import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const calls = [];
let state;
class ApiAuthError extends Error { constructor(status, message) { super(message); this.status = status; } }
class GmailProviderError extends Error { constructor(code) { super("Safe provider failure"); this.code = code; } }
const record = (name, value) => { calls.push({ name, value }); };
function respond(name, value) {
  record(name, value);
  if (state.failures[name]) throw state.failures[name];
}
mock.module("../lib/prisma.ts", { namedExports: { prisma: {
  gmailIntegration: {
    findFirst: async query => { respond("find", query); return state.existing; },
    create: async query => { respond("create", query); return query.data; },
    update: async query => { respond("update", query); return query.data; },
  },
  workspaceAuditLog: { create: async query => { respond("audit", query); return query.data; } },
} } });
mock.module("../lib/workspace-auth.ts", { namedExports: {
  ApiAuthError,
  requireRecentAuthentication: async () => { respond("recent"); return state.recentUserId; },
  requireWorkspaceRole: async (workspaceId, role) => { respond("access", { workspaceId, role }); return state.auth; },
  requireWorkspaceAccess: async () => { throw new Error("Unexpected workspace access lookup"); },
} });
mock.module("../lib/integration-oauth-state.ts", { namedExports: {
  consumeIntegrationOAuthState: async value => { respond("consume", value); return state.oauth; },
} });
mock.module("../lib/security-rate-limit.ts", { namedExports: {
  enforceDistributedRateLimit: async (request, options) => { respond("rate", { url: request.url, ...options }); },
  rateLimitResponse: () => null,
} });
mock.module("../lib/observability/logger.ts", { namedExports: { logEvent: () => {} } });
mock.module("../lib/gmail.ts", { namedExports: {
  GmailProviderError,
  exchangeCodeForTokens: async input => { respond("exchange", input); return state.tokens; },
  openGmailCredential: input => { respond("open", input); return "recovered-refresh"; },
  sealGmailCredential: input => { respond("seal", input); return `sealed:${input.field}:${input.integrationId}`; },
} });
const { GET } = require("../app/api/gmail/callback/route.ts");
const { ApiRequestError } = require("../lib/api-security.ts");
const currentTime = new Date("2026-10-10T12:00:00.000Z");
beforeEach(t => {
  calls.length = 0;
  state = {
    oauth: { userId: "owner", workspaceId: "household", codeVerifier: "synthetic-pkce" },
    auth: { userId: "owner", workspaceId: "household", role: "OWNER" }, recentUserId: "owner",
    tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, token_type: "Bearer", scope: "gmail.readonly" },
    existing: null, failures: {}, profile: () => Response.json({ emailAddress: "owner@example.test" }),
  };
  t.mock.timers.enable({ apis: ["Date"], now: currentTime });
  t.mock.method(globalThis, "fetch", async (url, options) => { record("profile", { url, options }); return state.profile(); });
});
const byName = name => calls.filter(call => call.name === name).map(call => call.value);
const writes = () => calls.filter(call => ["create", "update", "audit"].includes(call.name));
const callback = (query = "code=synthetic-code&state=synthetic-state") => GET(new Request(`https://nest.example.test/api/gmail/callback?${query}`));
function assertRedirect(response, status, scoped = true) {
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const url = new URL(response.headers.get("location"));
  assert.equal(url.origin, "https://nest.example.test");
  assert.equal(url.pathname, scoped ? "/w/household/settings" : "/entry");
  assert.equal(scoped ? url.searchParams.get("gmail") : url.searchParams.get("next"), scoped ? status : `/settings?gmail=${status}`);
}

test("a first-time Gmail connection without a refresh token requests renewed consent without storing an unusable integration", async () => {
  delete state.tokens.refresh_token;
  assertRedirect(await callback(), "refresh_required");
  assert.deepEqual(writes(), []);
  assert.deepEqual(byName("seal"), []);
});

for (const [query, status] of [
  ["error=access_denied&state=synthetic-state", "denied"], ["", "invalid_callback"],
  ["code=synthetic-code", "invalid_callback"], ["state=synthetic-state", "invalid_callback"],
]) {
  test(`incomplete or denied callbacks stop before consuming state (${query})`, async () => {
    assertRedirect(await callback(query), status, false);
    assert.equal(byName("rate").length, 1);
    assert.equal(byName("rate")[0].identifier, new URLSearchParams(query).get("state") ?? "missing-state");
    assert.deepEqual(byName("consume"), []);
    assert.deepEqual(writes(), []);
  });
}

test("expired or already consumed OAuth state never reaches account authorization or Google", async () => {
  state.oauth = null;
  assertRedirect(await callback(), "invalid_state", false);
  assert.deepEqual(byName("consume"), ["synthetic-state"]);
  assert.deepEqual(byName("access"), []);
  assert.deepEqual(byName("exchange"), []);
});

for (const differentIdentity of ["oauth", "recent"]) {
  test(`a different ${differentIdentity} identity cannot complete another user's connection`, async () => {
    if (differentIdentity === "oauth") state.oauth.userId = "other-owner";
    else state.recentUserId = "other-owner";
    assertRedirect(await callback(), "forbidden");
    assert.deepEqual(byName("access"), [{ workspaceId: "household", role: "OWNER" }]);
    assert.deepEqual(byName("exchange"), []);
    assert.deepEqual(writes(), []);
  });
}

