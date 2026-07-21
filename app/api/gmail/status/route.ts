import { prisma } from "@/lib/prisma";
import { runSecureApiRoute } from "@/lib/api-security";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "OWNER" },
    errorMessage: "Failed to load Gmail status",
  }, async ({ auth }) => {
    const { workspaceId, userId } = auth!;
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
  });
}

