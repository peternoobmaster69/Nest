import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewCreditCardTransactions } from "@/lib/ai/smart-review";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SmartReviewRequestSchema = z.object({
  transactionIds: z.array(z.string().min(1).max(180)).min(1).max(250),
}).strict();

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export async function POST(request: Request) {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    await enforceDistributedRateLimit(request, {
      scope: "ai-smart-review",
      identifier: `${workspaceId}:${userId}`,
      limit: 10,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
    const parsed = SmartReviewRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Choose between 1 and 250 visible unaccounted credit card transactions to review." },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }

    const transactionIds = [...new Set(parsed.data.transactionIds)];
    const result = await reviewCreditCardTransactions({ workspaceId, userId, transactionIds });
    return NextResponse.json(result, { headers: PRIVATE_HEADERS });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: PRIVATE_HEADERS },
      );
    }
    console.error("Smart Review request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Smart Review could not load suggestions. The normal accounting controls are still available." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
