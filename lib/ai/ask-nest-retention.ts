import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCHES_PER_RUN = 20;
const SINGAPORE_TIME_ZONE = "Asia/Singapore";

type RetentionTurn = {
  id: string;
  workspaceId: string;
  userId: string;
  createdAt: Date;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  toolCallCount: number;
  emptyResultCount: number;
  durationMs: number | null;
  feedbackRating: string | null;
};

type DailyUsage = {
  day: string;
  workspaceId: string;
  userId: string;
  turnCount: number;
  trackedTurnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCallCount: number;
  emptyResultCount: number;
  totalDurationMs: number;
  feedbackCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
};

export function getAskNestHistoryRetentionDays() {
  const configuredValue = process.env.ASK_NEST_HISTORY_RETENTION_DAYS?.trim();
  const configured = configuredValue ? Number(configuredValue) : Number.NaN;
  if (!Number.isInteger(configured)) return DEFAULT_RETENTION_DAYS;

  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, configured));
}

export function getAskNestUsageDayKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SINGAPORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;

  return `${value("year")}-${value("month")}-${value("day")}`;
}

function summarizeTurns(turns: RetentionTurn[]) {
  const usageByOwnerAndDay = new Map<string, DailyUsage>();

  for (const turn of turns) {
    const day = getAskNestUsageDayKey(turn.createdAt);
    const key = `${day}:${turn.workspaceId}:${turn.userId}`;
    const existing = usageByOwnerAndDay.get(key) ?? {
      day,
      workspaceId: turn.workspaceId,
      userId: turn.userId,
      turnCount: 0,
      trackedTurnCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      toolCallCount: 0,
      emptyResultCount: 0,
      totalDurationMs: 0,
      feedbackCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
    };

    existing.turnCount += 1;
    if (turn.totalTokens !== null) existing.trackedTurnCount += 1;
    existing.inputTokens += turn.inputTokens ?? 0;
    existing.outputTokens += turn.outputTokens ?? 0;
    existing.totalTokens += turn.totalTokens ?? 0;
    existing.toolCallCount += turn.toolCallCount;
    existing.emptyResultCount += turn.emptyResultCount;
    existing.totalDurationMs += turn.durationMs ?? 0;
    if (turn.feedbackRating === "HELPFUL") {
      existing.feedbackCount += 1;
      existing.helpfulCount += 1;
    } else if (turn.feedbackRating === "NOT_HELPFUL") {
      existing.feedbackCount += 1;
      existing.notHelpfulCount += 1;
    }
    usageByOwnerAndDay.set(key, existing);
  }

  return [...usageByOwnerAndDay.values()];
}

async function archiveAskNestTurns(tx: Prisma.TransactionClient, turns: RetentionTurn[]) {
  if (!turns.length) return { processed: 0, summaries: 0 };

  const summaries = summarizeTurns(turns);
  for (const summary of summaries) {
    await tx.askNestUsageDaily.upsert({
      where: {
        day_workspaceId_userId: {
          day: summary.day,
          workspaceId: summary.workspaceId,
          userId: summary.userId,
        },
      },
      create: summary,
      update: {
        turnCount: { increment: summary.turnCount },
        trackedTurnCount: { increment: summary.trackedTurnCount },
        inputTokens: { increment: summary.inputTokens },
        outputTokens: { increment: summary.outputTokens },
        totalTokens: { increment: summary.totalTokens },
        toolCallCount: { increment: summary.toolCallCount },
        emptyResultCount: { increment: summary.emptyResultCount },
        totalDurationMs: { increment: summary.totalDurationMs },
        feedbackCount: { increment: summary.feedbackCount },
        helpfulCount: { increment: summary.helpfulCount },
        notHelpfulCount: { increment: summary.notHelpfulCount },
      },
    });
  }

  const ids = turns.map((turn) => turn.id);
  await tx.askNestMemory.updateMany({
    where: { sourceTurnId: { in: ids } },
    data: { sourceTurnId: null },
  });
  await tx.askNestTurn.deleteMany({ where: { id: { in: ids } } });

  return { processed: turns.length, summaries: summaries.length };
}

export async function clearAskNestHistoryPreservingUsage(params: { workspaceId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    const turns = await tx.$queryRaw<RetentionTurn[]>`
      SELECT
        [id], [workspaceId], [userId], [createdAt], [inputTokens], [outputTokens], [totalTokens],
        [toolCallCount], [emptyResultCount], [durationMs], [feedbackRating]
      FROM [dbo].[AskNestTurn] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE [workspaceId] = ${params.workspaceId} AND [userId] = ${params.userId}
      ORDER BY [createdAt] ASC, [id] ASC
    `;

    let processed = 0;
    let summaries = 0;
    for (let offset = 0; offset < turns.length; offset += DEFAULT_BATCH_SIZE) {
      const archived = await archiveAskNestTurns(tx, turns.slice(offset, offset + DEFAULT_BATCH_SIZE));
      processed += archived.processed;
      summaries += archived.summaries;
    }
    return { processed, summaries };
  });
}

export type AskNestRetentionResult = {
  retentionDays: number;
  cutoff: Date;
  batches: number;
  processedTurns: number;
  summarizedDays: number;
  hasMore: boolean;
};

export async function runAskNestRetention(options: { now?: Date; batchSize?: number } = {}): Promise<AskNestRetentionResult> {
  const retentionDays = getAskNestHistoryRetentionDays();
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const requestedBatchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchSize = Number.isFinite(requestedBatchSize)
    ? Math.min(DEFAULT_BATCH_SIZE, Math.max(1, Math.floor(requestedBatchSize)))
    : DEFAULT_BATCH_SIZE;
  let batches = 0;
  let processedTurns = 0;
  let summarizedDays = 0;
  let hasMore = false;

  while (batches < MAX_BATCHES_PER_RUN) {
    const result = await prisma.$transaction(async (tx) => {
      const turns = await tx.$queryRaw<RetentionTurn[]>`
        SELECT TOP (${batchSize})
          [id], [workspaceId], [userId], [createdAt], [inputTokens], [outputTokens], [totalTokens],
          [toolCallCount], [emptyResultCount], [durationMs], [feedbackRating]
        FROM [dbo].[AskNestTurn] WITH (UPDLOCK, READPAST, ROWLOCK)
        WHERE [createdAt] < ${cutoff}
        ORDER BY [createdAt] ASC, [id] ASC
      `;
      if (!turns.length) return { processed: 0, summaries: 0, hasMore: false };

      const archived = await archiveAskNestTurns(tx, turns);
      return { ...archived, hasMore: turns.length === batchSize };
    });

    if (!result.processed) break;
    batches += 1;
    processedTurns += result.processed;
    summarizedDays += result.summaries;
    hasMore = result.hasMore;
    if (!result.hasMore) break;
  }

  return { retentionDays, cutoff, batches, processedTurns, summarizedDays, hasMore };
}
