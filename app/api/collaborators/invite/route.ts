import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireSensitiveWorkspaceAction } from "@/lib/workspace-auth";
import { sendPushToUser } from "@/lib/web-push";
import { sendWorkspaceInviteEmail } from "@/lib/workspace-invite-email";
import { NextResponse } from "next/server";
import { z } from "zod";

const InviteSchema = z.object({
  workspaceId: z.string().min(1),
  email: z.email(),
  role: z.enum(["EDITOR", "VIEWER"]).default("EDITOR"),
});

export async function POST(request: Request) {
  try {
    const parsed = InviteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    const { workspaceId, userId } = await requireSensitiveWorkspaceAction(parsed.data.workspaceId);
    const email = parsed.data.email.trim().toLowerCase();
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, isShared: true },
    });
    if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    if (!workspace.isShared) {
      return NextResponse.json(
        { error: "Workspace is private. Enable Shared mode before inviting collaborators." },
        { status: 400 },
      );
    }

    const targetUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (targetUser?.id === userId) {
      return NextResponse.json({ error: "You are already a member of this workspace." }, { status: 400 });
    }
    if (targetUser) {
      const existingMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUser.id } },
        select: { id: true },
      });
      if (existingMember) {
        return NextResponse.json({ error: "User is already a collaborator." }, { status: 400 });
      }
    }

    await prisma.workspaceInvite.updateMany({
      where: { workspaceId, invitedEmail: email, status: "PENDING", expiresAt: { lte: new Date() } },
      data: { status: "EXPIRED", tokenHash: null, respondedAt: new Date() },
    });
    const existingInvite = await prisma.workspaceInvite.findFirst({
      where: { workspaceId, invitedEmail: email, status: "PENDING", expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (existingInvite) {
      return NextResponse.json({ error: "Invite already pending for this email." }, { status: 400 });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId,
        invitedEmail: email,
        invitedById: userId,
        invitedUserId: targetUser?.id,
        role: parsed.data.role,
        tokenHash,
        expiresAt,
        status: "PENDING",
      },
      select: { id: true, invitedEmail: true, role: true, status: true, createdAt: true, expiresAt: true },
    });

    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId,
        actorUserId: userId,
        action: "INVITE_SENT",
        details: `One-time ${parsed.data.role} invite sent to ${email}; expires ${expiresAt.toISOString()}.`,
      },
    });

    const origin = (process.env.NEXTAUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
    const inviteUrl = `${origin}/invitations/${token}`;
    let emailSent = false;
    try {
      emailSent = await sendWorkspaceInviteEmail({
        to: email,
        workspaceName: workspace.name,
        role: parsed.data.role,
        inviteUrl,
        expiresAt,
      });
    } catch (deliveryError) {
      console.error("Workspace invitation email failed", deliveryError);
    }
    if (targetUser) {
      await sendPushToUser(targetUser.id, {
        title: "Workspace invitation",
        message: `Review your ${parsed.data.role.toLowerCase()} invitation to ${workspace.name}.`,
        href: `/invitations/${token}`,
        tag: `workspace-invite:${invite.id}`,
      });
    }

    return NextResponse.json({ ok: true, invite, inviteUrl, emailSent }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Failed to invite collaborator" }, { status: 500 });
  }
}
