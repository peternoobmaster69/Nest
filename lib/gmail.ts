import { htmlToText } from "@/lib/html-text";
import { prisma } from "@/lib/prisma";
import {
  decryptCredential,
  encryptCredential,
  gmailCredentialContext,
} from "@/lib/credential-encryption";

const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export class GmailProviderError extends Error {
  readonly safeMessage: string;

  constructor(
    public readonly code: string,
    safeMessage: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(safeMessage);
    this.name = "GmailProviderError";
    this.safeMessage = safeMessage;
  }
}

function gmailProviderFailure(operation: string, status: number) {
  if (status === 401 || status === 403) {
    return new GmailProviderError(
      "GMAIL_RECONNECT_REQUIRED",
      "Gmail authorization expired. Reconnect Gmail in Settings.",
      false,
      status,
    );
  }
  if (status === 404 && operation === "history") {
    return new GmailProviderError("GMAIL_HISTORY_EXPIRED", "Gmail history expired; a bounded rescan is required.", false, status);
  }
  if (status === 404 && operation === "message-get") {
    return new GmailProviderError("GMAIL_MESSAGE_GONE", "A Gmail message was removed before it could be read.", false, status);
  }
  const retryable = status === 408 || status === 429 || status >= 500;
  return new GmailProviderError(
    retryable ? "GMAIL_TEMPORARILY_UNAVAILABLE" : "GMAIL_REQUEST_REJECTED",
    retryable ? "Gmail is temporarily unavailable. The sync will retry." : "Gmail rejected the sync request.",
    retryable,
    status,
  );
}

async function gmailFetch(operation: string, url: string, accessToken: string) {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new GmailProviderError(
      "GMAIL_NETWORK_ERROR",
      "Gmail could not be reached. The sync will retry.",
      true,
    );
  }
  if (!response.ok) throw gmailProviderFailure(operation, response.status);
  return response;
}

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

function getGmailRedirectUri(origin?: string) {
  if (process.env.GMAIL_REDIRECT_URI) return process.env.GMAIL_REDIRECT_URI;
  const base = process.env.NEXTAUTH_URL || origin;
  if (!base) throw new Error("NEXTAUTH_URL or request origin is required for Gmail OAuth.");
  return `${base.replace(/\/$/, "")}/api/gmail/callback`;
}

export function buildGmailConsentUrl(params: { state: string; codeChallenge: string; origin?: string }) {
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
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_OAUTH_BASE}?${qp.toString()}`;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
  origin?: string;
}) {
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
      code_verifier: params.codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed with status ${res.status}.`);
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
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
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
  } catch {
    throw new GmailProviderError(
      "GMAIL_NETWORK_ERROR",
      "Gmail could not be reached. The sync will retry.",
      true,
    );
  }
  if (!res.ok) {
    throw gmailProviderFailure("token-refresh", res.status);
  }
  return res.json() as Promise<{
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  }>;
}

export function sealGmailCredential(params: {
  integrationId: string;
  workspaceId: string;
  field: "accessToken" | "refreshToken";
  value: string;
}) {
  return encryptCredential(
    params.value,
    gmailCredentialContext(params.integrationId, params.workspaceId, params.field),
  );
}

export function openGmailCredential(params: {
  integrationId: string;
  workspaceId: string;
  field: "accessToken" | "refreshToken";
  value: string;
}) {
  try {
    return decryptCredential(
      params.value,
      gmailCredentialContext(params.integrationId, params.workspaceId, params.field),
    );
  } catch {
    throw new GmailProviderError(
      "GMAIL_RECONNECT_REQUIRED",
      "Stored Gmail authorization can no longer be opened. Reconnect Gmail in Settings.",
      false,
    );
  }
}

