import { sendCreditCardPaymentReminders } from "@/lib/credit-card-payment-reminders";
import { NextResponse } from "next/server";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendCreditCardPaymentReminders();
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to send credit card payment reminders", message }, { status: 500 });
  }
}
