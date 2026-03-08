import { parseDbsTransactionAlert } from "@/lib/credit-alert-parser";
import { prisma } from "@/lib/prisma";

export async function ingestCreditAlert(params: {
  workspaceId: string;
  rawBody: string;
  rawSubject?: string;
  source?: string;
}) {
  const { workspaceId, rawBody, rawSubject, source = "EMAIL" } = params;
  const parsedAlert = parseDbsTransactionAlert(rawBody);

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

  const staging = await prisma.cardAlertStaging.create({
    data: {
      workspaceId,
      source,
      rawSubject,
      rawBody,
      bankName: parsedAlert.bankName,
      transactionRef: parsedAlert.transactionRef,
      currency: parsedAlert.currency,
      amountCents: parsedAlert.amountCents,
      transactionDate: parsedAlert.transactionDate,
      merchant: parsedAlert.merchant,
      cardLast4: parsedAlert.cardLast4,
      parseStatus: requiredMissing ? "FAILED" : "PARSED",
      failureReason: requiredMissing ? "Unable to parse required fields from alert." : null,
    },
  });

  if (requiredMissing) {
    return staging;
  }

  const card = await prisma.creditCardAccount.findFirst({
    where: {
      workspaceId,
      isActive: true,
      last4Digit: parsedAlert.cardLast4!,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
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
      amountCents: parsedAlert.amountCents!,
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
  const createdTx = await prisma.creditCardTransaction.create({
    data: {
      workspaceId,
      creditCardId: card.id,
      transactionDate: txDate,
      statementMonth: txDate.getUTCMonth() + 1,
      statementYear: txDate.getUTCFullYear(),
      amountCents: parsedAlert.amountCents!,
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

