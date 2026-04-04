import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
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
    await requireWorkspaceAccess(workspaceId);

    if (sourceBudgetId === destinationBudgetId) {
      return NextResponse.json({ error: "Source and destination sub accounts must be different." }, { status: 400 });
    }

    const budgets = await prisma.budgetEnvelope.findMany({
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

    const externalRef = `subaccount-transfer:${sourceBudgetId}:${destinationBudgetId}:${Date.now()}`;

    const result = await prisma.$transaction(async (db) => {
      const date = new Date();

      const transferOut = await db.transaction.create({
        data: {
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
        },
      });

      const transferIn = await db.transaction.create({
        data: {
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
        },
      });

      await recalculateBudgetAvailableCents(db, workspaceId, sourceBudget.id);
      await recalculateBudgetAvailableCents(db, workspaceId, destinationBudget.id);

      return {
        transferOutId: transferOut.id,
        transferInId: transferIn.id,
      };
    });

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to transfer between sub accounts", message }, { status: 500 });
  }
}
