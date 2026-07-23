import { prisma } from "@/lib/prisma";
import { getSmartReviewFingerprint, isSmartReviewGeneratedAtFresh } from "@/lib/ai/smart-review";
import { claimCreditCardTransaction, createLedgerTransaction, executePosting, getIdempotencyKey, PostingConflictError } from "@/lib/domains/ledger";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreditTxnAccountingSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("DEDUCT"),
    accountId: z.string().min(1),
    budgetId: z.string().min(1),
    destinationAccountId: z.string().min(1).optional(),
    destinationBudgetId: z.string().min(1).optional(),
    smartReviewFingerprint: z.string().length(64).optional(),
    smartReviewGeneratedAt: z.string().datetime().optional(),
  }),
  z.object({
    action: z.literal("RECEIVABLE"),
    receivableDate: z.string().datetime(),
    transactionDate: z.string().datetime().optional(),
    title: z.string().min(1).max(120),
    amountCents: z.number().int().positive(),
    remarks: z.string().max(500).optional(),
    notes: z.string().optional(),
    accountId: z.string().min(1).optional(),
    budgetId: z.string().min(1).optional(),
    smartReviewFingerprint: z.string().length(64).optional(),
    smartReviewGeneratedAt: z.string().datetime().optional(),
  }),
]).superRefine((value, context) => {
  if (Boolean(value.smartReviewFingerprint) !== Boolean(value.smartReviewGeneratedAt)) {
    context.addIssue({
      code: "custom",
      message: "Smart Review fingerprint and generation time must be supplied together.",
    });
  }
  if (value.action === "DEDUCT" && Boolean(value.destinationAccountId) !== Boolean(value.destinationBudgetId)) {
    context.addIssue({
      code: "custom",
      message: "Select both destination account and destination sub account.",
    });
  }
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = CreditTxnAccountingSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.creditCardTransaction.findUnique({
      where: { id },
      include: {
        creditCard: {
          select: {
            id: true,
            cardName: true,
            last4Digit: true,
            workspaceId: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Credit transaction not found" }, { status: 404 });
    }

    const { userId, workspaceId } = await requireWorkspaceAccess(existing.workspaceId, "EDITOR");
    const idempotencyKey = getIdempotencyKey(request, `credit-account:${existing.id}`);

    if (parsed.data.smartReviewFingerprint && parsed.data.smartReviewGeneratedAt) {
      if (!isSmartReviewGeneratedAtFresh(parsed.data.smartReviewGeneratedAt)) {
        return NextResponse.json(
          { error: "This Smart Review suggestion expired. Refresh suggestions before approving it." },
          { status: 409 },
        );
      }
      const currentFingerprint = await getSmartReviewFingerprint({
        workspaceId,
        userId,
        transactionId: existing.id,
      });
      if (!currentFingerprint || currentFingerprint !== parsed.data.smartReviewFingerprint) {
        return NextResponse.json(
          { error: "This Smart Review suggestion is stale. Refresh suggestions before approving it." },
          { status: 409 },
        );
      }
    }

    if (parsed.data.action === "DEDUCT") {
      const account = await prisma.financialAccount.findFirst({
        where: {
          id: parsed.data.accountId,
          workspaceId,
          kind: "BANK",
          isActive: true,
        },
        select: { id: true, name: true },
      });
      if (!account) {
        return NextResponse.json({ error: "Selected deduction account is invalid." }, { status: 400 });
      }

      const budget = await prisma.budgetEnvelope.findFirst({
        where: {
          id: parsed.data.budgetId,
          workspaceId,
          accountId: account.id,
          isActive: true,
        },
        select: { id: true, name: true },
      });
      if (!budget) {
        return NextResponse.json({ error: "Selected sub account is invalid." }, { status: 400 });
      }

      // Fetch workspace to get the receivable default subaccount
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { receivableDefaultAccountId: true, receivableDefaultBudgetId: true },
      });

      const destinationAccountId = parsed.data.destinationAccountId ?? workspace?.receivableDefaultAccountId;
      const destinationBudgetId = parsed.data.destinationBudgetId ?? workspace?.receivableDefaultBudgetId;
      let destination:
        | { accountId: string; accountName: string; budgetId: string; budgetName: string }
        | null = null;
      if (destinationAccountId || destinationBudgetId) {
        if (!destinationAccountId || !destinationBudgetId) {
          return NextResponse.json({ error: "Select both destination account and destination sub account." }, { status: 400 });
        }
        const selectedDestination = await prisma.budgetEnvelope.findFirst({
          where: {
            id: destinationBudgetId,
            workspaceId,
            accountId: destinationAccountId,
            isActive: true,
            account: { kind: "BANK", isActive: true },
          },
          select: {
            id: true,
            name: true,
            accountId: true,
            account: { select: { name: true } },
          },
        });
        if (!selectedDestination) {
          return NextResponse.json({ error: "Selected destination sub account is invalid." }, { status: 400 });
        }
        if (selectedDestination.id === budget.id) {
          return NextResponse.json({ error: "Source and destination sub accounts must be different." }, { status: 400 });
        }
        destination = {
          accountId: selectedDestination.accountId,
          accountName: selectedDestination.account.name,
          budgetId: selectedDestination.id,
          budgetName: selectedDestination.name,
        };
      }

      // Pre-capture values to avoid accessing inside transaction
      const {
        id: creditCardTxnId,
        creditCardId,
        transactionDate,
        amountCents,
        subject,
        creditCard: { cardName, last4Digit },
      } = existing;

      const posting = await executePosting({
        workspaceId,
        operation: "CREDIT_TRANSACTION_ACCOUNT",
        idempotencyKey,
        actorUserId: userId,
        sourceType: "CREDIT_CARD_TRANSACTION",
        sourceId: creditCardTxnId,
        request: { creditCardTransactionId: creditCardTxnId, ...parsed.data },
      }, async (db, postingGroupId) => {
          await claimCreditCardTransaction(db, creditCardTxnId);

          // Create DEBIT transaction from the selected subaccount
          const tx = await createLedgerTransaction(db, postingGroupId, {
              workspaceId,
              accountId: account.id,
              budgetId: budget.id,
              kind: "CREDIT_CARD_PAYMENT",
              direction: "DEBIT",
              date: transactionDate,
              amountCents,
              subject,
              details: `Accounted from ${cardName} ••${last4Digit}`,
              creditCardTransactionId: creditCardTxnId,
              isSynced: false,
              isFromFamily: false,
          });

          // Decrement source budget (DEBIT reduces available)
          await db.budgetEnvelope.update({
            where: { id: budget.id },
            data: { availableCents: { decrement: amountCents } },
          });

          // Create the explicit or workspace-default destination entry when configured.
          if (destination) {
            await createLedgerTransaction(db, postingGroupId, {
                workspaceId,
                accountId: destination.accountId,
                budgetId: destination.budgetId,
                kind: "CREDIT_CARD_PAYMENT",
                direction: "CREDIT",
                date: transactionDate,
                amountCents,
                subject: `Receivable: ${subject}`,
                details: `Receivable from ${cardName} ••${last4Digit}`,
                creditCardTransactionId: creditCardTxnId,
                isSynced: false,
                isFromFamily: false,
            });

            // Increment destination budget (CREDIT increases available)
            await db.budgetEnvelope.update({
              where: { id: destination.budgetId },
              data: { availableCents: { increment: amountCents } },
            });
          }

          await db.creditCardTxnLink.create({
            data: {
              creditCardId,
              creditCardTransactionId: creditCardTxnId,
              transactionId: tx.id,
              cardNameSnapshot: cardName,
              cardNoEnding: last4Digit,
              txDate: transactionDate,
              isProcessed: true,
              interfacedAt: new Date(),
            } as Prisma.CreditCardTxnLinkUncheckedCreateInput,
          });

          return { transactionId: tx.id };
      });

      return NextResponse.json({
        ok: true,
        action: "DEDUCT",
        ...posting.result,
        postingGroupId: posting.postingGroupId,
        replayed: posting.replayed,
      });
    }

    const receivablePayload = parsed.data;
    let sourceAccount:
      | {
          id: string;
          workspaceId: string;
        }
      | null = null;
    let sourceBudget:
      | {
          id: string;
        }
      | null = null;

    if (receivablePayload.accountId || receivablePayload.budgetId) {
      if (!receivablePayload.accountId || !receivablePayload.budgetId) {
        return NextResponse.json({ error: "Select both deduction account and subaccount." }, { status: 400 });
      }

      const account = await prisma.financialAccount.findFirst({
        where: {
          id: receivablePayload.accountId,
          kind: "BANK",
          isActive: true,
        },
        select: { id: true, workspaceId: true },
      });
      if (!account) {
        return NextResponse.json({ error: "Selected deduction account is invalid." }, { status: 400 });
      }
      await requireWorkspaceAccess(account.workspaceId, "EDITOR");

      const budget = await prisma.budgetEnvelope.findFirst({
        where: {
          id: receivablePayload.budgetId,
          workspaceId: account.workspaceId,
          accountId: account.id,
          isActive: true,
        },
        select: { id: true },
      });
      if (!budget) {
        return NextResponse.json({ error: "Selected deduction subaccount is invalid." }, { status: 400 });
      }

      sourceAccount = account;
      sourceBudget = budget;
    }

    const posting = await executePosting({
      workspaceId,
      operation: "CREDIT_TRANSACTION_ACCOUNT",
      idempotencyKey,
      actorUserId: userId,
      sourceType: "CREDIT_CARD_TRANSACTION",
      sourceId: existing.id,
      request: { creditCardTransactionId: existing.id, ...parsed.data },
    }, async (db, postingGroupId) => {
      await claimCreditCardTransaction(db, existing.id);
      const receivable = await db.receivable.create({
        data: {
          workspaceId,
          title: receivablePayload.title,
          amountCents: receivablePayload.amountCents,
          date: new Date(receivablePayload.receivableDate),
          transactionDate: receivablePayload.transactionDate ? new Date(receivablePayload.transactionDate) : null,
          remarkTogether: receivablePayload.remarks?.trim() || `Created from ${existing.creditCard.cardName} ••${existing.creditCard.last4Digit}`,
          notes: receivablePayload.notes,
          accountId: sourceAccount?.workspaceId === workspaceId ? sourceAccount.id : null,
          budgetId: sourceAccount?.workspaceId === workspaceId ? sourceBudget?.id : null,
          sourceWorkspaceId: sourceAccount?.workspaceId,
          sourceAccountId: sourceAccount?.id,
          sourceBudgetId: sourceBudget?.id,
          status: "OPEN",
        },
        select: { id: true },
      });

      await db.$executeRaw(Prisma.sql`
        UPDATE [Receivable] SET [postingGroupId] = ${postingGroupId} WHERE [id] = ${receivable.id}
      `);

      return receivable;
    });

    return NextResponse.json({
      ok: true,
      action: "RECEIVABLE",
      receivableId: posting.result.id,
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
    return NextResponse.json({ error: "Failed to account for credit transaction", message }, { status: 500 });
  }
}
