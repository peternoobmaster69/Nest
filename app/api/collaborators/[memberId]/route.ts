import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireSensitiveWorkspaceAction } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateMemberSchema = z.object({ role: z.enum(["EDITOR", "VIEWER"]) });

async function findMember(memberId: string) {
  return prisma.workspaceMember.findUnique({
    where: { id: memberId },
    select: { id: true, userId: true, workspaceId: true, role: true },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  try {
    const { memberId } = await params;
    const parsed = UpdateMemberSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const member = await findMember(memberId);
    if (!member) return NextResponse.json({ error: "Collaborator not found" }, { status: 404 });
    const auth = await requireSensitiveWorkspaceAction(member.workspaceId);
    if (member.role === "OWNER" || member.userId === auth.userId) {
      return NextResponse.json({ error: "Owner role cannot be changed here." }, { status: 400 });
    }
    const updated = await prisma.workspaceMember.update({
      where: { id: member.id },
      data: { role: parsed.data.role },
      select: { id: true, role: true },
    });
    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: member.workspaceId,
        actorUserId: auth.userId,
        action: "MEMBER_ROLE_CHANGED",
        details: `Collaborator ${member.userId} changed to ${parsed.data.role}.`,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Failed to update collaborator" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ memberId: string }> }) {
  try {
    const { memberId } = await params;
    const member = await findMember(memberId);
    if (!member) return NextResponse.json({ error: "Collaborator not found" }, { status: 404 });
    const auth = await requireSensitiveWorkspaceAction(member.workspaceId);
    if (member.role === "OWNER" || member.userId === auth.userId) {
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
    if (error instanceof ApiAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Failed to remove collaborator" }, { status: 500 });
  }
}
