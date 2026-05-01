import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateTransactionSchema = z.object({
  subject: z.string().min(1).max(120).optional(),
  amountCents: z.number().int().positive().optional(),
  direction: z.enum(["DEBIT", "CREDIT"]).optional(),
  kind: z
    .enum(["EXPENSE", "INCOME", "TRANSFER", "CREDIT_CARD_PAYMENT", "RECEIVABLE_PAYMENT", "ADJUSTMENT"])
    .optional(),
  details: z.string().max(500).nullable().optional(),
  notes: z.string().nullable().optional(),
  date: z.string().datetime().optional(),
  budgetId: z.string().min(1),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = UpdateTransactionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.transaction.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, budgetId: true, accountId: true },
    });
    if (!existing) {
      throw new Error("Transaction not found");
    }

    await requireWorkspaceAccess(existing.workspaceId);

    const result = await prisma.$transaction(
      async (db) => {
      const budget = await db.budgetEnvelope.findFirst({
        where: {
          id: parsed.data.budgetId,
          workspaceId: existing.workspaceId,
          accountId: existing.accountId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!budget) {
        throw new Error("Selected budget does not belong to this transaction account.");
      }

      const updated = await db.transaction.update({
        where: { id },
        data: parsed.data,
      });

      const budgetIdsToRecalculate = [existing.budgetId, parsed.data.budgetId].filter(
        (budgetId, index, allBudgetIds): budgetId is string =>
          typeof budgetId === "string" && allBudgetIds.indexOf(budgetId) === index,
      );
      for (const budgetId of budgetIdsToRecalculate) {
        await recalculateBudgetAvailableCents(db, existing.workspaceId, budgetId);
      }

      return updated;
      },
      { maxWait: 5000, timeout: 10000 },
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Transaction not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message === "Selected budget does not belong to this transaction account.") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update transaction", message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const existing = await prisma.transaction.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        budgetId: true,
      },
    });

    if (!existing) {
      throw new Error("Transaction not found");
    }

    await requireWorkspaceAccess(existing.workspaceId);

    await prisma.$transaction(
      async (db) => {
      // Find and reset any linked credit card transactions
      const creditCardLink = await db.creditCardTxnLink.findFirst({
        where: { transactionId: id },
        select: { creditCardId: true },
      });

      if (creditCardLink) {
        await db.creditCardTransaction.update({
          where: { id: creditCardLink.creditCardId },
          data: { isAllocated: false },
        });
        await db.creditCardTxnLink.deleteMany({
          where: { transactionId: id },
        });
      }

      await db.transaction.delete({ where: { id } });

      if (existing.budgetId) {
        await recalculateBudgetAvailableCents(db, existing.workspaceId, existing.budgetId);
      }
      },
      { maxWait: 5000, timeout: 10000 },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Transaction not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to delete transaction", message }, { status: 500 });
  }
}
