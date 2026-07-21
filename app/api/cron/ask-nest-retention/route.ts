import { NextResponse } from "next/server";
import { runAskNestRetention } from "@/lib/ai/ask-nest-retention";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { runDataRetention } from "@/lib/data-retention";
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
    const askNest = await runAskNestRetention();
    const result = await runDataRetention();
    return NextResponse.json({ ok: true, ...result, askNest });
  } catch (error) {
    console.error("Data retention failed", error);
    return NextResponse.json({ error: "Failed to run data retention" }, { status: 500 });
  }
}
