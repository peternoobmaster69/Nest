import { runScheduledGmailSyncs } from "@/lib/gmail-sync-runner";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const authorization = authorizeCronRequest(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  try {
    await runScheduledGmailSyncs();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Gmail cron sync failed", error);
    return NextResponse.json({ error: "Failed to run Gmail cron sync" }, { status: 500 });
  }
}
