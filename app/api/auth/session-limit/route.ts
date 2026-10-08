import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

const sessionSelectionSchema = z.object({
  sessionIds: z.array(z.string().trim().min(1)).max(MAX_ACTIVE_SESSIONS).optional(),
  sessionId: z.string().trim().min(1).optional(),
}).strict().refine((value) => !(value.sessionIds && value.sessionId), {
  message: "Choose either sessionIds or sessionId.",
});

async function getPendingToken(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.id || !token.sessionId || typeof token.sessionVersion !== "number") return null;
  return token;
}

export async function GET(request: NextRequest) {
  try {
    const token = await getPendingToken(request);
    if (!token?.sessionId) {
      return NextResponse.json({ error: "No device approval is pending." }, { status: 401 });
    }
    const pendingSessionId = token.sessionId;

    const now = new Date();
    const [user, pendingSession, sessions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: token.id },
        select: { sessionVersion: true },
      }),
      prisma.loginSession.findUnique({
        where: { sessionId: pendingSessionId },
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
    if (!token?.sessionId) {
      return NextResponse.json({ error: "No device approval is pending." }, { status: 401 });
    }
    const pendingSessionId = token.sessionId;
    const selection = sessionSelectionSchema.safeParse(await request.json().catch(() => ({})));
    if (!selection.success) {
      return NextResponse.json({ error: "Choose up to five valid active sessions." }, { status: 400 });
    }
    const requestedSessionIds = selection.data.sessionIds
      ?? (selection.data.sessionId ? [selection.data.sessionId] : []);
    const selectedSessionIds = [...new Set(requestedSessionIds)];
    if (selectedSessionIds.includes(pendingSessionId)) {
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
          where: { sessionId: pendingSessionId },
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
      let revokedSessionIds: string[] = [];
      if (selectedSessionIds.length) {
        const revoked = await transaction.loginSession.updateMany({
          where: {
            sessionId: { in: selectedSessionIds },
            userId: token.id,
            status: "ACTIVE",
            expiresAt: { gt: now },
          },
          data: { status: "REVOKED", revokedAt: now },
        });
        if (revoked.count !== selectedSessionIds.length) throw new InvalidSelectedSessionError();
        revokedSessionIds = selectedSessionIds;
      } else if (activeSessionCount >= MAX_ACTIVE_SESSIONS) {
        throw new InvalidSelectedSessionError();
      }

      const promoted = await transaction.loginSession.updateMany({
        where: {
          sessionId: pendingSessionId,
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
        take: 100,
        where: { userId: token.id },
        select: { workspaceId: true },
      });
      if (memberships.length) {
        const sessionDescription = revokedSessionIds.length === 1 ? "session was" : "sessions were";
        const details = revokedSessionIds.length
          ? `${revokedSessionIds.length} active ${sessionDescription} signed out to approve a new device.`
          : "A pending device was approved after an active-session slot became available.";
        await transaction.workspaceAuditLog.createMany({
          data: memberships.map((membership) => ({
            workspaceId: membership.workspaceId,
            actorUserId: token.id,
            action: "SESSION_REPLACED",
            details,
          })),
        });
      }
      return { revokedSessionIds };
    });

    return NextResponse.json(
      {
        approved: true,
        revokedSessionIds: result.revokedSessionIds,
        revokedSessionId: result.revokedSessionIds[0] ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InvalidPendingSessionError) {
      return NextResponse.json({ error: "This sign-in attempt is no longer valid." }, { status: 409 });
    }
    if (error instanceof InvalidSelectedSessionError) {
      return NextResponse.json({ error: "One or more selected sessions are no longer active. Review the list and try again." }, { status: 409 });
    }
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to approve this device." }, { status: 500 });
  }
}
