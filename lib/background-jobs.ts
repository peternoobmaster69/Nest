import { prisma } from "@/lib/prisma";

export type BackgroundJobPhase = "idle" | "reading" | "writing" | "complete" | "error";

export type BackgroundJobProgress = {
  phase: BackgroundJobPhase;
  progress: number;
  message: string;
  total: number;
  current: number;
  updatedAt: number;
  jobId?: string;
  status?: string;
};

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function statusToPhase(status: string): BackgroundJobPhase {
  if (status === "SUCCEEDED" || status === "SKIPPED") return "complete";
  if (status === "FAILED") return "error";
  if (status === "RUNNING" || status === "PENDING") return "writing";
  return "idle";
}

export async function createBackgroundJob(params: {
  type: string;
  key?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
  message?: string;
  leaseMs?: number;
}) {
  const now = new Date();
  return prisma.backgroundJob.create({
    data: {
      type: params.type,
      key: params.key ?? null,
      workspaceId: params.workspaceId ?? null,
      userId: params.userId ?? null,
      status: "RUNNING",
      progress: 0,
      current: 0,
      total: 0,
      message: params.message ?? "Job started.",
      lockedAt: now,
      leaseExpiresAt: new Date(now.getTime() + (params.leaseMs ?? 15 * 60 * 1000)),
      startedAt: now,
    },
  });
}

export async function findActiveBackgroundJob(type: string, key: string) {
  return prisma.backgroundJob.findFirst({
    where: {
      type,
      key,
      status: { in: ["PENDING", "RUNNING"] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: new Date() } }],
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function findLatestBackgroundJob(type: string, key: string) {
  return prisma.backgroundJob.findFirst({
    where: { type, key },
    orderBy: { updatedAt: "desc" },
  });
}

export async function updateBackgroundJobProgress(
  jobId: string | null | undefined,
  next: {
    progress?: number;
    message?: string;
    total?: number;
    current?: number;
    leaseMs?: number;
  },
) {
  if (!jobId) return null;
  const now = new Date();
  return prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      progress: next.progress === undefined ? undefined : clampProgress(next.progress),
      message: next.message,
      total: next.total,
      current: next.current,
      leaseExpiresAt: new Date(now.getTime() + (next.leaseMs ?? 15 * 60 * 1000)),
    },
  });
}

export async function completeBackgroundJob(
  jobId: string | null | undefined,
  params: {
    message: string;
    result?: unknown;
    skipped?: boolean;
  },
) {
  if (!jobId) return null;
  return prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: params.skipped ? "SKIPPED" : "SUCCEEDED",
      progress: 100,
      message: params.message,
      resultJson: params.result === undefined ? undefined : JSON.stringify(params.result),
      error: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
    },
  });
}

export async function failBackgroundJob(jobId: string | null | undefined, error: unknown) {
  if (!jobId) return null;
  const message = error instanceof Error ? error.message : "Unknown error";
  return prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      progress: 100,
      message,
      error: message,
      leaseExpiresAt: null,
      finishedAt: new Date(),
    },
  });
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
  };
}
