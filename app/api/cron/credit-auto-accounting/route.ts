import { runCreditTxnAutoAccounting } from "@/lib/credit-txn-auto-account-runner";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { ensureDatabaseReady } from "@/lib/database-readiness";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function GET(request: Request) {
  const authorization = authorizeCronRequest(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  try {
    await ensureDatabaseReady();
    const result = await runCreditTxnAutoAccounting();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Credit auto-accounting cron failed", error);
    return NextResponse.json({ error: "Failed to run credit auto-accounting cron" }, { status: 500 });
  }
}
