import { authorizeCronRequest } from "@/lib/cron-auth";
import { NextResponse } from "next/server";

// Authenticated tombstone: delivery now has one execution path under /api/cron.
export async function POST(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({
    error: "This endpoint has moved to GET /api/cron/credit-card-payment-reminders.",
  }, { status: 410 });
}
