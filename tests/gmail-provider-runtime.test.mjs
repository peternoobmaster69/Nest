import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { afterEach, beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-10T10:00:00Z");
const calls = [];
const environmentKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_REDIRECT_URI", "NEXTAUTH_URL", "INTEGRATION_ENCRYPTION_KEY", "INTEGRATION_ENCRYPTION_KEY_VERSION"];
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
let integration, respond, updatedRecord;
const prisma = { gmailIntegration: {
  findUnique: async (args) => { calls.push({ name: "findUnique", args }); return integration; },
  update: async (args) => {
    calls.push({ name: "update", args });
    Object.assign(integration, args.data);
    return updatedRecord ?? integration;
  },
} };
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
const gmail = require("../lib/gmail.ts");
const { GmailProviderError, buildGmailConsentUrl, exchangeCodeForTokens, ensureActiveGmailAccessToken, sealGmailCredential, openGmailCredential,
  revokeGmailCredential, listGmailMessagePage, getGmailProfile, listGmailHistoryPage, fetchGmailMessageMetadata, fetchGmailMessage } = gmail;
const requests = () => calls.filter(({ name }) => name === "fetch");
const updates = () => calls.filter(({ name }) => name === "update");
const json = (body, status = 200) => Response.json(body, { status });
const seal = (field, value) => sealGmailCredential({ integrationId: "inbox", workspaceId: "household", field, value });
const open = (field, value) => openGmailCredential({ integrationId: "inbox", workspaceId: "household", field, value });
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-secret", NEXTAUTH_URL: "https://nest.example.test",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), INTEGRATION_ENCRYPTION_KEY_VERSION: "gmail-test",
  });
  delete process.env.GMAIL_REDIRECT_URI;
  calls.length = 0; updatedRecord = null;
  integration = { id: "inbox", workspaceId: "household", isActive: true, accessToken: seal("accessToken", "old-access"),
    refreshToken: seal("refreshToken", "synthetic-refresh"), expiryDate: now, tokenType: "Bearer", scope: "gmail.readonly" };
  respond = () => json({ access_token: "new-access", expires_in: 3600 });
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({ name: "fetch", url: String(url), options });
    return respond();
  });
});
afterEach(() => {
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

test("a revoked refresh grant tells the user to reconnect instead of repeatedly rejecting sync", async () => {
  respond = () => json({ error: "invalid_grant", error_description: "private provider detail" }, 400);
  await assert.rejects(ensureActiveGmailAccessToken("inbox"), (error) => {
    assert.ok(error instanceof GmailProviderError);
    assert.equal(error.code, "GMAIL_RECONNECT_REQUIRED");
    assert.equal(error.retryable, false);
    assert.match(error.safeMessage, /Reconnect Gmail/);
    assert.doesNotMatch(error.message, /private provider detail/);
    return true;
  });
  assert.equal(updates().length, 0);
});

test("a missing reusable grant exposes the same safe reconnect action", async () => {
  integration.refreshToken = null;
  await assert.rejects(ensureActiveGmailAccessToken("inbox"), (error) => {
    assert.ok(error instanceof GmailProviderError);
    assert.equal(error.code, "GMAIL_RECONNECT_REQUIRED");
    assert.equal(error.retryable, false);
    assert.match(error.safeMessage, /Reconnect Gmail/);
    return true;
  });
  assert.equal(requests().length, 0);
});

test("missing OAuth configuration is not misclassified as a retryable provider network failure", async () => {
  delete process.env.GOOGLE_CLIENT_SECRET;
  await assert.rejects(ensureActiveGmailAccessToken("inbox"), /GOOGLE_CLIENT_SECRET is missing/);
  assert.equal(requests().length, 0);
});

test("OAuth consent requests read-only offline access with state and PKCE", () => {
  process.env.NEXTAUTH_URL = "https://nest.example.test/";
  const consent = new URL(buildGmailConsentUrl({ state: "state with spaces", codeChallenge: "pkce-challenge" }));
  assert.equal(consent.origin + consent.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.deepEqual(Object.fromEntries(consent.searchParams), {
    client_id: "synthetic-client", redirect_uri: "https://nest.example.test/api/gmail/callback", response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly", access_type: "offline", include_granted_scopes: "true", prompt: "consent",
    state: "state with spaces", code_challenge: "pkce-challenge", code_challenge_method: "S256",
  });
  assert.equal(requests().length, 0);
});

test("OAuth redirect configuration takes precedence over request origin and supports an explicit callback", () => {
  const params = { state: "state", codeChallenge: "challenge", origin: "https://request.example.test/" };
  assert.equal(new URL(buildGmailConsentUrl(params)).searchParams.get("redirect_uri"), "https://nest.example.test/api/gmail/callback");
  delete process.env.NEXTAUTH_URL;
  assert.equal(new URL(buildGmailConsentUrl(params)).searchParams.get("redirect_uri"), "https://request.example.test/api/gmail/callback");
  process.env.GMAIL_REDIRECT_URI = "https://callback.example.test/oauth/gmail";
  assert.equal(new URL(buildGmailConsentUrl(params)).searchParams.get("redirect_uri"), "https://callback.example.test/oauth/gmail");
});

test("OAuth consent rejects incomplete callback and client configuration", () => {
  delete process.env.NEXTAUTH_URL;
  assert.throws(() => buildGmailConsentUrl({ state: "state", codeChallenge: "challenge" }), /request origin is required/);
  delete process.env.GOOGLE_CLIENT_ID;
  assert.throws(() => buildGmailConsentUrl({ state: "state", codeChallenge: "challenge", origin: "https://nest.example.test" }), /GOOGLE_CLIENT_ID is missing/);
});

test("code exchange sends the verifier and configured callback as a form without dropping token metadata", async () => {
  const tokens = { access_token: "initial-access", expires_in: 1200, refresh_token: "initial-refresh", scope: "gmail.readonly", token_type: "Bearer", id_token: "synthetic-id" };
  respond = () => json(tokens);
  assert.deepEqual(await exchangeCodeForTokens({ code: "code & value", codeVerifier: "verifier", origin: "https://request.example.test" }), tokens);
  const request = requests()[0];
  assert.equal(request.url, "https://oauth2.googleapis.com/token");
  assert.equal(request.options.method, "POST");
  assert.equal(new Headers(request.options.headers).get("content-type"), "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(request.options.body), {
    code: "code & value", client_id: "synthetic-client", client_secret: "synthetic-secret", redirect_uri: "https://nest.example.test/api/gmail/callback",
    grant_type: "authorization_code", code_verifier: "verifier",
  });
});

test("code exchange failures expose the HTTP status without disclosing provider responses", async () => {
  respond = () => json({ error_description: "Private OAuth details" }, 400);
  await assert.rejects(exchangeCodeForTokens({ code: "code", codeVerifier: "verifier" }), { message: "Google token exchange failed with status 400." });
  assert.equal(updates().length, 0);
});

test("fresh access tokens are opened in their integration context without a refresh request", async () => {
  integration.expiryDate = new Date(now.getTime() + 60_001);
  assert.equal(await ensureActiveGmailAccessToken("inbox"), "old-access");
  assert.equal(requests().length, 0);
  assert.equal(updates().length, 0);
  assert.deepEqual(calls[0].args, { where: { id: "inbox" } });
});

test("a near-expiry token refresh persists an encrypted credential, expiry, and new provider metadata", async () => {
  integration.expiryDate = new Date(now.getTime() + 60_000);
  respond = () => json({ access_token: "replacement-access", expires_in: 1800, scope: "replacement-scope", token_type: "NewBearer" });
  assert.equal(await ensureActiveGmailAccessToken("inbox"), "replacement-access");
  const request = requests()[0];
  assert.equal(request.url, "https://oauth2.googleapis.com/token");
  assert.equal(request.options.method, "POST");
  assert.equal(new Headers(request.options.headers).get("content-type"), "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(request.options.body), {
    refresh_token: "synthetic-refresh", client_id: "synthetic-client", client_secret: "synthetic-secret",
    redirect_uri: "https://nest.example.test/api/gmail/callback", grant_type: "refresh_token",
  });
  const data = updates()[0].args.data;
  assert.notEqual(data.accessToken, "replacement-access");
  assert.equal(open("accessToken", data.accessToken), "replacement-access");
  assert.equal(data.tokenType, "NewBearer");
  assert.equal(data.scope, "replacement-scope");
  assert.deepEqual(data.expiryDate, new Date(now.getTime() + 1_800_000));
  assert.equal(open("refreshToken", integration.refreshToken), "synthetic-refresh");
});

for (const state of ["no expiry", "no access token"]) {
  test(`${state} triggers refresh and preserves metadata omitted by the provider`, async () => {
    if (state === "no expiry") integration.expiryDate = null;
    else { integration.accessToken = null; integration.expiryDate = new Date(now.getTime() + 3600_000); }
    delete process.env.NEXTAUTH_URL;
    assert.equal(await ensureActiveGmailAccessToken("inbox", "https://request.example.test"), "new-access");
    assert.equal(requests()[0].options.body.get("redirect_uri"), "https://request.example.test/api/gmail/callback");
    assert.equal(integration.tokenType, "Bearer");
    assert.equal(integration.scope, "gmail.readonly");
  });
}

for (const [state, message] of [["missing", "Gmail integration not found."], ["inactive", "Gmail integration is inactive."]]) {
  test(`${state} integrations never access provider credentials`, async () => {
    if (state === "missing") integration = null;
    else integration.isActive = false;
    await assert.rejects(ensureActiveGmailAccessToken("inbox"), { message });
    assert.equal(requests().length, 0);
    assert.equal(updates().length, 0);
  });
}

test("refresh rejects an update result that failed to retain the refreshed credential", async () => {
  updatedRecord = { accessToken: null };
  await assert.rejects(ensureActiveGmailAccessToken("inbox"), /Failed to refresh Gmail access token/);
  assert.equal(updates().length, 1);
});

test("credential envelopes cannot be opened under another workspace or credential field", () => {
  const value = seal("refreshToken", "synthetic-refresh");
  assert.equal(open("refreshToken", value), "synthetic-refresh");
  for (const params of [
    { integrationId: "inbox", workspaceId: "another-workspace", field: "refreshToken", value },
    { integrationId: "inbox", workspaceId: "household", field: "accessToken", value },
  ]) {
    assert.throws(() => openGmailCredential(params), (error) => {
      assert.ok(error instanceof GmailProviderError);
      assert.equal(error.code, "GMAIL_RECONNECT_REQUIRED");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, /synthetic-refresh/);
      return true;
    });
  }
});