export async function revokeGmailCredential(params: {
  integrationId: string;
  workspaceId: string;
  accessToken: string | null;
  refreshToken: string | null;
}) {
  const sealed = params.refreshToken || params.accessToken;
  if (!sealed) return;
  const field = params.refreshToken ? "refreshToken" : "accessToken";
  const token = openGmailCredential({ ...params, field, value: sealed });
  const response = await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (!response.ok && response.status !== 400) {
    throw new Error(`Google token revocation failed with status ${response.status}.`);
  }
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
  if (isFresh) {
    return openGmailCredential({
      integrationId: integration.id,
      workspaceId: integration.workspaceId,
      field: "accessToken",
      value: integration.accessToken!,
    });
  }

  if (!integration.refreshToken) {
    throw new Error("No Gmail refresh token. Reconnect Google in Settings.");
  }

  const refreshToken = openGmailCredential({
    integrationId: integration.id,
    workspaceId: integration.workspaceId,
    field: "refreshToken",
    value: integration.refreshToken,
  });
  const refreshed = await refreshAccessToken(refreshToken, origin);
  const expiryDate = new Date(Date.now() + refreshed.expires_in * 1000);
  const updated = await prisma.gmailIntegration.update({
    where: { id: integration.id },
    data: {
      accessToken: sealGmailCredential({
        integrationId: integration.id,
        workspaceId: integration.workspaceId,
        field: "accessToken",
        value: refreshed.access_token,
      }),
      tokenType: refreshed.token_type ?? integration.tokenType,
      scope: refreshed.scope ?? integration.scope,
      expiryDate,
    },
  });
  if (!updated.accessToken) throw new Error("Failed to refresh Gmail access token.");
  return refreshed.access_token;
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

export async function listGmailMessagePage(params: {
  accessToken: string;
  q: string;
  pageToken?: string | null;
  maxResults?: number;
}) {
  const query = new URLSearchParams({
    q: params.q,
    maxResults: String(Math.max(1, Math.min(100, params.maxResults ?? 50))),
  });
  if (params.pageToken) query.set("pageToken", params.pageToken);
  const response = await gmailFetch(
    "messages-list",
    `${GMAIL_API_BASE}/users/me/messages?${query.toString()}`,
    params.accessToken,
  );
  const data = (await response.json()) as {
    messages?: Array<{ id: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };
  return {
    messages: data.messages ?? [],
    nextPageToken: data.nextPageToken ?? null,
    resultSizeEstimate: data.resultSizeEstimate ?? 0,
  };
}

export async function getGmailProfile(accessToken: string) {
  const response = await gmailFetch("profile", `${GMAIL_API_BASE}/users/me/profile`, accessToken);
  const data = (await response.json()) as { historyId?: string; messagesTotal?: number };
  return { historyId: data.historyId ?? null, messagesTotal: data.messagesTotal ?? 0 };
}

export async function listGmailHistoryPage(params: {
  accessToken: string;
  startHistoryId: string;
  pageToken?: string | null;
  maxResults?: number;
}) {
  const query = new URLSearchParams({
    startHistoryId: params.startHistoryId,
    historyTypes: "messageAdded",
    maxResults: String(Math.max(1, Math.min(100, params.maxResults ?? 50))),
  });
  if (params.pageToken) query.set("pageToken", params.pageToken);
  const response = await gmailFetch(
    "history",
    `${GMAIL_API_BASE}/users/me/history?${query.toString()}`,
    params.accessToken,
  );
  const data = (await response.json()) as {
    history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
    nextPageToken?: string;
    historyId?: string;
  };
  const ids = new Set<string>();
  for (const entry of data.history ?? []) {
    for (const added of entry.messagesAdded ?? []) {
      if (added.message?.id) ids.add(added.message.id);
    }
  }
  return {
    messages: [...ids].map((id) => ({ id })),
    nextPageToken: data.nextPageToken ?? null,
    historyId: data.historyId ?? null,
  };
}

export async function fetchGmailMessageMetadata(accessToken: string, messageId: string) {
  const query = new URLSearchParams({ format: "metadata" });
  query.append("metadataHeaders", "Subject");
  const response = await gmailFetch(
    "message-get",
    `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(messageId)}?${query.toString()}`,
    accessToken,
  );
  const data = (await response.json()) as {
    payload?: { headers?: Array<{ name: string; value: string }> };
    historyId?: string;
  };
  const headers = data.payload?.headers ?? [];
  const subject = headers.find((header) => header.name.toLocaleLowerCase() === "subject")?.value ?? "";
  return { subject, historyId: data.historyId ?? null };
}

export async function fetchGmailMessage(accessToken: string, messageId: string) {
  const res = await gmailFetch(
    "message-get",
    `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    accessToken,
  );
  const data = await res.json();
  const headers = (data.payload?.headers ?? []) as Array<{ name: string; value: string }>;
  const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
  const body = extractTextPart(data.payload) || data.snippet || "";
  return { subject, body, historyId: typeof data.historyId === "string" ? data.historyId : null };
}
