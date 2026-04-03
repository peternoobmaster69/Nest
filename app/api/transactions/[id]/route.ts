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
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = UpdateTransactionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await prisma.$transaction(async (db) => {
      const existing = await db.transaction.findUnique({
        where: { id },
        select: { id: true, workspaceId: true, budgetId: true },
      });
      if (!existing) {
        throw new Error("Transaction not found");
      }

      await requireWorkspaceAccess(existing.workspaceId);

      const updated = await db.transaction.update({
        where: { id },
        data: parsed.data,
      });

      if (existing.budgetId) {
        await recalculateBudgetAvailableCents(db, existing.workspaceId, existing.budgetId);
      }

      return updated;
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Transaction not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update transaction", message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    await prisma.$transaction(async (db) => {
      const existing = await db.transaction.findUnique({
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

      await db.transaction.delete({ where: { id } });

      if (existing.budgetId) {
        await recalculateBudgetAvailableCents(db, existing.workspaceId, existing.budgetId);
      }
    });

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
