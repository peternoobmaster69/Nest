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

export async function ingestCreditAlert(params: {
  workspaceId: string;
  rawBody: string;
  rawSubject?: string;
  source?: string;
  sourceMessageId?: string;
}) {
  const { workspaceId, rawBody, rawSubject, source = "EMAIL", sourceMessageId } = params;
  const parsedAlert = parseCreditAlert(rawBody, rawSubject);
  const contentHash = hashKey(rawBody);
  const sourceMessageKey = hashKey(`${workspaceId}\0${source}\0${sourceMessageId ?? contentHash}`);
  const transactionKey = parsedAlert.transactionRef
    ? hashKey(`${workspaceId}\0${parsedAlert.transactionRef}`)
    : null;
  const normalizedBank = getSingaporeBankByName(parsedAlert.bankName)?.name ?? parsedAlert.bankName;
  const signedAmountCents =
    parsedAlert.amountCents === undefined
      ? undefined
      : parsedAlert.alertType === "REVERSAL"
        ? -Math.abs(parsedAlert.amountCents)
        : parsedAlert.amountCents;

  let staging = await prisma.cardAlertStaging.findFirst({
      where: {
        workspaceId,
        OR: [
          ...(sourceMessageKey ? [{ sourceMessageKey }] : []),
          ...(parsedAlert.transactionRef ? [{ transactionRef: parsedAlert.transactionRef }] : []),
        ],
      },
      select: { id: true, parseStatus: true, creditTransactionId: true },
    });
  if (staging && ["PROCESSED", "DUPLICATE", "FAILED"].includes(staging.parseStatus)) {
      return {
        id: staging.id,
        parseStatus: staging.parseStatus,
        creditTransactionId: staging.creditTransactionId,
        duplicate: true,
      };
  }

  const missingFields = [
    !parsedAlert.cardLast4 ? "card last four digits" : null,
    !parsedAlert.merchant ? "merchant" : null,
    parsedAlert.amountCents === undefined ? "amount" : null,
    !parsedAlert.transactionDate ? "transaction date" : null,
  ].filter((field): field is string => Boolean(field));
  const requiredMissing = missingFields.length > 0;
  const parseFailureReason = requiredMissing
    ? `Unable to parse required fields: ${missingFields.join(", ")}.`
    : null;
  const storedBody = requiredMissing
    ? sealFailedCreditAlertBody({ workspaceId, sourceMessageKey, rawBody, contentHash })
    : `[redacted after parsing; sha256:${contentHash}]`;

  if (!staging) {
    try {
      staging = await prisma.cardAlertStaging.create({
      data: {
        workspaceId,
        source,
        rawSubject: rawSubject ? "[redacted after parsing]" : null,
        rawBody: storedBody,
        sourceMessageKey,
        transactionKey,
        contentHash,
        bankName: normalizedBank,
        transactionRef: parsedAlert.transactionRef,
        currency: parsedAlert.currency,
        amountCents: signedAmountCents,
        transactionDate: parsedAlert.transactionDate,
        merchant: parsedAlert.merchant,
        cardLast4: parsedAlert.cardLast4,
        parseStatus: requiredMissing ? "FAILED" : "PARSED",
        failureReason: parseFailureReason,
      },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicateStaging = await prisma.cardAlertStaging.findFirst({
              where: {
                workspaceId,
                OR: [
                  ...(sourceMessageKey ? [{ sourceMessageKey }] : []),
                  ...(parsedAlert.transactionRef ? [{ transactionRef: parsedAlert.transactionRef }] : []),
                ],
              },
              select: { id: true, parseStatus: true, creditTransactionId: true },
            });

        if (duplicateStaging && ["PROCESSED", "DUPLICATE", "FAILED"].includes(duplicateStaging.parseStatus)) {
          return { ...duplicateStaging, duplicate: true };
        }
        staging = duplicateStaging;
      }
      if (!staging) throw error;
    }
  }

  if (requiredMissing) {
    return staging;
  }

  const processingStartedAt = new Date();
  const claim = await prisma.cardAlertStaging.updateMany({
    where: {
      id: staging.id,
      OR: [
        { parseStatus: { in: ["PENDING", "PARSED"] } },
        { parseStatus: "PROCESSING", processingStartedAt: { lte: new Date(Date.now() - 2 * 60_000) } },
      ],
    },
    data: { parseStatus: "PROCESSING", processingStartedAt },
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

  const card =
    (normalizedBank
      ? await prisma.creditCardAccount.findFirst({
          where: {
            workspaceId,
            isActive: true,
            last4Digit: parsedAlert.cardLast4!,
            bankName: normalizedBank,
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true, statementDay: true, paymentDueDay: true },
        })
      : null) ??
    await prisma.creditCardAccount.findFirst({
      where: {
        workspaceId,
        isActive: true,
        last4Digit: parsedAlert.cardLast4!,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, statementDay: true, paymentDueDay: true },
    });

  if (!card) {
    return prisma.cardAlertStaging.update({
      where: { id: staging.id },
      data: {
        parseStatus: "FAILED",
        failureReason: `No active card found for last4 ${parsedAlert.cardLast4}.`,
        processingStartedAt: null,
        processedAt: new Date(),
      },
    });
  }

  const existingTx = await prisma.creditCardTransaction.findFirst({
    where: {
      workspaceId,
      creditCardId: card.id,
      transactionDate: parsedAlert.transactionDate!,
      amountCents: signedAmountCents!,
      subject: parsedAlert.merchant!,
    },
    select: { id: true },
  });

  if (existingTx) {
    return prisma.cardAlertStaging.update({
      where: { id: staging.id },
      data: {
        parseStatus: "DUPLICATE",
        creditCardId: card.id,
        creditTransactionId: existingTx.id,
        processingStartedAt: null,
        processedAt: new Date(),
      },
    });
  }

  const txDate = parsedAlert.transactionDate!;
  const cycle = deriveStatementCycle({
    transactionDate: txDate,
    statementDay: card.statementDay,
    paymentDueDay: card.paymentDueDay,
  });
  const createdTx = await prisma.creditCardTransaction.create({
    data: {
      workspaceId,
      creditCardId: card.id,
      transactionDate: txDate,
      paymentDueDate: cycle.paymentDueDate,
      statementMonth: cycle.statementMonth,
      statementYear: cycle.statementYear,
      amountCents: signedAmountCents!,
      subject: parsedAlert.merchant!,
      isInstallment: false,
    },
    select: { id: true },
  });

  return prisma.cardAlertStaging.update({
    where: { id: staging.id },
    data: {
      parseStatus: "PROCESSED",
      creditCardId: card.id,
      creditTransactionId: createdTx.id,
      processingStartedAt: null,
      processedAt: new Date(),
    },
  });
}
