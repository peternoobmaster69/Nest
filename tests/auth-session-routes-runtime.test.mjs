import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-08T12:00:00Z");
const origin = "https://nest.example.test";
const calls = [];
let state;

function fieldMatches(actual, expected) {
  if (typeof expected !== "object" || expected === null) return actual === expected;
  if ("in" in expected) return expected.in.includes(actual);
  if ("gt" in expected) return actual > expected.gt;
  if ("lte" in expected) return actual <= expected.lte;
  throw new Error("Unsupported fixture query");
}
const matches = (row, where) => Object.entries(where).every(([key, value]) => fieldMatches(row[key], value));
const select = (row, fields) => row && Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]));
const record = (operation, handler) => async (args) => {
  calls.push({ operation, args });
  if (state.failure === operation) throw new Error("Private database details");
  return handler(args);
};
const prisma = {
  user: { findUnique: record("user.findUnique", ({ where, select: fields }) => select(state.user?.id === where.id ? state.user : null, fields)) },
  loginSession: {
    findUnique: record("loginSession.findUnique", ({ where, select: fields }) => select(state.sessions.find((row) => matches(row, where)), fields)),
    findMany: record("loginSession.findMany", ({ where, take, select: fields }) => state.sessions.filter((row) => matches(row, where)).sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, take).map((row) => select(row, fields))),
    count: record("loginSession.count", ({ where }) => state.sessions.filter((row) => matches(row, where)).length),
    updateMany: record("loginSession.updateMany", ({ where, data }) => {
      if (data.status === "ACTIVE" && state.failPromotion) return { count: 0 };
      const rows = state.sessions.filter((row) => matches(row, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    }),
  },
  workspaceMember: { findMany: record("workspaceMember.findMany", ({ where, take }) => state.memberships.filter((row) => row.userId === where.userId).slice(0, take).map(({ workspaceId }) => ({ workspaceId }))) },
  workspaceAuditLog: { createMany: record("workspaceAuditLog.createMany", ({ data }) => { state.audit.push(...data); return { count: data.length }; }) },
  account: { findMany: record("account.findMany", ({ where, take }) => state.accounts.filter((row) => row.userId === where.userId).sort((a, b) => a.provider.localeCompare(b.provider)).slice(0, take).map(({ provider }) => ({ provider }))) },
  $queryRaw: async (strings, userId) => {
    calls.push({ operation: "lockUser", userId });
    assert.match(strings.join("?"), /WITH \(UPDLOCK, HOLDLOCK\) WHERE \[id\] = \?/);
    return [];
  },
  $transaction: async (handler) => {
    calls.push({ operation: "begin" });
    const snapshot = structuredClone({ sessions: state.sessions, audit: state.audit });
    try {
      const result = await handler(prisma);
      calls.push({ operation: "commit" });
      return result;
    } catch (error) {
      Object.assign(state, snapshot);
      calls.push({ operation: "rollback" });
      throw error;
    }
  },
};
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("next-auth/jwt", { namedExports: { getToken: async ({ req }) => {
  calls.push({ operation: "token", req });
  if (state.tokenFailure) throw state.tokenFailure;
  return state.token;
} } });
mock.module("../lib/server-session.ts", { namedExports: { getDatabaseReadyServerSession: async () => {
  calls.push({ operation: "authenticate" });
  if (state.authFailure) throw state.authFailure;
  return state.session;
} } });
const pending = require("../app/api/auth/session-limit/route.ts");
const sessions = require("../app/api/auth/sessions/route.ts");
const accounts = require("../app/api/auth/accounts/route.ts");
const sessionRow = (sessionId, overrides = {}) => ({
  sessionId, userId: "owner", status: "ACTIVE", deviceName: `Device ${sessionId}`, provider: "google",
  ipAddress: "192.0.2.1", countryCode: "SG", signedInAt: now, lastSeenAt: now,
  expiresAt: new Date(now.getTime() + 60_000), revokedAt: null, ...overrides,
});
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  t.mock.method(console, "error", () => {});
  const configuredOrigin = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = origin;
  t.after(() => {
    if (configuredOrigin === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = configuredOrigin;
  });
  calls.length = 0;
  state = {
    user: { id: "owner", sessionVersion: 7 },
    token: { id: "owner", sessionId: "pending", sessionVersion: 7 },
    session: { user: { id: "owner", authenticatedAt: now.getTime() / 1000 } },
    sessions: [sessionRow("pending", { status: "PENDING" }), sessionRow("device-a"), sessionRow("device-b", { lastSeenAt: new Date(now.getTime() - 1000) }), sessionRow("foreign", { userId: "another-owner" })],
    memberships: [{ userId: "owner", workspaceId: "household" }, { userId: "owner", workspaceId: "travel" }, { userId: "another-owner", workspaceId: "private" }],
    accounts: [{ userId: "owner", provider: "google" }, { userId: "owner", provider: "apple" }, { userId: "owner", provider: "google" }, { userId: "another-owner", provider: "facebook" }],
    audit: [],
  };
});
function request(method = "GET", body, headers = {}) {
  return new Request(`${origin}/api/auth/sessions`, { method, headers: { origin, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function rejected(response, status, error) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
}
const row = (id) => state.sessions.find(({ sessionId }) => sessionId === id);
const operation = (name) => calls.filter((call) => call.operation === name);
const invalidAttempt = "This sign-in attempt is no longer valid.";
const invalidSelection = "One or more selected sessions are no longer active. Review the list and try again.";

test("pending-device endpoints reject incomplete identities before any database access", async () => {
  for (const token of [null, {}, { id: "owner" }, { id: "owner", sessionId: "pending" }, { id: "owner", sessionId: "pending", sessionVersion: "7" }]) {
    state.token = token;
    for (const [handler, method] of [[pending.GET, "GET"], [pending.POST, "POST"]]) {
      calls.length = 0;
      await rejected(await handler(request(method)), 401, "No device approval is pending.");
      assert.deepEqual(calls.map(({ operation: name }) => name), ["token"]);
    }
  }
});

test("pending-device listings expose only active, unexpired devices belonging to this account", async () => {
  state.sessions.push(sessionRow("expired", { expiresAt: now }), sessionRow("revoked", { status: "REVOKED" }));
  const response = await pending.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.maxActiveSessions, 5);
  assert.deepEqual(body.sessions.map(({ sessionId }) => sessionId), ["device-a", "device-b"]);
  assert.deepEqual(Object.keys(body.sessions[0]).sort(), ["countryCode", "deviceName", "ipAddress", "lastSeenAt", "provider", "sessionId", "signedInAt"]);
  const query = operation("loginSession.findMany")[0].args;
  assert.deepEqual(query.where, { userId: "owner", status: "ACTIVE", expiresAt: { gt: now } });
  assert.deepEqual(query.orderBy, { lastSeenAt: "desc" });
  assert.equal(query.take, 5);
});

const invalidateAttempt = {
  "deleted user": () => { state.user = null; },
  "changed session version": () => { state.user.sessionVersion++; },
  "missing pending session": () => { state.sessions = state.sessions.filter(({ sessionId }) => sessionId !== "pending"); },
  "another user's pending session": () => { row("pending").userId = "another-owner"; },
  "already approved session": () => { row("pending").status = "ACTIVE"; },
  "expired pending session": () => { row("pending").expiresAt = now; },
};
for (const [name, invalidate] of Object.entries(invalidateAttempt)) {
  test(`device approval rejects a ${name} without changing sessions`, async () => {
    invalidate();
    const original = structuredClone(state.sessions);
    await rejected(await pending.GET(request()), 409, invalidAttempt);
    await rejected(await pending.POST(request("POST", { sessionId: "device-a" })), 409, invalidAttempt);
    assert.deepEqual(state.sessions, original);
    assert.deepEqual(state.audit, []);
    assert.equal(operation("rollback").length, 1);
    assert.equal(operation("loginSession.updateMany").length, 0);
    assert.equal(operation("lockUser")[0].userId, "owner");
  });
}

test("device approval validates selections and denies cross-origin mutations before reading an identity", async () => {
  await rejected(await pending.POST(request("POST", {}, { origin: "https://attacker.example.test" })), 403, "Cross-origin request denied");
  assert.deepEqual(calls, []);
  for (const body of [null, [], { extra: true }, { sessionId: " " }, { sessionIds: ["device-a"], sessionId: "device-b" }, { sessionIds: [1] }, { sessionIds: Array(6).fill("device-a") }]) {
    await rejected(await pending.POST(request("POST", body)), 400, "Choose up to five valid active sessions.");
  }
  await rejected(await pending.POST(request("POST", { sessionIds: ["pending"] })), 400, "Choose an existing active device to sign out.");
  assert.equal(operation("begin").length, 0);
});

for (const [selection, expected, wording] of [
  [{ sessionId: " device-a " }, ["device-a"], "1 active session was"],
  [{ sessionIds: ["device-a", "device-b", "device-a"] }, ["device-a", "device-b"], "2 active sessions were"],
  [{}, [], "A pending device was approved"],
]) {
  test(`device approval revokes ${expected.length} selected devices atomically and audits each workspace`, async () => {
    state.sessions.push(sessionRow("old-active", { expiresAt: now }), sessionRow("old-pending", { status: "PENDING", expiresAt: now }));
    const response = await pending.POST(request("POST", selection));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { approved: true, revokedSessionIds: expected, revokedSessionId: expected[0] ?? null });
    assert.equal(row("pending").status, "ACTIVE");
    assert.equal(row("pending").expiresAt.getTime(), now.getTime() + 30 * 86400_000);
    assert.equal(row("pending").lastSeenAt.getTime(), now.getTime());
    assert.equal(row("pending").revokedAt, null);
    for (const id of [...expected, "old-active", "old-pending"]) {
      assert.equal(row(id).status, "REVOKED");
      assert.equal(row(id).revokedAt.getTime(), now.getTime());
    }
    assert.equal(row("foreign").status, "ACTIVE");
    assert.deepEqual(state.audit.map(({ workspaceId }) => workspaceId), ["household", "travel"]);
    assert.ok(state.audit.every(({ actorUserId, action, details }) => actorUserId === "owner" && action === "SESSION_REPLACED" && details.startsWith(wording)));
    const writes = operation("loginSession.updateMany");
    assert.ok(writes.every(({ args }) => args.where.userId === "owner"));
    assert.ok(calls.findIndex(({ operation: name }) => name === "lockUser") < calls.findIndex(({ operation: name }) => name === "user.findUnique"));
    assert.equal(operation("commit").length, 1);
  });
}

test("a freed slot can approve a device without workspace audits, including an unreadable optional selection", async () => {
  state.memberships = [];
  const malformed = new Request(`${origin}/api/auth/session-limit`, { method: "POST", headers: { origin }, body: "{" });
  const response = await pending.POST(malformed);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { approved: true, revokedSessionIds: [], revokedSessionId: null });
  assert.equal(operation("workspaceAuditLog.createMany").length, 0);
});

