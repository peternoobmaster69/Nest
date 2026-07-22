import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { ApiRequestError, assertSameOriginRequest } from "@/lib/api-security";
import { prisma } from "@/lib/prisma";
import { getActiveSessionExpiry, MAX_ACTIVE_SESSIONS } from "@/lib/session-policy";

class InvalidPendingSessionError extends Error {}
class InvalidSelectedSessionError extends Error {}

const sessionDetails = {
  sessionId: true,
  deviceName: true,
  ipAddress: true,
  countryCode: true,
  provider: true,
  signedInAt: true,
  lastSeenAt: true,
} as const;

async function getPendingToken(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.id || !token.sessionId || typeof token.sessionVersion !== "number") return null;
  return token;
}

export async function GET(request: NextRequest) {
  try {
    const token = await getPendingToken(request);
    if (!token) {
      return NextResponse.json({ error: "No device approval is pending." }, { status: 401 });
    }

    const now = new Date();
    const [user, pendingSession, sessions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: token.id },
        select: { sessionVersion: true },
      }),
      prisma.loginSession.findUnique({
        where: { sessionId: token.sessionId },
        select: { userId: true, status: true, expiresAt: true },
      }),
      prisma.loginSession.findMany({
        where: { userId: token.id, status: "ACTIVE", expiresAt: { gt: now } },
        orderBy: { lastSeenAt: "desc" },
        take: MAX_ACTIVE_SESSIONS,
        select: sessionDetails,
      }),
    ]);
    if (
      !user ||
      user.sessionVersion !== token.sessionVersion ||
      !pendingSession ||
      pendingSession.userId !== token.id ||
      pendingSession.status !== "PENDING" ||
      pendingSession.expiresAt <= now
    ) {
      return NextResponse.json({ error: "This sign-in attempt is no longer valid." }, { status: 409 });
    }

    return NextResponse.json(
      { sessions, maxActiveSessions: MAX_ACTIVE_SESSIONS },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to load active devices." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginRequest(request);
    const token = await getPendingToken(request);
    const body = await request.json().catch(() => ({})) as { sessionId?: unknown };
    if (!token) {
      return NextResponse.json({ error: "No device approval is pending." }, { status: 401 });
    }
    const selectedSessionId = typeof body.sessionId === "string" && body.sessionId
      ? body.sessionId
      : null;
    if (selectedSessionId === token.sessionId) {
      return NextResponse.json({ error: "Choose an existing active device to sign out." }, { status: 400 });
    }

    const now = new Date();
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT [id] FROM [dbo].[User] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${token.id}
      `;
      const [user, pendingSession] = await Promise.all([
        transaction.user.findUnique({
          where: { id: token.id },
          select: { sessionVersion: true },
        }),
        transaction.loginSession.findUnique({
          where: { sessionId: token.sessionId },
          select: { userId: true, status: true, expiresAt: true },
        }),
      ]);
      if (
        !user ||
        user.sessionVersion !== token.sessionVersion ||
        !pendingSession ||
        pendingSession.userId !== token.id ||
        pendingSession.status !== "PENDING" ||
        pendingSession.expiresAt <= now
      ) {
        throw new InvalidPendingSessionError();
      }

      await transaction.loginSession.updateMany({
        where: {
          userId: token.id,
          status: { in: ["ACTIVE", "PENDING"] },
          expiresAt: { lte: now },
        },
        data: { status: "REVOKED", revokedAt: now },
      });

      const activeSessionCount = await transaction.loginSession.count({
        where: { userId: token.id, status: "ACTIVE", expiresAt: { gt: now } },
      });
      let revokedSessionId: string | null = null;
      if (activeSessionCount >= MAX_ACTIVE_SESSIONS) {
        if (!selectedSessionId) throw new InvalidSelectedSessionError();
        const revoked = await transaction.loginSession.updateMany({
          where: {
            sessionId: selectedSessionId,
            userId: token.id,
            status: "ACTIVE",
            expiresAt: { gt: now },
          },
          data: { status: "REVOKED", revokedAt: now },
        });
        if (revoked.count !== 1) throw new InvalidSelectedSessionError();
        revokedSessionId = selectedSessionId;
      }

      const promoted = await transaction.loginSession.updateMany({
        where: {
          sessionId: token.sessionId,
          userId: token.id,
          status: "PENDING",
          expiresAt: { gt: now },
        },
        data: {
          status: "ACTIVE",
          expiresAt: getActiveSessionExpiry(now),
          lastSeenAt: now,
          revokedAt: null,
        },
      });
      if (promoted.count !== 1) throw new InvalidPendingSessionError();

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
            details: revokedSessionId
              ? "An active device was signed out to approve a new device."
              : "A pending device was approved after an active-session slot became available.",
          })),
        });
      }
      return { revokedSessionId };
    });

    return NextResponse.json(
      { approved: true, revokedSessionId: result.revokedSessionId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InvalidPendingSessionError) {
      return NextResponse.json({ error: "This sign-in attempt is no longer valid." }, { status: 409 });
    }
    if (error instanceof InvalidSelectedSessionError) {
      return NextResponse.json({ error: "That device is no longer active. Choose another device." }, { status: 409 });
    }
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to approve this device." }, { status: 500 });
  }
}
