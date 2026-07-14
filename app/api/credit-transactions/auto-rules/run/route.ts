import { runCreditTxnAutoAccounting } from "@/lib/credit-txn-auto-account-runner";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceRole } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const RunAutoRulesSchema = z.object({ workspaceId: z.string().min(1) });
const MANUAL_RUN_ROLES = ["OWNER", "EDITOR"] as const;

export async function POST(request: Request) {
  try {
    const parsed = RunAutoRulesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const { workspaceId } = await requireWorkspaceRole(parsed.data.workspaceId, MANUAL_RUN_ROLES);
    const result = await runCreditTxnAutoAccounting(prisma, { workspaceId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Manual credit transaction auto-accounting failed", error);
    return NextResponse.json({ error: "Failed to run credit transaction auto-accounting" }, { status: 500 });
  }
}
