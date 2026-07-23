import { runScheduledGmailSyncs } from "@/lib/domains/integrations";
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
    const result = await runScheduledGmailSyncs();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Gmail cron sync failed", error);
    return NextResponse.json({ error: "Failed to run Gmail cron sync" }, { status: 500 });
  }
}
