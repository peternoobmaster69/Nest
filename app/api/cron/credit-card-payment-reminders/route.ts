import { sendCreditCardPaymentReminders } from "@/lib/credit-card-payment-reminders";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const authorization = authorizeCronRequest(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  try {
    const result = await sendCreditCardPaymentReminders();
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    console.error("Credit card payment reminder cron failed", error);
    return NextResponse.json({ error: "Failed to send credit card payment reminders" }, { status: 500 });
  }
}
