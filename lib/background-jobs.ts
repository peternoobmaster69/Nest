import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/observability/logger";

type BackgroundJobPhase = "idle" | "queued" | "reading" | "writing" | "complete" | "error" | "cancelled";

export type BackgroundJobProgress = {
  phase: BackgroundJobPhase;
  progress: number;
  message: string;
  total: number;
  current: number;
  updatedAt: number;
  jobId?: string;
  status?: string;
  attempts?: number;
  retryCount?: number;
  errorCode?: string | null;
};

export class BackgroundJobError extends Error {
  constructor(
    public readonly code: string,
    safeMessage: string,
    public readonly retryable = false,
  ) {
    super(safeMessage);
    this.name = "BackgroundJobError";
  }
}

type JobFailure = { code: string; message: string; retryable: boolean };

const DEFAULT_LEASE_MS = 5 * 60_000;

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function activeScopeHash(type: string, scopeKey: string | null | undefined) {
  return scopeKey ? digest(`${type}\0${scopeKey}`) : null;
}

function idempotencyHash(type: string, idempotencyKey: string | null | undefined) {
  return idempotencyKey ? digest(`${type}\0${idempotencyKey}`) : null;
}

function statusToPhase(status: string): BackgroundJobPhase {
  if (status === "SUCCEEDED" || status === "SKIPPED") return "complete";
  if (status === "FAILED" || status === "DEAD_LETTER") return "error";
  if (status === "CANCELLED") return "cancelled";
  if (status === "PENDING") return "queued";
  if (status === "RUNNING") return "writing";
  return "idle";
}

export function sanitizeBackgroundJobError(error: unknown): JobFailure {
  if (error instanceof BackgroundJobError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    const rawConstraint = error.meta?.constraint ?? error.meta?.field_name;
    const constraint = typeof rawConstraint === "string" && /^[A-Za-z0-9_]{1,64}$/.test(rawConstraint)
      ? rawConstraint
      : null;
    return {
      code: constraint ? `P2003:${constraint}` : "P2003",
      message: "The background job could not be completed because stored data failed database validation.",
      retryable: false,
    };
  }

  const candidate = error as { code?: unknown; retryable?: unknown; safeMessage?: unknown } | null;
  const code = typeof candidate?.code === "string" && /^[A-Z0-9_:-]{1,80}$/.test(candidate.code)
    ? candidate.code
    : "JOB_FAILED";
  const safeMessage = typeof candidate?.safeMessage === "string" ? candidate.safeMessage : null;
  return {
    code,
    message: safeMessage || "The background job could not be completed.",
    retryable: candidate?.retryable === true,
  };
}

