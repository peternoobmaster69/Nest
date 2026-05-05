import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

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

    const where = {
      workspaceId,
      ...(accountId ? { accountId } : {}),
      ...(budgetId && budgetId !== "ALL" ? { budgetId } : {}),
    };

    // Get all transactions with just the fields we need for aggregation
    const transactions = await prisma.transaction.findMany({
      where,
      select: {
        date: true,
        amountCents: true,
        direction: true,
      },
      orderBy: [{ date: "desc" }],
    });

    // Aggregate by month (using UTC to avoid timezone issues)
    const monthMap = new Map<
      string,
      {
        monthKey: string;
        year: number;
        month: number;
        count: number;
        incomeCents: number;
        expenseCents: number;
      }
    >();

    transactions.forEach((tx) => {
      const date = new Date(tx.date);
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          monthKey,
          year,
          month,
          count: 0,
          incomeCents: 0,
          expenseCents: 0,
        });
      }

      const data = monthMap.get(monthKey)!;
      data.count += 1;
      if (tx.direction === "CREDIT") {
        data.incomeCents += tx.amountCents;
      } else {
        data.expenseCents += tx.amountCents;
      }
    });

    // Sort by most recent month first
    const months = Array.from(monthMap.values())
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
      .map((m) => ({
        monthKey: m.monthKey,
        monthLabel: new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }),
        count: m.count,
        incomeCents: m.incomeCents,
        expenseCents: m.expenseCents,
      }));

    return NextResponse.json({ months, total: transactions.length });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch months", message }, { status: 500 });
  }
}
