import { createHash } from "node:crypto";
import { Prisma, type AiAgentEvaluation, type AiAgentFineTuneJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/contracts";
import { AGENT_IDS, defaultAgentConfiguration, type AgentConfiguration, type AgentId, type AgentSettings } from "./agent-catalog";
import {
  AgentExampleSchema, AgentSettingsSchema, validateAgentCapabilities,
  type AgentDetail, type AgentEvaluation, type AgentEvaluationResult, type AgentExampleInput,
  type AgentFineTuneJob, type AgentRegistry, type AgentSummary,
} from "./agent-contracts";
import { decodeAgentConfiguration, decodeAgentExample } from "./agent-runtime";
import { getAiWorkloadStatus } from "./config";

type Db = Prisma.TransactionClient;

export function stableAgentJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableAgentJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableAgentJson(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function agentHash(value: unknown) { return createHash("sha256").update(stableAgentJson(value)).digest("hex"); }

export function serializeAgentEvaluation(row: AiAgentEvaluation): AgentEvaluation {
  const status = row.status === "RUNNING" && Date.now() - row.createdAt.getTime() >= 180_000 ? "INTERRUPTED" : row.status;
  return { id: row.id, revision: row.revision, datasetHash: row.datasetHash, status, passedCount: row.passedCount,
    totalCount: row.totalCount, results: JSON.parse(row.resultsJson) as AgentEvaluationResult[], createdAt: row.createdAt.toISOString() };
}

export function serializeAgentFineTuneJob(row: AiAgentFineTuneJob): AgentFineTuneJob {
  return { id: row.id, providerJobId: row.providerJobId, baseModel: row.baseModel, trainingType: row.trainingType,
    status: row.status, fineTunedModel: row.fineTunedModel, trainingCount: row.trainingCount, validationCount: row.validationCount,
    revision: row.revision, error: row.error, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function getAgentRegistry(): Promise<AgentRegistry> {
  const [rows, counts] = await Promise.all([
    prisma.aiAgentConfig.findMany({ where: { id: { in: [...AGENT_IDS] } } }),
    prisma.aiAgentExample.groupBy({ by: ["agentId", "purpose", "status"], _count: { _all: true } }),
  ]);
  const agents = AGENT_IDS.map((id): AgentSummary => {
    const row = rows.find((entry) => entry.id === id);
    const count = (purpose: string, status = "APPROVED") => counts.filter((entry) => entry.agentId === id && entry.purpose === purpose && entry.status === status).reduce((sum, entry) => sum + entry._count._all, 0);
    return { configuration: row ? decodeAgentConfiguration(row) : defaultAgentConfiguration(id), trainingCount: count("TRAINING"),
      evaluationCount: count("EVALUATION"), draftCount: count("TRAINING", "DRAFT") + count("EVALUATION", "DRAFT") };
  });
  return { agents, provider: getAiWorkloadStatus() };
}

export async function getAgentDetail(id: AgentId): Promise<AgentDetail> {
  const [registry, examples, evaluations, jobs, revisions] = await Promise.all([
    getAgentRegistry(),
    prisma.aiAgentExample.findMany({ where: { agentId: id }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 250 }),
    prisma.aiAgentEvaluation.findMany({ where: { agentId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.aiAgentFineTuneJob.findMany({ where: { agentId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.aiAgentRevision.findMany({ where: { agentId: id }, orderBy: { revision: "desc" }, take: 10 }),
  ]);
  return { ...registry.agents.find((agent) => agent.configuration.id === id)!, examples: examples.map(decodeAgentExample),
    evaluations: evaluations.map(serializeAgentEvaluation), fineTuningJobs: jobs.map(serializeAgentFineTuneJob),
    revisions: revisions.map((revision) => ({ revision: revision.revision, settings: AgentSettingsSchema.parse(JSON.parse(revision.settingsJson)),
      action: revision.action, createdAt: revision.createdAt.toISOString() })) };
}

function configurationData(settings: AgentSettings) {
  const { capabilities, ...values } = settings;
  return { ...values, capabilitiesJson: JSON.stringify(capabilities) };
}

function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
    throw new ApiRequestError(409, "The agent changed, or this example already exists. Refresh and try again.");
  }
  throw error;
}

async function writeRevision(db: Db, id: AgentId, settings: AgentSettings, current: AgentConfiguration, actorUserId: string, action = "CONFIGURATION", targetId?: string) {
  const revision = current.revision + 1;
  const data = { ...configurationData(settings), revision, updatedByUserId: actorUserId };
  if (current.revision) {
    const updated = await db.aiAgentConfig.updateMany({ where: { id, revision: current.revision }, data });
    if (updated.count !== 1) throw new ApiRequestError(409, "The agent changed. Refresh before saving.");
  } else {
    await db.aiAgentConfig.create({ data: { id, ...data } });
  }
  await db.aiAgentRevision.create({ data: { agentId: id, revision, settingsJson: JSON.stringify(settings), actorUserId, action, targetId } });
  return decodeAgentConfiguration(await db.aiAgentConfig.findUniqueOrThrow({ where: { id } }));
}

async function currentConfiguration(db: Db, id: AgentId) {
  const row = await db.aiAgentConfig.findUnique({ where: { id } });
  return row ? decodeAgentConfiguration(row) : defaultAgentConfiguration(id);
}

export async function saveAgentConfiguration(id: AgentId, input: AgentSettings & { revision: number }, actorUserId: string) {
  const settings = AgentSettingsSchema.parse({
    enabled: input.enabled, instructions: input.instructions, deployment: input.deployment, reasoningEffort: input.reasoningEffort,
    maxOutputTokens: input.maxOutputTokens, maxToolRounds: input.maxToolRounds, maxToolCalls: input.maxToolCalls,
    trainingExampleLimit: input.trainingExampleLimit, capabilities: input.capabilities,
  });
  if (!validateAgentCapabilities(id, settings.capabilities)) throw new ApiRequestError(422, "Choose capabilities registered for this agent.");
  if (settings.maxToolCalls < settings.maxToolRounds) throw new ApiRequestError(422, "The tool-call allowance must cover the number of tool rounds.");
  try {
    return await prisma.$transaction(async (db) => {
      const current = await currentConfiguration(db, id);
      if (current.revision !== input.revision) throw new ApiRequestError(409, "The agent changed. Refresh before saving.");
      return writeRevision(db, id, settings, current, actorUserId);
    });
  } catch (error) { return conflict(error); }
}

function validateExample(input: AgentExampleInput) {
  const parsed = AgentExampleSchema.parse(input);
  if (parsed.matchMode === "JSON_SUBSET") {
    try {
      const expected: unknown = JSON.parse(parsed.expectedOutput);
      if (expected && typeof expected === "object" && !Object.keys(expected).length) throw new Error("Empty assertion");
    } catch { throw new ApiRequestError(422, "A JSON field check needs valid, non-empty expected JSON."); }
  }
  return parsed;
}

export async function saveAgentExample(id: AgentId, input: AgentExampleInput, actorUserId: string, existing?: { id: string; revision: number }) {
  const data = validateExample(input);
  const contentHash = agentHash({ input: data.input.toLowerCase().replace(/\s+/g, " "), context: JSON.parse(data.contextJson) });
  try {
    return await prisma.$transaction(async (db) => {
      const current = await currentConfiguration(db, id);
      if (!existing && await db.aiAgentExample.count({ where: { agentId: id } }) >= 250) throw new ApiRequestError(422, "Keep at most 250 curated examples per agent.");
      let exampleId = existing?.id;
      if (existing) {
        const changed = await db.aiAgentExample.updateMany({ where: { id: existing.id, agentId: id, revision: existing.revision },
          data: { ...data, contentHash, revision: { increment: 1 }, updatedByUserId: actorUserId } });
        if (changed.count !== 1) throw new ApiRequestError(409, "This example changed or was removed. Refresh before saving.");
      } else {
        const example = await db.aiAgentExample.create({ data: { ...data, agentId: id, contentHash, updatedByUserId: actorUserId } });
        exampleId = example.id;
      }
      const settings = AgentSettingsSchema.strip().parse(current);
      await writeRevision(db, id, settings, current, actorUserId, existing ? "EXAMPLE_UPDATED" : "EXAMPLE_CREATED", exampleId);
      return decodeAgentExample(await db.aiAgentExample.findUniqueOrThrow({ where: { id: exampleId } }));
    });
  } catch (error) { return conflict(error); }
}

export async function deleteAgentExample(id: AgentId, exampleId: string, revision: number, actorUserId: string) {
  try {
    await prisma.$transaction(async (db) => {
      const current = await currentConfiguration(db, id);
      const deleted = await db.aiAgentExample.deleteMany({ where: { id: exampleId, agentId: id, revision } });
      if (deleted.count !== 1) throw new ApiRequestError(409, "This example changed or was removed. Refresh before deleting it.");
      const settings = AgentSettingsSchema.strip().parse(current);
      await writeRevision(db, id, settings, current, actorUserId, "EXAMPLE_DELETED", exampleId);
    });
  } catch (error) { conflict(error); }
}
