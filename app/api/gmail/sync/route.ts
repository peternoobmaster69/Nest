import { backgroundJobToProgress, findLatestBackgroundJob } from "@/lib/domains/jobs";
import {
  GMAIL_SYNC_JOB_TYPE,
  getGmailSyncJobKey,
  processGmailSyncQueue,
  queueGmailSyncForIntegration,
} from "@/lib/domains/integrations";
import { prisma } from "@/lib/prisma";
import { runSecureApiRoute } from "@/lib/api-security";
import { enforceDistributedRateLimit } from "@/lib/security-rate-limit";
import { NextResponse } from "next/server";

export const maxDuration = 300;

async function findIntegration(workspaceId: string, userId: string) {
  return prisma.gmailIntegration.findFirst({
    where: { workspaceId, userId, isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, workspaceId: true, userId: true, lastSyncedAt: true, lastHistoryId: true },
  });
}

export async function GET(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "OWNER" },
    errorMessage: "Failed to fetch Gmail sync progress",
  }, async ({ auth }) => {
    const integration = await findIntegration(auth!.workspaceId, auth!.userId);
    if (!integration) {
      return NextResponse.json({ phase: "idle", progress: 0, message: "", total: 0, current: 0, updatedAt: Date.now() });
    }
    const persisted = backgroundJobToProgress(
      await findLatestBackgroundJob(GMAIL_SYNC_JOB_TYPE, getGmailSyncJobKey(integration.id)),
    );
    return NextResponse.json(persisted ?? { phase: "idle", progress: 0, message: "", total: 0, current: 0, updatedAt: Date.now() });
  });
}

export async function POST(request: Request) {
  return runSecureApiRoute(request, {
    mutation: true,
    auth: { minimumRole: "OWNER" },
    errorMessage: "Failed to sync Gmail",
  }, async ({ auth }) => {
    const { workspaceId, userId } = auth!;
    await enforceDistributedRateLimit(request, {
      scope: "gmail-sync",
      identifier: `${workspaceId}:${userId}`,
      limit: 4,
      windowMs: 5 * 60_000,
      blockMs: 5 * 60_000,
    });
    const integration = await findIntegration(workspaceId, userId);
    if (!integration) return NextResponse.json({ error: "Gmail is not connected." }, { status: 400 });

    const queued = await queueGmailSyncForIntegration(integration);
    if (queued.job.status === "PENDING") {
      // Work is awaited and bounded. If this invocation is interrupted, the durable lease is recovered by cron.
      await processGmailSyncQueue({
        jobId: queued.job.id,
        origin: new URL(request.url).origin,
        maxSlices: 10,
      });
    }

    const job = await prisma.backgroundJob.findUnique({ where: { id: queued.job.id } });
    if (job?.status === "SUCCEEDED" || job?.status === "SKIPPED") {
      let summary = {};
      try { summary = JSON.parse(job.resultJson ?? "{}"); } catch {}
      return NextResponse.json({ ok: true, jobId: job.id, ...summary });
    }
    return NextResponse.json({
      ok: true,
      queued: job?.status === "PENDING",
      jobId: queued.job.id,
      message: job?.message ?? "Gmail sync queued.",
      errorCode: job?.errorCode ?? null,
    }, { status: 202 });
  });
}
