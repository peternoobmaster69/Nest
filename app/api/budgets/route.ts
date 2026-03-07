import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateBudgetSchema = z.object({
  workspaceId: z.string().min(1),
  accountId: z.string().min(1),
  createdById: z.string().min(1),
  name: z.string().min(1).max(80),
  icon: z.string().max(8).optional(),
  targetCents: z.number().int().min(0).optional().default(0),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const budgets = await prisma.budgetEnvelope.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { name: "asc" },
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthlyBudgetOutgoing = await prisma.transaction.groupBy({
    by: ["budgetId"],
    where: {
      workspaceId,
      budgetId: { not: null },
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

  return NextResponse.json(
    budgets.map((budget) => ({
      ...budget,
      monthlyOutgoingCents: outgoingByBudget.get(budget.id) ?? 0,
    })),
  );
}

export async function POST(request: Request) {
  const parsed = CreateBudgetSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

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
    data: parsed.data,
  });

  return NextResponse.json(budget, { status: 201 });
}
