import { applyBudgetAvailableDelta } from "@/lib/budget-ledger";
import { createLedgerTransaction, executePosting, getIdempotencyKey, PostingConflictError } from "@/lib/domains/ledger";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const TransferSchema = z.object({
  workspaceId: z.string().min(1),
  sourceBudgetId: z.string().min(1),
  destinationBudgetId: z.string().min(1),
  title: z.string().min(1).max(120),
  amountCents: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const parsed = TransferSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { workspaceId, sourceBudgetId, destinationBudgetId, title, amountCents } = parsed.data;
    const { userId } = await requireWorkspaceAccess(workspaceId, "EDITOR");

    if (sourceBudgetId === destinationBudgetId) {
      return NextResponse.json({ error: "Source and destination sub accounts must be different." }, { status: 400 });
    }

    const budgets = await prisma.budgetEnvelope.findMany({
      take: 2,
      where: {
        workspaceId,
        id: { in: [sourceBudgetId, destinationBudgetId] },
        isActive: true,
      },
      select: {
        id: true,
        accountId: true,
        name: true,
      },
    });

    const sourceBudget = budgets.find((budget) => budget.id === sourceBudgetId);
    const destinationBudget = budgets.find((budget) => budget.id === destinationBudgetId);

    if (!sourceBudget || !destinationBudget) {
      return NextResponse.json({ error: "Both source and destination sub accounts must be active and in the current workspace." }, { status: 400 });
    }

    const idempotencyKey = getIdempotencyKey(request);
    const externalRef = `subaccount-transfer:${idempotencyKey}`;

    const posting = await executePosting({
      workspaceId,
      operation: "SUBACCOUNT_TRANSFER",
      idempotencyKey,
      actorUserId: userId,
      sourceType: "BUDGET_TRANSFER",
      sourceId: sourceBudgetId,
      request: parsed.data,
    }, async (db, postingGroupId) => {
      const date = new Date();

      const transferOut = await createLedgerTransaction(db, postingGroupId, {
          workspaceId,
          accountId: sourceBudget.accountId,
          budgetId: sourceBudget.id,
          kind: "TRANSFER",
          direction: "DEBIT",
          date,
          amountCents,
          subject: title,
          details: `Transfer to ${destinationBudget.name}`,
          externalRef,
          isSynced: false,
          isFromFamily: false,
      });

      const transferIn = await createLedgerTransaction(db, postingGroupId, {
          workspaceId,
          accountId: destinationBudget.accountId,
          budgetId: destinationBudget.id,
          kind: "TRANSFER",
          direction: "CREDIT",
          date,
          amountCents,
          subject: title,
          details: `Transfer from ${sourceBudget.name}`,
          externalRef,
          isSynced: false,
          isFromFamily: false,
      });

      await applyBudgetAvailableDelta(db, sourceBudget.id, -amountCents);
      await applyBudgetAvailableDelta(db, destinationBudget.id, amountCents);

      return {
        transferOutId: transferOut.id,
        transferInId: transferIn.id,
      };
    });

    return NextResponse.json(
      { ok: true, ...posting.result, postingGroupId: posting.postingGroupId, replayed: posting.replayed },
      { status: posting.replayed ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PostingConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to transfer between sub accounts", message }, { status: 500 });
  }
}
