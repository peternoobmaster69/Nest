import { ingestCreditAlert } from "@/lib/credit-alert-ingest";
import { buildGmailAlertQuery, getGmailSyncWindowLabel, isGmailSyncDue } from "@/lib/gmail-alert-query";
import { ensureActiveGmailAccessToken, fetchGmailMessage, listGmailMessageIds } from "@/lib/gmail";
import {
  clearGmailSyncProgressLater,
  getGmailSyncProgressKey,
  setGmailSyncProgress,
  type GmailSyncProgressState,
} from "@/lib/gmail-sync-progress";
import {
  completeBackgroundJob,
  createBackgroundJob,
  failBackgroundJob,
  findActiveBackgroundJob,
  updateBackgroundJobProgress,
} from "@/lib/background-jobs";
import { prisma } from "@/lib/prisma";

type GmailIntegrationRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  lastSyncedAt: Date | null;
};

type GmailSyncResult = {
  scannedMessages: number;
  processed: number;
  duplicates: number;
  failed: number;
  jobId?: string;
  skipped?: boolean;
  reason?: string;
};

const activeSyncs = new Set<string>();
export const GMAIL_SYNC_JOB_TYPE = "GMAIL_SYNC";

export function getGmailSyncJobKey(integrationId: string) {
  return `gmail:${integrationId}`;
}

export function isGmailSyncRunning(integrationId: string) {
  return activeSyncs.has(integrationId);
}

