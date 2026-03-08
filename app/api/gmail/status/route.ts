import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { workspaceId, userId } = await requireWorkspaceAccess();
    const integration = await prisma.gmailIntegration.findFirst({
      where: { workspaceId, userId, isActive: true },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        email: true,
        scope: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ connected: Boolean(integration), integration });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load Gmail status", message }, { status: 500 });
  }
}

