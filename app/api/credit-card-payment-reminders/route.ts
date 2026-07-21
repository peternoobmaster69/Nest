import { sendCreditCardPaymentReminders } from "@/lib/credit-card-payment-reminders";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dryRun") === "1" || searchParams.get("dryRun") === "true";
  const result = await sendCreditCardPaymentReminders({ dryRun });
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
