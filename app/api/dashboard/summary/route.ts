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

    // Credit card summary for current month
    const creditCards = await prisma.creditCardAccount.findMany({
      where: { workspaceId, isActive: true },
      select: { id: true, cardName: true },
    });

    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    const creditCardTransactions = await prisma.creditCardTransaction.findMany({
      where: {
        workspaceId,
        statementYear: currentYear,
        statementMonth: currentMonth,
      },
      select: {
        amountCents: true,
        isAllocated: true,
        creditCardId: true,
      },
    });

    const creditCardSummary = creditCards.map((card) => {
      const cardTxns = creditCardTransactions.filter((t) => t.creditCardId === card.id);
      const totalSpentCents = cardTxns.reduce((sum, t) => sum + t.amountCents, 0);
      const accountedCents = cardTxns
        .filter((t) => t.isAllocated)
        .reduce((sum, t) => sum + t.amountCents, 0);
      return {
        cardId: card.id,
        cardName: card.cardName,
        totalSpentCents,
        accountedCents,
        unaccountedCents: totalSpentCents - accountedCents,
      };
    }).filter((c) => c.totalSpentCents > 0); // Only show cards with transactions

    const totalCreditSpent = creditCardSummary.reduce((sum, c) => sum + c.totalSpentCents, 0);
    const totalCreditAccounted = creditCardSummary.reduce((sum, c) => sum + c.accountedCents, 0);

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
        cards: creditCardSummary,
        totalSpentCents: totalCreditSpent,
        totalAccountedCents: totalCreditAccounted,
        totalUnaccountedCents: totalCreditSpent - totalCreditAccounted,
      },
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
