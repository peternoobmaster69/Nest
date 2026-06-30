import {
  completeBackgroundJob,
  createBackgroundJob,
  failBackgroundJob,
} from "@/lib/background-jobs";
import { sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const CREDIT_CARD_PAYMENT_REMINDER_JOB_TYPE = "CREDIT_CARD_PAYMENT_REMINDER";

type ReminderCandidate = {
  workspaceId: string;
  workspaceName: string;
  cardId: string;
  cardName: string;
  bankName: string | null;
  statementMonth: number;
  statementYear: number;
  paymentDueDate: Date;
  outstandingCents: number | bigint;
};

export type CreditCardPaymentReminderResult = {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  failures: Array<{ key: string; message: string }>;
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDateKey(date: Date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(cents / 100);
}

function formatDueDate(date: Date) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatStatement(month: number, year: number) {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function getReminderKey(candidate: ReminderCandidate, reminderDate: Date) {
  return [
    candidate.workspaceId,
    candidate.cardId,
    candidate.statementYear,
    String(candidate.statementMonth).padStart(2, "0"),
    formatDateKey(candidate.paymentDueDate),
    formatDateKey(reminderDate),
  ].join(":");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildReminderEmail(candidate: ReminderCandidate) {
  const dueDate = formatDueDate(candidate.paymentDueDate);
  const outstanding = formatMoney(Number(candidate.outstandingCents));
  const statement = formatStatement(candidate.statementMonth, candidate.statementYear);
  const cardLabel = candidate.bankName
    ? `${candidate.bankName} ${candidate.cardName}`
    : candidate.cardName;
  const subject = `Credit card payment due: ${cardLabel}`;
  const text = [
    `Payment reminder for ${candidate.workspaceName}`,
    "",
    `${cardLabel} has an outstanding ${statement} statement balance of ${outstanding}.`,
    `Payment due date: ${dueDate}`,
    "",
    "Nest will keep sending this daily reminder while the statement remains outstanding.",
  ].join("\n");
  const html = `
    <div>
      <p>Payment reminder for <strong>${escapeHtml(candidate.workspaceName)}</strong></p>
      <p>
        <strong>${escapeHtml(cardLabel)}</strong> has an outstanding
        ${escapeHtml(statement)} statement balance of <strong>${escapeHtml(outstanding)}</strong>.
      </p>
      <p>Payment due date: <strong>${escapeHtml(dueDate)}</strong></p>
      <p>Nest will keep sending this daily reminder while the statement remains outstanding.</p>
    </div>
  `;

  return { subject, text, html };
}

async function getWorkspaceRecipients(workspaceIds: string[]) {
  if (workspaceIds.length === 0) return new Map<string, string[]>();

  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: {
      workspaceId: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  const recipients = new Map<string, string[]>();
  for (const row of rows as Array<{ workspaceId: string; user: { email: string | null } }>) {
    if (!row.user.email) continue;
    const existing = recipients.get(row.workspaceId) ?? [];
    existing.push(row.user.email);
    recipients.set(row.workspaceId, existing);
  }
  return recipients;
}

async function wasReminderSent(key: string) {
  const sentCount = await prisma.backgroundJob.count({
    where: {
      type: CREDIT_CARD_PAYMENT_REMINDER_JOB_TYPE,
      key,
      status: "SUCCEEDED",
    },
  });
  return sentCount > 0;
}

export async function runCreditCardPaymentReminderJob(now = new Date()) {
  const today = startOfUtcDay(now);
  const reminderWindowEnd = addUtcDays(today, 4);

  const candidates = await prisma.$queryRaw<ReminderCandidate[]>(Prisma.sql`
    SELECT
      cct.[workspaceId] AS [workspaceId],
      w.[name] AS [workspaceName],
      cct.[creditCardId] AS [cardId],
      cc.[cardName] AS [cardName],
      cc.[bankName] AS [bankName],
      cct.[statementMonth] AS [statementMonth],
      cct.[statementYear] AS [statementYear],
      MIN(cct.[paymentDueDate]) AS [paymentDueDate],
      SUM(CAST(cct.[amountCents] AS BIGINT)) AS [outstandingCents]
    FROM [dbo].[CreditCardTransaction] cct
    INNER JOIN [dbo].[CreditCardAccount] cc
      ON cc.[id] = cct.[creditCardId]
    INNER JOIN [dbo].[Workspace] w
      ON w.[id] = cct.[workspaceId]
    WHERE cct.[paymentDueDate] IS NOT NULL
      AND cc.[isActive] = 1
      AND cct.[paymentDueDate] < ${reminderWindowEnd}
    GROUP BY
      cct.[workspaceId],
      w.[name],
      cct.[creditCardId],
      cc.[cardName],
      cc.[bankName],
      cct.[statementMonth],
      cct.[statementYear]
    HAVING SUM(CAST(cct.[amountCents] AS BIGINT)) > 0
      AND MIN(cct.[paymentDueDate]) < ${reminderWindowEnd}
    ORDER BY MIN(cct.[paymentDueDate]) ASC
  `);

  const recipientsByWorkspace = await getWorkspaceRecipients([
    ...new Set(candidates.map((candidate) => candidate.workspaceId)),
  ]);
  const result: CreditCardPaymentReminderResult = {
    checked: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const candidate of candidates) {
    const key = getReminderKey(candidate, today);
    const recipients = recipientsByWorkspace.get(candidate.workspaceId) ?? [];

    if (recipients.length === 0 || (await wasReminderSent(key))) {
      result.skipped += 1;
      continue;
    }

    const job = await createBackgroundJob({
      type: CREDIT_CARD_PAYMENT_REMINDER_JOB_TYPE,
      key,
      workspaceId: candidate.workspaceId,
      message: "Sending credit card payment reminder.",
    });

    try {
      const email = buildReminderEmail(candidate);
      await sendEmail({ to: recipients, ...email });
      await completeBackgroundJob(job.id, {
        message: "Credit card payment reminder sent.",
        result: {
          cardId: candidate.cardId,
          paymentDueDate: candidate.paymentDueDate,
          outstandingCents: Number(candidate.outstandingCents),
          recipients,
        },
      });
      result.sent += 1;
    } catch (error) {
      await failBackgroundJob(job.id, error);
      result.failed += 1;
      result.failures.push({
        key,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}
