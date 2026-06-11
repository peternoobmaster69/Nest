import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

const OPEN_RECEIVABLE_STATUSES = ["OPEN", "PARTIAL"];
const receivableListSelect = Prisma.validator<Prisma.ReceivableSelect>()({
  id: true,
  workspaceId: true,
  sourceWorkspaceId: true,
  title: true,
  amountCents: true,
  date: true,
  status: true,
  budgetId: true,
  sourceBudgetId: true,
  workspace: {
    select: { name: true },
  },
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const budgetId = searchParams.get("budgetId");

    if (!workspaceId || !budgetId) {
      return NextResponse.json({ error: "workspaceId and budgetId are required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const sourceWhere: Prisma.ReceivableWhereInput = {
      sourceWorkspaceId: workspaceId,
      sourceBudgetId: budgetId,
      status: { in: OPEN_RECEIVABLE_STATUSES },
    };
    const legacyWhere: Prisma.ReceivableWhereInput = {
      budgetId,
      sourceBudgetId: null,
      status: { in: OPEN_RECEIVABLE_STATUSES },
    };

    const [sourceSummary, legacySummary] = await Promise.all([
      prisma.receivable.aggregate({
        where: sourceWhere,
        _sum: { amountCents: true },
        _count: { id: true },
      }),
      prisma.receivable.aggregate({
        where: legacyWhere,
        _sum: { amountCents: true },
        _count: { id: true },
      }),
    ]);
    const [sourceReceivables, legacyReceivables] = await Promise.all([
      prisma.receivable.findMany({
        where: sourceWhere,
        select: receivableListSelect,
      }),
      prisma.receivable.findMany({
        where: legacyWhere,
        select: receivableListSelect,
      }),
    ]);

    const items = [...sourceReceivables, ...legacyReceivables]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((receivable) => ({
        id: receivable.id,
        workspaceId: receivable.workspaceId,
        sourceWorkspaceId: receivable.sourceWorkspaceId,
        workspaceName: receivable.workspace.name,
        title: receivable.title,
        amountCents: receivable.amountCents,
        date: receivable.date,
        status: receivable.status,
        budgetId: receivable.sourceBudgetId ?? receivable.budgetId,
        sourceBudgetId: receivable.sourceBudgetId,
      }));

    return NextResponse.json({
      workspaceId,
      budgetId,
      receivableReservedCents: (sourceSummary._sum.amountCents ?? 0) + (legacySummary._sum.amountCents ?? 0),
      count: (sourceSummary._count.id ?? 0) + (legacySummary._count.id ?? 0),
      items,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch receivable budget summary", message }, { status: 500 });
  }
}
