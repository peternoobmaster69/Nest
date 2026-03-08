import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isShared: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = UpdateWorkspaceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(id);
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: id,
          userId: auth.userId,
        },
      },
      select: { role: true },
    });
    if (!membership || membership.role !== "OWNER") {
      return NextResponse.json({ error: "Only workspace owner can update workspace settings." }, { status: 403 });
    }

    const updated = await prisma.workspace.update({
      where: { id },
      data: {
        name: parsed.data.name?.trim(),
        isShared: parsed.data.isShared,
      },
      select: { id: true, name: true, isShared: true },
    });

    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: id,
        actorUserId: auth.userId,
        action: "WORKSPACE_UPDATED",
        details: `Workspace updated: ${parsed.data.name ? `name="${updated.name}" ` : ""}${parsed.data.isShared !== undefined ? `isShared=${updated.isShared}` : ""}`.trim(),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update workspace", message }, { status: 500 });
  }
}
