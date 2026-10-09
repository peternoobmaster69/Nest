import { ApiRequestError, runSecureApiRoute } from "@/lib/api-security";
import { prisma } from "@/lib/prisma";
import { getSmartReviewFingerprint, isSmartReviewGeneratedAtFresh } from "@/lib/ai/smart-review";
import { claimCreditCardTransaction, createLedgerTransaction, executePosting, getIdempotencyKey } from "@/lib/domains/ledger";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
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
    smartReviewGeneratedAt: z.iso.datetime().optional(),
  }),
  z.object({
    action: z.literal("RECEIVABLE"),
    receivableDate: z.iso.datetime(),
    transactionDate: z.iso.datetime().optional(),
    title: z.string().min(1).max(120),
    amountCents: z.number().int().positive(),
    remarks: z.string().max(500).optional(),
    notes: z.string().optional(),
    accountId: z.string().min(1).optional(),
    budgetId: z.string().min(1).optional(),
    smartReviewFingerprint: z.string().length(64).optional(),
    smartReviewGeneratedAt: z.iso.datetime().optional(),
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

type AccountingInput = z.infer<typeof CreditTxnAccountingSchema>;

async function validateSmartReview(data: AccountingInput, workspaceId: string, userId: string, transactionId: string) {
  if (!data.smartReviewGeneratedAt) return;
  if (!isSmartReviewGeneratedAtFresh(data.smartReviewGeneratedAt)) {
    throw new ApiRequestError(409, "This Smart Review suggestion expired. Refresh suggestions before approving it.");
  }
  const currentFingerprint = await getSmartReviewFingerprint({ workspaceId, userId, transactionId });
  if (currentFingerprint !== data.smartReviewFingerprint) {
    throw new ApiRequestError(409, "This Smart Review suggestion is stale. Refresh suggestions before approving it.");
  }
}

async function resolveDestination(workspaceId: string, data: Extract<AccountingInput, { action: "DEDUCT" }>, sourceBudgetId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { receivableDefaultAccountId: true, receivableDefaultBudgetId: true },
  });
  const accountId = data.destinationAccountId ?? workspace?.receivableDefaultAccountId;
  const budgetId = data.destinationBudgetId ?? workspace?.receivableDefaultBudgetId;
  if (!accountId && !budgetId) return null;
  if (!accountId || !budgetId) {
    throw new ApiRequestError(400, "Select both destination account and destination sub account.");
  }
  const destination = await prisma.budgetEnvelope.findFirst({
    where: { id: budgetId, workspaceId, accountId, isActive: true, account: { kind: "BANK", isActive: true } },
    select: { id: true, accountId: true },
  });
  if (!destination) throw new ApiRequestError(400, "Selected destination sub account is invalid.");
  if (destination.id === sourceBudgetId) {
    throw new ApiRequestError(400, "Source and destination sub accounts must be different.");
  }
  return { accountId: destination.accountId, budgetId: destination.id };
}

async function resolveReceivableSource(data: Extract<AccountingInput, { action: "RECEIVABLE" }>) {
  if (!data.accountId && !data.budgetId) return null;
  if (!data.accountId || !data.budgetId) {
    throw new ApiRequestError(400, "Select both deduction account and subaccount.");
  }
  const account = await prisma.financialAccount.findFirst({
    where: { id: data.accountId, kind: "BANK", isActive: true },
    select: { id: true, workspaceId: true },
  });
  if (!account) throw new ApiRequestError(400, "Selected deduction account is invalid.");
  await requireWorkspaceAccess(account.workspaceId, "EDITOR");
  const budget = await prisma.budgetEnvelope.findFirst({
    where: { id: data.budgetId, workspaceId: account.workspaceId, accountId: account.id, isActive: true },
    select: { id: true },
  });
  if (!budget) throw new ApiRequestError(400, "Selected deduction subaccount is invalid.");
  return { workspaceId: account.workspaceId, accountId: account.id, budgetId: budget.id };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to account for credit transaction" }, async () => {
    const { id } = await params;
    const parsed = CreditTxnAccountingSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
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

    await validateSmartReview(parsed.data, workspaceId, userId, existing.id);

    const operation = {
      workspaceId,
      operation: "CREDIT_TRANSACTION_ACCOUNT",
      idempotencyKey,
      actorUserId: userId,
      sourceType: "CREDIT_CARD_TRANSACTION",
      sourceId: existing.id,
      request: { creditCardTransactionId: existing.id, ...parsed.data },
    };

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

      const destination = await resolveDestination(workspaceId, parsed.data, budget.id);

      // Pre-capture values to avoid accessing inside transaction
      const {
        id: creditCardTxnId,
        creditCardId,
        transactionDate,
        amountCents,
        subject,
        creditCard: { cardName, last4Digit },
      } = existing;

      const posting = await executePosting(operation, async (db, postingGroupId) => {
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
    const source = await resolveReceivableSource(receivablePayload);

    const posting = await executePosting(operation, async (db, postingGroupId) => {
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
          accountId: source?.workspaceId === workspaceId ? source.accountId : null,
          budgetId: source?.workspaceId === workspaceId ? source.budgetId : null,
          sourceWorkspaceId: source?.workspaceId,
          sourceAccountId: source?.accountId,
          sourceBudgetId: source?.budgetId,
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
  });
}
