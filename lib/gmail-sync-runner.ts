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
import { getGmailSyncProgressCounters } from "@/lib/gmail-sync-counters";
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
  pendingMessageIds: string[] | null;
  nextPageToken: string | null;
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

function restoreCheckpointPage(parsed: GmailCheckpoint): GmailCheckpoint {
  return {
    ...parsed,
    ignored: Number.isInteger(parsed.ignored) && parsed.ignored >= 0 ? parsed.ignored : 0,
    pendingMessageIds: Array.isArray(parsed.pendingMessageIds) && parsed.pendingMessageIds.every((id) => typeof id === "string")
      ? parsed.pendingMessageIds : null,
    nextPageToken: typeof parsed.nextPageToken === "string" ? parsed.nextPageToken : null,
  };
}

function parseCheckpoint(value: string | null, integration: GmailIntegrationRecord): GmailCheckpoint {
  if (value) {
    try {
      const parsed = JSON.parse(value) as GmailCheckpoint;
      if (parsed.version === 1 && (parsed.mode === "query" || parsed.mode === "history")) {
        return restoreCheckpointPage(parsed);
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
    pendingMessageIds: null,
    nextPageToken: null,
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
  if (!integration?.isActive) {
    throw new BackgroundJobError("GMAIL_INTEGRATION_INACTIVE", "The Gmail integration is no longer active.");
  }
  return integration;
}

async function loadGmailSyncPage(accessToken: string, integration: GmailIntegrationRecord, checkpoint: GmailCheckpoint, limit: number) {
  if (checkpoint.mode === "history" && checkpoint.startHistoryId) {
    try {
      const page = await listGmailHistoryPage({
        accessToken,
        startHistoryId: checkpoint.startHistoryId,
        pageToken: checkpoint.pageToken,
        maxResults: limit,
      });
      checkpoint.highWaterHistoryId = page.historyId ?? checkpoint.highWaterHistoryId;
      return page;
    } catch (error) {
      if (!(error instanceof GmailProviderError) || error.code !== "GMAIL_HISTORY_EXPIRED") throw error;
      checkpoint.mode = "query";
      checkpoint.pageToken = null;
      checkpoint.startHistoryId = null;
    }
  }
  return listGmailMessagePage({
    accessToken,
    q: buildGmailAlertQuery(integration.lastSyncedAt),
    pageToken: checkpoint.pageToken,
    maxResults: limit,
  });
}

async function processGmailMessage(accessToken: string, messageId: string, workspaceId: string): Promise<"ignored" | "duplicates" | "processed" | "failed"> {
  try {
    const metadata = await fetchGmailMessageMetadata(accessToken, messageId);
    if (!isGmailCreditAlertSubject(metadata.subject)) return "ignored";

    const full = await fetchGmailMessage(accessToken, messageId);
    const result = await ingestCreditAlert({
      workspaceId,
      rawBody: full.body,
      rawSubject: full.subject,
      source: "GMAIL",
      sourceMessageId: messageId,
    });
    if ("duplicate" in result && result.duplicate) return "duplicates";
    if ("parseStatus" in result && result.parseStatus === "PROCESSED") return "processed";
    if ("parseStatus" in result && result.parseStatus === "DUPLICATE") return "duplicates";
    return "failed";
  } catch (error) {
    if (!(error instanceof GmailProviderError) || error.code !== "GMAIL_MESSAGE_GONE") throw error;
    return "failed";
  }
}

async function processGmailSyncJob(claimed: NonNullable<Awaited<ReturnType<typeof claimBackgroundJob>>>, origin?: string) {
  const { job, leaseToken } = claimed;

  try {
    const integration = await loadIntegrationFromJob(job.payloadJson);
    const checkpoint = parseCheckpoint(job.checkpointJson, integration);
    await heartbeatBackgroundJob(job.id, leaseToken, {
      progress: Math.min(90, 5 + checkpoint.scannedMessages),
      message: checkpoint.mode === "history" ? "Reading new Gmail history..." : "Scanning a bounded Gmail page...",
      ...getGmailSyncProgressCounters(checkpoint.scannedMessages, job.total),
      checkpoint,
    });

    const accessToken = await ensureActiveGmailAccessToken(integration.id, origin);
    if (!checkpoint.highWaterHistoryId) {
      checkpoint.highWaterHistoryId = (await getGmailProfile(accessToken)).historyId;
    }

    const limit = messagesPerSlice();
    if (checkpoint.pendingMessageIds === null) {
      const page = await loadGmailSyncPage(accessToken, integration, checkpoint, limit);
      checkpoint.pendingMessageIds = page.messages.map((message) => message.id);
      checkpoint.nextPageToken = page.nextPageToken;
      // Persist this page before importing. A retry resumes the same message list,
      // even when new mail changes the provider's current page contents.
      await throwIfBackgroundJobCancelled(job.id, leaseToken);
      await heartbeatBackgroundJob(job.id, leaseToken, { checkpoint });
    }

    for (const messageId of checkpoint.pendingMessageIds.slice(0, limit)) {
      await throwIfBackgroundJobCancelled(job.id, leaseToken);
      const outcome = await processGmailMessage(accessToken, messageId, integration.workspaceId);
      checkpoint.scannedMessages += 1;
      checkpoint[outcome] += 1;
      checkpoint.pendingMessageIds.shift();

      await heartbeatBackgroundJob(job.id, leaseToken, {
        progress: Math.min(90, 10 + checkpoint.scannedMessages),
        message: `Reviewed ${checkpoint.scannedMessages} Gmail message${checkpoint.scannedMessages === 1 ? "" : "s"}.`,
        ...getGmailSyncProgressCounters(checkpoint.scannedMessages, job.total),
        checkpoint,
      });
    }

    if (checkpoint.pendingMessageIds.length === 0) {
      checkpoint.pendingMessageIds = null;
      checkpoint.pageToken = checkpoint.nextPageToken;
      checkpoint.nextPageToken = null;
    }
    if (checkpoint.pendingMessageIds || checkpoint.pageToken) {
      await continueBackgroundJob(job.id, leaseToken, {
        checkpoint,
        message: `Gmail page complete; ${checkpoint.scannedMessages} messages processed so far.`,
        progress: Math.min(90, 10 + checkpoint.scannedMessages),
        ...getGmailSyncProgressCounters(checkpoint.scannedMessages, job.total),
      });
      return { completed: false, jobId: job.id, summary: checkpoint };
    }

    await throwIfBackgroundJobCancelled(job.id, leaseToken);
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
    // The claim operation also recovers expired leases when no pending work exists.
    const claimed = await claimBackgroundJob({ jobId: requestedJobId, type: GMAIL_SYNC_JOB_TYPE, leaseMs: 5 * 60_000 });
    if (!claimed) break;
    const result = await processGmailSyncJob(claimed, params.origin);
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
