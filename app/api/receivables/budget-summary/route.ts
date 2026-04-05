import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const budgetId = searchParams.get("budgetId");

    if (!workspaceId || !budgetId) {
      return NextResponse.json({ error: "workspaceId and budgetId are required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const sourceSummary = await prisma.receivable.aggregate({
      where: {
        sourceWorkspaceId: workspaceId,
        sourceBudgetId: budgetId,
        status: { in: ["OPEN", "PARTIAL"] },
      },
      _sum: { amountCents: true },
      _count: { id: true },
    });
    const legacySummary = await prisma.receivable.aggregate({
      where: {
        budgetId,
        sourceBudgetId: null,
        status: { in: ["OPEN", "PARTIAL"] },
      },
      _sum: { amountCents: true },
      _count: { id: true },
    });

    return NextResponse.json({
      workspaceId,
      budgetId,
      receivableReservedCents: (sourceSummary._sum.amountCents ?? 0) + (legacySummary._sum.amountCents ?? 0),
      count: (sourceSummary._count.id ?? 0) + (legacySummary._count.id ?? 0),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch receivable budget summary", message }, { status: 500 });
  }
}
