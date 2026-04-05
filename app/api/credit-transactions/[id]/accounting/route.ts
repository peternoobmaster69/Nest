import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreditTxnAccountingSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("DEDUCT"),
    accountId: z.string().min(1),
    budgetId: z.string().min(1),
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
  }),
]);

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

    const { workspaceId } = await requireWorkspaceAccess(existing.workspaceId);

    if (existing.isAllocated) {
      return NextResponse.json({ error: "Credit transaction is already accounted." }, { status: 409 });
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

      // Pre-capture values to avoid accessing inside transaction
      const {
        id: creditCardTxnId,
        creditCardId,
        transactionDate,
        amountCents,
        subject,
        creditCard: { cardName, last4Digit },
      } = existing;

      const result = await prisma.$transaction(
        async (db) => {
          // Create DEBIT transaction from the selected subaccount
          const tx = await db.transaction.create({
            data: {
              workspaceId,
              accountId: account.id,
              budgetId: budget.id,
              kind: "CREDIT_CARD_PAYMENT",
              direction: "DEBIT",
              date: transactionDate,
              amountCents,
              subject,
              details: `Accounted from ${cardName} ••${last4Digit}`,
              isSynced: false,
              isFromFamily: false,
            },
            select: { id: true },
          });

          // Decrement source budget (DEBIT reduces available)
          await db.budgetEnvelope.update({
            where: { id: budget.id },
            data: { availableCents: { decrement: amountCents } },
          });

          // Create CREDIT transaction to the receivable default subaccount if configured
          if (workspace?.receivableDefaultAccountId && workspace?.receivableDefaultBudgetId) {
            await db.transaction.create({
              data: {
                workspaceId,
                accountId: workspace.receivableDefaultAccountId,
                budgetId: workspace.receivableDefaultBudgetId,
                kind: "CREDIT_CARD_PAYMENT",
                direction: "CREDIT",
                date: transactionDate,
                amountCents,
                subject: `Receivable: ${subject}`,
                details: `Receivable from ${cardName} ••${last4Digit}`,
                isSynced: false,
                isFromFamily: false,
              },
            });

            // Increment receivable budget (CREDIT increases available)
            await db.budgetEnvelope.update({
              where: { id: workspace.receivableDefaultBudgetId },
              data: { availableCents: { increment: amountCents } },
            });
          }

          await db.creditCardTxnLink.create({
            data: {
              creditCardId,
              transactionId: tx.id,
              cardNameSnapshot: cardName,
              cardNoEnding: last4Digit,
              txDate: transactionDate,
              isProcessed: true,
              interfacedAt: new Date(),
            },
          });

          await db.creditCardTransaction.update({
            where: { id: creditCardTxnId },
            data: { isAllocated: true },
          });

          return { transactionId: tx.id };
        },
        { maxWait: 5000, timeout: 10000 },
      );

      return NextResponse.json({ ok: true, action: "DEDUCT", ...result });
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
      await requireWorkspaceAccess(account.workspaceId);

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

    const created = await prisma.$transaction(async (db) => {
      const receivable = await db.receivable.create({
        data: {
          workspaceId,
          title: receivablePayload.title,
          amountCents: receivablePayload.amountCents,
          date: new Date(receivablePayload.receivableDate),
          transactionDate: receivablePayload.transactionDate ? new Date(receivablePayload.transactionDate) : null,
          remarkTogether: receivablePayload.remarks?.trim() || `Created from ${existing.creditCard.cardName} ••${existing.creditCard.last4Digit}`,
          notes: receivablePayload.notes,
          accountId: sourceAccount?.id,
          budgetId: sourceBudget?.id,
          sourceWorkspaceId: sourceAccount?.workspaceId,
          sourceAccountId: sourceAccount?.id,
          sourceBudgetId: sourceBudget?.id,
          status: "OPEN",
        },
        select: { id: true },
      });

      await db.creditCardTransaction.update({
        where: { id: existing.id },
        data: { isAllocated: true },
      });

      return receivable;
    });

    return NextResponse.json({ ok: true, action: "RECEIVABLE", receivableId: created.id });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to account for credit transaction", message }, { status: 500 });
  }
}
