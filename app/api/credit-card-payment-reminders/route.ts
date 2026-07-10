import { sendCreditCardPaymentReminders } from "@/lib/credit-card-payment-reminders";
import { NextResponse } from "next/server";

function isAuthorized(request: Request) {
  const secret = process.env.CREDIT_CARD_REMINDER_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  const cronSecret = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronSecret === secret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dryRun") === "1" || searchParams.get("dryRun") === "true";
  const result = await sendCreditCardPaymentReminders({ dryRun });
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
