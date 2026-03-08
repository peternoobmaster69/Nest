import { getBankConsistency } from "@/lib/bank-consistency";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAccess();

    const budgets = await prisma.budgetEnvelope.findMany({
      where: { workspaceId },
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
        date: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      _sum: { amountCents: true },
    });
    const outgoingByBudget = new Map(
      monthlyBudgetOutgoing
        .filter((row) => row.budgetId)
        .map((row) => [row.budgetId as string, row._sum.amountCents ?? 0]),
    );

    const transactions = await prisma.transaction.findMany({
      where: { workspaceId },
      take: 8,
      orderBy: { date: "desc" },
      include: {
        budget: {
          select: {
            name: true,
          },
        },
      },
    });

    const bankConsistency = await getBankConsistency(prisma, workspaceId);
    const totalBankBalance = bankConsistency.reduce((sum, bank) => sum + bank.currentBalanceCents, 0);

    return NextResponse.json({
      totalBalanceCents: totalBankBalance,
      bankDiscrepancies: bankConsistency.filter((b) => b.discrepancyCents !== 0),
      budgets: budgets.map((b) => ({
        id: b.id,
        name: b.name,
        icon: b.icon,
        accountId: b.accountId,
        availableCents: b.availableCents,
        targetCents: b.targetCents,
        monthlyOutgoingCents: outgoingByBudget.get(b.id) ?? 0,
      })),
      recentTransactions: transactions.map((t) => ({
        id: t.id,
        subject: t.subject,
        amountCents: t.amountCents,
        direction: t.direction,
        date: t.date.toISOString(),
        budgetName: t.budget?.name ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 404) {
        return NextResponse.json({
          totalBalanceCents: 0,
          bankDiscrepancies: [],
          budgets: [],
          recentTransactions: [],
        });
      }
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        totalBalanceCents: 0,
        bankDiscrepancies: [],
        budgets: [],
        recentTransactions: [],
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