for (const [operation, failure, status] of [
  ["rate", new ApiRequestError(429, "Try again later"), 429],
  ["recent", new ApiAuthError(401, "Re-authentication required"), 401],
  ["access", new ApiAuthError(403, "Owner required"), 403],
  ["consume", new Error("internal state storage detail"), 500],
  ["exchange", new Error("internal token provider detail"), 500],
]) {
  test(`${operation} failures return a safe response without saving credentials`, async () => {
    state.failures[operation] = failure;
    const response = await callback();
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /internal .* detail|synthetic-access|synthetic-refresh/);
    assert.deepEqual(writes(), []);
  });
}

for (const [name, profile] of [
  ["unavailable", () => new Response(null, { status: 503 })], ["missing email", () => Response.json({})],
  ["empty email", () => Response.json({ emailAddress: "" })], ["invalid body", () => new Response("not json")],
  ["network", () => { throw new Error("Network unavailable"); }],
]) {
  test(`an ${name} Gmail profile cannot activate an unidentified connection`, async () => {
    state.profile = profile;
    assertRedirect(await callback(), "profile_unavailable");
    assert.deepEqual(byName("find"), []);
    assert.deepEqual(writes(), []);
  });
}

test("new connections use the verified workspace, seal both tokens, and audit only after saving", async () => {
  assertRedirect(await callback("code=synthetic-code&state=synthetic-state&workspaceId=untrusted"), "connected");
  assert.deepEqual(byName("exchange"), [{ code: "synthetic-code", codeVerifier: "synthetic-pkce", origin: "https://nest.example.test" }]);
  assert.deepEqual(byName("profile"), [{ url: "https://gmail.googleapis.com/gmail/v1/users/me/profile", options: { headers: { Authorization: "Bearer synthetic-access" } } }]);
  assert.deepEqual(byName("find")[0].where, { workspaceId: "household", userId: "owner" });
  const created = byName("create")[0].data;
  assert.match(created.id, /^[a-f\d-]{36}$/);
  assert.deepEqual(created, {
    id: created.id, workspaceId: "household", userId: "owner", email: "owner@example.test",
    accessToken: `sealed:accessToken:${created.id}`, refreshToken: `sealed:refreshToken:${created.id}`,
    tokenType: "Bearer", scope: "gmail.readonly", expiryDate: new Date("2026-10-10T13:00:00.000Z"), isActive: true,
  });
  assert.deepEqual(byName("seal"), [
    { integrationId: created.id, workspaceId: "household", field: "accessToken", value: "synthetic-access" },
    { integrationId: created.id, workspaceId: "household", field: "refreshToken", value: "synthetic-refresh" },
  ]);
  assert.deepEqual(writes().map(call => call.name), ["create", "audit"]);
  assert.deepEqual(byName("audit")[0].data, { workspaceId: "household", actorUserId: "owner", action: "GMAIL_INTEGRATION_CONNECTED", details: "Gmail integration connected for owner@example.test." });
});

for (const freshRefreshToken of [true, false]) {
  test(`reconnecting an existing account ${freshRefreshToken ? "replaces" : "recovers"} its refresh credential without changing its identity`, async () => {
    state.existing = { id: "integration-existing", workspaceId: "household", refreshToken: "encrypted-old-refresh" };
    if (!freshRefreshToken) delete state.tokens.refresh_token;
    assertRedirect(await callback(), "connected");
    assert.deepEqual(byName("create"), []);
    assert.deepEqual(byName("update")[0].where, { id: "integration-existing" });
    assert.equal(byName("update")[0].data.isActive, true);
    assert.equal(byName("update")[0].data.refreshToken, "sealed:refreshToken:integration-existing");
    assert.equal(byName("seal")[1].value, freshRefreshToken ? "synthetic-refresh" : "recovered-refresh");
    assert.deepEqual(byName("open"), freshRefreshToken ? [] : [{ integrationId: "integration-existing", workspaceId: "household", field: "refreshToken", value: "encrypted-old-refresh" }]);
  });
}

for (const [refreshToken, failure, expectedStatus] of [
  [null, null, 307], ["encrypted", new GmailProviderError("GMAIL_RECONNECT_REQUIRED"), 307],
  ["encrypted", new GmailProviderError("UNEXPECTED_PROVIDER_ERROR"), 500], ["encrypted", new Error("internal encryption detail"), 500],
]) {
  test(`an unusable saved refresh credential is never silently replaced with empty authorization (${failure?.code ?? refreshToken})`, async () => {
    delete state.tokens.refresh_token;
    state.existing = { id: "existing", workspaceId: "household", refreshToken };
    if (failure) state.failures.open = failure;
    const response = await callback();
    if (expectedStatus === 307) assertRedirect(response, "refresh_required");
    else { assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /internal encryption detail/); }
    assert.deepEqual(writes(), []);
  });
}