export async function runGmailSyncForIntegration(
  integration: GmailIntegrationRecord,
  origin?: string,
  jobId?: string,
): Promise<GmailSyncResult> {
  if (activeSyncs.has(integration.id)) {
    throw new Error("Gmail sync is already running.");
  }

  if (!jobId) {
    const activeJob = await findActiveBackgroundJob(GMAIL_SYNC_JOB_TYPE, getGmailSyncJobKey(integration.id));
    if (activeJob) {
      return {
        scannedMessages: 0,
        processed: 0,
        duplicates: 0,
        failed: 0,
        skipped: true,
        reason: "Gmail sync is already running.",
        jobId: activeJob.id,
      };
    }
  }

  activeSyncs.add(integration.id);
  const progressKey = getGmailSyncProgressKey(integration.workspaceId, integration.userId);
  let persistedJobId = jobId;
  let lastPersistedProgressAt = 0;

  if (!persistedJobId) {
    const job = await createBackgroundJob({
      type: GMAIL_SYNC_JOB_TYPE,
      key: getGmailSyncJobKey(integration.id),
      workspaceId: integration.workspaceId,
      userId: integration.userId,
      message: "Connecting to Gmail...",
    });
    persistedJobId = job.id;
  }

  const publishProgress = async (
    next: Partial<GmailSyncProgressState> & Pick<GmailSyncProgressState, "phase">,
    persist = false,
  ) => {
    setGmailSyncProgress(progressKey, next);
    const now = Date.now();
    if (persist || now - lastPersistedProgressAt >= 2000) {
      lastPersistedProgressAt = now;
      await updateBackgroundJobProgress(persistedJobId, {
        progress: next.progress,
        message: next.message,
        total: next.total,
        current: next.current,
      });
    }
  };

  try {
    const freshIntegration = await prisma.gmailIntegration.findUnique({
      where: { id: integration.id },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        lastSyncedAt: true,
      },
    });

    if (!freshIntegration) {
      throw new Error("Gmail integration not found.");
    }

    if (!isGmailSyncDue(freshIntegration.lastSyncedAt)) {
      const reason = `Gmail sync skipped. Last synced at ${freshIntegration.lastSyncedAt?.toLocaleString("en-SG", {
        timeZone: "Asia/Singapore",
      })}.`;
      await publishProgress({
        phase: "complete",
        progress: 100,
        message: reason,
        total: 0,
        current: 0,
      }, true);
      await completeBackgroundJob(persistedJobId, {
        message: reason,
        result: { scannedMessages: 0, processed: 0, duplicates: 0, failed: 0, skipped: true },
        skipped: true,
      });
      clearGmailSyncProgressLater(progressKey);
      return {
        scannedMessages: 0,
        processed: 0,
        duplicates: 0,
        failed: 0,
        skipped: true,
        reason,
        jobId: persistedJobId,
      };
    }

    await publishProgress({
      phase: "reading",
      progress: 0,
      message: "Connecting to Gmail...",
      total: 0,
      current: 0,
    }, true);

    const accessToken = await ensureActiveGmailAccessToken(freshIntegration.id, origin);
    const gmailQuery = buildGmailAlertQuery(freshIntegration.lastSyncedAt);
    const windowLabel = getGmailSyncWindowLabel(freshIntegration.lastSyncedAt);
    const ids = await listGmailMessageIds(accessToken, gmailQuery);

    await publishProgress({
      phase: "reading",
      progress: ids.length ? 5 : 30,
      message: ids.length ? `Reading email contents from ${windowLabel}...` : `No matching emails found for ${windowLabel}.`,
      total: ids.length,
      current: 0,
    }, true);

    const messages: Array<{ id: string; subject: string; body: string }> = [];
    for (const [index, msg] of ids.entries()) {
      const full = await fetchGmailMessage(accessToken, msg.id);
      messages.push({ id: msg.id, subject: full.subject, body: full.body });
      const ratio = (index + 1) / ids.length;
      await publishProgress({
        phase: "reading",
        progress: 5 + ratio * 25,
        message: `Reading emails ${index + 1}/${ids.length}`,
        total: ids.length,
        current: index + 1,
      });
    }

    let processed = 0;
    let duplicates = 0;
    let failed = 0;

    if (messages.length > 0) {
      await publishProgress({
        phase: "writing",
        progress: 30,
        message: "Writing transactions to database...",
        total: messages.length,
        current: 0,
      }, true);
    }

    for (const [index, msg] of messages.entries()) {
      try {
        const result = await ingestCreditAlert({
          workspaceId: integration.workspaceId,
          rawBody: msg.body,
          rawSubject: msg.subject,
          source: "GMAIL",
        });
        if ("duplicate" in result && result.duplicate) {
          duplicates += 1;
        } else if ("parseStatus" in result && result.parseStatus === "PROCESSED") {
          processed += 1;
        } else if ("parseStatus" in result && result.parseStatus === "DUPLICATE") {
          duplicates += 1;
        } else {
          console.warn("Gmail sync alert failed", {
            messageId: msg.id,
            subject: msg.subject,
            result,
          });
          failed += 1;
        }
      } catch (messageError) {
        console.error("Gmail sync message processing error:", msg.id, messageError);
        failed += 1;
      }

      if (messages.length > 0) {
        const ratio = (index + 1) / messages.length;
        await publishProgress({
          phase: "writing",
          progress: 30 + ratio * 70,
          message: `Writing to database ${index + 1}/${messages.length}`,
          total: messages.length,
          current: index + 1,
        });
      }
    }

    await prisma.gmailIntegration.update({
      where: { id: freshIntegration.id },
      data: { lastSyncedAt: new Date() },
    });

    const completedMessage = `Synced ${ids.length} emails: ${processed} processed, ${duplicates} duplicates, ${failed} failed.`;
    await publishProgress({
      phase: "complete",
      progress: 100,
      message: completedMessage,
      total: ids.length,
      current: ids.length,
    }, true);
    await completeBackgroundJob(persistedJobId, {
      message: completedMessage,
      result: { scannedMessages: ids.length, processed, duplicates, failed },
    });
    clearGmailSyncProgressLater(progressKey);

    return {
      scannedMessages: ids.length,
      processed,
      duplicates,
      failed,
      jobId: persistedJobId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await publishProgress({
      phase: "error",
      progress: 100,
      message,
    }, true);
    await failBackgroundJob(persistedJobId, error);
    clearGmailSyncProgressLater(progressKey);
    throw error;
  } finally {
    activeSyncs.delete(integration.id);
  }
}

export async function runScheduledGmailSyncs() {
  const integrations = await prisma.gmailIntegration.findMany({
    where: { isActive: true },
    select: {
      id: true,
      workspaceId: true,
      userId: true,
      lastSyncedAt: true,
    },
  });

  for (const integration of integrations) {
    if (isGmailSyncRunning(integration.id)) continue;
    try {
      await runGmailSyncForIntegration(integration);
    } catch (error) {
      console.error("Scheduled Gmail sync failed:", integration.id, error);
    }
  }
}
