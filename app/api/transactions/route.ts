import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateTransactionSchema = z.object({
  workspaceId: z.string().min(1),
  accountId: z.string().min(1),
  subject: z.string().min(1).max(120),
  amountCents: z.number().int().positive(),
  direction: z.enum(["DEBIT", "CREDIT"]),
  kind: z.enum([
    "EXPENSE",
    "INCOME",
    "TRANSFER",
    "CREDIT_CARD_PAYMENT",
    "RECEIVABLE_PAYMENT",
    "ADJUSTMENT",
  ]),
  date: z.string().datetime(),
  details: z.string().max(500).optional(),
  notes: z.string().optional(),
  budgetId: z.string().min(1).optional(),
  budgetOperation: z.enum(["DEDUCT", "ADD"]).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const txs = await prisma.transaction.findMany({
      where: { workspaceId },
      orderBy: { date: "desc" },
      take: 100,
      select: {
        id: true,
        workspaceId: true,
        accountId: true,
        budgetId: true,
        kind: true,
        direction: true,
        date: true,
        amountCents: true,
        subject: true,
        details: true,
        notes: true,
        isSynced: true,
        isFromFamily: true,
        externalRef: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      txs.map((t) => ({
        ...t,
        date: t.date.toISOString(),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch transactions", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = CreateTransactionSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { budgetId, budgetOperation, ...txPayload } = parsed.data;
    await requireWorkspaceAccess(txPayload.workspaceId);

    const account = await prisma.financialAccount.findFirst({
      where: {
        id: txPayload.accountId,
        workspaceId: txPayload.workspaceId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!account) {
      return NextResponse.json({ error: "Invalid account for workspace." }, { status: 400 });
    }

    if ((budgetId && !budgetOperation) || (!budgetId && budgetOperation)) {
      return NextResponse.json({ error: "budgetId and budgetOperation must be provided together." }, { status: 400 });
    }

    const normalizedDirection =
      budgetOperation === "ADD" ? "CREDIT" : budgetOperation === "DEDUCT" ? "DEBIT" : txPayload.direction;
    const normalizedKind =
      budgetOperation === "ADD" ? "ADJUSTMENT" : budgetOperation === "DEDUCT" ? "EXPENSE" : txPayload.kind;

    const created = await prisma.$transaction(async (db) => {
      const tx = await db.transaction.create({
        data: {
          ...txPayload,
          direction: normalizedDirection,
          kind: normalizedKind,
          budgetId,
          date: new Date(txPayload.date),
          isSynced: false,
        },
      });

      let updatedBudget = null;
      if (budgetId && budgetOperation) {
        const budget = await db.budgetEnvelope.findFirst({
          where: { id: budgetId, workspaceId: txPayload.workspaceId, isActive: true },
          select: { id: true, accountId: true },
        });
        if (!budget) {
          throw new Error("Selected budget does not belong to workspace.");
        }
        if (budget.accountId !== txPayload.accountId) {
          throw new Error("Selected budget is linked to a different bank account.");
        }

        updatedBudget = await recalculateBudgetAvailableCents(db, txPayload.workspaceId, budget.id);
      }

      return { tx, updatedBudget };
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create transaction", message }, { status: 500 });
  }
}