for (const [body, expected] of [[{ error: "invalid_request", error_description: "Private details" }, "GMAIL_REQUEST_REJECTED"], [null, "GMAIL_REQUEST_REJECTED"], ["malformed JSON", "GMAIL_REQUEST_REJECTED"]]) {
  test(`refresh handles rejected token response ${JSON.stringify(body)} without leaking its contents`, async () => {
    respond = () => typeof body === "string" ? new Response(body, { status: 400 }) : json(body, 400);
    await assert.rejects(ensureActiveGmailAccessToken("inbox"), (error) => {
      assert.equal(error.code, expected);
      assert.equal(error.status, 400);
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.safeMessage, /Private details|malformed JSON/);
      return true;
    });
    assert.equal(updates().length, 0);
  });
}

test("token refresh network failures become safe retryable provider errors", async () => {
  respond = () => { throw new TypeError("Private token URL details"); };
  await assert.rejects(ensureActiveGmailAccessToken("inbox"), (error) => {
    assert.equal(error.code, "GMAIL_NETWORK_ERROR");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /Private token URL details/);
    return true;
  });
  assert.equal(updates().length, 0);
});

for (const [tokenKind, status] of [["refresh", 200], ["access", 400]]) {
  test(`revocation uses the ${tokenKind} token and accepts HTTP ${status}`, async () => {
    respond = () => json({}, status);
    await revokeGmailCredential({ integrationId: "inbox", workspaceId: "household", accessToken: integration.accessToken,
      refreshToken: tokenKind === "refresh" ? integration.refreshToken : null });
    assert.equal(requests()[0].url, "https://oauth2.googleapis.com/revoke");
    assert.equal(requests()[0].options.method, "POST");
    assert.equal(requests()[0].options.body.get("token"), tokenKind === "refresh" ? "synthetic-refresh" : "old-access");
  });
}

