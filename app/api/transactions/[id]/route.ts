import { applyTransactionBudgetDelta } from "@/lib/budget-ledger";
import { executePosting, getIdempotencyKey, PostingConflictError, reverseLedgerTransaction } from "@/lib/posting-service";
import { Prisma } from "@prisma/client";
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
  groupId: z.string().min(1).nullable().optional(),
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
      select: {
        id: true,
        workspaceId: true,
        budgetId: true,
        accountId: true,
        direction: true,
        amountCents: true,
      },
    });
    if (!existing) {
      throw new Error("Transaction not found");
    }

    const { userId } = await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    const posting = await executePosting({
      workspaceId: existing.workspaceId,
      operation: "TRANSACTION_UPDATE",
      idempotencyKey: getIdempotencyKey(request),
      actorUserId: userId,
      sourceType: "TRANSACTION",
      sourceId: id,
      request: { transactionId: id, ...parsed.data },
    }, async (db, postingGroupId) => {
      const ledgerState = await db.$queryRaw<Array<{ postingGroupId: string | null; voidedAt: Date | null }>>(Prisma.sql`
        SELECT [postingGroupId], [voidedAt]
        FROM [Transaction] WITH (UPDLOCK, HOLDLOCK)
        WHERE [id] = ${id}
      `);
      if (!ledgerState[0] || ledgerState[0].voidedAt) {
        throw new PostingConflictError("Transaction is unavailable for update.");
      }
      if (ledgerState[0].postingGroupId) {
        throw new PostingConflictError("Posted transactions are immutable; reverse and replace instead.");
      }
      const current = await db.transaction.findUniqueOrThrow({
        where: { id },
        select: { budgetId: true, accountId: true, direction: true, amountCents: true },
      });

      const budget = await db.budgetEnvelope.findFirst({
        where: {
          id: parsed.data.budgetId,
          workspaceId: existing.workspaceId,
          accountId: current.accountId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!budget) {
        throw new Error("Selected budget does not belong to this transaction account.");
      }

      if (parsed.data.groupId) {
        const group = await db.transactionGroup.findFirst({
          where: {
            id: parsed.data.groupId,
            workspaceId: existing.workspaceId,
            budgetId: parsed.data.budgetId,
          },
          select: { id: true },
        });
        if (!group) throw new Error("Selected group does not belong to this sub-account.");
      }

      const updated = await db.transaction.update({
        where: { id },
        data: parsed.data,
      });

      await applyTransactionBudgetDelta(db, {
        previousBudgetId: current.budgetId,
        previousDirection: current.direction,
        previousAmountCents: current.amountCents,
        nextBudgetId: updated.budgetId,
        nextDirection: updated.direction,
        nextAmountCents: updated.amountCents,
      });

      await db.$executeRaw(Prisma.sql`
        UPDATE [Transaction] SET [postingGroupId] = ${postingGroupId} WHERE [id] = ${id}
      `);

      return updated;
    });

    return NextResponse.json({
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
    if (message === "Transaction not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message === "Selected budget does not belong to this transaction account.") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message === "Selected group does not belong to this sub-account.") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update transaction", message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const existing = await prisma.transaction.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        budgetId: true,
        direction: true,
        amountCents: true,
      },
    });

    if (!existing) {
      throw new Error("Transaction not found");
    }

    const { userId } = await requireWorkspaceAccess(existing.workspaceId, "EDITOR");
    const reason = request.headers.get("x-reversal-reason")?.trim() || "User requested transaction reversal";
    const posting = await reverseLedgerTransaction({
      transactionId: id,
      actorUserId: userId,
      reason: reason.slice(0, 500),
      idempotencyKey: getIdempotencyKey(request),
    });

    return NextResponse.json({ ...posting.result, postingGroupId: posting.postingGroupId, replayed: posting.replayed });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PostingConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "Transaction not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to delete transaction", message }, { status: 500 });
  }
}
