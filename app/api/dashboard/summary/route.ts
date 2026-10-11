import { getBankConsistency } from "@/lib/bank-consistency";
import { getOutstandingCreditCardStatements } from "@/lib/credit-card-statement-balances";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { CACHE_POLICIES } from "@/lib/api/contracts";
import { runSecureApiRoute } from "@/lib/api-security";
import { withQueryTelemetry } from "@/lib/observability/query-telemetry";

const DASHBOARD_CACHE_HEADERS = {
  "Cache-Control": CACHE_POLICIES.privateNoStore,
  Vary: "Cookie, X-Workspace-Id",
};

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(date: Date) {
  return date.toLocaleDateString("en-SG", { month: "short", year: "2-digit" });
}

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0);
}

type CashFlowRow = {
  year: number;
  month: number;
  accountId: string;
  budgetId: string | null;
  direction: string;
  amountCents: number | bigint;
};
type CashFlowTotals = { inflowCents: number; outflowCents: number };
type CashFlowMonth = CashFlowTotals & {
  accounts: Map<string, CashFlowTotals>;
  budgets: Map<string, CashFlowTotals>;
};

function accumulateCashFlow(month: CashFlowMonth, row: CashFlowRow) {
  const amountCents = toNumber(row.amountCents);
  const account = month.accounts.get(row.accountId) ?? { inflowCents: 0, outflowCents: 0 };
  const budget = row.budgetId
    ? month.budgets.get(row.budgetId) ?? { inflowCents: 0, outflowCents: 0 }
    : null;
  const field = row.direction === "CREDIT" ? "inflowCents" : "outflowCents";
  month[field] += amountCents;
  account[field] += amountCents;
  if (budget) budget[field] += amountCents;
  month.accounts.set(row.accountId, account);
  if (row.budgetId && budget) month.budgets.set(row.budgetId, budget);
}

function cashFlowBalance(totals: CashFlowTotals) {
  return {
    inflowCents: totals.inflowCents,
    outflowCents: totals.outflowCents,
    netCents: totals.inflowCents - totals.outflowCents,
  };
}

function cashFlowGroups(groups: Map<string, CashFlowTotals>) {
  return Object.fromEntries([...groups].map(([id, totals]) => [id, cashFlowBalance(totals)]));
}

function buildCashFlow(monthStarts: Date[], rows: CashFlowRow[]) {
  const months = monthStarts.map((date) => ({
    key: getMonthKey(date),
    label: getMonthLabel(date),
    totals: { inflowCents: 0, outflowCents: 0, accounts: new Map<string, CashFlowTotals>(), budgets: new Map<string, CashFlowTotals>() },
  }));
  const byMonth = new Map(months.map((month) => [month.key, month.totals]));
  for (const row of rows) {
    const month = byMonth.get(`${row.year}-${String(row.month).padStart(2, "0")}`);
    if (month) accumulateCashFlow(month, row);
  }
  return months.map(({ key, label, totals }) => ({
    key,
    label,
    ...cashFlowBalance(totals),
    accounts: cashFlowGroups(totals.accounts),
    budgets: cashFlowGroups(totals.budgets),
  }));
}

async function getDashboardWorkspaceId() {
  try {
    return (await requireWorkspaceAccess()).workspaceId;
  } catch (error) {
    if (error instanceof ApiAuthError && error.status === 404) return null;
    throw error;
  }
}

