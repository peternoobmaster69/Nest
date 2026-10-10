import { parseCreditAlert } from "@/lib/credit-alert-parser";
import { deriveStatementCycle } from "@/lib/credit-card-statement-cycle";
import { getSingaporeBankByName } from "@/lib/singapore-banks";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { sealFailedCreditAlertBody } from "@/lib/credit-alert-diagnostics";

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeCreditAlertCurrency(value: string | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

type CreditAlertParams = {
  workspaceId: string;
  rawBody: string;
  rawSubject?: string;
  source?: string;
  sourceMessageId?: string;
};
type ParsedCreditAlert = ReturnType<typeof parseCreditAlert>;
const stagingSelect = { id: true, parseStatus: true, creditTransactionId: true } as const;
type StagingRecord = Prisma.CardAlertStagingGetPayload<{ select: typeof stagingSelect }>;
const cardSelect = { id: true, statementDay: true, paymentDueDay: true } as const;
type AlertCard = Prisma.CreditCardAccountGetPayload<{ select: typeof cardSelect }>;

function isTerminalStaging(staging: StagingRecord) {
  return ["PROCESSED", "DUPLICATE", "FAILED"].includes(staging.parseStatus);
}

async function findOrCreateStaging(where: Prisma.CardAlertStagingWhereInput, data: () => Prisma.CardAlertStagingUncheckedCreateInput) {
  const current = await prisma.cardAlertStaging.findFirst({ where, select: stagingSelect });
  if (current) return { staging: current, duplicate: isTerminalStaging(current) };
  try {
    return { staging: await prisma.cardAlertStaging.create({ data: data() }), duplicate: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const concurrent = await prisma.cardAlertStaging.findFirst({ where, select: stagingSelect });
    if (!concurrent) throw error;
    return { staging: concurrent, duplicate: isTerminalStaging(concurrent) };
  }
}

function missingAlertFields(alert: ParsedCreditAlert) {
  return [
    !alert.cardLast4 ? "card last four digits" : null,
    !alert.merchant ? "merchant" : null,
    alert.amountCents === undefined ? "amount" : null,
    !alert.transactionDate ? "transaction date" : null,
  ].filter((field): field is string => Boolean(field));
}

function signedAlertAmount(alert: ParsedCreditAlert) {
  if (alert.amountCents === undefined) return undefined;
  return alert.alertType === "REVERSAL" ? -Math.abs(alert.amountCents) : alert.amountCents;
}

async function claimAlertStaging(id: string) {
  const claim = await prisma.cardAlertStaging.updateMany({
    where: {
      id,
      OR: [
        { parseStatus: { in: ["PENDING", "PARSED"] } },
        { parseStatus: "PROCESSING", processingStartedAt: { lte: new Date(Date.now() - 2 * 60_000) } },
      ],
    },
    data: { parseStatus: "PROCESSING", processingStartedAt: new Date() },
  });
  if (claim.count !== 1) {
    const error = new Error("Credit alert staging is already being processed.") as Error & {
      code: string; retryable: boolean; safeMessage: string;
    };
    error.code = "ALERT_STAGING_BUSY";
    error.retryable = true;
    error.safeMessage = "Credit alert staging is busy. The job will retry.";
    throw error;
  }
}

function finishAlertStaging(id: string, data: Prisma.CardAlertStagingUncheckedUpdateInput) {
  return prisma.cardAlertStaging.update({
    where: { id },
    data: { ...data, processingStartedAt: null, processedAt: new Date() },
  });
}

async function findAlertCard(workspaceId: string, last4Digit: string, bankName: string | undefined) {
  const where = { workspaceId, isActive: true, last4Digit };
  if (bankName) {
    const card = await prisma.creditCardAccount.findFirst({
      where: { ...where, bankName }, orderBy: { updatedAt: "desc" }, select: cardSelect,
    });
    if (card) return card;
  }
  return prisma.creditCardAccount.findFirst({
    where, orderBy: { updatedAt: "desc" }, select: cardSelect,
  });
}

async function recordAlertTransaction(workspaceId: string, stagingId: string, card: AlertCard, alert: ParsedCreditAlert, amountCents: number) {
  const transactionDate = alert.transactionDate!;
  const subject = alert.merchant!;
  const existing = await prisma.creditCardTransaction.findFirst({
    where: { workspaceId, creditCardId: card.id, transactionDate, amountCents, subject },
    select: { id: true },
  });
  if (existing) {
    return finishAlertStaging(stagingId, { parseStatus: "DUPLICATE", creditCardId: card.id, creditTransactionId: existing.id });
  }
  const cycle = deriveStatementCycle({ transactionDate, statementDay: card.statementDay, paymentDueDay: card.paymentDueDay });
  const created = await prisma.creditCardTransaction.create({
    data: {
      workspaceId, creditCardId: card.id, transactionDate,
      paymentDueDate: cycle.paymentDueDate, statementMonth: cycle.statementMonth, statementYear: cycle.statementYear,
      amountCents, subject, isInstallment: false,
    },
    select: { id: true },
  });
  return finishAlertStaging(stagingId, { parseStatus: "PROCESSED", creditCardId: card.id, creditTransactionId: created.id });
}

export async function ingestCreditAlert(params: CreditAlertParams) {
  const { workspaceId, rawBody, rawSubject, source = "EMAIL", sourceMessageId } = params;
  const alert = parseCreditAlert(rawBody, rawSubject);
  const contentHash = hashKey(rawBody);
  const sourceMessageKey = hashKey(`${workspaceId}\0${source}\0${sourceMessageId ?? contentHash}`);
  const transactionKey = alert.transactionRef ? hashKey(`${workspaceId}\0${alert.transactionRef}`) : null;
  const bankName = getSingaporeBankByName(alert.bankName)?.name ?? alert.bankName;
  const amountCents = signedAlertAmount(alert);
  const missingFields = missingAlertFields(alert);
  const requiredMissing = missingFields.length > 0;
  const stagingData = (): Prisma.CardAlertStagingUncheckedCreateInput => ({
    workspaceId,
    source,
    rawSubject: rawSubject ? "[redacted after parsing]" : null,
    rawBody: requiredMissing
      ? sealFailedCreditAlertBody({ workspaceId, sourceMessageKey, rawBody, contentHash })
      : `[redacted after parsing; sha256:${contentHash}]`,
    sourceMessageKey, transactionKey, contentHash, bankName,
    transactionRef: alert.transactionRef,
    currency: normalizeCreditAlertCurrency(alert.currency),
    amountCents,
    transactionDate: alert.transactionDate,
    merchant: alert.merchant,
    cardLast4: alert.cardLast4,
    parseStatus: requiredMissing ? "FAILED" : "PARSED",
    failureReason: requiredMissing ? `Unable to parse required fields: ${missingFields.join(", ")}.` : null,
  });
  const { staging, duplicate } = await findOrCreateStaging({
    workspaceId,
    OR: [{ sourceMessageKey }, ...(alert.transactionRef ? [{ transactionRef: alert.transactionRef }] : [])],
  }, stagingData);
  if (duplicate) return { ...staging, duplicate: true };
  if (requiredMissing) {
    if (staging.parseStatus === "FAILED") return staging;
    await claimAlertStaging(staging.id);
    const data = stagingData();
    return finishAlertStaging(staging.id, {
      parseStatus: "FAILED", rawBody: data.rawBody, rawSubject: data.rawSubject, failureReason: data.failureReason,
    });
  }

  await claimAlertStaging(staging.id);
  const card = await findAlertCard(workspaceId, alert.cardLast4!, bankName);
  if (!card) {
    return finishAlertStaging(staging.id, { parseStatus: "FAILED", failureReason: `No active card found for last4 ${alert.cardLast4}.` });
  }
  return recordAlertTransaction(workspaceId, staging.id, card, alert, amountCents!);
}
