import { authorizeCronRequest } from "@/lib/cron-auth";
import { NextResponse } from "next/server";

// Kept as an authenticated tombstone so old callers fail explicitly without creating a second job entry point.
export async function POST(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({
    error: "This endpoint has moved to GET /api/cron/credit-card-payment-reminders.",
  }, { status: 410 });
}
