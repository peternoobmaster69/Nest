import { ingestCreditAlert } from "@/lib/credit-alert-ingest";
import { buildGmailAlertQuery, isGmailCreditAlertSubject, isGmailSyncDue } from "@/lib/gmail-alert-query";
import {
  ensureActiveGmailAccessToken,
  fetchGmailMessage,
  fetchGmailMessageMetadata,
  getGmailProfile,
  GmailProviderError,
  listGmailHistoryPage,
  listGmailMessagePage,
} from "@/lib/gmail";
import {
  BackgroundJobError,
  claimBackgroundJob,
  completeClaimedBackgroundJob,
  continueBackgroundJob,
  enqueueBackgroundJob,
  failClaimedBackgroundJob,
  heartbeatBackgroundJob,
  throwIfBackgroundJobCancelled,
} from "@/lib/background-jobs";
import { formatGmailSyncSummary, type GmailSyncSummary } from "@/lib/gmail-sync-summary";
import { prisma } from "@/lib/prisma";

type GmailIntegrationRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  lastSyncedAt: Date | null;
  lastHistoryId?: string | null;
};

type GmailCheckpoint = GmailSyncSummary & {
  version: 1;
  mode: "query" | "history";
  pageToken: string | null;
  startHistoryId: string | null;
  highWaterHistoryId: string | null;
};

const DEFAULT_MESSAGES_PER_SLICE = 50;
const DEFAULT_SLICES_PER_INVOCATION = 4;
export const GMAIL_SYNC_JOB_TYPE = "GMAIL_SYNC";

