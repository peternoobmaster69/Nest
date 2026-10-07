import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireRecentAuthentication, requireSessionUserId } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const RespondSchema = z.object({ action: z.enum(["accept", "decline"]) });

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function loadIdentity(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true },
  });
  if (!user?.email || !user.emailVerified) {
    throw new ApiAuthError(403, "A verified account email is required");
  }
  return { ...user, email: user.email.toLowerCase() };
}

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const user = await loadIdentity(await requireSessionUserId());
    const { token } = await params;
    const invite = await prisma.workspaceInvite.findFirst({
      where: { tokenHash: hashToken(token) },
      select: {
        invitedEmail: true,
        role: true,
        status: true,
        expiresAt: true,
        workspace: { select: { name: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });
    if (invite?.invitedEmail !== user.email) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }
    const status =
      invite.status === "PENDING" && (!invite.expiresAt || invite.expiresAt <= new Date())
        ? "EXPIRED"
        : invite.status;
    return NextResponse.json({ ...invite, status });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load invitation" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const user = await loadIdentity(await requireRecentAuthentication());
    const parsed = RespondSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    const { token } = await params;
    const tokenHash = hashToken(token);
    const invite = await prisma.workspaceInvite.findFirst({
      where: { tokenHash },
      select: { id: true, workspaceId: true, invitedEmail: true, invitedById: true, role: true },
    });
    if (invite?.invitedEmail !== user.email) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    const accepted = parsed.data.action === "accept";
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.workspaceInvite.updateMany({
        where: {
          id: invite.id,
          tokenHash,
          status: "PENDING",
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          status: accepted ? "ACCEPTED" : "DECLINED",
          tokenHash: null,
          invitedUserId: user.id,
          respondedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw new ApiAuthError(409, "Invitation is expired or already used");

      if (accepted) {
        await tx.workspaceMember.upsert({
          where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
          update: {},
          create: {
            workspaceId: invite.workspaceId,
            userId: user.id,
            role: invite.role === "EDITOR" ? "EDITOR" : "VIEWER",
            invitedBy: invite.invitedById,
          },
        });
      }
      await tx.workspaceAuditLog.create({
        data: {
          workspaceId: invite.workspaceId,
          actorUserId: user.id,
          action: accepted ? "INVITE_ACCEPTED" : "INVITE_DECLINED",
          details: `${user.email} ${accepted ? "accepted" : "declined"} the invitation.`,
        },
      });
    });

    return NextResponse.json({ ok: true, accepted, workspaceId: accepted ? invite.workspaceId : null });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to respond to invitation" }, { status: 500 });
  }
}
