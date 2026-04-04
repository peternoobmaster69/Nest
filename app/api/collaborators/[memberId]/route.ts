import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function DELETE(_: Request, { params }: { params: Promise<{ memberId: string }> }) {
  try {
    const { memberId } = await params;
    const member = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { id: true, userId: true, workspaceId: true, role: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Collaborator not found" }, { status: 404 });
    }

    const auth = await requireWorkspaceAccess(member.workspaceId);
    const actorMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: member.workspaceId,
          userId: auth.userId,
        },
      },
      select: { role: true },
    });

    if (!actorMembership || actorMembership.role !== "OWNER") {
      return NextResponse.json({ error: "Only workspace owner can remove collaborators." }, { status: 403 });
    }

    if (member.role === "OWNER") {
      return NextResponse.json({ error: "Owner cannot be removed." }, { status: 400 });
    }

    await prisma.workspaceMember.delete({ where: { id: member.id } });

    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: member.workspaceId,
        actorUserId: auth.userId,
        action: "MEMBER_REMOVED",
        details: `Collaborator removed (${member.userId}).`,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to remove collaborator", message }, { status: 500 });
  }
}
