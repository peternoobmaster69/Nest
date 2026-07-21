import { handler } from "@/lib/auth";
import { ensureDatabaseReady } from "@/lib/database-readiness";
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
  isDatabaseUnavailableError,
  isDatabaseWakeTransientError,
} from "@/lib/database-errors";
import { NextResponse } from "next/server";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

export const maxDuration = 120;

type NextAuthRouteContext = {
  params: Promise<{ nextauth: string[] }>;
};

function databaseUnavailableResponse() {
  return NextResponse.json(
    {
      error: "Database unavailable",
      code: DATABASE_UNAVAILABLE_CODE,
      message: DATABASE_UNAVAILABLE_MESSAGE,
    },
    { status: 503, headers: { "Retry-After": "30" } },
  );
}

export async function GET(request: Request, context: NextAuthRouteContext) {
  try {
    return await handler(request, context);
  } catch (error) {
    if (!isDatabaseWakeTransientError(error)) throw error;
    try {
      await ensureDatabaseReady();
      return await handler(request, context);
    } catch (retryError) {
      if (!isDatabaseUnavailableError(retryError)) throw retryError;
      return databaseUnavailableResponse();
    }
  }
}

export async function POST(request: Request, context: NextAuthRouteContext) {
  try {
    await ensureDatabaseReady();
    await enforceDistributedRateLimit(request, {
      scope: "nextauth-post",
      limit: 30,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
    return await handler(request, context);
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (!isDatabaseUnavailableError(error)) throw error;
    return databaseUnavailableResponse();
  }
}
