import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { EmailClient, KnownEmailSendStatus } from "@azure/communication-email";
import { createHash } from "node:crypto";
import {
  addUtcDays,
  getDaysUntilDue,
  getReminderDateKey,
  REMINDER_LEAD_DAYS,
  shouldSendPaymentReminder,
  startOfUtcDay,
} from "@/lib/credit-card-payment-reminder-schedule";
import { completeBackgroundJob, createBackgroundJob, failBackgroundJob } from "@/lib/background-jobs";
import { syncCreditCardDueNotificationsForAllUsers } from "@/lib/in-app-notifications";

const DELIVERY_JOB_TYPE = "CREDIT_CARD_PAYMENT_REMINDER_EMAIL";

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
  workspaceId: string;
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
  skippedCount: number;
  errors: Array<{ to: string; message: string }>;
};

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
  const reminderThrough = addUtcDays(today, REMINDER_LEAD_DAYS + 1);

  const rows = await prisma.$queryRaw<ReminderRow[]>(Prisma.sql`
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
      AND cc.[isActive] = 1
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

  return rows.filter((row) => shouldSendPaymentReminder(getDaysUntilDue(row.paymentDueDate, today)));
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
      const daysUntilDue = getDaysUntilDue(row.paymentDueDate, today);
      const dueColor = daysUntilDue <= 0 ? "#b42318" : daysUntilDue <= 1 ? "#b54708" : "#9a6700";
      return `
        <tr>
          <td style="padding:14px 12px;border-bottom:1px solid #e7efea;">
            <strong>${escapeHtml(cardName)}</strong><br>
            <span style="color:#65776d;font-size:13px;">${escapeHtml(getStatementLabel(row.statementMonth, row.statementYear))}</span>
          </td>
          <td align="right" style="padding:14px 12px;border-bottom:1px solid #e7efea;font-weight:700;white-space:nowrap;">${escapeHtml(formatMoney(toNumber(row.outstandingCents)))}</td>
          <td align="right" style="padding:14px 12px;border-bottom:1px solid #e7efea;color:${dueColor};white-space:nowrap;">
            ${escapeHtml(getDueLabel(row.paymentDueDate, today))}<br>
            <span style="color:#65776d;font-size:12px;">${escapeHtml(formatDate(row.paymentDueDate))}</span>
          </td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <div style="margin:0;padding:28px 12px;background:#f3f7f5;font-family:Arial,sans-serif;color:#17211b;line-height:1.5;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dce8e1;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(20,68,43,0.08);">
        <div style="padding:22px 28px;background:#158f58;color:#ffffff;">
          <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.88;">Nest</div>
          <div style="margin-top:5px;font-size:24px;font-weight:700;line-height:1.25;">Credit card payment reminder</div>
        </div>
        <div style="padding:26px 28px;">
          <p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 22px;color:#42544a;">This is a reminder that <strong>${escapeHtml(workspaceName)}</strong> has credit card payments due soon or overdue.</p>
          <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #dce8e1;border-radius:10px;overflow:hidden;">
            <thead>
              <tr style="background:#f6faf8;color:#53645b;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;">
                <th align="left" style="padding:11px 12px;border-bottom:1px solid #dce8e1;">Card</th>
                <th align="right" style="padding:11px 12px;border-bottom:1px solid #dce8e1;">Outstanding</th>
                <th align="right" style="padding:11px 12px;border-bottom:1px solid #dce8e1;">Due</th>
              </tr>
            </thead>
            <tbody>${htmlRows}</tbody>
          </table>
          <div style="margin-top:20px;padding:16px 18px;border-radius:10px;background:#edf8f2;">
            <span style="color:#53645b;font-size:13px;">Total outstanding</span><br>
            <strong style="font-size:24px;color:#116f45;">${escapeHtml(formatMoney(totalOutstanding))}</strong>
          </div>
          ${appUrl ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(appUrl)}/credit-transactions" style="display:inline-block;padding:11px 17px;border-radius:8px;background:#158f58;color:#ffffff;font-weight:700;text-decoration:none;">Manage payments in Nest</a></p>` : ""}
          <p style="margin:22px 0 0;color:#718078;font-size:12px;">You will keep receiving this reminder while the statement balance remains outstanding.</p>
        </div>
      </div>
    </div>
  `;

  return { workspaceId: recipient.workspaceId, to: recipient.email, subject, text, html };
}

async function sendReminderEmail(email: ReminderEmail) {
  const connectionString = process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING;
  const senderAddress = process.env.AZURE_EMAIL_SENDER;

  if (!connectionString || !senderAddress) {
    throw new Error("AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING and AZURE_EMAIL_SENDER must be configured");
  }

  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    recipients: {
      to: [{ address: email.to }],
    },
    content: {
      subject: email.subject,
      html: email.html,
      plainText: email.text,
    },
  });
  const response = await poller.pollUntilDone();

  if (response.status !== KnownEmailSendStatus.Succeeded) {
    const detail = response.error?.message || response.error?.code || response.status;
    throw new Error(`Azure Communication Email failed: ${detail}`);
  }
}

function getDeliveryKey(email: ReminderEmail, today: Date) {
  const recipientHash = createHash("sha256").update(email.to.trim().toLowerCase()).digest("hex").slice(0, 20);
  return `${getReminderDateKey(today)}:${email.workspaceId}:${recipientHash}`;
}

async function wasAlreadySentOrIsSending(key: string) {
  const now = new Date();
  const existing = await prisma.backgroundJob.findFirst({
    where: {
      type: DELIVERY_JOB_TYPE,
      key,
      OR: [
        { status: "SUCCEEDED" },
        {
          status: { in: ["PENDING", "RUNNING"] },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: now } }],
        },
      ],
    },
    select: { id: true },
  });

  return Boolean(existing);
}

export async function sendCreditCardPaymentReminders({ dryRun = false } = {}): Promise<ReminderResult> {
  const today = startOfUtcDay(new Date());
  if (!dryRun) {
    await syncCreditCardDueNotificationsForAllUsers();
  }
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
      skippedCount: 0,
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
      skippedCount: emails.length,
      errors: [],
    };
  }

  const errors: ReminderResult["errors"] = [];
  let sentCount = 0;
  let skippedCount = 0;

  for (const email of emails) {
    const deliveryKey = getDeliveryKey(email, today);
    if (await wasAlreadySentOrIsSending(deliveryKey)) {
      skippedCount += 1;
      continue;
    }

    let jobId: string | null = null;
    try {
      const job = await createBackgroundJob({
        type: DELIVERY_JOB_TYPE,
        key: deliveryKey,
        workspaceId: email.workspaceId,
        message: "Sending credit card payment reminder.",
        leaseMs: 5 * 60 * 1000,
      });
      jobId = job.id;
      await sendReminderEmail(email);
      await completeBackgroundJob(jobId, {
        message: "Credit card payment reminder sent.",
        result: { provider: "AZURE_COMMUNICATION_EMAIL" },
      });
      sentCount += 1;
    } catch (error) {
      await failBackgroundJob(jobId, error).catch(() => null);
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
    skippedCount,
    errors,
  };
}