test("full-device approvals require an active selection, and foreign or concurrently revoked selections roll back", async () => {
  state.sessions.push(sessionRow("device-c"), sessionRow("device-d"), sessionRow("device-e"));
  const original = structuredClone(state.sessions);
  for (const selection of [{}, { sessionIds: [] }, { sessionIds: ["device-a", "foreign"] }, { sessionId: "missing" }]) {
    await rejected(await pending.POST(request("POST", selection)), 409, invalidSelection);
    assert.deepEqual(state.sessions, original);
    assert.deepEqual(state.audit, []);
  }
  assert.equal(operation("commit").length, 0);
  assert.equal(operation("rollback").length, 4);
});

test("a failed pending-device promotion rolls back the selected device revocations", async () => {
  state.failPromotion = true;
  const original = structuredClone(state.sessions);
  await rejected(await pending.POST(request("POST", { sessionId: "device-a" })), 409, invalidAttempt);
  assert.deepEqual(state.sessions, original);
  assert.equal(operation("rollback").length, 1);
  assert.equal(operation("workspaceAuditLog.createMany").length, 0);
});

test("pending-device failures disclose stable errors and roll back an audit failure", async () => {
  state.tokenFailure = new Error("Private token configuration");
  await rejected(await pending.GET(request()), 500, "Unable to load active devices.");
  await rejected(await pending.POST(request("POST", {})), 500, "Unable to approve this device.");
  delete state.tokenFailure;
  state.failure = "loginSession.findMany";
  await rejected(await pending.GET(request()), 500, "Unable to load active devices.");
  state.failure = "workspaceAuditLog.createMany";
  const original = structuredClone(state.sessions);
  await rejected(await pending.POST(request("POST", { sessionId: "device-a" })), 500, "Unable to approve this device.");
  assert.deepEqual(state.sessions, original);
  assert.deepEqual(state.audit, []);
});