export async function GET(request: Request) {
  const response = await runSecureApiRoute(request, { errorMessage: "Failed to fetch dashboard summary" }, async ({ requestId }) => {
    const workspaceId = await getDashboardWorkspaceId();
    if (!workspaceId) {
      return NextResponse.json({ totalBalanceCents: 0, bankDiscrepancies: [], budgets: [], recentTransactions: [], cashFlow: [] });
    }
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const cashFlowMonthStarts = Array.from(
      { length: 12 },
      (_, index) => new Date(now.getFullYear(), now.getMonth() - index, 1),
    );
    const cashFlowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const [
      budgets,
      monthlyBudgetOutgoing,
      receivableSourceTotals,
      transactions,
      bankConsistency,
      creditCardDueRows,
      cashFlowRows,
    ] = await withQueryTelemetry(
      { domain: "dashboard", operation: "summary", workspaceId, requestId },
      () => Promise.all([
      prisma.budgetEnvelope.findMany({
        where: { workspaceId },
        orderBy: { name: "asc" },
        take: 500,
      }),
      prisma.transaction.groupBy({
        by: ["budgetId"],
        where: {
          workspaceId,
          budgetId: { not: null },
          voidedAt: null,
          kind: { not: "REVERSAL" },
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
        where: { workspaceId, voidedAt: null, kind: { not: "REVERSAL" } },
        take: 8,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        include: {
          budget: {
            select: {
              name: true,
            },
          },
        },
      }),
      getBankConsistency(prisma, workspaceId),
      getOutstandingCreditCardStatements(prisma, { workspaceId, limit: 500 }),
      prisma.$queryRaw<CashFlowRow[]>(Prisma.sql`
        SELECT TOP (10000)
          YEAR([date]) AS [year],
          MONTH([date]) AS [month],
          [accountId],
          [budgetId],
          [direction],
          SUM(CAST([amountCents] AS BIGINT)) AS [amountCents]
        FROM [dbo].[Transaction]
        WHERE [workspaceId] = ${workspaceId}
          AND [voidedAt] IS NULL
          AND [kind] <> 'REVERSAL'
          AND [date] >= ${cashFlowStart}
          AND [date] < ${nextMonthStart}
        GROUP BY
          YEAR([date]),
          MONTH([date]),
          [accountId],
          [budgetId],
          [direction]
      `),
      ]),
    );

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
      const legacyReceivableTotals = await withQueryTelemetry(
        { domain: "dashboard", operation: "legacy_receivable_totals", workspaceId, requestId },
        () => prisma.receivable.groupBy({
        by: ["budgetId"],
        where: {
          budgetId: { in: budgetIds },
          sourceBudgetId: null,
          status: { in: ["OPEN", "PARTIAL"] },
        },
        _sum: { amountCents: true },
        }),
      );
      for (const row of legacyReceivableTotals) {
        if (!row.budgetId) continue;
        receivableByBudget.set(row.budgetId, (receivableByBudget.get(row.budgetId) ?? 0) + (row._sum.amountCents ?? 0));
      }
    }

    const totalBankBalance = bankConsistency.reduce((sum, bank) => sum + bank.currentBalanceCents, 0);

    const nextDueCards = creditCardDueRows.map((row) => ({
      cardId: row.cardId,
      cardName: row.cardName,
      bankName: row.bankName,
      statementMonth: row.statementMonth,
      statementYear: row.statementYear,
      paymentDueDate: row.paymentDueDate.toISOString(),
      outstandingCents: toNumber(row.outstandingCents),
    }));

    const totalOutstandingCents = nextDueCards.reduce((sum, item) => sum + item.outstandingCents, 0);
    const overdueCount = nextDueCards.filter((item) => new Date(item.paymentDueDate).getTime() < now.getTime()).length;
    const dueSoonCount = nextDueCards.filter((item) => {
      const dueInMs = new Date(item.paymentDueDate).getTime() - now.getTime();
      return dueInMs >= 0 && dueInMs <= 7 * 24 * 60 * 60 * 1000;
    }).length;

    const cashFlow = buildCashFlow(cashFlowMonthStarts, cashFlowRows);

    return NextResponse.json(
      {
        totalBalanceCents: totalBankBalance,
        bankDiscrepancies: bankConsistency.filter((b) => b.discrepancyCents !== 0),
        budgets: budgets.map((b) => ({
          id: b.id,
          name: b.name,
          icon: b.icon,
          isSavings: b.isSavings,
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
        cashFlow,
      },
    );
  });
  for (const [name, value] of Object.entries(DASHBOARD_CACHE_HEADERS)) response.headers.set(name, value);
  return response;
}
