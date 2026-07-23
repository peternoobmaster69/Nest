import { reconcileWorkspaceBudgets } from "@/lib/domains/ledger";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }
    await requireWorkspaceAccess(workspaceId);
    const rows = await reconcileWorkspaceBudgets(prisma, workspaceId);
    const drifted = rows.filter((row) => row.driftCents !== 0);
    return NextResponse.json({
      ok: drifted.length === 0,
      checked: rows.length,
      drifted: drifted.length,
      rows,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Budget reconciliation failed", error);
    return NextResponse.json({ error: "Failed to reconcile budgets" }, { status: 500 });
  }
}
