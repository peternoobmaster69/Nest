import { APIError, toFile } from "openai";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/contracts";
import { getAiWorkloadClient } from "./config";
import type { AgentId } from "./agent-catalog";
import { AgentFineTuneRequestSchema } from "./agent-contracts";
import { agentHash, serializeAgentFineTuneJob } from "./agent-store";
import { agentDatasetLine, buildAgentDataset, loadAgentTrainingSnapshot } from "./agent-training";

const TERMINAL_STATUSES = ["SUCCEEDED", "FAILED", "CANCELLED"];

type FineTuneInput = z.infer<typeof AgentFineTuneRequestSchema>;
type TrainingSnapshot = Awaited<ReturnType<typeof loadAgentTrainingSnapshot>>;
type FineTuneClient = ReturnType<typeof getAiWorkloadClient>["client"];

function prepareFineTuneDatasets(snapshot: TrainingSnapshot) {
  const training = snapshot.examples.filter((example) => example.purpose === "TRAINING");
  if (training.length < 10) throw new ApiRequestError(422, "Approve at least 10 distinct training examples before starting fine-tuning.");
  const trainingJsonl = buildAgentDataset(snapshot.configuration, training, "TRAINING");
  // Evaluation assertions may be partial JSON or text. Only complete responses are valid provider validation data.
  const validation = snapshot.examples.filter((example) => {
    if (example.purpose !== "EVALUATION") return false;
    try { agentDatasetLine(snapshot.configuration, example); return true; } catch { return false; }
  });
  const validationJsonl = validation.length ? buildAgentDataset(snapshot.configuration, validation, "EVALUATION") : null;
  return { trainingJsonl, validationJsonl, trainingCount: training.length, validationCount: validation.length };
}

type FineTuneDatasets = ReturnType<typeof prepareFineTuneDatasets>;

