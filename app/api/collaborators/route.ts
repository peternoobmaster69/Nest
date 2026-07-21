import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const access = await requireWorkspaceAccess(workspaceId);
    const isOwner = access.role === "OWNER";

    const [workspace, members, invites, auditLogs] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true, isShared: true },
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      isOwner ? prisma.workspaceInvite.findMany({
        where: { workspaceId, status: "PENDING" },
        include: {
          invitedBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }) : Promise.resolve([]),
      isOwner ? prisma.workspaceAuditLog.findMany({
        where: { workspaceId },
        include: {
          actorUser: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 60,
      }) : Promise.resolve([]),
    ]);

    return NextResponse.json({ workspace, members, invites, auditLogs, role: access.role });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load collaborators", message }, { status: 500 });
  }
}
