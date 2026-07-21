import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateBudgetSchema = z.object({
  workspaceId: z.string().min(1),
  accountId: z.string().min(1),
  name: z.string().min(1).max(80),
  icon: z.string().max(8).optional(),
  targetCents: z.number().int().min(0).optional().default(0),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const budgets = await prisma.budgetEnvelope.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        accountId: true,
        name: true,
        icon: true,
        isActive: true,
        availableCents: true,
        targetCents: true,
      },
    });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthlyBudgetOutgoing = await prisma.transaction.groupBy({
      by: ["budgetId"],
      where: {
        workspaceId,
        budgetId: { not: null },
        voidedAt: null,
        kind: { not: "REVERSAL" },
        direction: "DEBIT",
        date: { gte: monthStart, lt: nextMonthStart },
      },
      _sum: { amountCents: true },
    });
    const outgoingByBudget = new Map(
      monthlyBudgetOutgoing
        .filter((row) => row.budgetId)
        .map((row) => [row.budgetId as string, row._sum.amountCents ?? 0]),
    );

    const receivableSourceTotals = await prisma.receivable.groupBy({
      by: ["sourceBudgetId"],
      where: {
        sourceWorkspaceId: workspaceId,
        sourceBudgetId: { not: null },
        status: { in: ["OPEN", "PARTIAL"] },
      },
      _sum: { amountCents: true },
    });
    const receivableByBudget = new Map<string, number>(
      receivableSourceTotals
        .filter((row) => row.sourceBudgetId)
        .map((row) => [row.sourceBudgetId as string, row._sum.amountCents ?? 0]),
    );
    const budgetIds = budgets.map((budget) => budget.id);
    if (budgetIds.length > 0) {
      const legacyReceivableTotals = await prisma.receivable.groupBy({
        by: ["budgetId"],
        where: {
          budgetId: { in: budgetIds },
          sourceBudgetId: null,
          status: { in: ["OPEN", "PARTIAL"] },
        },
        _sum: { amountCents: true },
      });
      for (const row of legacyReceivableTotals) {
        if (!row.budgetId) continue;
        receivableByBudget.set(row.budgetId, (receivableByBudget.get(row.budgetId) ?? 0) + (row._sum.amountCents ?? 0));
      }
    }

    return NextResponse.json(
      budgets.map((budget) => ({
        ...budget,
        monthlyOutgoingCents: outgoingByBudget.get(budget.id) ?? 0,
        receivableReservedCents: receivableByBudget.get(budget.id) ?? 0,
      })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch budgets", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = CreateBudgetSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");
    const createdById = auth.userId;

    const bankAccount = await prisma.financialAccount.findFirst({
      where: {
        id: parsed.data.accountId,
        workspaceId: parsed.data.workspaceId,
        kind: "BANK",
        isActive: true,
      },
      select: { id: true },
    });

    if (!bankAccount) {
      return NextResponse.json({ error: "Budget account must link to an active bank account." }, { status: 400 });
    }

    const budget = await prisma.budgetEnvelope.create({
      data: {
        workspaceId: parsed.data.workspaceId,
        accountId: parsed.data.accountId,
        createdById,
        name: parsed.data.name,
        icon: parsed.data.icon,
        targetCents: parsed.data.targetCents,
      },
    });

    return NextResponse.json(budget, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create budget", message }, { status: 500 });
  }
}