test("revocation is a no-op when no token remains and surfaces unexpected provider failure statuses", async () => {
  await revokeGmailCredential({ integrationId: "inbox", workspaceId: "household", accessToken: null, refreshToken: null });
  assert.equal(requests().length, 0);
  respond = () => json({ secret: "Private provider details" }, 503);
  await assert.rejects(revokeGmailCredential({ integrationId: "inbox", workspaceId: "household", accessToken: integration.accessToken, refreshToken: null }), {
    message: "Google token revocation failed with status 503.",
  });
});

for (const [operation, status, code, retryable] of [
  ["profile", 401, "GMAIL_RECONNECT_REQUIRED", false], ["profile", 403, "GMAIL_RECONNECT_REQUIRED", false],
  ["history", 404, "GMAIL_HISTORY_EXPIRED", false], ["message", 404, "GMAIL_MESSAGE_GONE", false],
  ["list", 404, "GMAIL_REQUEST_REJECTED", false], ["profile", 408, "GMAIL_TEMPORARILY_UNAVAILABLE", true],
  ["profile", 429, "GMAIL_TEMPORARILY_UNAVAILABLE", true], ["refresh", 503, "GMAIL_TEMPORARILY_UNAVAILABLE", true],
]) {
  test(`${operation} HTTP ${status} maps to ${code} with the correct retry policy`, async () => {
    respond = () => json({ error: "Private provider details" }, status);
    const action = {
      profile: () => getGmailProfile("synthetic-access"),
      history: () => listGmailHistoryPage({ accessToken: "synthetic-access", startHistoryId: "100" }),
      message: () => fetchGmailMessage("synthetic-access", "message"),
      list: () => listGmailMessagePage({ accessToken: "synthetic-access", q: "subject:alert" }),
      refresh: () => ensureActiveGmailAccessToken("inbox"),
    }[operation];
    await assert.rejects(action(), (error) => {
      assert.ok(error instanceof GmailProviderError);
      assert.equal(error.name, "GmailProviderError");
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.retryable, retryable);
      assert.doesNotMatch(error.safeMessage, /Private provider details/);
      return true;
    });
  });
}

