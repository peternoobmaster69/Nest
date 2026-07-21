import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireSensitiveWorkspaceAction } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const LinkSchema = z.object({
  workspaceId: z.string().min(1),
  rotate: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = LinkSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const auth = await requireSensitiveWorkspaceAction(parsed.data.workspaceId);
    const existing = await prisma.workspace.findUnique({
      where: { id: auth.workspaceId },
      select: { publicNetWorthToken: true },
    });
    if (!existing) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    const shouldRotate = parsed.data.rotate || !existing.publicNetWorthToken;
    const token = shouldRotate ? randomBytes(32).toString("base64url") : existing.publicNetWorthToken;
    const workspace = await prisma.workspace.update({
      where: { id: auth.workspaceId },
      data: { publicNetWorthEnabled: true, publicNetWorthToken: token },
      select: { publicNetWorthEnabled: true, publicNetWorthToken: true },
    });
    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: auth.workspaceId,
        actorUserId: auth.userId,
        action: shouldRotate && existing.publicNetWorthToken ? "PUBLIC_LINK_ROTATED" : "PUBLIC_LINK_CREATED",
        details: shouldRotate && existing.publicNetWorthToken ? "Public API bearer link rotated." : "Public API bearer link enabled.",
      },
    });
    return NextResponse.json(workspace);
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Unable to create public link" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const parsed = LinkSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const auth = await requireSensitiveWorkspaceAction(parsed.data.workspaceId);
    const workspace = await prisma.workspace.update({
      where: { id: auth.workspaceId },
      data: { publicNetWorthEnabled: false, publicNetWorthToken: null },
      select: { publicNetWorthEnabled: true, publicNetWorthToken: true },
    });
    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: auth.workspaceId,
        actorUserId: auth.userId,
        action: "PUBLIC_LINK_REVOKED",
        details: "Public API bearer link revoked.",
      },
    });
    return NextResponse.json(workspace);
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Unable to revoke public link" }, { status: 500 });
  }
}