async function reserveFineTuningJob(
  id: AgentId,
  input: FineTuneInput,
  actorUserId: string,
  requestHash: string,
  datasetHash: string,
  providerHash: string,
  datasets: FineTuneDatasets,
) {
  try {
    await prisma.$transaction(async (db) => {
      const active = await db.aiAgentFineTuneJob.findFirst({ where: { agentId: id, status: { notIn: TERMINAL_STATUSES } } });
      if (active) throw new ApiRequestError(409, "An existing training job is still active or needs a status refresh.");
      await db.aiAgentFineTuneJob.create({ data: { id: input.requestId, agentId: id, revision: input.revision, requestHash,
        datasetHash, providerHash, baseModel: input.baseModel, trainingType: input.trainingType,
        status: "SUBMITTING", trainingCount: datasets.trainingCount, validationCount: datasets.validationCount, actorUserId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      const existing = await prisma.aiAgentFineTuneJob.findUnique({ where: { id: input.requestId } });
      if (existing?.agentId === id && existing.requestHash === requestHash) return serializeAgentFineTuneJob(existing);
      throw new ApiRequestError(409, "A training job was started concurrently. Refresh its status before trying again.");
    }
    throw error;
  }
  return null;
}

async function submitFineTuningJob(id: AgentId, input: FineTuneInput, client: FineTuneClient, datasets: FineTuneDatasets) {
  let submissionStarted = false;
  try {
    const trainingFile = await client.files.create({ file: await toFile(Buffer.from(datasets.trainingJsonl), `${id}-training.jsonl`, { type: "application/jsonl" }), purpose: "fine-tune" }, { maxRetries: 0 });
    await prisma.aiAgentFineTuneJob.update({ where: { id: input.requestId }, data: { trainingFileId: trainingFile.id } });
    let validationFileId: string | undefined;
    if (datasets.validationJsonl) {
      const file = await client.files.create({ file: await toFile(Buffer.from(datasets.validationJsonl), `${id}-validation.jsonl`, { type: "application/jsonl" }), purpose: "fine-tune" }, { maxRetries: 0 });
      validationFileId = file.id;
      await prisma.aiAgentFineTuneJob.update({ where: { id: input.requestId }, data: { validationFileId } });
    }
    submissionStarted = true;
    const body = { model: input.baseModel, training_file: trainingFile.id, validation_file: validationFileId,
      suffix: `nest-${id}`.slice(0, 40), trainingType: input.trainingType,
      method: { type: "supervised" as const, supervised: { hyperparameters: { n_epochs: input.epochs } } } };
    const job = await client.fineTuning.jobs.create(body, { maxRetries: 0, timeout: 60_000, headers: { "Idempotency-Key": input.requestId } });
    return serializeAgentFineTuneJob(await prisma.aiAgentFineTuneJob.update({ where: { id: input.requestId }, data: {
      providerJobId: job.id, status: job.status.toUpperCase(), fineTunedModel: job.fine_tuned_model,
    } }));
  } catch (error) {
    const rejected = error instanceof APIError && Boolean(error.status && error.status >= 400 && error.status < 500 && error.status !== 408);
    const uncertain = submissionStarted && !rejected;
    const message = uncertain
      ? "Azure did not confirm the submission. Refresh to reconcile it before starting another job."
      : "Azure could not accept this training job. Check the resource's fine-tuning access, supported base model, training type, and quota.";
    return serializeAgentFineTuneJob(await prisma.aiAgentFineTuneJob.update({ where: { id: input.requestId }, data: { status: uncertain ? "UNKNOWN" : "FAILED", error: message } }));
  }
}

export async function startAgentFineTuning(id: AgentId, input: FineTuneInput, actorUserId: string) {
  const requestHash = agentHash({ id, ...input, actorUserId });
  const previous = await prisma.aiAgentFineTuneJob.findUnique({ where: { id: input.requestId } });
  if (previous) {
    if (previous.agentId !== id || previous.requestHash !== requestHash) throw new ApiRequestError(409, "This request ID belongs to another training job.");
    return serializeAgentFineTuneJob(previous);
  }
  const { client } = getAiWorkloadClient();
  const snapshot = await loadAgentTrainingSnapshot(id, input.revision);
  const datasets = prepareFineTuneDatasets(snapshot);
  const concurrent = await reserveFineTuningJob(id, input, actorUserId, requestHash, snapshot.datasetHash, agentHash(client.baseURL), datasets);
  if (concurrent) return concurrent;
  return submitFineTuningJob(id, input, client, datasets);
}

export async function updateAgentFineTuning(id: AgentId, jobId: string, action: "refresh" | "cancel") {
  const row = await prisma.aiAgentFineTuneJob.findFirst({ where: { id: jobId, agentId: id } });
  if (!row) throw new ApiRequestError(404, "Training job not found.");
  if (TERMINAL_STATUSES.includes(row.status)) return serializeAgentFineTuneJob(row);
  const { client } = getAiWorkloadClient();
  if (row.providerHash !== agentHash(client.baseURL)) throw new ApiRequestError(409, "This job belongs to a different Azure resource. Restore that resource's connection to manage it.");
  let providerJobId = row.providerJobId;
  if (!providerJobId) {
    if (row.status === "SUBMITTING" && Date.now() - row.updatedAt.getTime() < 120_000) throw new ApiRequestError(409, "The job is still being submitted. Refresh shortly.");
    if (row.trainingFileId) {
      const jobs = await client.fineTuning.jobs.list({ limit: 100 });
      providerJobId = jobs.data.find((job) => job.training_file === row.trainingFileId)?.id ?? null;
    }
    if (!providerJobId) {
      return serializeAgentFineTuneJob(await prisma.aiAgentFineTuneJob.update({ where: { id: row.id }, data: {
        status: "UNKNOWN", error: "No matching job was returned yet. Check this submission in Azure before creating another training job.",
      } }));
    }
  }
  const job = action === "cancel"
    ? await client.fineTuning.jobs.cancel(providerJobId, { maxRetries: 0 })
    : await client.fineTuning.jobs.retrieve(providerJobId);
  return serializeAgentFineTuneJob(await prisma.aiAgentFineTuneJob.update({ where: { id: row.id }, data: {
    providerJobId: job.id, status: job.status.toUpperCase(), fineTunedModel: job.fine_tuned_model,
    error: job.error?.message ? "Azure reported a training failure. Review the job's diagnostics in Azure." : null,
  } }));
}
