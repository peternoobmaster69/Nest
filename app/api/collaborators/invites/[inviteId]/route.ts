import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireSensitiveWorkspaceAction } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function DELETE(_: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  try {
    const { inviteId } = await params;
    const invite = await prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      select: { workspaceId: true, invitedEmail: true, status: true },
    });
    if (!invite) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    const auth = await requireSensitiveWorkspaceAction(invite.workspaceId);
    const revoked = await prisma.workspaceInvite.updateMany({
      where: { id: inviteId, status: "PENDING" },
      data: { status: "REVOKED", tokenHash: null, revokedAt: new Date(), respondedAt: new Date() },
    });
    if (!revoked.count) {
      return NextResponse.json({ error: "Invitation is no longer pending" }, { status: 409 });
    }
    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: invite.workspaceId,
        actorUserId: auth.userId,
        action: "INVITE_REVOKED",
        details: `Invitation for ${invite.invitedEmail} revoked.`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to revoke invitation" }, { status: 500 });
  }
}
