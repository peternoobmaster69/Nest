import { buildGmailConsentUrl } from "@/lib/gmail";
import { createIntegrationOAuthState } from "@/lib/integration-oauth-state";
import { runSecureApiRoute } from "@/lib/api-security";
import { enforceDistributedRateLimit } from "@/lib/security-rate-limit";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return runSecureApiRoute(request, {
    mutation: true,
    auth: { minimumRole: "OWNER", recent: true },
    errorMessage: "Failed to prepare Gmail connect URL",
  }, async ({ auth }) => {
    const { userId, workspaceId } = auth!;
    await enforceDistributedRateLimit(request, {
      scope: "gmail-connect",
      identifier: `${workspaceId}:${userId}`,
      limit: 5,
      windowMs: 10 * 60_000,
    });
    const origin = new URL(request.url).origin;
    const { state, codeChallenge } = await createIntegrationOAuthState(userId, workspaceId);
    return NextResponse.json({ url: buildGmailConsentUrl({ state, codeChallenge, origin }) });
  });
}
