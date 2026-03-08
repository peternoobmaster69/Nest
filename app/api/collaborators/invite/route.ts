import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const InviteSchema = z.object({
  workspaceId: z.string().min(1),
  email: z.string().email(),
});

export async function POST(request: Request) {
  try {
    const parsed = InviteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { workspaceId, userId } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const email = parsed.data.email.trim().toLowerCase();
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { isShared: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }
    if (!workspace.isShared) {
      return NextResponse.json({ error: "Workspace is private. Enable Shared mode to invite collaborators." }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (targetUser) {
      const existingMember = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: targetUser.id,
          },
        },
        select: { id: true },
      });
      if (existingMember) {
        return NextResponse.json({ error: "User is already a collaborator." }, { status: 400 });
      }
    }

    const existingInvite = await prisma.workspaceInvite.findFirst({
      where: { workspaceId, invitedEmail: email, status: "PENDING" },
      select: { id: true },
    });
    if (existingInvite) {
      return NextResponse.json({ error: "Invite already pending for this email." }, { status: 400 });
    }

    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId,
        invitedEmail: email,
        invitedById: userId,
        invitedUserId: targetUser?.id,
        status: "PENDING",
      },
    });

    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId,
        actorUserId: userId,
        action: "INVITE_SENT",
        details: `Invite sent to ${email}.`,
      },
    });

    if (targetUser) {
      await prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: targetUser.id,
          },
        },
        update: {},
        create: {
          workspaceId,
          userId: targetUser.id,
          role: "MEMBER",
          invitedBy: userId,
        },
      });

      await prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          status: "ACCEPTED",
          respondedAt: new Date(),
          invitedUserId: targetUser.id,
        },
      });

      await prisma.workspaceAuditLog.create({
        data: {
          workspaceId,
          actorUserId: targetUser.id,
          action: "INVITE_AUTO_ACCEPTED",
          details: `${email} added as collaborator.`,
        },
      });
    }

    return NextResponse.json({ ok: true, invite }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to invite collaborator", message }, { status: 500 });
  }
}
