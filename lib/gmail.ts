import { prisma } from "@/lib/prisma";

const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function getGoogleClientId() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is missing");
  return clientId;
}

function getGoogleClientSecret() {
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientSecret) throw new Error("GOOGLE_CLIENT_SECRET is missing");
  return clientSecret;
}

export function getGmailRedirectUri(origin?: string) {
  if (process.env.GMAIL_REDIRECT_URI) return process.env.GMAIL_REDIRECT_URI;
  const base = process.env.NEXTAUTH_URL || origin;
  if (!base) throw new Error("NEXTAUTH_URL or request origin is required for Gmail OAuth.");
  return `${base.replace(/\/$/, "")}/api/gmail/callback`;
}

export function buildGmailConsentUrl(params: { state: string; origin?: string }) {
  const redirectUri = getGmailRedirectUri(params.origin);
  const qp = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: params.state,
  });
  return `${GOOGLE_OAUTH_BASE}?${qp.toString()}`;
}

export async function exchangeCodeForTokens(params: { code: string; origin?: string }) {
  const redirectUri = getGmailRedirectUri(params.origin);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }
  return res.json() as Promise<{
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
    id_token?: string;
  }>;
}

async function refreshAccessToken(refreshToken: string, origin?: string) {
  const redirectUri = getGmailRedirectUri(origin);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${text}`);
  }
  return res.json() as Promise<{
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  }>;
}

export async function ensureActiveGmailAccessToken(integrationId: string, origin?: string) {
  const integration = await prisma.gmailIntegration.findUnique({
    where: { id: integrationId },
  });
  if (!integration) throw new Error("Gmail integration not found.");
  if (!integration.isActive) throw new Error("Gmail integration is inactive.");

  const now = Date.now();
  const expiry = integration.expiryDate?.getTime() ?? 0;
  const isFresh = integration.accessToken && expiry > now + 60_000;
  if (isFresh) return integration.accessToken!;

  if (!integration.refreshToken) {
    throw new Error("No Gmail refresh token. Reconnect Google in Settings.");
  }

  const refreshed = await refreshAccessToken(integration.refreshToken, origin);
  const expiryDate = new Date(Date.now() + refreshed.expires_in * 1000);
  const updated = await prisma.gmailIntegration.update({
    where: { id: integration.id },
    data: {
      accessToken: refreshed.access_token,
      tokenType: refreshed.token_type ?? integration.tokenType,
      scope: refreshed.scope ?? integration.scope,
      expiryDate,
    },
  });
  if (!updated.accessToken) throw new Error("Failed to refresh Gmail access token.");
  return updated.accessToken;
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

type GmailPayload = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
};

function htmlToText(input: string) {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractTextPart(payload: GmailPayload | null): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return htmlToText(decodeBase64Url(payload.body.data));
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const found = extractTextPart(part);
      if (found) return found;
    }
  }
  return "";
}

export async function listGmailMessageIds(accessToken: string, q: string) {
  const allMessages: Array<{ id: string }> = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q,
      maxResults: "500",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const res = await fetch(`${GMAIL_API_BASE}/users/me/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gmail list failed: ${text}`);
    }
    const data = (await res.json()) as {
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    };
    allMessages.push(...(data.messages ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allMessages;
}

export async function fetchGmailMessage(accessToken: string, messageId: string) {
  const res = await fetch(`${GMAIL_API_BASE}/users/me/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail get message failed: ${text}`);
  }
  const data = await res.json();
  const headers = (data.payload?.headers ?? []) as Array<{ name: string; value: string }>;
  const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
  const body = extractTextPart(data.payload) || data.snippet || "";
  return { subject, body };
}
