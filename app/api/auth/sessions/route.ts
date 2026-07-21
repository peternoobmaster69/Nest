import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireRecentAuthentication } from "@/lib/workspace-auth";

export async function DELETE() {
  try {
    const userId = await requireRecentAuthentication();
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      }),
      ...(memberships.length
        ? [
            prisma.workspaceAuditLog.createMany({
              data: memberships.map((membership) => ({
                workspaceId: membership.workspaceId,
                actorUserId: userId,
                action: "SESSIONS_REVOKED",
                details: "All account sessions revoked.",
              })),
            }),
          ]
        : []),
    ]);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "Unable to revoke sessions" }, { status: 500 });
  }
}
