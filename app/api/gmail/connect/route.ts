import { buildGmailConsentUrl } from "@/lib/gmail";
import { createIntegrationOAuthState } from "@/lib/integration-oauth-state";
import { ApiAuthError, requireRecentAuthentication, requireWorkspaceRole } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const userId = await requireRecentAuthentication();
    const auth = await requireWorkspaceRole(null, "OWNER");
    if (auth.userId !== userId) throw new ApiAuthError(401, "Unauthorized");
    const origin = new URL(request.url).origin;
    const state = await createIntegrationOAuthState(userId, auth.workspaceId);
    return NextResponse.json({ url: buildGmailConsentUrl({ state, origin }) });
  } catch (error) {
    if (error instanceof ApiAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Failed to prepare Gmail connect URL" }, { status: 500 });
  }
}
