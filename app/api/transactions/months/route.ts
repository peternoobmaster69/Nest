import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const accountId = searchParams.get("accountId");
    const budgetId = searchParams.get("budgetId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const rows = await prisma.$queryRaw<
      Array<{
        year: number;
        month: number;
        count: number | bigint;
        incomeCents: number | bigint | null;
        expenseCents: number | bigint | null;
      }>
    >(Prisma.sql`
      SELECT
        YEAR([date]) AS [year],
        MONTH([date]) AS [month],
        COUNT_BIG(*) AS [count],
        SUM(CASE WHEN [direction] = 'CREDIT' THEN CAST([amountCents] AS BIGINT) ELSE 0 END) AS [incomeCents],
        SUM(CASE WHEN [direction] = 'DEBIT' THEN CAST([amountCents] AS BIGINT) ELSE 0 END) AS [expenseCents]
      FROM [dbo].[Transaction]
      WHERE [workspaceId] = ${workspaceId}
        AND [voidedAt] IS NULL
        AND [kind] <> 'REVERSAL'
        ${accountId ? Prisma.sql`AND [accountId] = ${accountId}` : Prisma.empty}
        ${budgetId && budgetId !== "ALL" ? Prisma.sql`AND [budgetId] = ${budgetId}` : Prisma.empty}
      GROUP BY YEAR([date]), MONTH([date])
      ORDER BY YEAR([date]) DESC, MONTH([date]) DESC
    `);

    const months = rows.map((row) => {
      const monthKey = `${row.year}-${String(row.month).padStart(2, "0")}`;
      return {
        monthKey,
        monthLabel: new Date(Date.UTC(row.year, row.month - 1, 1)).toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }),
        count: toNumber(row.count),
        incomeCents: toNumber(row.incomeCents),
        expenseCents: toNumber(row.expenseCents),
      };
    });

    return NextResponse.json({
      months,
      total: months.reduce((sum, month) => sum + month.count, 0),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch months", message }, { status: 500 });
  }
}
