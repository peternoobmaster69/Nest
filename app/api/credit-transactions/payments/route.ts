import { applyBudgetAvailableDelta } from "@/lib/budget-ledger";
import { createLedgerTransaction, executePosting, getIdempotencyKey, PostingConflictError } from "@/lib/posting-service";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateCreditCardPaymentSchema = z.object({
  cardId: z.string().min(1),
  statementMonth: z.number().int().min(1).max(12),
  statementYear: z.number().int().min(2020).max(2100),
  amountCents: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess(null, "EDITOR");
    const parsed = CreateCreditCardPaymentSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { cardId, statementMonth, statementYear, amountCents } = parsed.data;

    const [card, workspace] = await Promise.all([
      prisma.creditCardAccount.findFirst({
        where: {
          id: cardId,
          workspaceId,
          isActive: true,
        },
        select: {
          id: true,
          cardName: true,
          last4Digit: true,
          bankName: true,
          workspaceId: true,
        },
      }),
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          id: true,
          receivableDefaultAccountId: true,
          receivableDefaultBudgetId: true,
        },
      }),
    ]);

    if (!card) {
      return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
    }

    if (!workspace?.receivableDefaultAccountId || !workspace.receivableDefaultBudgetId) {
      return NextResponse.json(
        { error: "Configure default receivable account and subaccount in Settings before making a payment." },
        { status: 400 },
      );
    }

    const outstanding = await prisma.creditCardTransaction.aggregate({
      where: {
        workspaceId,
        creditCardId: cardId,
        statementMonth,
        statementYear,
      },
      _sum: { amountCents: true },
    });

    const outstandingAmountCents = outstanding._sum.amountCents ?? 0;
    if (outstandingAmountCents <= 0) {
      return NextResponse.json(
        { error: "No outstanding amount for the selected card and statement month." },
        { status: 400 },
      );
    }

    if (amountCents > outstandingAmountCents) {
      return NextResponse.json(
        { error: "Payment amount exceeds the outstanding amount for the selected card and statement month." },
        { status: 400 },
      );
    }

    const [defaultAccount, defaultBudget] = await Promise.all([
      prisma.financialAccount.findFirst({
        where: {
          id: workspace.receivableDefaultAccountId,
          workspaceId,
          kind: "BANK",
          isActive: true,
        },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.budgetEnvelope.findFirst({
        where: {
          id: workspace.receivableDefaultBudgetId,
          workspaceId,
          accountId: workspace.receivableDefaultAccountId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    if (!defaultAccount) {
      return NextResponse.json(
        { error: "Default receivable account is invalid. Update Settings." },
        { status: 400 },
      );
    }

    if (!defaultBudget) {
      return NextResponse.json(
        { error: "Default receivable subaccount is invalid. Update Settings." },
        { status: 400 },
      );
    }

    const now = new Date();
    const paymentSubject = `Payment • ${card.cardName} ••${card.last4Digit}`;
    const paymentDetails = `Payment for ${statementMonth}/${statementYear} from ${defaultBudget.name}`;

    const posting = await executePosting({
      workspaceId,
      operation: "CREDIT_CARD_PAYMENT",
      idempotencyKey: getIdempotencyKey(request),
      actorUserId: userId,
      sourceType: "CREDIT_CARD",
      sourceId: cardId,
      request: parsed.data,
    }, async (db, postingGroupId) => {
      const currentOutstanding = await db.creditCardTransaction.aggregate({
        where: { workspaceId, creditCardId: cardId, statementMonth, statementYear },
        _sum: { amountCents: true },
      });
      const currentOutstandingCents = currentOutstanding._sum.amountCents ?? 0;
      if (currentOutstandingCents <= 0 || amountCents > currentOutstandingCents) {
        throw new PostingConflictError("Payment conflicts with the current outstanding amount.");
      }

      const paymentTransaction = await db.creditCardTransaction.create({
        data: {
          workspaceId,
          creditCardId: cardId,
          transactionDate: now,
          paymentDueDate: now,
          statementMonth,
          statementYear,
          amountCents: -amountCents,
          subject: paymentSubject,
          isInstallment: false,
          installmentNo: null,
          totalInstallments: null,
          isAllocated: true,
        },
        include: { creditCard: true },
      });

      const bankTransaction = await createLedgerTransaction(db, postingGroupId, {
          workspaceId,
          accountId: defaultAccount.id,
          budgetId: defaultBudget.id,
          kind: "CREDIT_CARD_PAYMENT",
          direction: "DEBIT",
          date: now,
          amountCents,
          subject: paymentSubject,
          details: paymentDetails,
          creditCardTransactionId: paymentTransaction.id,
          isSynced: false,
          isFromFamily: false,
      });

      await applyBudgetAvailableDelta(db, defaultBudget.id, -amountCents);

      return {
        bankTransactionId: bankTransaction.id,
        paymentTransaction,
      };
    });

    return NextResponse.json({
      ok: true,
      paidAmountCents: amountCents,
      outstandingAmountCents: outstandingAmountCents - amountCents,
      ...posting.result,
      postingGroupId: posting.postingGroupId,
      replayed: posting.replayed,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PostingConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create credit card payment", message }, { status: 500 });
  }
}
