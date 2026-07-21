import { prisma } from "@/lib/prisma";
import { revokeGmailCredential } from "@/lib/gmail";
import { runSecureApiRoute } from "@/lib/api-security";
import { enforceDistributedRateLimit } from "@/lib/security-rate-limit";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return runSecureApiRoute(request, {
    mutation: true,
    auth: { minimumRole: "OWNER", recent: true },
    errorMessage: "Failed to disconnect Gmail",
  }, async ({ auth }) => {
    const { userId, workspaceId } = auth!;
    await enforceDistributedRateLimit(request, {
      scope: "gmail-disconnect",
      identifier: `${workspaceId}:${userId}`,
      limit: 5,
      windowMs: 10 * 60_000,
    });
    const integrations = await prisma.gmailIntegration.findMany({
      where: { workspaceId, userId, isActive: true },
      select: { id: true, workspaceId: true, accessToken: true, refreshToken: true },
    });
    for (const integration of integrations) {
      try {
        await revokeGmailCredential({
          integrationId: integration.id,
          workspaceId: integration.workspaceId,
          accessToken: integration.accessToken,
          refreshToken: integration.refreshToken,
        });
      } catch (error) {
        console.warn("Gmail token revocation failed; clearing local credentials", error);
      }
    }
    await prisma.gmailIntegration.updateMany({
      where: { workspaceId, userId },
      data: { isActive: false, accessToken: null, refreshToken: null, expiryDate: null },
    });
    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId,
        actorUserId: userId,
        action: "GMAIL_INTEGRATION_DISCONNECTED",
        details: "Gmail integration disconnected and stored tokens cleared.",
      },
    });
    return NextResponse.json({ ok: true });
  });
}
