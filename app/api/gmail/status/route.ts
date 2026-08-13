import { prisma } from "@/lib/prisma";
import { runSecureApiRoute } from "@/lib/api-security";
import { NextResponse } from "next/server";
import { GmailProviderError, openGmailCredential } from "@/lib/gmail";

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
        workspaceId: true,
        email: true,
        scope: true,
        accessToken: true,
        refreshToken: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    });
    let requiresReconnect = false;
    if (integration) {
      const field = integration.refreshToken ? "refreshToken" : "accessToken";
      const credential = integration[field];
      if (!credential) {
        requiresReconnect = true;
      } else {
        try {
          openGmailCredential({
            integrationId: integration.id,
            workspaceId: integration.workspaceId,
            field,
            value: credential,
          });
        } catch (error) {
          if (!(error instanceof GmailProviderError) || error.code !== "GMAIL_RECONNECT_REQUIRED") throw error;
          requiresReconnect = true;
        }
      }
    }
    const safeIntegration = integration
      ? {
          id: integration.id,
          email: integration.email,
          scope: integration.scope,
          lastSyncedAt: integration.lastSyncedAt,
          createdAt: integration.createdAt,
        }
      : null;
    return NextResponse.json({ connected: Boolean(integration), requiresReconnect, integration: safeIntegration });
  });
}
