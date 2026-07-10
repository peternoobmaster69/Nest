import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const REMINDER_LEAD_DAYS = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

type ReminderRow = {
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

type ReminderRecipient = {
  workspaceId: string;
  email: string;
  name: string | null;
};

type ReminderEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type ReminderResult = {
  ok: boolean;
  dryRun: boolean;
  dueItemCount: number;
  emailCount: number;
  sentCount: number;
  errors: Array<{ to: string; message: string }>;
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: process.env.CREDIT_CARD_REMINDER_CURRENCY || "SGD",
  }).format(cents / 100);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function getDaysUntilDue(dueDate: Date, today: Date) {
  return Math.ceil((startOfUtcDay(dueDate).getTime() - today.getTime()) / MS_PER_DAY);
}

function getDueLabel(dueDate: Date, today: Date) {
  const days = getDaysUntilDue(dueDate, today);
  if (days < 0) return `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

function getStatementLabel(month: number, year: number) {
  const statementDate = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("en-SG", { month: "long", year: "numeric", timeZone: "UTC" }).format(statementDate);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

async function findDueCreditCardPayments(today: Date) {
  const reminderThrough = addDays(today, REMINDER_LEAD_DAYS + 1);

  return prisma.$queryRaw<ReminderRow[]>(Prisma.sql`
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
      AND cct.[paymentDueDate] < ${reminderThrough}
    GROUP BY
      cct.[workspaceId],
      w.[name],
      cct.[creditCardId],
      cc.[cardName],
      cc.[bankName],
      cct.[statementMonth],
      cct.[statementYear]
    HAVING SUM(CAST(cct.[amountCents] AS BIGINT)) > 0
    ORDER BY MIN(cct.[paymentDueDate]) ASC
  `);
}

async function findRecipients(workspaceIds: string[]) {
  if (workspaceIds.length === 0) return [];

  const members = await prisma.workspaceMember.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      user: { email: { not: null } },
    },
    select: {
      workspaceId: true,
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
  });

  return members.flatMap<ReminderRecipient>((member) => {
    if (!member.user.email) return [];
    return [{
      workspaceId: member.workspaceId,
      email: member.user.email,
      name: member.user.name,
    }];
  });
}

function buildReminderEmail(recipient: ReminderRecipient, rows: ReminderRow[], today: Date): ReminderEmail {
  const workspaceName = rows[0]?.workspaceName || "your workspace";
  const totalOutstanding = rows.reduce((sum, row) => sum + toNumber(row.outstandingCents), 0);
  const subject = `Credit card payment reminder: ${formatMoney(totalOutstanding)} due`;
  const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || "";
  const greeting = recipient.name ? `Hi ${recipient.name},` : "Hi,";

  const lines = rows.map((row) => {
    const bankPrefix = row.bankName ? `${row.bankName} ` : "";
    return [
      `${bankPrefix}${row.cardName}`,
      getStatementLabel(row.statementMonth, row.statementYear),
      `${formatMoney(toNumber(row.outstandingCents))} ${getDueLabel(row.paymentDueDate, today)} (${formatDate(row.paymentDueDate)})`,
    ].join(" - ");
  });

  const text = [
    greeting,
    "",
    `This is a reminder that ${workspaceName} has credit card payments due soon or overdue:`,
    "",
    ...lines.map((line) => `- ${line}`),
    "",
    `Total outstanding: ${formatMoney(totalOutstanding)}`,
    appUrl ? `Manage payments: ${appUrl}/credit-transactions` : "",
    "",
    "You will keep receiving this reminder while the statement balance remains outstanding.",
  ]
    .filter(Boolean)
    .join("\n");

  const htmlRows = rows
    .map((row) => {
      const cardName = `${row.bankName ? `${row.bankName} ` : ""}${row.cardName}`;
      return `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${escapeHtml(cardName)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${escapeHtml(getStatementLabel(row.statementMonth, row.statementYear))}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(formatMoney(toNumber(row.outstandingCents)))}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(getDueLabel(row.paymentDueDate, today))}</td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;">
      <p>${escapeHtml(greeting)}</p>
      <p>This is a reminder that <strong>${escapeHtml(workspaceName)}</strong> has credit card payments due soon or overdue.</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th align="left">Card</th>
            <th align="left">Statement</th>
            <th align="right">Outstanding</th>
            <th align="right">Due</th>
          </tr>
        </thead>
        <tbody>${htmlRows}</tbody>
      </table>
      <p><strong>Total outstanding: ${escapeHtml(formatMoney(totalOutstanding))}</strong></p>
      ${appUrl ? `<p><a href="${escapeHtml(appUrl)}/credit-transactions">Manage payments in Nest</a></p>` : ""}
      <p style="color:#6b7280;font-size:13px;">You will keep receiving this reminder while the statement balance remains outstanding.</p>
    </div>
  `;

  return { to: recipient.email, subject, text, html };
}

async function sendReminderEmail(email: ReminderEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CREDIT_CARD_REMINDER_FROM;

  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and CREDIT_CARD_REMINDER_FROM must be configured");
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
      text: email.text,
      html: email.html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email provider returned ${response.status}`);
  }
}

export async function sendCreditCardPaymentReminders({ dryRun = false } = {}): Promise<ReminderResult> {
  const today = startOfUtcDay(new Date());
  const dueRows = await findDueCreditCardPayments(today);
  const workspaceIds = [...new Set(dueRows.map((row) => row.workspaceId))];
  const recipients = await findRecipients(workspaceIds);
  const rowsByWorkspace = new Map<string, ReminderRow[]>();

  for (const row of dueRows) {
    const rows = rowsByWorkspace.get(row.workspaceId) ?? [];
    rows.push(row);
    rowsByWorkspace.set(row.workspaceId, rows);
  }

  const emails = recipients
    .map((recipient) => {
      const rows = rowsByWorkspace.get(recipient.workspaceId) ?? [];
      return rows.length > 0 ? buildReminderEmail(recipient, rows, today) : null;
    })
    .filter((email): email is ReminderEmail => Boolean(email));

  if (emails.length === 0) {
    return {
      ok: true,
      dryRun,
      dueItemCount: dueRows.length,
      emailCount: 0,
      sentCount: 0,
      errors: [],
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun,
      dueItemCount: dueRows.length,
      emailCount: emails.length,
      sentCount: 0,
      errors: [],
    };
  }

  const errors: ReminderResult["errors"] = [];
  let sentCount = 0;

  for (const email of emails) {
    try {
      await sendReminderEmail(email);
      sentCount += 1;
    } catch (error) {
      errors.push({
        to: email.to,
        message: error instanceof Error ? error.message : "Unknown email error",
      });
    }
  }

  return {
    ok: errors.length === 0,
    dryRun,
    dueItemCount: dueRows.length,
    emailCount: emails.length,
    sentCount,
    errors,
  };
}
