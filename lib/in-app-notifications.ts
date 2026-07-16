import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  addUtcDays,
  getDaysUntilDue,
  REMINDER_LEAD_DAYS,
  shouldSendPaymentReminder,
  shouldShowPaymentReminder,
  startOfUtcDay,
} from "@/lib/credit-card-payment-reminder-schedule";
import { sendPushToUser } from "@/lib/web-push";

const CREDIT_CARD_DUE_TYPE = "CREDIT_CARD_DUE";
const WORKSPACE_INVITATION_TYPE = "WORKSPACE_INVITATION";

type DueCardRow = {
  workspaceId: string;
  cardId: string;
  cardName: string;
  last4Digit: string;
  statementMonth: number;
  statementYear: number;
  paymentDueDate: Date;
  outstandingCents: number | bigint;
};

export type InAppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

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
  const workspaceFilter = workspaceId ? Prisma.sql`AND cct.[workspaceId] = ${workspaceId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<DueCardRow[]>(Prisma.sql`
    SELECT
      cct.[workspaceId] AS [workspaceId],
      cct.[creditCardId] AS [cardId],
      cc.[cardName] AS [cardName],
      cc.[last4Digit] AS [last4Digit],
      cct.[statementMonth] AS [statementMonth],
      cct.[statementYear] AS [statementYear],
      MIN(cct.[paymentDueDate]) AS [paymentDueDate],
      SUM(CAST(cct.[amountCents] AS BIGINT)) AS [outstandingCents]
    FROM [dbo].[CreditCardTransaction] cct
    INNER JOIN [dbo].[CreditCardAccount] cc ON cc.[id] = cct.[creditCardId]
    WHERE cct.[paymentDueDate] IS NOT NULL
      AND cct.[paymentDueDate] < ${reminderThrough}
      AND cc.[isActive] = 1
      ${workspaceFilter}
    GROUP BY
      cct.[workspaceId],
      cct.[creditCardId],
      cc.[cardName],
      cc.[last4Digit],
      cct.[statementMonth],
      cct.[statementYear]
    HAVING SUM(CAST(cct.[amountCents] AS BIGINT)) > 0
  `);

  return {
    today,
    rows: rows.filter((row) => shouldShowPaymentReminder(getDaysUntilDue(row.paymentDueDate, today))),
  };
}

function getDedupeKey(row: DueCardRow) {
  return `credit-card-due:${row.workspaceId}:${row.cardId}:${row.statementYear}:${row.statementMonth}`;
}

async function syncRowsForUser(userId: string, workspaceId: string, rows: DueCardRow[], today: Date, deliverPush = false) {
  const activeKeys: string[] = [];

  for (const row of rows) {
    const dedupeKey = getDedupeKey(row);
    activeKeys.push(dedupeKey);
    const daysUntilDue = getDaysUntilDue(row.paymentDueDate, today);
    const copy = dueCopy(daysUntilDue);
    const amount = formatMoney(Number(row.outstandingCents));
    const message = `${row.cardName} ending ${row.last4Digit} has ${amount} outstanding and is ${copy.label}.`;
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
        OR ISNULL(target.[metadataJson], '') <> ${metadataJson}
      ) THEN
        UPDATE SET
          [title] = ${copy.title},
          [message] = ${message},
          [href] = '/credit-transactions',
          [metadataJson] = ${metadataJson},
          [readAt] = CASE
            WHEN target.[message] <> ${message} AND ${copy.shouldRealert ? 1 : 0} = 1 THEN NULL
            ELSE target.[readAt]
          END,
          [updatedAt] = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT ([id], [userId], [workspaceId], [type], [dedupeKey], [title], [message], [href], [metadataJson], [createdAt], [updatedAt])
        VALUES (${randomUUID()}, ${userId}, ${workspaceId}, ${CREDIT_CARD_DUE_TYPE}, ${dedupeKey}, ${copy.title}, ${message}, '/credit-transactions', ${metadataJson}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `);

    if (deliverPush && copy.shouldRealert) {
      await sendPushToUser(userId, {
        title: copy.title,
        message,
        href: "/credit-transactions",
        tag: dedupeKey,
      });
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

  for (const row of rows) {
    const workspaceRows = rowsByWorkspace.get(row.workspaceId) ?? [];
    workspaceRows.push(row);
    rowsByWorkspace.set(row.workspaceId, workspaceRows);
  }

  for (const member of members) {
    await syncRowsForUser(member.userId, member.workspaceId, rowsByWorkspace.get(member.workspaceId) ?? [], today, true);
  }
}

export async function listInAppNotifications(userId: string, workspaceId: string) {
  return prisma.$queryRaw<InAppNotification[]>(Prisma.sql`
    SELECT TOP (50) [id], [type], [title], [message], [href], [readAt], [createdAt], [updatedAt]
    FROM [dbo].[InAppNotification]
    WHERE [userId] = ${userId} AND [workspaceId] = ${workspaceId}
      AND [type] IN (${CREDIT_CARD_DUE_TYPE}, ${WORKSPACE_INVITATION_TYPE})
    ORDER BY CASE WHEN [readAt] IS NULL THEN 0 ELSE 1 END, [updatedAt] DESC
  `);
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