export async function enqueueBackgroundJob(params: {
  type: string;
  key: string;
  workspaceId?: string | null;
  userId?: string | null;
  message?: string;
  payload?: unknown;
  checkpoint?: unknown;
  idempotencyKey?: string | null;
  maxAttempts?: number;
  availableAt?: Date;
}) {
  const scopeHash = activeScopeHash(params.type, params.key);
  const dedupeHash = idempotencyHash(params.type, params.idempotencyKey);
  try {
    const job = await prisma.backgroundJob.create({
      data: {
        type: params.type,
        key: params.key,
        activeScopeKey: scopeHash,
        idempotencyKey: dedupeHash,
        workspaceId: params.workspaceId ?? null,
        userId: params.userId ?? null,
        status: "PENDING",
        progress: 0,
        current: 0,
        total: 0,
        message: params.message ?? "Job queued.",
        payloadJson: params.payload === undefined ? null : JSON.stringify(params.payload),
        checkpointJson: params.checkpoint === undefined ? null : JSON.stringify(params.checkpoint),
        maxAttempts: Math.max(1, Math.min(25, params.maxAttempts ?? 5)),
        availableAt: params.availableAt ?? new Date(),
      },
    });
    logEvent("info", "job.enqueued", {
      jobId: job.id,
      jobType: job.type,
      workspaceId: job.workspaceId,
      status: job.status,
    });
    return { job, created: true, duplicateReason: null as null | "active" | "idempotent" };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;

    const existing = await prisma.backgroundJob.findFirst({
      where: {
        OR: [
          ...(dedupeHash ? [{ idempotencyKey: dedupeHash }] : []),
          ...(scopeHash ? [{ activeScopeKey: scopeHash }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (!existing) throw error;
    const duplicateReason = dedupeHash && existing.idempotencyKey === dedupeHash ? "idempotent" : "active";
    const job = await prisma.backgroundJob.update({
      where: { id: existing.id },
      data: { duplicateCount: { increment: 1 } },
    });
    logEvent("info", "job.duplicate_suppressed", {
      jobId: job.id,
      jobType: job.type,
      workspaceId: job.workspaceId,
      duplicateReason,
    });
    return { job, created: false, duplicateReason };
  }
}

async function expireAbandonedJob(jobId: string, now: Date) {
  const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (job?.status !== "RUNNING" || !job.leaseExpiresAt || job.leaseExpiresAt > now) return;

  if (job.cancelRequestedAt) {
    await prisma.backgroundJob.updateMany({
      where: { id: job.id, status: "RUNNING", leaseExpiresAt: { lte: now } },
      data: {
        status: "CANCELLED",
        activeScopeKey: null,
        message: "Job cancelled.",
        leaseToken: null,
        lockedAt: null,
        leaseExpiresAt: null,
        finishedAt: now,
      },
    });
    return;
  }

  const nextRetryCount = job.retryCount + 1;
  const deadLetter = nextRetryCount >= job.maxAttempts;
  await prisma.backgroundJob.updateMany({
    where: { id: job.id, status: "RUNNING", leaseExpiresAt: { lte: now } },
    data: deadLetter
      ? {
          status: "DEAD_LETTER",
          activeScopeKey: null,
          retryCount: nextRetryCount,
          errorCode: "LEASE_EXPIRED",
          error: "The worker stopped before completing this job.",
          message: "Job moved to dead letters after repeated interrupted attempts.",
          leaseToken: null,
          leaseExpiresAt: null,
          deadLetteredAt: now,
          finishedAt: now,
        }
      : {
          status: "PENDING",
          retryCount: nextRetryCount,
          errorCode: "LEASE_EXPIRED",
          error: "The worker stopped before completing this job.",
          message: "Interrupted job queued for retry.",
          availableAt: new Date(now.getTime() + retryDelayMs(nextRetryCount)),
          leaseToken: null,
          leaseExpiresAt: null,
        },
  });
}

async function recoverExpiredBackgroundJobs(type?: string) {
  const now = new Date();
  const expired = await prisma.backgroundJob.findMany({
    where: { type, status: "RUNNING", leaseExpiresAt: { lte: now } },
    select: { id: true },
    take: 50,
  });
  for (const job of expired) await expireAbandonedJob(job.id, now);
  return expired.length;
}

export async function claimBackgroundJob(params: { jobId?: string; type?: string; leaseMs?: number }) {
  const now = new Date();
  await recoverExpiredBackgroundJobs(params.type);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = await prisma.backgroundJob.findFirst({
      where: {
        id: params.jobId,
        type: params.type,
        status: "PENDING",
        availableAt: { lte: now },
        cancelRequestedAt: null,
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;

    const leaseToken = randomUUID();
    const claimed = await prisma.backgroundJob.updateMany({
      where: {
        id: candidate.id,
        status: "PENDING",
        availableAt: { lte: now },
        cancelRequestedAt: null,
      },
      data: {
        status: "RUNNING",
        leaseToken,
        lockedAt: now,
        leaseExpiresAt: new Date(now.getTime() + (params.leaseMs ?? DEFAULT_LEASE_MS)),
        startedAt: candidate.startedAt ?? now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 1) {
      const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: candidate.id } });
      logEvent("info", "job.claimed", {
        jobId: job.id,
        jobType: job.type,
        workspaceId: job.workspaceId,
        attempts: job.attempts,
      });
      return { job, leaseToken };
    }
  }
  return null;
}

export async function heartbeatBackgroundJob(
  jobId: string,
  leaseToken: string,
  next: {
    progress?: number;
    message?: string;
    total?: number;
    current?: number;
    checkpoint?: unknown;
    leaseMs?: number;
  },
) {
  const updated = await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: "RUNNING", leaseToken, cancelRequestedAt: null },
    data: {
      progress: next.progress === undefined ? undefined : clampProgress(next.progress),
      message: next.message,
      total: next.total,
      current: next.current,
      checkpointJson: next.checkpoint === undefined ? undefined : JSON.stringify(next.checkpoint),
      leaseExpiresAt: new Date(Date.now() + (next.leaseMs ?? DEFAULT_LEASE_MS)),
    },
  });
  if (updated.count !== 1) throw new BackgroundJobError("LEASE_LOST", "This job no longer owns its worker lease.");
}

export async function continueBackgroundJob(
  jobId: string,
  leaseToken: string,
  params: { checkpoint: unknown; message: string; progress?: number; current?: number; total?: number; delayMs?: number },
) {
  const updated = await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: "RUNNING", leaseToken, cancelRequestedAt: null },
    data: {
      status: "PENDING",
      checkpointJson: JSON.stringify(params.checkpoint),
      message: params.message,
      progress: params.progress === undefined ? undefined : clampProgress(params.progress),
      current: params.current,
      total: params.total,
      availableAt: new Date(Date.now() + (params.delayMs ?? 0)),
      leaseToken: null,
      lockedAt: null,
      leaseExpiresAt: null,
    },
  });
  if (updated.count !== 1) throw new BackgroundJobError("LEASE_LOST", "This job no longer owns its worker lease.");
}

export async function completeClaimedBackgroundJob(
  jobId: string,
  leaseToken: string,
  params: { message: string; result?: unknown; skipped?: boolean },
) {
  const updated = await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: "RUNNING", leaseToken },
    data: {
      status: params.skipped ? "SKIPPED" : "SUCCEEDED",
      activeScopeKey: null,
      progress: 100,
      message: params.message,
      resultJson: params.result === undefined ? undefined : JSON.stringify(params.result),
      errorCode: null,
      error: null,
      leaseToken: null,
      lockedAt: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
    },
  });
  if (updated.count !== 1) throw new BackgroundJobError("LEASE_LOST", "This job no longer owns its worker lease.");
  logEvent("info", "job.completed", { jobId, status: params.skipped ? "SKIPPED" : "SUCCEEDED" });
}

