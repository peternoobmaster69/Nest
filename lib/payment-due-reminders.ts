import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type ReminderRow = {
  workspaceId: string;
  workspaceName: string;
  cardId: string;
  cardName: string;
  bankName: string | null;
  last4Digit: string;
  statementMonth: number;
  statementYear: number;
  paymentDueDate: Date;
  outstandingCents: number | bigint;
  recipientEmail: string;
  recipientName: string | null;
};

type ReminderEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type PaymentDueReminderResult = {
  ok: boolean;
  sent: number;
  skipped: number;
  errors: Array<{ to: string; message: string }>;
  dryRun?: boolean;
};

const REMINDER_WINDOW_DAYS = 3;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(cents / 100);
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getDaysUntil(dueDate: Date, today: Date) {
  return Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function buildReminderEmail(row: ReminderRow, today: Date): ReminderEmail {
  const outstandingCents = Number(row.outstandingCents);
  const dueDate = new Date(row.paymentDueDate);
  const daysUntil = getDaysUntil(dueDate, today);
  const cardLabel = `${row.cardName} ending ${row.last4Digit}`;
  const dueLabel =
    daysUntil < 0
      ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} overdue`
      : daysUntil === 0
        ? "due today"
        : `due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
  const subject = `Credit card payment ${dueLabel}: ${row.cardName}`;
  const statementLabel = `${row.statementMonth}/${row.statementYear}`;
  const amount = formatCurrency(outstandingCents);
  const formattedDueDate = formatDate(dueDate);

  const text = [
    `Hi ${row.recipientName || "there"},`,
    "",
    `${cardLabel} has an outstanding payment of ${amount} for statement ${statementLabel}.`,
    `Payment due date: ${formattedDueDate} (${dueLabel}).`,
    "",
    "Nest will continue sending reminders while this statement remains outstanding.",
  ].join("\n");

  const html = `
    <p>Hi ${row.recipientName || "there"},</p>
    <p><strong>${cardLabel}</strong> has an outstanding payment of <strong>${amount}</strong> for statement ${statementLabel}.</p>
    <p>Payment due date: <strong>${formattedDueDate}</strong> (${dueLabel}).</p>
    <p>Nest will continue sending reminders while this statement remains outstanding.</p>
  `;

  return {
    to: row.recipientEmail,
    subject,
    html,
    text,
  };
}

async function sendResendEmail(email: ReminderEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PAYMENT_REMINDER_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("Missing RESEND_API_KEY or PAYMENT_REMINDER_FROM_EMAIL");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${message}`);
  }
}

export async function sendPaymentDueReminders(): Promise<PaymentDueReminderResult> {
  const today = startOfToday();
  const reminderWindowEnd = addDays(today, REMINDER_WINDOW_DAYS + 1);
  const dryRun = process.env.PAYMENT_REMINDER_DRY_RUN === "true";

  const rows = await prisma.$queryRaw<ReminderRow[]>(Prisma.sql`
    WITH DueStatements AS (
      SELECT
        cct.[workspaceId],
        cct.[creditCardId] AS [cardId],
        cct.[statementMonth],
        cct.[statementYear],
        MIN(cct.[paymentDueDate]) AS [paymentDueDate],
        SUM(CAST(cct.[amountCents] AS BIGINT)) AS [outstandingCents]
      FROM [dbo].[CreditCardTransaction] cct
      WHERE cct.[paymentDueDate] IS NOT NULL
      GROUP BY
        cct.[workspaceId],
        cct.[creditCardId],
        cct.[statementMonth],
        cct.[statementYear]
      HAVING
        SUM(CAST(cct.[amountCents] AS BIGINT)) > 0
        AND MIN(cct.[paymentDueDate]) < ${reminderWindowEnd}
    )
    SELECT
      ds.[workspaceId],
      w.[name] AS [workspaceName],
      ds.[cardId],
      cc.[cardName],
      cc.[bankName],
      cc.[last4Digit],
      ds.[statementMonth],
      ds.[statementYear],
      ds.[paymentDueDate],
      ds.[outstandingCents],
      u.[email] AS [recipientEmail],
      u.[name] AS [recipientName]
    FROM DueStatements ds
    INNER JOIN [dbo].[Workspace] w
      ON w.[id] = ds.[workspaceId]
    INNER JOIN [dbo].[CreditCardAccount] cc
      ON cc.[id] = ds.[cardId]
    INNER JOIN [dbo].[WorkspaceMember] wm
      ON wm.[workspaceId] = ds.[workspaceId]
    INNER JOIN [dbo].[User] u
      ON u.[id] = wm.[userId]
    WHERE
      cc.[isActive] = 1
      AND u.[email] IS NOT NULL
    ORDER BY ds.[paymentDueDate] ASC, cc.[cardName] ASC
  `);

  const result: PaymentDueReminderResult = {
    ok: true,
    sent: 0,
    skipped: 0,
    errors: [],
    ...(dryRun ? { dryRun: true } : {}),
  };

  for (const row of rows) {
    const email = buildReminderEmail(row, today);

    try {
      if (dryRun) {
        result.skipped += 1;
        continue;
      }

      await sendResendEmail(email);
      result.sent += 1;
    } catch (error) {
      result.ok = false;
      result.errors.push({
        to: email.to,
        message: error instanceof Error ? error.message : "Unknown email error",
      });
    }
  }

  return result;
}
