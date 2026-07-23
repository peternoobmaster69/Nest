import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { getReceivableSourceSummary } from "@/lib/domains/receivables";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const budgetId = searchParams.get("budgetId");

    if (!workspaceId || !budgetId) {
      return NextResponse.json({ error: "workspaceId and budgetId are required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    return NextResponse.json(await getReceivableSourceSummary(workspaceId, budgetId));
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch receivable source summary", message }, { status: 500 });
  }
}
