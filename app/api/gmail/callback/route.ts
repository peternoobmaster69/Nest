import { exchangeCodeForTokens, openGmailCredential, sealGmailCredential } from "@/lib/gmail";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { consumeIntegrationOAuthState } from "@/lib/integration-oauth-state";
import { runSecureApiRoute } from "@/lib/api-security";
import { enforceDistributedRateLimit } from "@/lib/security-rate-limit";
import { requireRecentAuthentication, requireWorkspaceRole } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { buildWorkspacePath } from "@/lib/workspace-entry";

function defaultSettingsRedirect(origin: string, status: string) {
  const entryUrl = new URL("/entry", origin);
  entryUrl.searchParams.set("next", `/settings?gmail=${status}`);
  return entryUrl;
}

function workspaceSettingsRedirect(origin: string, workspaceId: string, status: string) {
  return new URL(buildWorkspacePath(workspaceId, `/settings?gmail=${status}`), origin);
}

export async function GET(request: Request) {
  return runSecureApiRoute(request, { errorMessage: "Failed to complete Gmail connect" }, async () => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const origin = url.origin;

    await enforceDistributedRateLimit(request, {
      scope: "gmail-oauth-callback",
      identifier: state ?? "missing-state",
      limit: 20,
      windowMs: 10 * 60_000,
    });

    if (error) {
      return NextResponse.redirect(defaultSettingsRedirect(origin, "denied"));
    }
    if (!code || !state) {
      return NextResponse.redirect(defaultSettingsRedirect(origin, "invalid_callback"));
    }

    const oauthState = await consumeIntegrationOAuthState(state);
    if (!oauthState) {
      return NextResponse.redirect(defaultSettingsRedirect(origin, "invalid_state"));
    }
    const recentUserId = await requireRecentAuthentication();
    const auth = await requireWorkspaceRole(oauthState.workspaceId, "OWNER");
    if (oauthState.userId !== auth.userId || recentUserId !== auth.userId) {
      return NextResponse.redirect(workspaceSettingsRedirect(origin, oauthState.workspaceId, "forbidden"));
    }

    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: oauthState.codeVerifier,
      origin,
    });
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
      return NextResponse.redirect(workspaceSettingsRedirect(origin, auth.workspaceId, "profile_unavailable"));
    }

    const existing = await prisma.gmailIntegration.findFirst({
      where: { workspaceId: auth.workspaceId, userId: auth.userId },
      select: { id: true, workspaceId: true, refreshToken: true },
    });

    if (existing) {
      const refreshToken = tokens.refresh_token || (existing.refreshToken
        ? openGmailCredential({
            integrationId: existing.id,
            workspaceId: existing.workspaceId,
            field: "refreshToken",
            value: existing.refreshToken,
          })
        : undefined);
      await prisma.gmailIntegration.update({
        where: { id: existing.id },
        data: {
          email,
          accessToken: sealGmailCredential({
            integrationId: existing.id,
            workspaceId: auth.workspaceId,
            field: "accessToken",
            value: tokens.access_token,
          }),
          refreshToken: refreshToken
            ? sealGmailCredential({
                integrationId: existing.id,
                workspaceId: auth.workspaceId,
                field: "refreshToken",
                value: refreshToken,
              })
            : null,
          tokenType: tokens.token_type,
          scope: tokens.scope,
          expiryDate,
          isActive: true,
        },
      });
    } else {
      const integrationId = randomUUID();
      await prisma.gmailIntegration.create({
        data: {
          id: integrationId,
          workspaceId: auth.workspaceId,
          userId: auth.userId,
          email,
          accessToken: sealGmailCredential({
            integrationId,
            workspaceId: auth.workspaceId,
            field: "accessToken",
            value: tokens.access_token,
          }),
          refreshToken: tokens.refresh_token
            ? sealGmailCredential({
                integrationId,
                workspaceId: auth.workspaceId,
                field: "refreshToken",
                value: tokens.refresh_token,
              })
            : null,
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

    return NextResponse.redirect(workspaceSettingsRedirect(origin, auth.workspaceId, "connected"));
  });
}
