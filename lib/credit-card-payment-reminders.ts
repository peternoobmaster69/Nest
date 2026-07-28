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
import {
  BackgroundJobError,
  claimBackgroundJob,
  completeClaimedBackgroundJob,
  enqueueBackgroundJob,
  failClaimedBackgroundJob,
} from "@/lib/background-jobs";
import { syncCreditCardDueNotificationsForAllUsers } from "@/lib/in-app-notifications";
import { buildAbsoluteWorkspaceEntryUrl, buildCreditCardStatementPath } from "@/lib/workspace-entry";

const DELIVERY_JOB_TYPE = "CREDIT_CARD_PAYMENT_REMINDER_EMAIL";

function maxDeliveriesPerRun() {
  const parsed = Number(process.env.PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
}

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
  userId: string;
  email: string;
  name: string | null;
};

type ReminderEmail = {
  workspaceId: string;
  userId: string;
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
  errors: Array<{ code: string; count: number }>;
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
          id: true,
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
      userId: member.user.id,
      email: member.user.email,
      name: member.user.name,
    }];
  });
}

function buildReminderEmail(recipient: ReminderRecipient, rows: ReminderRow[], today: Date): ReminderEmail {
  const workspaceLabel = rows[0]?.workspaceName
    ? `${rows[0].workspaceName} workspace`
    : "your workspace";
  const totalOutstanding = rows.reduce((sum, row) => sum + toNumber(row.outstandingCents), 0);
  const subject = `Credit card payment reminder: ${formatMoney(totalOutstanding)} due`;
  const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || "";
  const managePaymentsDestination = rows.length === 1
    ? buildCreditCardStatementPath({
        cardId: rows[0].cardId,
        statementMonth: rows[0].statementMonth,
        statementYear: rows[0].statementYear,
      })
    : "/credit-transactions";
  const managePaymentsUrl = buildAbsoluteWorkspaceEntryUrl(
    appUrl,
    recipient.workspaceId,
    managePaymentsDestination,
  );
  const greeting = recipient.name ? `Hi ${recipient.name},` : "Hi,";

  const lines = rows.map((row) => {
    const bankPrefix = row.bankName ? `${row.bankName} ` : "";
    const statementUrl = buildAbsoluteWorkspaceEntryUrl(
      appUrl,
      recipient.workspaceId,
      buildCreditCardStatementPath({
        cardId: row.cardId,
        statementMonth: row.statementMonth,
        statementYear: row.statementYear,
      }),
    );
    const summary = [
      `${bankPrefix}${row.cardName}`,
      getStatementLabel(row.statementMonth, row.statementYear),
      `${formatMoney(toNumber(row.outstandingCents))} ${getDueLabel(row.paymentDueDate, today)} (${formatDate(row.paymentDueDate)})`,
    ].join(" - ");
    return statementUrl ? `${summary}\n  View statement: ${statementUrl}` : summary;
  });

  const text = [
    greeting,
    "",
    `This is a reminder that ${workspaceLabel} has credit card payments due soon or overdue:`,
    "",
    ...lines.map((line) => `- ${line}`),
    "",
    `Total outstanding: ${formatMoney(totalOutstanding)}`,
    managePaymentsUrl ? `Manage payments: ${managePaymentsUrl}` : "",
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
      const statementUrl = buildAbsoluteWorkspaceEntryUrl(
        appUrl,
        recipient.workspaceId,
        buildCreditCardStatementPath({
          cardId: row.cardId,
          statementMonth: row.statementMonth,
          statementYear: row.statementYear,
        }),
      );
      const cardLabel = statementUrl
        ? `<a href="${escapeHtml(statementUrl)}" style="color:#116f45;text-decoration:underline;"><strong>${escapeHtml(cardName)}</strong></a>`
        : `<strong>${escapeHtml(cardName)}</strong>`;
      return `
        <tr>
          <td style="padding:14px 12px;border-bottom:1px solid #e7efea;">
            ${cardLabel}<br>
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
          <p style="margin:0 0 22px;color:#42544a;">This is a reminder that <strong>${escapeHtml(workspaceLabel)}</strong> has credit card payments due soon or overdue.</p>
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
          ${managePaymentsUrl ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(managePaymentsUrl)}" style="display:inline-block;padding:11px 17px;border-radius:8px;background:#158f58;color:#ffffff;font-weight:700;text-decoration:none;">Manage payments in Nest</a></p>` : ""}
          <p style="margin:22px 0 0;color:#718078;font-size:12px;">You will keep receiving this reminder while the statement balance remains outstanding.</p>
        </div>
      </div>
    </div>
  `;

  return { workspaceId: recipient.workspaceId, userId: recipient.userId, to: recipient.email, subject, text, html };
}

async function sendReminderEmail(email: ReminderEmail, operationId: string) {
  const connectionString = process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING;
  const senderAddress = process.env.AZURE_EMAIL_SENDER;

  if (!connectionString || !senderAddress) {
    throw new BackgroundJobError("EMAIL_NOT_CONFIGURED", "Reminder email is not configured.");
  }

  const client = new EmailClient(connectionString);
  let response;
  try {
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
    }, { operationId });
    response = await poller.pollUntilDone();
  } catch {
    throw new BackgroundJobError(
      "EMAIL_PROVIDER_UNAVAILABLE",
      "The email provider is temporarily unavailable.",
      true,
    );
  }

  if (response.status !== KnownEmailSendStatus.Succeeded) {
    throw new BackgroundJobError(
      "EMAIL_PROVIDER_REJECTED",
      "The email provider did not accept the reminder.",
      false,
    );
  }
}

async function rebuildReminderEmail(job: {
  workspaceId: string | null;
  userId: string | null;
  payloadJson: string | null;
}) {
  if (!job.workspaceId || !job.userId) return null;
  let reminderDate: Date;
  try {
    const payload = JSON.parse(job.payloadJson ?? "{}") as { reminderDate?: unknown };
    reminderDate = startOfUtcDay(new Date(String(payload.reminderDate ?? "")));
    if (!Number.isFinite(reminderDate.getTime())) return null;
  } catch {
    return null;
  }
  const [rows, membership] = await Promise.all([
    findDueCreditCardPayments(reminderDate),
    prisma.workspaceMember.findFirst({
      where: { workspaceId: job.workspaceId, userId: job.userId, user: { email: { not: null } } },
      select: { workspaceId: true, user: { select: { id: true, email: true, name: true } } },
    }),
  ]);
  if (!membership?.user.email) return null;
  const workspaceRows = rows.filter((row) => row.workspaceId === job.workspaceId);
  if (!workspaceRows.length) return null;
  return buildReminderEmail({
    workspaceId: membership.workspaceId,
    userId: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
  }, workspaceRows, reminderDate);
}

function getDeliveryKey(email: ReminderEmail, today: Date) {
  const recipientHash = createHash("sha256").update(email.to.trim().toLowerCase()).digest("hex").slice(0, 20);
  return `${getReminderDateKey(today)}:${email.workspaceId}:${recipientHash}`;
}

function deliveryOperationId(key: string) {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function processReminderEmailDeliveryJob(jobId: string, preparedEmail?: ReminderEmail) {
  const claimed = await claimBackgroundJob({ jobId, leaseMs: 5 * 60_000 });
  if (!claimed) return { status: "skipped" as const };
  try {
    const email = preparedEmail ?? await rebuildReminderEmail(claimed.job);
    if (!email || !claimed.job.key) {
      await completeClaimedBackgroundJob(claimed.job.id, claimed.leaseToken, {
        message: "Reminder no longer applies; delivery skipped.",
        skipped: true,
      });
      return { status: "skipped" as const };
    }
    await sendReminderEmail(email, deliveryOperationId(claimed.job.key));
    await completeClaimedBackgroundJob(claimed.job.id, claimed.leaseToken, {
      message: "Credit card payment reminder sent.",
      result: { provider: "AZURE_COMMUNICATION_EMAIL" },
    });
    return { status: "sent" as const };
  } catch (error) {
    const failed = await failClaimedBackgroundJob(claimed.job.id, claimed.leaseToken, error).catch(() => null);
    return { status: "failed" as const, code: failed?.failure.code ?? "EMAIL_DELIVERY_FAILED" };
  }
}

async function sendCreditCardPaymentReminders({ dryRun = false } = {}): Promise<ReminderResult> {
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

  const errorCounts = new Map<string, number>();
  let sentCount = 0;
  let skippedCount = 0;
  let attemptedCount = 0;

  for (const email of emails) {
    const deliveryKey = getDeliveryKey(email, today);
    const queued = await enqueueBackgroundJob({
      type: DELIVERY_JOB_TYPE,
      key: deliveryKey,
      idempotencyKey: deliveryKey,
      workspaceId: email.workspaceId,
      userId: email.userId,
      message: "Credit card payment reminder queued.",
      payload: { reminderDate: today.toISOString() },
      maxAttempts: 4,
    });
    if (["SUCCEEDED", "SKIPPED", "RUNNING"].includes(queued.job.status)) {
      skippedCount += 1;
      continue;
    }
    if (attemptedCount >= maxDeliveriesPerRun()) {
      skippedCount += 1;
      continue;
    }

    attemptedCount += 1;
    const delivery = await processReminderEmailDeliveryJob(queued.job.id, email);
    if (delivery.status === "sent") {
      sentCount += 1;
    } else if (delivery.status === "failed") {
      errorCounts.set(delivery.code, (errorCounts.get(delivery.code) ?? 0) + 1);
    } else {
      skippedCount += 1;
    }
  }

  const errors = [...errorCounts].map(([code, count]) => ({ code, count }));

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

export async function runCreditCardPaymentReminderJob({ dryRun = false } = {}) {
  return sendCreditCardPaymentReminders({ dryRun });
}
