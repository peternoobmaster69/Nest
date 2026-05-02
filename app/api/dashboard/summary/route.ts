import { getBankConsistency } from "@/lib/bank-consistency";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

const DASHBOARD_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
};

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAccess();

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
      budgets,
      monthlyBudgetOutgoing,
      receivableSourceTotals,
      transactions,
      bankConsistency,
      creditCardTransactions,
    ] = await Promise.all([
      prisma.budgetEnvelope.findMany({
        where: { workspaceId },
        orderBy: { name: "asc" },
      }),
      prisma.transaction.groupBy({
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
      }),
      prisma.receivable.groupBy({
        by: ["sourceBudgetId"],
        where: {
          sourceWorkspaceId: workspaceId,
          sourceBudgetId: { not: null },
          status: { in: ["OPEN", "PARTIAL"] },
        },
        _sum: { amountCents: true },
      }),
      prisma.transaction.findMany({
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
      }),
      getBankConsistency(prisma, workspaceId),
      prisma.creditCardTransaction.findMany({
        where: {
          workspaceId,
          paymentDueDate: { not: null },
        },
        include: {
          creditCard: {
            select: {
              id: true,
              cardName: true,
              bankName: true,
            },
          },
        },
        orderBy: {
          paymentDueDate: "asc",
        },
      }),
    ]);

    const outgoingByBudget = new Map(
      monthlyBudgetOutgoing
        .filter((row) => row.budgetId)
        .map((row) => [row.budgetId as string, row._sum.amountCents ?? 0]),
    );
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

    const totalBankBalance = bankConsistency.reduce((sum, bank) => sum + bank.currentBalanceCents, 0);

    const dueByStatement = new Map<string, {
      cardId: string;
      cardName: string;
      bankName: string | null;
      statementMonth: number;
      statementYear: number;
      paymentDueDate: string;
      outstandingCents: number;
    }>();

    for (const tx of creditCardTransactions) {
      if (!tx.paymentDueDate) continue;
      const key = `${tx.creditCardId}:${tx.statementYear}:${tx.statementMonth}`;
      const existing = dueByStatement.get(key);
      if (existing) {
        existing.outstandingCents += tx.amountCents;
        if (tx.amountCents > 0) {
          existing.paymentDueDate = tx.paymentDueDate.toISOString();
        }
        continue;
      }
      dueByStatement.set(key, {
        cardId: tx.creditCardId,
        cardName: tx.creditCard.cardName,
        bankName: tx.creditCard.bankName,
        statementMonth: tx.statementMonth,
        statementYear: tx.statementYear,
        paymentDueDate: tx.paymentDueDate.toISOString(),
        outstandingCents: tx.amountCents,
      });
    }

    const nextDueCards = [...dueByStatement.values()]
      .filter((item) => item.outstandingCents > 0)
      .sort((a, b) => new Date(a.paymentDueDate).getTime() - new Date(b.paymentDueDate).getTime());

    const totalOutstandingCents = nextDueCards.reduce((sum, item) => sum + item.outstandingCents, 0);
    const overdueCount = nextDueCards.filter((item) => new Date(item.paymentDueDate).getTime() < now.getTime()).length;
    const dueSoonCount = nextDueCards.filter((item) => {
      const diffDays = Math.ceil((new Date(item.paymentDueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 7;
    }).length;

    return NextResponse.json(
      {
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
          receivableReservedCents: receivableByBudget.get(b.id) ?? 0,
        })),
        recentTransactions: transactions.map((t) => ({
          id: t.id,
          subject: t.subject,
          amountCents: t.amountCents,
          direction: t.direction,
          date: t.date.toISOString(),
          budgetName: t.budget?.name ?? null,
        })),
        creditCardSummary: {
          nextDueCards,
          totalOutstandingCents,
          overdueCount,
          dueSoonCount,
        },
      },
      { headers: DASHBOARD_CACHE_HEADERS },
    );
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
