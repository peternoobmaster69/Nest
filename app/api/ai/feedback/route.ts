import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

const FeedbackSchema = z.object({
  turnId: z.string().trim().min(1).max(1_000),
  rating: z.enum(["HELPFUL", "NOT_HELPFUL"]),
  reason: z.enum(["WRONG_DATA", "MISUNDERSTOOD", "MISSING_DETAIL", "NO_RESULTS", "OTHER"]).nullable(),
}).strict().superRefine((value, context) => {
  if (value.rating === "NOT_HELPFUL" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required." });
  }
  if (value.rating === "HELPFUL" && value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Helpful feedback does not need a reason." });
  }
});

export async function POST(request: Request) {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    const body = await request.json().catch(() => null);
    const parsed = FeedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose a valid feedback option." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const result = await prisma.askNestTurn.updateMany({
      where: { id: parsed.data.turnId, workspaceId, userId },
      data: {
        feedbackRating: parsed.data.rating,
        feedbackReason: parsed.data.reason,
        feedbackAt: new Date(),
      },
    });
    if (result.count !== 1) {
      return NextResponse.json({ error: "This Ask Nest turn is no longer available." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ rating: parsed.data.rating, reason: parsed.data.reason }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    console.error("Ask Nest feedback save failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Could not save Ask Nest feedback." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
