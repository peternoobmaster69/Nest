import { exchangeCodeForTokens } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { consumeIntegrationOAuthState } from "@/lib/integration-oauth-state";
import { ApiAuthError, requireRecentAuthentication, requireWorkspaceRole } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const origin = url.origin;

    if (error) {
      return NextResponse.redirect(`${origin}/settings?gmail=denied`);
    }
    if (!code || !state) {
      return NextResponse.redirect(`${origin}/settings?gmail=invalid_callback`);
    }

    const oauthState = await consumeIntegrationOAuthState(state);
    if (!oauthState) {
      return NextResponse.redirect(`${origin}/settings?gmail=invalid_state`);
    }
    const recentUserId = await requireRecentAuthentication();
    const auth = await requireWorkspaceRole(oauthState.workspaceId, "OWNER");
    if (oauthState.userId !== auth.userId || recentUserId !== auth.userId) {
      return NextResponse.redirect(`${origin}/settings?gmail=forbidden`);
    }

    const tokens = await exchangeCodeForTokens({ code, origin });
    const expiryDate = new Date(Date.now() + tokens.expires_in * 1000);

    let email = "";
    try {
      const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as { emailAddress?: string };
        email = profile.emailAddress ?? "";
      }
    } catch {
      // Keep empty email if profile fetch fails.
    }

    if (!email) {
      return NextResponse.redirect(`${origin}/settings?gmail=profile_unavailable`);
    }

    const existing = await prisma.gmailIntegration.findFirst({
      where: { workspaceId: auth.workspaceId, userId: auth.userId },
      select: { id: true, refreshToken: true },
    });

    if (existing) {
      await prisma.gmailIntegration.update({
        where: { id: existing.id },
        data: {
          email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existing.refreshToken,
          tokenType: tokens.token_type,
          scope: tokens.scope,
          expiryDate,
          isActive: true,
        },
      });
    } else {
      await prisma.gmailIntegration.create({
        data: {
          workspaceId: auth.workspaceId,
          userId: auth.userId,
          email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenType: tokens.token_type,
          scope: tokens.scope,
          expiryDate,
          isActive: true,
        },
      });
    }

    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: auth.workspaceId,
        actorUserId: auth.userId,
        action: "GMAIL_INTEGRATION_CONNECTED",
        details: `Gmail integration connected for ${email}.`,
      },
    });

    return NextResponse.redirect(`${origin}/settings?gmail=connected`);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to complete Gmail connect", message }, { status: 500 });
  }
}
