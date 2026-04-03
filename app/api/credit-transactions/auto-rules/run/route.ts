import { runCreditTxnAutoAccounting } from "@/lib/credit-txn-auto-account-runner";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    await requireWorkspaceAccess();
    const result = await runCreditTxnAutoAccounting();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to run credit transaction auto-accounting", message }, { status: 500 });
  }
}
