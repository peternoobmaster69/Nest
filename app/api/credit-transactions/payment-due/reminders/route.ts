import { sendCreditCardPaymentReminders } from "@/lib/credit-card-payment-reminders";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const secret = process.env.PAYMENT_REMINDER_CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendCreditCardPaymentReminders();
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