test("Gmail API network errors expose only the safe retry message", async () => {
  respond = () => { throw new Error("Private transport diagnostics"); };
  await assert.rejects(getGmailProfile("synthetic-access"), (error) => {
    assert.equal(error.code, "GMAIL_NETWORK_ERROR");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /Private transport diagnostics/);
    return true;
  });
});

test("message listing encodes query and cursor, forwards authorization, and exposes pagination totals", async () => {
  respond = () => json({ messages: [{ id: "first" }], nextPageToken: "next & page", resultSizeEstimate: 12 });
  assert.deepEqual(await listGmailMessagePage({ accessToken: "synthetic-access", q: 'subject:"Card Alert" after:123', pageToken: "saved & page", maxResults: 80 }), {
    messages: [{ id: "first" }], nextPageToken: "next & page", resultSizeEstimate: 12,
  });
  const request = requests()[0];
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, "https://gmail.googleapis.com/gmail/v1/users/me/messages");
  assert.deepEqual(Object.fromEntries(url.searchParams), { q: 'subject:"Card Alert" after:123', pageToken: "saved & page", maxResults: "80" });
  assert.equal(new Headers(request.options.headers).get("authorization"), "Bearer synthetic-access");
});

for (const [maximum, expected] of [[undefined, "50"], [0, "1"], [500, "100"]]) {
  test(`empty message pages default response fields and bound maxResults ${maximum}`, async () => {
    respond = () => json({});
    assert.deepEqual(await listGmailMessagePage({ accessToken: "synthetic-access", q: "", maxResults: maximum }), { messages: [], nextPageToken: null, resultSizeEstimate: 0 });
    const url = new URL(requests()[0].url);
    assert.equal(url.searchParams.get("maxResults"), expected);
    assert.equal(url.searchParams.has("pageToken"), false);
  });
}

test("profile data supplies the durable history marker with empty-account defaults", async () => {
  respond = () => json({ historyId: "1000001", messagesTotal: 17, emailAddress: "private@example.test" });
  assert.deepEqual(await getGmailProfile("synthetic-access"), { historyId: "1000001", messagesTotal: 17 });
  assert.equal(new URL(requests()[0].url).pathname, "/gmail/v1/users/me/profile");
  respond = () => json({});
  assert.deepEqual(await getGmailProfile("synthetic-access"), { historyId: null, messagesTotal: 0 });
});

