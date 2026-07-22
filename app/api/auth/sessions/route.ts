import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ApiAuthError,
  requireRecentAuthentication,
  requireSessionUserId,
} from "@/lib/workspace-auth";

export async function GET() {
  try {
    const userId = await requireSessionUserId();
    const [user, sessions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { activeSessionId: true },
      }),
      prisma.loginSession.findMany({
        where: { userId },
        orderBy: { signedInAt: "desc" },
        take: 5,
        select: {
          sessionId: true,
          provider: true,
          ipAddress: true,
          countryCode: true,
          signedInAt: true,
        },
      }),
    ]);
    return NextResponse.json(
      {
        sessions: sessions.map((session) => ({
          ...session,
          active: session.sessionId === user?.activeSessionId,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to load login sessions" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const userId = await requireRecentAuthentication();
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          sessionVersion: { increment: 1 },
          activeSessionId: null,
          activeSessionExpiresAt: null,
        },
      }),
      ...(memberships.length
        ? [
            prisma.workspaceAuditLog.createMany({
              data: memberships.map((membership) => ({
                workspaceId: membership.workspaceId,
                actorUserId: userId,
                action: "SESSIONS_REVOKED",
                details: "All account sessions revoked.",
              })),
            }),
          ]
        : []),
    ]);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to revoke sessions" }, { status: 500 });
  }
}
