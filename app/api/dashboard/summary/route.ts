import { getBankConsistency } from "@/lib/bank-consistency";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { CACHE_POLICIES } from "@/lib/api/contracts";
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

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    const requestId = randomUUID();

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
      prisma.$queryRaw<
        Array<{
          cardId: string;
          cardName: string;
          bankName: string | null;
          statementMonth: number;
          statementYear: number;
          paymentDueDate: Date;
          outstandingCents: number | bigint;
        }>
      >(Prisma.sql`
        SELECT TOP (500)
          cct.[creditCardId] AS [cardId],
          cc.[cardName] AS [cardName],
          cc.[bankName] AS [bankName],
          cct.[statementMonth] AS [statementMonth],
          cct.[statementYear] AS [statementYear],
          MIN(cct.[paymentDueDate]) AS [paymentDueDate],
          SUM(CAST(cct.[amountCents] AS BIGINT)) AS [outstandingCents]
        FROM [dbo].[CreditCardTransaction] cct
        INNER JOIN [dbo].[CreditCardAccount] cc
          ON cc.[id] = cct.[creditCardId]
        WHERE cct.[workspaceId] = ${workspaceId}
          AND cct.[paymentDueDate] IS NOT NULL
        GROUP BY
          cct.[creditCardId],
          cc.[cardName],
          cc.[bankName],
          cct.[statementMonth],
          cct.[statementYear]
        HAVING SUM(CAST(cct.[amountCents] AS BIGINT)) > 0
        ORDER BY MIN(cct.[paymentDueDate]) ASC
      `),
      prisma.$queryRaw<
        Array<{
          year: number;
          month: number;
          accountId: string;
          budgetId: string | null;
          direction: string;
          amountCents: number | bigint;
        }>
      >(Prisma.sql`
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
      const diffDays = Math.ceil((new Date(item.paymentDueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 7;
    }).length;

    const cashFlowByMonth = new Map<string, {
      inflowCents: number;
      outflowCents: number;
      accounts: Map<string, { inflowCents: number; outflowCents: number }>;
      budgets: Map<string, { inflowCents: number; outflowCents: number }>;
    }>();
    for (const month of cashFlowMonthStarts) {
      cashFlowByMonth.set(getMonthKey(month), {
        inflowCents: 0,
        outflowCents: 0,
        accounts: new Map(),
        budgets: new Map(),
      });
    }
    for (const row of cashFlowRows) {
      const month = cashFlowByMonth.get(`${row.year}-${String(row.month).padStart(2, "0")}`);
      if (!month) continue;

      const amountCents = toNumber(row.amountCents);
      const account = month.accounts.get(row.accountId) ?? { inflowCents: 0, outflowCents: 0 };
      const budget = row.budgetId
        ? month.budgets.get(row.budgetId) ?? { inflowCents: 0, outflowCents: 0 }
        : null;
      if (row.direction === "CREDIT") {
        month.inflowCents += amountCents;
        account.inflowCents += amountCents;
        if (budget) budget.inflowCents += amountCents;
      } else {
        month.outflowCents += amountCents;
        account.outflowCents += amountCents;
        if (budget) budget.outflowCents += amountCents;
      }
      month.accounts.set(row.accountId, account);
      if (row.budgetId && budget) month.budgets.set(row.budgetId, budget);
    }

    const cashFlow = cashFlowMonthStarts.map((month) => {
      const key = getMonthKey(month);
      const data = cashFlowByMonth.get(key) ?? {
        inflowCents: 0,
        outflowCents: 0,
        accounts: new Map(),
        budgets: new Map(),
      };
      return {
        key,
        label: getMonthLabel(month),
        inflowCents: data.inflowCents,
        outflowCents: data.outflowCents,
        netCents: data.inflowCents - data.outflowCents,
        accounts: Object.fromEntries(
          [...data.accounts.entries()].map(([accountId, account]) => [
            accountId,
            {
              inflowCents: account.inflowCents,
              outflowCents: account.outflowCents,
              netCents: account.inflowCents - account.outflowCents,
            },
          ]),
        ),
        budgets: Object.fromEntries(
          [...data.budgets.entries()].map(([budgetId, budget]) => [
            budgetId,
            {
              inflowCents: budget.inflowCents,
              outflowCents: budget.outflowCents,
              netCents: budget.inflowCents - budget.outflowCents,
            },
          ]),
        ),
      };
    });

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
        cashFlow,
      },
      { headers: { ...DASHBOARD_CACHE_HEADERS, "X-Request-Id": requestId } },
    );
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 404) {
        return NextResponse.json({
          totalBalanceCents: 0,
          bankDiscrepancies: [],
          budgets: [],
          recentTransactions: [],
          cashFlow: [],
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
        cashFlow: [],
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