test("history pages request message additions and deduplicate IDs across records", async () => {
  respond = () => json({ historyId: "150", nextPageToken: "following", history: [
    { messagesAdded: [{ message: { id: "one" } }, { message: { id: "two" } }, {}] },
    {}, { messagesAdded: [{ message: {} }, { message: { id: "one" } }] },
  ] });
  assert.deepEqual(await listGmailHistoryPage({ accessToken: "synthetic-access", startHistoryId: "100", pageToken: "previous", maxResults: 200 }), {
    messages: [{ id: "one" }, { id: "two" }], nextPageToken: "following", historyId: "150",
  });
  const url = new URL(requests()[0].url);
  assert.equal(url.pathname, "/gmail/v1/users/me/history");
  assert.deepEqual(Object.fromEntries(url.searchParams), { startHistoryId: "100", historyTypes: "messageAdded", maxResults: "100", pageToken: "previous" });
});

test("history defaults missing arrays and cursors and uses the default and minimum page sizes", async () => {
  respond = () => json({});
  for (const [maximum, expected] of [[undefined, "50"], [0, "1"]]) {
    assert.deepEqual(await listGmailHistoryPage({ accessToken: "synthetic-access", startHistoryId: "100", maxResults: maximum }), {
      messages: [], nextPageToken: null, historyId: null,
    });
    const url = new URL(requests().at(-1).url);
    assert.equal(url.searchParams.get("maxResults"), expected);
    assert.equal(url.searchParams.has("pageToken"), false);
  }
});

test("metadata requests only the subject header and escapes message identifiers", async () => {
  respond = () => json({ payload: { headers: [{ name: "From", value: "ignored" }, { name: "sUbJeCt", value: "Card Transaction Alert" }] }, historyId: "110" });
  assert.deepEqual(await fetchGmailMessageMetadata("synthetic-access", "message/with space"), { subject: "Card Transaction Alert", historyId: "110" });
  const url = new URL(requests()[0].url);
  assert.equal(url.pathname, "/gmail/v1/users/me/messages/message%2Fwith%20space");
  assert.equal(url.searchParams.get("format"), "metadata");
  assert.deepEqual(url.searchParams.getAll("metadataHeaders"), ["Subject"]);
});

for (const body of [{}, { payload: {} }, { payload: { headers: [] } }]) {
  test(`metadata with no subject ${JSON.stringify(body)} returns safe empty values`, async () => {
    respond = () => json(body);
    assert.deepEqual(await fetchGmailMessageMetadata("synthetic-access", "message"), { subject: "", historyId: null });
  });
}

test("full message reads decode base64url UTF-8 and find mixed-case subject headers", async () => {
  const text = "Card transaction SGD 12.34 – café \uFFFF\uFFFE";
  respond = () => json({ payload: { mimeType: "text/plain", body: { data: Buffer.from(text).toString("base64url") },
    headers: [{ name: "From", value: "bank@example.test" }, { name: "SUBJECT", value: "Card Transaction Alert" }] }, historyId: "125" });
  assert.deepEqual(await fetchGmailMessage("synthetic-access", "message/one"), { subject: "Card Transaction Alert", body: text, historyId: "125" });
  const url = new URL(requests()[0].url);
  assert.equal(url.pathname, "/gmail/v1/users/me/messages/message%2Fone");
  assert.equal(url.searchParams.get("format"), "full");
});

test("HTML message bodies become readable text and nested parts skip unsupported or empty content", async () => {
  const html = "<div>Card alert<br>SGD 10.00</div>";
  respond = () => json({ payload: { mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } } });
  const rendered = await fetchGmailMessage("synthetic-access", "message");
  assert.match(rendered.body, /Card alert\s+SGD 10\.00/);
  assert.doesNotMatch(rendered.body, /<div>|<br>/);
  respond = () => json({ payload: { mimeType: "multipart/mixed", parts: [
    { mimeType: "application/pdf", body: { data: "AA" } },
    { mimeType: "text/plain", body: {} },
    { mimeType: "text/html", body: {} },
    { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Nested card alert").toString("base64url") } }] },
  ] }, snippet: "Unused preview", historyId: 123 });
  assert.deepEqual(await fetchGmailMessage("synthetic-access", "message"), { subject: "", body: "Nested card alert", historyId: null });
});

for (const [payload, snippet, expected] of [[null, "Preview fallback", "Preview fallback"], [{ parts: [] }, undefined, ""], [{ mimeType: "text/plain" }, "", ""], [{ mimeType: "text/html" }, undefined, ""]]) {
  test(`missing message content ${JSON.stringify(payload)} falls back safely to the snippet`, async () => {
    respond = () => json({ payload, snippet });
    assert.deepEqual(await fetchGmailMessage("synthetic-access", "message"), { subject: "", body: expected, historyId: null });
  });
}
