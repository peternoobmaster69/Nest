import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  getOutstandingCreditCardStatements,
  type OutstandingCreditCardStatement as DueCardRow,
} from "@/lib/credit-card-statement-balances";
import {
  addUtcDays,
  getDaysUntilDue,
  REMINDER_LEAD_DAYS,
  shouldSendPaymentReminder,
  shouldShowPaymentReminder,
  startOfUtcDay,
} from "@/lib/credit-card-payment-reminder-schedule";
import { sendPushToUser } from "@/lib/web-push";
import {
  BackgroundJobError,
  claimBackgroundJob,
  completeClaimedBackgroundJob,
  enqueueBackgroundJob,
  failClaimedBackgroundJob,
} from "@/lib/background-jobs";
import { buildCreditCardStatementPath, buildWorkspaceEntryHref } from "@/lib/workspace-entry";
import { ApiRequestError } from "@/lib/api-security";
import { decodeCursor, toListEnvelope } from "@/lib/api/pagination";

const CREDIT_CARD_DUE_TYPE = "CREDIT_CARD_DUE";
const WORKSPACE_INVITATION_TYPE = "WORKSPACE_INVITATION";
const REMINDER_PUSH_JOB_TYPE = "CREDIT_CARD_PAYMENT_REMINDER_PUSH";

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: process.env.CREDIT_CARD_REMINDER_CURRENCY || "SGD",
  }).format(cents / 100);
}

function dueCopy(daysUntilDue: number) {
  if (daysUntilDue < 0) {
    const days = Math.abs(daysUntilDue);
    return {
      title: "Credit card payment overdue",
      label: `${days} day${days === 1 ? "" : "s"} overdue`,
      shouldRealert: true,
    };
  }
  if (daysUntilDue === 0) return { title: "Credit card payment due today", label: "due today", shouldRealert: true };
  if (daysUntilDue === 1) return { title: "Credit card payment due tomorrow", label: "due tomorrow", shouldRealert: true };
  return {
    title: "Credit card payment due soon",
    label: `due in ${daysUntilDue} days`,
    shouldRealert: shouldSendPaymentReminder(daysUntilDue),
  };
}

async function findDueCards(workspaceId?: string) {
  const today = startOfUtcDay(new Date());
  const reminderThrough = addUtcDays(today, REMINDER_LEAD_DAYS + 1);
  const rows = await getOutstandingCreditCardStatements(prisma, {
    workspaceId,
    activeOnly: true,
    dueBefore: reminderThrough,
  });

  return {
    today,
    rows: rows.filter((row) => shouldShowPaymentReminder(getDaysUntilDue(row.paymentDueDate, today))),
  };
}

function getDedupeKey(row: DueCardRow) {
  return `credit-card-due:${row.workspaceId}:${row.cardId}:${row.statementYear}:${row.statementMonth}`;
}

type PreparedPush = { title: string; message: string; href: string; tag: string };
type DeliveryBudget = { used: number; limit: number };