function retryDelayMs(retryCount: number) {
  return Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, retryCount - 1));
}

export async function failClaimedBackgroundJob(jobId: string, leaseToken: string, error: unknown) {
  const failure = sanitizeBackgroundJobError(error);
  const job = await prisma.backgroundJob.findFirst({ where: { id: jobId, status: "RUNNING", leaseToken } });
  if (!job) return null;
  const retryCount = job.retryCount + 1;
  if (job.cancelRequestedAt) {
    const cancelled = await prisma.backgroundJob.updateMany({
      where: { id: jobId, status: "RUNNING", leaseToken },
      data: {
        status: "CANCELLED",
        activeScopeKey: null,
        message: "Job cancelled.",
        leaseToken: null,
        lockedAt: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
      },
    });
    return cancelled.count === 1 ? { retrying: false, failure } : null;
  }
  const shouldRetry = failure.retryable && retryCount < job.maxAttempts && !job.cancelRequestedAt;
  const now = new Date();
  const updated = await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: "RUNNING", leaseToken },
    data: shouldRetry
      ? {
          status: "PENDING",
          retryCount,
          message: `Retry ${retryCount}/${job.maxAttempts - 1} queued.`,
          errorCode: failure.code,
          error: failure.message,
          availableAt: new Date(now.getTime() + retryDelayMs(retryCount)),
          leaseToken: null,
          lockedAt: null,
          leaseExpiresAt: null,
        }
      : {
          status: failure.retryable ? "DEAD_LETTER" : "FAILED",
          activeScopeKey: null,
          retryCount,
          progress: 100,
          message: failure.message,
          errorCode: failure.code,
          error: failure.message,
          leaseToken: null,
          lockedAt: null,
          leaseExpiresAt: null,
          deadLetteredAt: failure.retryable ? now : null,
          finishedAt: now,
        },
  });
  logEvent(shouldRetry ? "warn" : "error", "job.failed", {
    jobId,
    jobType: job.type,
    workspaceId: job.workspaceId,
    retrying: shouldRetry,
    retryCount,
    errorCode: failure.code,
    error,
  });
  return updated.count === 1 ? { retrying: shouldRetry, failure } : null;
}

