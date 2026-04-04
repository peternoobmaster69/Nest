import { parseCreditAlert } from "@/lib/credit-alert-parser";
import { deriveStatementCycle } from "@/lib/credit-card-statement-cycle";
import { getSingaporeBankByName } from "@/lib/singapore-banks";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function ingestCreditAlert(params: {
  workspaceId: string;
  rawBody: string;
  rawSubject?: string;
  source?: string;
}) {
  const { workspaceId, rawBody, rawSubject, source = "EMAIL" } = params;
  const parsedAlert = parseCreditAlert(rawBody, rawSubject);
  const normalizedBank = getSingaporeBankByName(parsedAlert.bankName)?.name ?? parsedAlert.bankName;
  const signedAmountCents =
    parsedAlert.amountCents === undefined
      ? undefined
      : parsedAlert.alertType === "REVERSAL"
        ? -Math.abs(parsedAlert.amountCents)
        : parsedAlert.amountCents;

  if (parsedAlert.transactionRef) {
    const existing = await prisma.cardAlertStaging.findFirst({
      where: { workspaceId, transactionRef: parsedAlert.transactionRef },
      select: { id: true, parseStatus: true, creditTransactionId: true },
    });
    if (existing) {
      return {
        id: existing.id,
        parseStatus: existing.parseStatus,
        creditTransactionId: existing.creditTransactionId,
        duplicate: true,
      };
    }
  }

  const requiredMissing =
    !parsedAlert.cardLast4 || !parsedAlert.merchant || !parsedAlert.amountCents || !parsedAlert.transactionDate;

  let staging;
  try {
    staging = await prisma.cardAlertStaging.create({
      data: {
        workspaceId,
        source,
        rawSubject,
        rawBody,
        bankName: normalizedBank,
        transactionRef: parsedAlert.transactionRef,
        currency: parsedAlert.currency,
        amountCents: signedAmountCents,
        transactionDate: parsedAlert.transactionDate,
        merchant: parsedAlert.merchant,
        cardLast4: parsedAlert.cardLast4,
        parseStatus: requiredMissing ? "FAILED" : "PARSED",
        failureReason: requiredMissing ? "Unable to parse required fields from alert." : null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicateStaging =
        (parsedAlert.transactionRef
          ? await prisma.cardAlertStaging.findFirst({
              where: { workspaceId, transactionRef: parsedAlert.transactionRef },
              select: { id: true, parseStatus: true, creditTransactionId: true },
            })
          : null) ??
        null;

      if (duplicateStaging) {
        return {
          id: duplicateStaging.id,
          parseStatus: duplicateStaging.parseStatus,
          creditTransactionId: duplicateStaging.creditTransactionId,
          duplicate: true,
        };
      }
    }
    throw error;
  }

  if (requiredMissing) {
    return staging;
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
      processedAt: new Date(),
    },
  });
}