function boundedInteger(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function messagesPerSlice() {
  return boundedInteger(process.env.GMAIL_SYNC_MESSAGES_PER_SLICE, DEFAULT_MESSAGES_PER_SLICE, 100);
}

function slicesPerInvocation() {
  return boundedInteger(process.env.GMAIL_SYNC_SLICES_PER_INVOCATION, DEFAULT_SLICES_PER_INVOCATION, 10);
}

function parseCheckpoint(value: string | null, integration: GmailIntegrationRecord): GmailCheckpoint {
  if (value) {
    try {
      const parsed = JSON.parse(value) as GmailCheckpoint;
      if (parsed.version === 1 && (parsed.mode === "query" || parsed.mode === "history")) {
        return {
          ...parsed,
          ignored: Number.isInteger(parsed.ignored) && parsed.ignored >= 0 ? parsed.ignored : 0,
        };
      }
    } catch {
      // Start from the integration's durable cursor when an old checkpoint is unreadable.
    }
  }
  return {
    version: 1,
    mode: integration.lastHistoryId ? "history" : "query",
    pageToken: null,
    startHistoryId: integration.lastHistoryId ?? null,
    highWaterHistoryId: null,
    scannedMessages: 0,
    processed: 0,
    duplicates: 0,
    ignored: 0,
    failed: 0,
  };
}

export function getGmailSyncJobKey(integrationId: string) {
  return `gmail:${integrationId}`;
}

export async function queueGmailSyncForIntegration(integration: GmailIntegrationRecord) {
  return enqueueBackgroundJob({
    type: GMAIL_SYNC_JOB_TYPE,
    key: getGmailSyncJobKey(integration.id),
    workspaceId: integration.workspaceId,
    userId: integration.userId,
    message: "Gmail sync queued.",
    payload: { integrationId: integration.id },
    maxAttempts: 5,
  });
}

async function loadIntegrationFromJob(payloadJson: string | null) {
  let integrationId = "";
  try {
    const payload = JSON.parse(payloadJson ?? "{}") as { integrationId?: unknown };
    if (typeof payload.integrationId === "string") integrationId = payload.integrationId;
  } catch {}
  if (!integrationId) throw new BackgroundJobError("INVALID_JOB_PAYLOAD", "The Gmail sync job payload is invalid.");

  const integration = await prisma.gmailIntegration.findUnique({
    where: { id: integrationId },
    select: {
      id: true,
      workspaceId: true,
      userId: true,
      lastSyncedAt: true,
      lastHistoryId: true,
      isActive: true,
    },
  });
  if (!integration || !integration.isActive) {
    throw new BackgroundJobError("GMAIL_INTEGRATION_INACTIVE", "The Gmail integration is no longer active.");
  }
  return integration;
}

async function processGmailSyncJob(jobId: string, origin?: string) {
  const claimed = await claimBackgroundJob({ jobId, type: GMAIL_SYNC_JOB_TYPE, leaseMs: 5 * 60_000 });
  if (!claimed) return null;
  const { job, leaseToken } = claimed;

  try {
    const integration = await loadIntegrationFromJob(job.payloadJson);
    const checkpoint = parseCheckpoint(job.checkpointJson, integration);
    await heartbeatBackgroundJob(job.id, leaseToken, {
      progress: Math.min(90, 5 + checkpoint.scannedMessages),
      message: checkpoint.mode === "history" ? "Reading new Gmail history..." : "Scanning a bounded Gmail page...",
      current: checkpoint.scannedMessages,
      checkpoint,
    });

    const accessToken = await ensureActiveGmailAccessToken(integration.id, origin);
    if (!checkpoint.highWaterHistoryId) {
      checkpoint.highWaterHistoryId = (await getGmailProfile(accessToken)).historyId;
    }

    let messages: Array<{ id: string }> = [];
    let nextPageToken: string | null = null;
    if (checkpoint.mode === "history" && checkpoint.startHistoryId) {
      try {
        const page = await listGmailHistoryPage({
          accessToken,
          startHistoryId: checkpoint.startHistoryId,
          pageToken: checkpoint.pageToken,
          maxResults: messagesPerSlice(),
        });
        messages = page.messages;
        nextPageToken = page.nextPageToken;
        checkpoint.highWaterHistoryId = page.historyId ?? checkpoint.highWaterHistoryId;
      } catch (error) {
        if (!(error instanceof GmailProviderError) || error.code !== "GMAIL_HISTORY_EXPIRED") throw error;
        checkpoint.mode = "query";
        checkpoint.pageToken = null;
        checkpoint.startHistoryId = null;
        const page = await listGmailMessagePage({
          accessToken,
          q: buildGmailAlertQuery(integration.lastSyncedAt),
          maxResults: messagesPerSlice(),
        });
        messages = page.messages;
        nextPageToken = page.nextPageToken;
      }
    } else {
      const page = await listGmailMessagePage({
        accessToken,
        q: buildGmailAlertQuery(integration.lastSyncedAt),
        pageToken: checkpoint.pageToken,
        maxResults: messagesPerSlice(),
      });
      messages = page.messages;
      nextPageToken = page.nextPageToken;
    }

    for (const message of messages) {
      await throwIfBackgroundJobCancelled(job.id, leaseToken);
      checkpoint.scannedMessages += 1;
      let result;
      try {
        const metadata = await fetchGmailMessageMetadata(accessToken, message.id);
        if (!isGmailCreditAlertSubject(metadata.subject)) {
          checkpoint.ignored += 1;
          await heartbeatBackgroundJob(job.id, leaseToken, {
            progress: Math.min(90, 10 + checkpoint.scannedMessages),
            message: `Reviewed ${checkpoint.scannedMessages} Gmail message${checkpoint.scannedMessages === 1 ? "" : "s"}.`,
            current: checkpoint.scannedMessages,
            total: Math.max(checkpoint.scannedMessages, (job.total ?? 0)),
            checkpoint,
          });
          continue;
        }

        const full = await fetchGmailMessage(accessToken, message.id);
        result = await ingestCreditAlert({
          workspaceId: integration.workspaceId,
          rawBody: full.body,
          rawSubject: full.subject,
          source: "GMAIL",
          sourceMessageId: message.id,
        });
      } catch (error) {
        if (!(error instanceof GmailProviderError) || error.code !== "GMAIL_MESSAGE_GONE") throw error;
        checkpoint.failed += 1;
        continue;
      }
      if ("duplicate" in result && result.duplicate) checkpoint.duplicates += 1;
      else if ("parseStatus" in result && result.parseStatus === "PROCESSED") checkpoint.processed += 1;
      else if ("parseStatus" in result && result.parseStatus === "DUPLICATE") checkpoint.duplicates += 1;
      else checkpoint.failed += 1;

      await heartbeatBackgroundJob(job.id, leaseToken, {
        progress: Math.min(90, 10 + checkpoint.scannedMessages),
        message: `Reviewed ${checkpoint.scannedMessages} Gmail message${checkpoint.scannedMessages === 1 ? "" : "s"}.`,
        current: checkpoint.scannedMessages,
        total: Math.max(checkpoint.scannedMessages, (job.total ?? 0)),
        checkpoint,
      });
    }

    checkpoint.pageToken = nextPageToken;
    if (nextPageToken) {
      await continueBackgroundJob(job.id, leaseToken, {
        checkpoint,
        message: `Gmail page complete; ${checkpoint.scannedMessages} messages processed so far.`,
        progress: Math.min(90, 10 + checkpoint.scannedMessages),
        current: checkpoint.scannedMessages,
      });
      return { completed: false, jobId: job.id, summary: checkpoint };
    }

    await prisma.gmailIntegration.update({
      where: { id: integration.id },
      data: {
        lastSyncedAt: new Date(),
        lastHistoryId: checkpoint.highWaterHistoryId,
      },
    });
    const message = formatGmailSyncSummary(checkpoint);
    await completeClaimedBackgroundJob(job.id, leaseToken, { message, result: checkpoint });
    return { completed: true, jobId: job.id, summary: checkpoint };
  } catch (error) {
    if (error instanceof BackgroundJobError && ["JOB_CANCELLED", "LEASE_LOST"].includes(error.code)) return null;
    await failClaimedBackgroundJob(job.id, leaseToken, error);
    return null;
  }
}

export async function processGmailSyncQueue(params: { jobId?: string; origin?: string; maxSlices?: number } = {}) {
  const maximum = Math.max(1, Math.min(10, params.maxSlices ?? slicesPerInvocation()));
  let processedSlices = 0;
  const requestedJobId = params.jobId;

  while (processedSlices < maximum) {
    let jobId = requestedJobId;
    if (!jobId) {
      const next = await prisma.backgroundJob.findFirst({
        where: { type: GMAIL_SYNC_JOB_TYPE, status: "PENDING", availableAt: { lte: new Date() } },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (!next) break;
      jobId = next.id;
    }
    const result = await processGmailSyncJob(jobId, params.origin);
    processedSlices += 1;
    if (requestedJobId && result?.completed) break;
    if (requestedJobId && !result) break;
  }
  return { processedSlices };
}

export async function runScheduledGmailSyncs() {
  const integrations = await prisma.gmailIntegration.findMany({
    where: { isActive: true },
    select: { id: true, workspaceId: true, userId: true, lastSyncedAt: true, lastHistoryId: true },
  });
  let queued = 0;
  let suppressed = 0;
  for (const integration of integrations) {
    if (!isGmailSyncDue(integration.lastSyncedAt)) continue;
    const result = await queueGmailSyncForIntegration(integration);
    if (result.created) queued += 1;
    else suppressed += 1;
  }
  const processed = await processGmailSyncQueue();
  return { queued, suppressed, ...processed };
}
