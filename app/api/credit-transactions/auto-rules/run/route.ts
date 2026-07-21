import { runCreditTxnAutoAccounting } from "@/lib/credit-txn-auto-account-runner";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceRole } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

const RunAutoRulesSchema = z.object({ workspaceId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const parsed = RunAutoRulesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const { workspaceId, userId } = await requireWorkspaceRole(parsed.data.workspaceId, "EDITOR");
    await enforceDistributedRateLimit(request, {
      scope: "credit-auto-rules-run",
      identifier: `${workspaceId}:${userId}`,
      limit: 5,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
    const result = await runCreditTxnAutoAccounting(prisma, { workspaceId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Manual credit transaction auto-accounting failed", error);
    return NextResponse.json({ error: "Failed to run credit transaction auto-accounting" }, { status: 500 });
  }
}
