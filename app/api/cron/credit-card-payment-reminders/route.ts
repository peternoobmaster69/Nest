import { runCreditCardPaymentReminderJob } from "@/lib/credit-card-payment-reminders";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { ensureDatabaseReady } from "@/lib/database-readiness";
import { NextResponse } from "next/server";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

export const maxDuration = 300;

export async function GET(request: Request) {
  const authorization = authorizeCronRequest(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  try {
    await enforceDistributedRateLimit(request, {
      scope: "credit-card-payment-reminders",
      limit: 3,
      windowMs: 60_000,
      blockMs: 5 * 60_000,
    });
    await ensureDatabaseReady();
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "1" || searchParams.get("dryRun") === "true";
    const result = await runCreditCardPaymentReminderJob({ dryRun });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    const rateLimited = rateLimitResponse(error);
    if (rateLimited) return rateLimited;
    console.error("Credit card payment reminder cron failed", error);
    return NextResponse.json({ error: "Failed to send credit card payment reminders" }, { status: 500 });
  }
}
