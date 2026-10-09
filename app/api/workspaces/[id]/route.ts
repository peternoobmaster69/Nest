import { runSecureApiRoute } from "@/lib/api-security";
import { clearActiveWorkspaceCookie, getActiveWorkspaceCookie, setActiveWorkspaceCookie } from "@/lib/active-workspace";
import { prisma } from "@/lib/prisma";
import { requireSensitiveWorkspaceAction } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isShared: z.boolean().optional(),
  sidebarMoneyPages: z.record(z.string(), z.boolean()).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to update workspace" }, async () => {
    const { id } = await params;
    const parsed = UpdateWorkspaceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    const auth = await requireSensitiveWorkspaceAction(id);

    const updateData: { name?: string; isShared?: boolean; sidebarMoneyPages?: string } = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name.trim();
    if (parsed.data.isShared !== undefined) updateData.isShared = parsed.data.isShared;
    if (parsed.data.sidebarMoneyPages !== undefined) {
      updateData.sidebarMoneyPages = JSON.stringify(parsed.data.sidebarMoneyPages);
    }

    const updated = await prisma.workspace.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, isShared: true, sidebarMoneyPages: true },
    });

    const changes: string[] = [];
    if (parsed.data.name !== undefined) changes.push(`name="${updated.name}"`);
    if (parsed.data.isShared !== undefined) changes.push(`isShared=${updated.isShared}`);
    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: id,
        actorUserId: auth.userId,
        action: "WORKSPACE_UPDATED",
        details: ["Workspace updated:", ...changes].join(" "),
      },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to delete workspace" }, async () => {
    const { id } = await params;
    const activeWorkspaceCookie = await getActiveWorkspaceCookie();
    const auth = await requireSensitiveWorkspaceAction(id);

    const workspaceCount = await prisma.workspaceMember.count({
      where: { userId: auth.userId },
    });
    if (workspaceCount <= 1) {
      return NextResponse.json({ error: "At least one workspace must remain." }, { status: 400 });
    }

    await prisma.workspace.delete({ where: { id } });

    const nextMembership = await prisma.workspaceMember.findFirst({
      where: { userId: auth.userId },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });

    await prisma.user.update({
      where: { id: auth.userId },
      data: { activeWorkspaceId: nextMembership?.workspaceId ?? null },
    });

    const response = NextResponse.json({ ok: true, activeWorkspaceId: nextMembership?.workspaceId ?? null });
    if (activeWorkspaceCookie === id) {
      if (nextMembership?.workspaceId) {
        return setActiveWorkspaceCookie(response, nextMembership.workspaceId);
      }
      return clearActiveWorkspaceCookie(response);
    }
    return response;
  });
}
