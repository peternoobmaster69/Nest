import { NextResponse } from "next/server";
import { runAskNestRetention } from "@/lib/ai/ask-nest-retention";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { ensureDatabaseReady } from "@/lib/database-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = authorizeCronRequest(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  try {
    await ensureDatabaseReady();
    const result = await runAskNestRetention();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Ask Nest retention failed", error);
    return NextResponse.json({ error: "Failed to run Ask Nest retention" }, { status: 500 });
  }
}