export async function requestBackgroundJobCancellation(jobId: string) {
  const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!job || !["PENDING", "RUNNING"].includes(job.status)) return job;
  const now = new Date();
  if (job.status === "PENDING") {
    return prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        activeScopeKey: null,
        cancelRequestedAt: now,
        message: "Job cancelled.",
        finishedAt: now,
      },
    });
  }
  return prisma.backgroundJob.update({
    where: { id: job.id },
    data: { cancelRequestedAt: now, message: "Cancellation requested." },
  });
}

export async function throwIfBackgroundJobCancelled(jobId: string, leaseToken: string) {
  const job = await prisma.backgroundJob.findFirst({
    where: { id: jobId, status: "RUNNING", leaseToken },
    select: { cancelRequestedAt: true },
  });
  if (!job) throw new BackgroundJobError("LEASE_LOST", "This job no longer owns its worker lease.");
  if (job.cancelRequestedAt) {
    const now = new Date();
    await prisma.backgroundJob.updateMany({
      where: { id: jobId, status: "RUNNING", leaseToken },
      data: {
        status: "CANCELLED",
        activeScopeKey: null,
        message: "Job cancelled.",
        leaseToken: null,
        lockedAt: null,
        leaseExpiresAt: null,
        finishedAt: now,
      },
    });
    throw new BackgroundJobError("JOB_CANCELLED", "Job cancelled.");
  }
}

export async function retryBackgroundJob(jobId: string) {
  const existing = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!existing || !["FAILED", "DEAD_LETTER", "CANCELLED"].includes(existing.status)) return null;
  const scopeHash = activeScopeHash(existing.type, existing.key);
  try {
    return await prisma.backgroundJob.update({
      where: { id: existing.id },
      data: {
        status: "PENDING",
        activeScopeKey: scopeHash,
        progress: 0,
        message: "Job manually queued for retry.",
        retryCount: 0,
        availableAt: new Date(),
        leaseToken: null,
        lockedAt: null,
        leaseExpiresAt: null,
        cancelRequestedAt: null,
        deadLetteredAt: null,
        finishedAt: null,
        errorCode: null,
        error: null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BackgroundJobError("SCOPE_BUSY", "Another job already owns this scope.");
    }
    throw error;
  }
}

export async function findLatestBackgroundJob(type: string, key: string) {
  return prisma.backgroundJob.findFirst({ where: { type, key }, orderBy: { updatedAt: "desc" } });
}

export function backgroundJobToProgress(
  job: Awaited<ReturnType<typeof findLatestBackgroundJob>>,
  now = Date.now(),
): BackgroundJobProgress | null {
  if (!job) return null;
  const expired =
    (job.status === "PENDING" || job.status === "RUNNING") &&
    job.leaseExpiresAt !== null &&
    job.leaseExpiresAt.getTime() <= now;
  if (expired) {
    return {
      phase: "error",
      progress: 100,
      message: "Background job stopped before completion. Please retry.",
      total: job.total ?? 0,
      current: job.current ?? 0,
      updatedAt: job.updatedAt.getTime(),
      jobId: job.id,
      status: job.status,
      attempts: job.attempts,
      retryCount: job.retryCount,
      errorCode: job.errorCode ?? "LEASE_EXPIRED",
    };
  }
  return {
    phase: statusToPhase(job.status),
    progress: clampProgress(job.progress),
    message: job.message ?? "",
    total: job.total ?? 0,
    current: job.current ?? 0,
    updatedAt: job.updatedAt.getTime(),
    jobId: job.id,
    status: job.status,
    attempts: job.attempts,
    retryCount: job.retryCount,
    errorCode: job.errorCode,
  };
}
