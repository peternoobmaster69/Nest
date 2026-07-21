import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireRecentAuthentication, requireWorkspaceRole } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const recentUserId = await requireRecentAuthentication();
    const auth = await requireWorkspaceRole(null, "OWNER");
    if (recentUserId !== auth.userId) throw new ApiAuthError(401, "Unauthorized");
    await prisma.gmailIntegration.updateMany({
      where: { workspaceId: auth.workspaceId, userId: auth.userId, isActive: true },
      data: { isActive: false, accessToken: "", refreshToken: "" },
    });
    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: auth.workspaceId,
        actorUserId: auth.userId,
        action: "GMAIL_INTEGRATION_DISCONNECTED",
        details: "Gmail integration disconnected and stored tokens cleared.",
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Failed to disconnect Gmail" }, { status: 500 });
  }
}
