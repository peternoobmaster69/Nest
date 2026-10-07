import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-07T12:00:00Z");
const calls = [];
let storedUser;
let storedSession;
let activeCount;
let memberships;
let passkeyUser;

const record = (operation, result) => async (options) => {
  calls.push({ operation, options });
  return typeof result === "function" ? result(options) : result;
};
const prisma = {
  user: {
    findUnique: record("user.findUnique", () => storedUser),
    update: record("user.update", () => storedUser),
    updateMany: record("user.updateMany", { count: 1 }),
  },
  loginSession: {
    findUnique: record("loginSession.findUnique", () => storedSession),
    updateMany: record("loginSession.updateMany", { count: 1 }),
    count: record("loginSession.count", () => activeCount),
    create: record("loginSession.create", ({ data }) => data),
  },
  account: { updateMany: record("account.updateMany", { count: 1 }) },
  workspaceMember: { findMany: record("workspaceMember.findMany", () => memberships) },
  workspaceAuditLog: { createMany: record("workspaceAuditLog.createMany", { count: 1 }) },
  $queryRaw: async (strings, userId) => {
    calls.push({ operation: "lockUser", userId });
    assert.match(strings.join("?"), /UPDLOCK, HOLDLOCK/);
    return [];
  },
  $transaction: async (handler) => handler(prisma),
};
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/passkeys.ts", { namedExports: {
  consumePasskeyLoginTicket: record("passkey.consume", () => passkeyUser),
} });
mock.module("../lib/workspace-bootstrap.ts", { namedExports: {
  ensureUserWithDefaultWorkspace: record("workspace.bootstrap", { id: "owner" }),
} });
mock.module("../lib/auth-request-metadata.ts", { namedExports: {
  getAuthRequestMetadata: () => ({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", ipAddress: "192.0.2.1", countryCode: "SG" }),
} });
const configured = new Map();
for (const provider of ["GOOGLE", "APPLE", "FACEBOOK"]) {
  for (const field of ["CLIENT_ID", "CLIENT_SECRET"]) {
    const key = `${provider}_${field}`;
    configured.set(key, process.env[key]);
    process.env[key] = "synthetic-provider-setting";
  }
}
const { authOptions } = require("../lib/auth.ts");
for (const [key, original] of configured) {
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}
const { jwt, signIn, session } = authOptions.callbacks;
beforeEach((context) => {
  context.mock.timers.enable({ apis: ["Date"], now });
  calls.length = 0;
  storedUser = { id: "owner", sessionVersion: 7 };
  storedSession = { userId: "owner", status: "ACTIVE", expiresAt: new Date(now.getTime() + 2 * 86400_000), lastSeenAt: now };
  activeCount = 0;
  memberships = [{ workspaceId: "household" }, { workspaceId: "travel" }];
  passkeyUser = { id: "owner", name: "Nest Owner", email: "owner@example.test", image: null };
});
function token(extra = {}) {
  return { id: "owner", sessionId: "session-one", sessionVersion: 7, authenticatedAt: Math.floor(now.getTime() / 1000), ...extra };
}

test("OAuth sign-in requires a verified provider email and credentials use a single-use passkey ticket", async () => {
  for (const profile of [{ email_verified: true }, { email_verified: "true" }, { verified: true }]) {
    assert.equal(await signIn({ account: { type: "oauth" }, profile }), true);
  }
  for (const profile of [null, {}, { email_verified: false }, { email_verified: "false" }, { verified: "true" }]) {
    assert.equal(await signIn({ account: { type: "oauth" }, profile }), false);
  }
  assert.equal(await signIn({ account: null }), true);
  assert.equal(await signIn({ account: { type: "credentials" } }), true);
  const provider = authOptions.providers.find((entry) => entry.options?.id === "passkey");
  assert.ok(provider);
  assert.equal(await provider.options.authorize(undefined), null);
  assert.equal(await provider.options.authorize({ loginToken: "" }), null);
  assert.equal(calls.length, 0);
  assert.deepEqual(await provider.options.authorize({ loginToken: "single-use-ticket" }), passkeyUser);
  assert.equal(calls.at(-1).options, "single-use-ticket");
  passkeyUser = null;
  assert.equal(await provider.options.authorize({ loginToken: "expired-ticket" }), null);
  assert.ok(["google", "apple", "facebook"].every((id) => authOptions.providers.some((entry) => entry.id === id)));
});

test("new sign-ins serialize session allocation and enforce the five-device limit", async () => {
  for (const [count, status, duration] of [[4, "ACTIVE", 30 * 86400_000], [5, "PENDING", 10 * 60_000]]) {
    calls.length = 0;
    activeCount = count;
    const result = await jwt({ token: {}, user: { id: "owner" }, account: { provider: "google" } });
    assert.equal(calls[0].operation, "lockUser");
    assert.equal(calls[0].userId, "owner");
    assert.equal(result.id, "owner");
    assert.match(result.sessionId, /^[a-f0-9-]{36}$/);
    assert.equal(result.sessionVersion, 7);
    assert.equal(result.revoked, false);
    assert.equal(result.sessionLimitRequired, status === "PENDING");
    assert.equal(result.authenticatedAt, Math.floor(now.getTime() / 1000));
    const data = calls.find(({ operation }) => operation === "loginSession.create").options.data;
    assert.equal(data.status, status);
    assert.equal(data.provider, "google");
    assert.equal(data.ipAddress, "192.0.2.1");
    assert.equal(data.expiresAt.getTime(), now.getTime() + duration);
    const cleanup = calls.find(({ operation }) => operation === "loginSession.updateMany").options;
    assert.deepEqual(cleanup.where, { userId: "owner", status: { in: ["ACTIVE", "PENDING"] }, expiresAt: { lte: now } });
    assert.equal(cleanup.data.status, "REVOKED");
    assert.ok(calls.some(({ operation }) => operation === "user.update"));
  }
});

test("legacy JWTs gain a session without recording a new sign-in, and deleted users remain revoked", async () => {
  const anonymous = {};
  assert.equal(await jwt({ token: anonymous }), anonymous);
  assert.equal(calls.length, 0);
  const result = await jwt({ token: { id: "owner" } });
  assert.ok(result.sessionId);
  assert.equal(calls.find(({ operation }) => operation === "loginSession.create").options.data.provider, null);
  assert.ok(!calls.some(({ operation }) => operation === "user.update"));
  calls.length = 0;
  storedUser = null;
  const rejected = await jwt({ token: {}, user: { id: "deleted-user" } });
  assert.equal(rejected.revoked, true);
  assert.equal(rejected.sessionLimitRequired, false);
  assert.equal(rejected.sessionVersion, 0);
  assert.ok(!calls.some(({ operation }) => operation === "loginSession.create"));
});

test("session refresh rejects deleted users, changed versions, missing sessions, and another user's session", async () => {
  for (const kind of ["deleted-user", "changed-version", "missing-session", "other-user"]) {
    storedUser = kind === "deleted-user" ? null : { sessionVersion: kind === "changed-version" ? 8 : 7 };
    storedSession = kind === "missing-session" ? null : { userId: kind === "other-user" ? "other-owner" : "owner" };
    const result = await jwt({ token: token({ sessionLimitRequired: true }) });
    assert.equal(result.revoked, true, kind);
    assert.equal(result.sessionLimitRequired, false, kind);
  }
  storedUser = null;
  storedSession = { userId: "owner" };
  assert.equal((await jwt({ token: token({ sessionVersion: undefined }) })).revoked, true);
});

test("expired sessions are revoked once, pending sessions are restricted, and unknown statuses fail closed", async () => {
  for (const status of ["ACTIVE", "REVOKED"]) {
    calls.length = 0;
    storedSession = { ...storedSession, status, expiresAt: new Date(now.getTime() - 1) };
    const result = await jwt({ token: token() });
    assert.equal(result.revoked, true);
    assert.equal(result.sessionLimitRequired, false);
    assert.equal(calls.filter(({ operation }) => operation === "loginSession.updateMany").length, status === "REVOKED" ? 0 : 1);
  }
  storedSession = { ...storedSession, status: "PENDING", expiresAt: new Date(now.getTime() + 60_000) };
  const pending = await jwt({ token: token() });
  assert.equal(pending.revoked, false);
  assert.equal(pending.sessionLimitRequired, true);
  storedSession.status = "unexpected";
  assert.equal((await jwt({ token: token() })).revoked, true);
});

test("healthy active sessions renew only when expiring or due for an activity update", async () => {
  assert.equal((await jwt({ token: token() })).revoked, false);
  assert.ok(!calls.some(({ operation }) => operation === "loginSession.updateMany"));
  for (const change of [{ expiresAt: new Date(now.getTime() + 86400_000) }, { lastSeenAt: new Date(now.getTime() - 15 * 60_000) }]) {
    calls.length = 0;
    storedSession = { userId: "owner", status: "ACTIVE", expiresAt: new Date(now.getTime() + 2 * 86400_000), lastSeenAt: now, ...change };
    const result = await jwt({ token: token() });
    assert.equal(result.revoked, false);
    const update = calls.find(({ operation }) => operation === "loginSession.updateMany").options;
    assert.deepEqual(update.where, { sessionId: "session-one", userId: "owner", status: "ACTIVE" });
    assert.equal(update.data.lastSeenAt.getTime(), now.getTime());
    assert.equal(update.data.expiresAt.getTime(), now.getTime() + 30 * 86400_000);
  }
});

test("client sessions hide the user while revoked or awaiting device approval", async () => {
  for (const flags of [{ revoked: true }, { sessionLimitRequired: true }, { revoked: true, sessionLimitRequired: true }]) {
    const result = await session({ session: { user: { name: "Owner" } }, token: token(flags) });
    assert.equal(result.user, undefined);
    assert.equal(result.sessionLimitRequired, Boolean(flags.sessionLimitRequired && !flags.revoked));
  }
  for (const [identity, adapterUser, expected] of [[token(), undefined, "owner"], [{ sub: "legacy-owner" }, undefined, "legacy-owner"], [{}, { id: "adapter-owner" }, "adapter-owner"], [{}, undefined, ""]]) {
    const result = await session({ session: { user: {} }, token: identity, user: adapterUser });
    assert.equal(result.user.id, expected);
    assert.equal(result.user.authenticatedAt, identity.authenticatedAt ?? 0);
  }
  assert.equal((await session({ session: {}, token: token() })).user, undefined);
});

test("linking an account removes provider tokens and records an audit in every workspace", async () => {
  await authOptions.events.linkAccount({ user: { id: "owner" }, account: { provider: "google", providerAccountId: "google-owner" } });
  const update = calls.find(({ operation }) => operation === "account.updateMany").options;
  assert.deepEqual(update.where, { provider: "google", providerAccountId: "google-owner", userId: "owner" });
  assert.deepEqual(update.data, { access_token: null, refresh_token: null, id_token: null, session_state: null });
  const audit = calls.find(({ operation }) => operation === "workspaceAuditLog.createMany").options.data;
  assert.deepEqual(audit.map(({ workspaceId }) => workspaceId), ["household", "travel"]);
  assert.ok(audit.every(({ actorUserId, action }) => actorUserId === "owner" && action === "AUTH_ACCOUNT_LINKED"));
  calls.length = 0;
  memberships = [];
  await authOptions.events.linkAccount({ user: { id: "owner" }, account: { provider: "apple", providerAccountId: "apple-owner" } });
  assert.ok(!calls.some(({ operation }) => operation === "workspaceAuditLog.createMany"));
});

test("verified sign-ins bootstrap the owner workspace and passkey sign-ins leave email verification unchanged", async () => {
  await authOptions.events.signIn({ user: {}, account: null });
  assert.equal(calls.length, 0);
  const user = { id: "owner", email: "owner@example.test", name: "Owner" };
  await authOptions.events.signIn({ user, account: { type: "oauth" } });
  assert.deepEqual(calls.find(({ operation }) => operation === "user.updateMany").options.where, { id: "owner", emailVerified: null });
  assert.deepEqual(calls.find(({ operation }) => operation === "workspace.bootstrap").options, user);
  for (const account of [null, { type: "credentials" }]) {
    calls.length = 0;
    await authOptions.events.signIn({ user, account });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operation, "workspace.bootstrap");
  }
});

test("sign-out revokes only the current user's active or pending session", async () => {
  for (const incomplete of [{}, { id: "owner" }, { sessionId: "session-one" }]) {
    await authOptions.events.signOut({ token: incomplete });
  }
  assert.equal(calls.length, 0);
  await authOptions.events.signOut({ token: token() });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, {
    where: { userId: "owner", sessionId: "session-one", status: { in: ["ACTIVE", "PENDING"] } },
    data: { status: "REVOKED", revokedAt: now },
  });
});
