import { isGmailSyncRunning, runGmailSyncForIntegration } from "@/lib/gmail-sync-runner";
import { GMAIL_SYNC_JOB_TYPE, getGmailSyncJobKey } from "@/lib/gmail-sync-runner";
import {
  backgroundJobToProgress,
  createBackgroundJob,
  failBackgroundJob,
  findActiveBackgroundJob,
  findLatestBackgroundJob,
} from "@/lib/background-jobs";
import {
  clearGmailSyncProgressLater,
  getGmailSyncProgress,
  getGmailSyncProgressKey,
  setGmailSyncProgress,
} from "@/lib/gmail-sync-progress";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { workspaceId, userId } = await requireWorkspaceAccess(null, "OWNER");
    const key = getGmailSyncProgressKey(workspaceId, userId);
    const memoryProgress = getGmailSyncProgress(key);
    if (memoryProgress.phase !== "idle") {
      return NextResponse.json(memoryProgress);
    }

    const integration = await prisma.gmailIntegration.findFirst({
      where: { workspaceId, userId, isActive: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!integration) {
      return NextResponse.json(memoryProgress);
    }

    const persisted = backgroundJobToProgress(
      await findLatestBackgroundJob(GMAIL_SYNC_JOB_TYPE, getGmailSyncJobKey(integration.id)),
    );
    return NextResponse.json(persisted ?? memoryProgress);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch Gmail sync progress", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let progressKey = "";
  try {
    const { workspaceId, userId } = await requireWorkspaceAccess(null, "OWNER");
    progressKey = getGmailSyncProgressKey(workspaceId, userId);
    const integration = await prisma.gmailIntegration.findFirst({
      where: { workspaceId, userId, isActive: true },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        lastSyncedAt: true,
      },
    });

    if (!integration) {
      return NextResponse.json({ error: "Gmail is not connected." }, { status: 400 });
    }

    if (isGmailSyncRunning(integration.id)) {
      setGmailSyncProgress(progressKey, {
        phase: "reading",
        progress: 0,
        message: "Gmail sync is already running...",
        total: 0,
        current: 0,
      });
      return NextResponse.json({ error: "Gmail sync is already running." }, { status: 409 });
    }

    const activeJob = await findActiveBackgroundJob(GMAIL_SYNC_JOB_TYPE, getGmailSyncJobKey(integration.id));
    if (activeJob) {
      return NextResponse.json(
        {
          ok: true,
          queued: false,
          jobId: activeJob.id,
          message: activeJob.message ?? "Gmail sync is already running.",
        },
        { status: 202 },
      );
    }

    const job = await createBackgroundJob({
      type: GMAIL_SYNC_JOB_TYPE,
      key: getGmailSyncJobKey(integration.id),
      workspaceId,
      userId,
      message: "Gmail sync queued.",
    });

    void runGmailSyncForIntegration(integration, new URL(request.url).origin, job.id).catch(async (error) => {
      console.error("Gmail sync background job error:", error);
      await failBackgroundJob(job.id, error);
    });

    return NextResponse.json({
      ok: true,
      queued: true,
      jobId: job.id,
    }, { status: 202 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Gmail sync error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (progressKey) {
      setGmailSyncProgress(progressKey, {
        phase: "error",
        progress: 100,
        message,
      });
      clearGmailSyncProgressLater(progressKey);
    }
    return NextResponse.json({ error: "Failed to sync Gmail", message }, { status: 500 });
  }
}
