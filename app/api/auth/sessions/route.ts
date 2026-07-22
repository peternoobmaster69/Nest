import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { ApiRequestError, assertSameOriginRequest } from "@/lib/api-security";
import { prisma } from "@/lib/prisma";
import { MAX_ACTIVE_SESSIONS } from "@/lib/session-policy";
import {
  ApiAuthError,
  requireRecentAuthentication,
  requireSessionUserId,
} from "@/lib/workspace-auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireSessionUserId();
    const token = await getToken({ req: request });
    const sessions = await prisma.loginSession.findMany({
      where: { userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      take: MAX_ACTIVE_SESSIONS,
      select: {
        sessionId: true,
        provider: true,
        deviceName: true,
        ipAddress: true,
        countryCode: true,
        signedInAt: true,
        lastSeenAt: true,
      },
    });
    return NextResponse.json(
      {
        sessions: sessions.map((session) => ({
          ...session,
          current: session.sessionId === token?.sessionId,
        })),
        maxActiveSessions: MAX_ACTIVE_SESSIONS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to load active sessions" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOriginRequest(request);
    const [userId, token] = await Promise.all([
      requireRecentAuthentication(),
      getToken({ req: request }),
    ]);
    const body = await request.json().catch(() => ({})) as { sessionId?: unknown };
    if (typeof body.sessionId !== "string" || !body.sessionId) {
      return NextResponse.json({ error: "Session id is required" }, { status: 400 });
    }
    const sessionId = body.sessionId;

    const now = new Date();
    const revoked = await prisma.$transaction(async (transaction) => {
      const result = await transaction.loginSession.updateMany({
        where: {
          userId,
          sessionId,
          status: "ACTIVE",
          expiresAt: { gt: now },
        },
        data: { status: "REVOKED", revokedAt: now },
      });
      if (result.count !== 1) return false;

      const memberships = await transaction.workspaceMember.findMany({
        where: { userId },
        select: { workspaceId: true },
      });
      if (memberships.length) {
        await transaction.workspaceAuditLog.createMany({
          data: memberships.map((membership) => ({
            workspaceId: membership.workspaceId,
            actorUserId: userId,
            action: "SESSION_REVOKED",
            details: "One active device session was signed out by the user.",
          })),
        });
      }
      return true;
    });
    if (!revoked) {
      return NextResponse.json({ error: "That session is no longer active." }, { status: 404 });
    }
    return NextResponse.json({ revoked: true, current: sessionId === token?.sessionId });
  } catch (error) {
    if (error instanceof ApiAuthError || error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to revoke session" }, { status: 500 });
  }
}