function maxDeliveriesPerRun() {
  const parsed = Number(process.env.PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
}

export async function processReminderPushDeliveryJob(jobId: string, prepared?: PreparedPush) {
  const claimed = await claimBackgroundJob({ jobId, leaseMs: 2 * 60_000 });
  if (!claimed) return { status: "skipped" as const };
  try {
    let payload = prepared;
    if (!payload && claimed.job.userId && claimed.job.workspaceId) {
      // A payment may have settled the statement since this push was queued.
      await syncCreditCardDueNotificationsForUser(claimed.job.userId, claimed.job.workspaceId);
      let dedupeKey = "";
      try {
        const stored = JSON.parse(claimed.job.payloadJson ?? "{}") as { dedupeKey?: unknown };
        if (typeof stored.dedupeKey === "string") dedupeKey = stored.dedupeKey;
      } catch {}
      const notification = dedupeKey ? await prisma.inAppNotification.findFirst({
        where: { userId: claimed.job.userId, workspaceId: claimed.job.workspaceId, dedupeKey },
        select: { title: true, message: true, href: true, dedupeKey: true },
      }) : null;
      if (notification) {
        payload = {
          title: notification.title,
          message: notification.message,
          href: notification.href ?? "/credit-transactions",
          tag: notification.dedupeKey,
        };
      }
    }
    if (!payload || !claimed.job.userId) {
      await completeClaimedBackgroundJob(claimed.job.id, claimed.leaseToken, {
        message: "Push reminder no longer applies; delivery skipped.",
        skipped: true,
      });
      return { status: "skipped" as const };
    }
    const delivery = await sendPushToUser(claimed.job.userId, payload);
    if (("failed" in delivery ? (delivery.failed ?? 0) : 0) > 0) {
      throw new BackgroundJobError(
        "PUSH_PROVIDER_UNAVAILABLE",
        "Some push notifications could not be delivered.",
        true,
      );
    }
    await completeClaimedBackgroundJob(claimed.job.id, claimed.leaseToken, {
      message: delivery.configured ? "Payment reminder push sent." : "Push is not configured; delivery skipped.",
      result: { sent: delivery.sent, configured: delivery.configured },
      skipped: !delivery.configured,
    });
    return { status: delivery.configured ? "sent" as const : "skipped" as const };
  } catch (error) {
    await failClaimedBackgroundJob(claimed.job.id, claimed.leaseToken, error);
    return { status: "failed" as const };
  }
}

async function syncRowsForUser(
  userId: string,
  workspaceId: string,
  rows: DueCardRow[],
  today: Date,
  deliverPush = false,
  deliveryBudget?: DeliveryBudget,
) {
  const activeKeys: string[] = [];

  for (const row of rows) {
    const dedupeKey = getDedupeKey(row);
    activeKeys.push(dedupeKey);
    const daysUntilDue = getDaysUntilDue(row.paymentDueDate, today);
    const copy = dueCopy(daysUntilDue);
    const amount = formatMoney(Number(row.outstandingCents));
    const message = `${row.cardName} ending ${row.last4Digit} has ${amount} outstanding and is ${copy.label}.`;
    const href = buildWorkspaceEntryHref(workspaceId, buildCreditCardStatementPath({
      cardId: row.cardId,
      statementMonth: row.statementMonth,
      statementYear: row.statementYear,
    }));
    const metadataJson = JSON.stringify({
      cardId: row.cardId,
      statementMonth: row.statementMonth,
      statementYear: row.statementYear,
      paymentDueDate: row.paymentDueDate.toISOString(),
      outstandingCents: Number(row.outstandingCents),
    });

    await prisma.$executeRaw(Prisma.sql`
      MERGE [dbo].[InAppNotification] AS target
      USING (SELECT ${userId} AS [userId], ${dedupeKey} AS [dedupeKey]) AS source
      ON target.[userId] = source.[userId] AND target.[dedupeKey] = source.[dedupeKey]
      WHEN MATCHED AND (
        target.[title] <> ${copy.title}
        OR target.[message] <> ${message}
        OR ISNULL(target.[href], '') <> ${href}
        OR ISNULL(target.[metadataJson], '') <> ${metadataJson}
      ) THEN
        UPDATE SET
          [title] = ${copy.title},
          [message] = ${message},
          [href] = ${href},
          [metadataJson] = ${metadataJson},
          [readAt] = CASE
            WHEN target.[message] <> ${message} AND ${copy.shouldRealert ? 1 : 0} = 1 THEN NULL
            ELSE target.[readAt]
          END,
          [updatedAt] = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT ([id], [userId], [workspaceId], [type], [dedupeKey], [title], [message], [href], [metadataJson], [createdAt], [updatedAt])
        VALUES (${randomUUID()}, ${userId}, ${workspaceId}, ${CREDIT_CARD_DUE_TYPE}, ${dedupeKey}, ${copy.title}, ${message}, ${href}, ${metadataJson}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `);

    if (deliverPush && copy.shouldRealert) {
      const deliveryKey = `${startOfUtcDay(today).toISOString()}:${userId}:${dedupeKey}`;
      const queued = await enqueueBackgroundJob({
        type: REMINDER_PUSH_JOB_TYPE,
        key: deliveryKey,
        idempotencyKey: deliveryKey,
        workspaceId,
        userId,
        message: "Payment reminder push queued.",
        payload: { dedupeKey },
        maxAttempts: 4,
      });
      if (!["SUCCEEDED", "SKIPPED", "RUNNING"].includes(queued.job.status)) {
        if (deliveryBudget && deliveryBudget.used >= deliveryBudget.limit) continue;
        if (deliveryBudget) deliveryBudget.used += 1;
        await processReminderPushDeliveryJob(queued.job.id, {
          title: copy.title,
          message,
          href,
          tag: dedupeKey,
        });
      }
    }
  }

  const existing = await prisma.$queryRaw<Array<{ dedupeKey: string }>>(Prisma.sql`
    SELECT [dedupeKey]
    FROM [dbo].[InAppNotification]
    WHERE [userId] = ${userId}
      AND [workspaceId] = ${workspaceId}
      AND [type] = ${CREDIT_CARD_DUE_TYPE}
  `);
  const activeKeySet = new Set(activeKeys);
  const staleKeys = existing.map((item) => item.dedupeKey).filter((key) => !activeKeySet.has(key));

  for (const staleKey of staleKeys) {
    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM [dbo].[InAppNotification]
      WHERE [userId] = ${userId} AND [dedupeKey] = ${staleKey}
    `);
  }
}

export async function syncCreditCardDueNotificationsForUser(userId: string, workspaceId: string) {
  const { today, rows } = await findDueCards(workspaceId);
  await syncRowsForUser(userId, workspaceId, rows, today);
}

export async function syncCreditCardDueNotificationsForAllUsers() {
  const [{ today, rows }, members] = await Promise.all([
    findDueCards(),
    prisma.workspaceMember.findMany({ select: { userId: true, workspaceId: true } }),
  ]);
  const rowsByWorkspace = new Map<string, DueCardRow[]>();
  const deliveryBudget: DeliveryBudget = { used: 0, limit: maxDeliveriesPerRun() };

  for (const row of rows) {
    const workspaceRows = rowsByWorkspace.get(row.workspaceId) ?? [];
    workspaceRows.push(row);
    rowsByWorkspace.set(row.workspaceId, workspaceRows);
  }

  for (const member of members) {
    await syncRowsForUser(
      member.userId,
      member.workspaceId,
      rowsByWorkspace.get(member.workspaceId) ?? [],
      today,
      true,
      deliveryBudget,
    );
  }
}

export async function listInAppNotifications(
  userId: string,
  workspaceId: string,
  options: { limit: number; cursor?: string },
) {
  let cursor: ReturnType<typeof decodeCursor> | null = null;
  if (options.cursor) {
    try {
      cursor = decodeCursor(options.cursor);
    } catch {
      throw new ApiRequestError(400, "Invalid notification cursor");
    }
  }
  const cursorDate = cursor ? new Date(cursor.sortValue) : null;
  if (cursorDate && Number.isNaN(cursorDate.getTime())) {
    throw new ApiRequestError(400, "Invalid notification cursor");
  }
  const where = {
    userId,
    workspaceId,
    type: { in: [CREDIT_CARD_DUE_TYPE, WORKSPACE_INVITATION_TYPE] },
    ...(cursor && cursorDate ? {
      OR: [
        { updatedAt: { lt: cursorDate } },
        { updatedAt: cursorDate, id: { lt: cursor.id } },
      ],
    } : {}),
  };
  const [rows, unreadCount] = await Promise.all([
    prisma.inAppNotification.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: options.limit + 1,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        href: true,
        readAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.inAppNotification.count({
      where: {
        userId,
        workspaceId,
        readAt: null,
        type: { in: [CREDIT_CARD_DUE_TYPE, WORKSPACE_INVITATION_TYPE] },
      },
    }),
  ]);
  return {
    page: toListEnvelope(rows, options.limit, (row) => ({
      id: row.id,
      sortValue: row.updatedAt.toISOString(),
    })),
    unreadCount,
  };
}

export async function markInAppNotificationRead(userId: string, notificationId: string) {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE [dbo].[InAppNotification]
    SET [readAt] = COALESCE([readAt], CURRENT_TIMESTAMP), [updatedAt] = CURRENT_TIMESTAMP
    WHERE [id] = ${notificationId} AND [userId] = ${userId}
      AND [type] IN (${CREDIT_CARD_DUE_TYPE}, ${WORKSPACE_INVITATION_TYPE})
  `);
}

export async function markAllInAppNotificationsRead(userId: string, workspaceId: string) {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE [dbo].[InAppNotification]
    SET [readAt] = COALESCE([readAt], CURRENT_TIMESTAMP), [updatedAt] = CURRENT_TIMESTAMP
    WHERE [userId] = ${userId} AND [workspaceId] = ${workspaceId} AND [readAt] IS NULL
      AND [type] IN (${CREDIT_CARD_DUE_TYPE}, ${WORKSPACE_INVITATION_TYPE})
  `);
}