test("active-session listings mark the current device and do not cache authentication data", async () => {
  state.token.sessionId = "device-a";
  state.sessions.push(sessionRow("expired", { expiresAt: now }));
  const response = await sessions.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.maxActiveSessions, 5);
  assert.deepEqual(body.sessions.map(({ sessionId, current }) => ({ sessionId, current })), [{ sessionId: "device-a", current: true }, { sessionId: "device-b", current: false }]);
  assert.ok(body.sessions.every((session) => !("userId" in session) && !("expiresAt" in session)));
  state.token = null;
  assert.ok((await (await sessions.GET(request())).json()).sessions.every(({ current }) => !current));
});

test("active-session listings require authentication and hide database failures", async () => {
  state.session = null;
  await rejected(await sessions.GET(request()), 401, "Unauthorized");
  assert.equal(operation("loginSession.findMany").length, 0);
  state.session = { user: { id: "owner" } };
  state.failure = "loginSession.findMany";
  await rejected(await sessions.GET(request()), 500, "Unable to load active sessions");
});

test("session revocation requires same-origin, recent authentication, and a nonempty identifier", async () => {
  await rejected(await sessions.DELETE(request("DELETE", { sessionId: "device-a" }, { origin: "https://attacker.example.test" })), 403, "Cross-origin request denied");
  assert.deepEqual(calls, []);
  state.session = null;
  await rejected(await sessions.DELETE(request("DELETE", { sessionId: "device-a" })), 401, "Unauthorized");
  state.session = { user: { id: "owner", authenticatedAt: now.getTime() / 1000 - 601 } };
  await rejected(await sessions.DELETE(request("DELETE", { sessionId: "device-a" })), 401, "Recent authentication required");
  state.session.user.authenticatedAt = now.getTime() / 1000;
  for (const body of [null, {}, [], { sessionId: 7 }, { sessionId: "" }]) {
    await rejected(await sessions.DELETE(request("DELETE", body)), 400, "Session id is required");
  }
  await rejected(await sessions.DELETE(new Request(`${origin}/api/auth/sessions`, { method: "DELETE", body: "{" })), 400, "Session id is required");
  assert.equal(operation("begin").length, 0);
});

