import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { ApiRequestError, assertSameOriginRequest } from "@/lib/api-security";
import { prisma } from "@/lib/prisma";
import { getActiveSessionExpiry } from "@/lib/session-policy";

class InvalidSessionTakeoverError extends Error {}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginRequest(request);
    const token = await getToken({ req: request });
    if (
      !token?.id ||
      !token.sessionId ||
      !token.takeoverRequired ||
      typeof token.sessionVersion !== "number"
    ) {
      return NextResponse.json({ error: "No session replacement is pending." }, { status: 401 });
    }

    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      const replaced = await transaction.user.updateMany({
        where: {
          id: token.id,
          sessionVersion: token.sessionVersion,
        },
        data: {
          activeSessionId: token.sessionId,
          activeSessionExpiresAt: getActiveSessionExpiry(now),
          lastSignedInAt: now,
        },
      });
      if (replaced.count !== 1) throw new InvalidSessionTakeoverError();

      const memberships = await transaction.workspaceMember.findMany({
        where: { userId: token.id },
        select: { workspaceId: true },
      });
      if (memberships.length) {
        await transaction.workspaceAuditLog.createMany({
          data: memberships.map((membership) => ({
            workspaceId: membership.workspaceId,
            actorUserId: token.id,
            action: "SESSION_REPLACED",
            details: "A new sign-in replaced the previously active session after user confirmation.",
          })),
        });
      }
    });

    return NextResponse.json(
      { replaced: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InvalidSessionTakeoverError) {
      return NextResponse.json({ error: "This sign-in attempt is no longer valid." }, { status: 409 });
    }
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to replace the active session." }, { status: 500 });
  }
}
