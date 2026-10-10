import { NextResponse } from "next/server";
import { z } from "zod";
import type { AskNestAnswer } from "@/lib/ai/ask-nest-types";
import { clearAskNestHistoryPreservingUsage } from "@/lib/ai/ask-nest-retention";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { runSecureApiRoute } from "@/lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

const QuerySchema = z.object({
  cursor: z.string().min(1).max(1_000).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export async function GET(request: Request) {
  return runSecureApiRoute(request, { noStore: false, errorMessage: "Could not load Ask Nest history." }, async () => {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid history cursor." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const { cursor, limit } = parsed.data;
    const rows = await prisma.askNestTurn.findMany({
      where: { workspaceId, userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        question: true,
        answerJson: true,
        feedbackRating: true,
        feedbackReason: true,
        createdAt: true,
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const turns = page.flatMap((row) => {
      try {
        return [{
          id: row.id,
          question: row.question,
          answer: { ...(JSON.parse(row.answerJson) as AskNestAnswer), turnId: row.id },
          feedbackRating: row.feedbackRating,
          feedbackReason: row.feedbackReason,
          createdAt: row.createdAt.toISOString(),
        }];
      } catch {
        return [];
      }
    }).reverse();
    return NextResponse.json({
      turns,
      nextCursor: hasMore ? page.at(-1)!.id : null,
    }, { headers: PRIVATE_HEADERS });
  });
}

export async function DELETE(request: Request) {
  return runSecureApiRoute(request, { mutation: true, noStore: false, errorMessage: "Could not clear Ask Nest history." }, async () => {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    await clearAskNestHistoryPreservingUsage({ workspaceId, userId });
    return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
  });
}