test("revoking the current device updates only that session and audits the owning workspaces", async () => {
  state.token.sessionId = "device-a";
  const response = await sessions.DELETE(request("DELETE", { sessionId: "device-a" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: true, current: true });
  assert.equal(row("device-a").status, "REVOKED");
  assert.equal(row("device-a").revokedAt.getTime(), now.getTime());
  assert.equal(row("device-b").status, "ACTIVE");
  assert.equal(row("foreign").status, "ACTIVE");
  assert.deepEqual(operation("loginSession.updateMany")[0].args.where, { userId: "owner", sessionId: "device-a", status: "ACTIVE", expiresAt: { gt: now } });
  assert.deepEqual(state.audit.map(({ workspaceId }) => workspaceId), ["household", "travel"]);
  assert.ok(state.audit.every(({ actorUserId, action }) => actorUserId === "owner" && action === "SESSION_REVOKED"));
  assert.equal(operation("commit").length, 1);
});

test("revoking another device handles a missing current token and an account without workspaces", async () => {
  state.token = null;
  state.memberships = [];
  const response = await sessions.DELETE(request("DELETE", { sessionId: "device-b" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: true, current: false });
  assert.equal(row("device-b").status, "REVOKED");
  assert.equal(operation("workspaceAuditLog.createMany").length, 0);
});

test("session revocation does not mutate another user's, expired, pending, or missing sessions", async () => {
  state.sessions.push(sessionRow("expired", { expiresAt: now }), sessionRow("revoked", { status: "REVOKED" }));
  const original = structuredClone(state.sessions);
  for (const sessionId of ["foreign", "expired", "pending", "revoked", "missing"]) {
    await rejected(await sessions.DELETE(request("DELETE", { sessionId })), 404, "That session is no longer active.");
  }
  assert.deepEqual(state.sessions, original);
  assert.deepEqual(state.audit, []);
  assert.equal(operation("workspaceMember.findMany").length, 0);
});

test("session revocation rolls back when auditing fails and does not expose database diagnostics", async () => {
  state.failure = "workspaceAuditLog.createMany";
  const original = structuredClone(state.sessions);
  await rejected(await sessions.DELETE(request("DELETE", { sessionId: "device-a" })), 500, "Unable to revoke session");
  assert.deepEqual(state.sessions, original);
  assert.deepEqual(state.audit, []);
  assert.equal(operation("rollback").length, 1);
});

test("linked providers are sorted, deduplicated, bounded, and scoped to the authenticated account", async () => {
  const response = await accounts.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: ["apple", "google"] });
  assert.deepEqual(operation("account.findMany")[0].args, { take: 100, where: { userId: "owner" }, orderBy: { provider: "asc" }, select: { provider: true } });
  state.accounts = [];
  assert.deepEqual(await (await accounts.GET()).json(), { providers: [] });
});

test("linked-provider queries reject unauthenticated callers and redact database failures", async () => {
  state.session = null;
  await rejected(await accounts.GET(), 401, "Unauthorized");
  assert.equal(operation("account.findMany").length, 0);
  state.session = { user: { id: "owner" } };
  state.failure = "account.findMany";
  await rejected(await accounts.GET(), 500, "Unable to load linked accounts");
});
