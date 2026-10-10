import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { afterEach, beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-10T08:00:00Z");
const calls = [];
const events = [];
const models = [
  "user", "workspace", "workspaceMember", "budgetEnvelope", "budgetSource", "monthlyBudgetSource", "monthlyBudgetPlanSource",
  "workspaceAuditLog", "workspaceInvite", "note", "receivable", "transaction", "postingGroup", "backgroundJob", "integrationOAuthState",
  "transactionAgentDraft", "financialAccount", "creditCardAccount", "creditCardTransaction", "investmentAccount", "investmentEntry",
  "frequentFlyerAccount", "hotelRewardAccount", "creditCardReward", "mileProgram", "mileRedemption", "mileRedemptionDetail",
  "inAppNotification", "passkeyCredential", "loginSession",
];
const originalOrigin = process.env.NEXTAUTH_URL;
let tables, session, failOperation, inTransaction;

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "workspaceId_userId") return matches(row, value);
    if (value && typeof value === "object") {
      if ("in" in value) return value.in.includes(row[key]);
      if ("not" in value) return row[key] !== value.not;
      return matches(row[key], value);
    }
    return row[key] === value;
  });
}
function select(row, fields) {
  if (row === null) return null;
  if (!fields) return structuredClone(row);
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [
    key, value === true ? row[key] : select(row[key], value.select),
  ]));
}
function operation(model, method) {
  return async (options) => {
    const name = `${model}.${method}`;
    calls.push({ name, options, inTransaction });
    if (name === failOperation) throw new Error("Synthetic database failure");
    const rows = tables.get(model);
    const selected = rows.filter((row) => matches(row, options.where));
    if (method === "findMany") {
      if (options.orderBy?.id) selected.sort((a, b) => a.id.localeCompare(b.id));
      const offset = options.cursor ? selected.findIndex((row) => row.id === options.cursor.id) + options.skip : 0;
      return selected.slice(offset, offset + options.take).map((row) => select(row, options.select));
    }
    if (method === "findUnique" || method === "findFirst") return select(selected[0] ?? null, options.select);
    if (method === "update" || method === "updateMany") {
      for (const row of selected) Object.assign(row, options.data);
      return method === "update" ? select(selected[0], options.select) : { count: selected.length };
    }
    if (method === "createMany") { rows.push(...structuredClone(options.data)); return { count: options.data.length }; }
    if (method === "delete" && model === "user") {
      assert.ok(!tables.get("transactionAgentDraft").some((draft) => draft.userId === options.where.id), "Draft foreign keys still reference the account");
    }
    tables.set(model, rows.filter((row) => !selected.includes(row)));
    return method === "delete" ? selected[0] : { count: selected.length };
  };
}
const prisma = Object.fromEntries(models.map((model) => [model, Object.fromEntries(
  ["findUnique", "findFirst", "findMany", "update", "updateMany", "createMany", "delete", "deleteMany"].map((method) => [method, operation(model, method)]),
)]));
prisma.$transaction = async (action, options) => {
  calls.push({ name: "transaction.begin", options });
  const snapshot = structuredClone(tables);
  inTransaction = true;
  try { return await action(prisma); }
  catch (error) { tables = snapshot; throw error; }
  finally { inTransaction = false; }
};
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/server-session.ts", { namedExports: { getDatabaseReadyServerSession: async () => session } });
mock.module("next/headers", { namedExports: {
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
} });
mock.module("../lib/observability/logger.ts", { namedExports: { logEvent: (...args) => events.push(args) } });
const { PATCH, DELETE } = require("../app/api/profile/route.ts");
const { GET } = require("../app/api/profile/export/route.ts");

function user(extra = {}) {
  return { id: "departing", name: "Original name", email: "departing@example.test", emailVerified: now, image: null,
    activeWorkspaceId: "household", createdAt: now, updatedAt: now, sessionVersion: 5, ...extra };
}
function membership(workspaceId = "household", userId = "departing", role = "OWNER", extra = {}) {
  return { id: `${workspaceId}-${userId}`, workspaceId, userId, role, createdAt: now, workspace: { name: workspaceId }, ...extra };
}
function request(method = "GET", body, headers = {}) {
  return new Request(`https://nest.example.test/api/profile${method === "GET" ? "/export" : ""}`, {
    method, headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function verifyHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
  assert.match(response.headers.get("vary"), /Cookie/);
}
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  process.env.NEXTAUTH_URL = "https://nest.example.test";
  calls.length = 0;
  events.length = 0;
  tables = new Map(models.map((model) => [model, []]));
  tables.set("user", [user(), user({ id: "another", email: "another@example.test" })]);
  tables.set("workspaceMember", [membership(), membership("household", "replacement")]);
  tables.set("workspace", [{ id: "household", name: "Household" }]);
  session = { user: { id: "departing", authenticatedAt: Math.floor(now.getTime() / 1000) } };
  failOperation = null;
  inTransaction = false;
});
afterEach(() => {
  if (originalOrigin === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalOrigin;
});

test("profile edits trim before validating so whitespace never replaces a user's name", async () => {
  const response = await PATCH(request("PATCH", { name: " \t \n " }));
  assert.equal(response.status, 422);
  assert.equal(tables.get("user")[0].name, "Original name");
  assert.ok(!calls.some(({ name }) => name === "user.update"));
  verifyHeaders(response);
});

test("profile edits use the signed-in user and return only public profile fields", async () => {
  session.user.authenticatedAt = 1;
  const response = await PATCH(request("PATCH", { name: "  New name  ", id: "another", email: "injected@example.test" }));
  assert.equal(response.status, 200);
  verifyHeaders(response);
  assert.deepEqual(await response.json(), { id: "departing", name: "New name", email: "departing@example.test" });
  assert.equal(tables.get("user")[1].name, "Original name");
  assert.ok(!calls.some(({ name }) => name.startsWith("workspace")));
});

for (const method of ["PATCH", "DELETE"]) {
  test(`${method} profile requests reject cross-origin writes before querying the database`, async () => {
    const handler = method === "PATCH" ? PATCH : DELETE;
    const response = await handler(request(method, { name: "Changed", confirmation: "DELETE MY ACCOUNT" }, { origin: "https://attacker.example.test" }));
    assert.equal(response.status, 403);
    verifyHeaders(response);
    assert.equal(calls.length, 0);
  });
}

for (const [method, handler, body] of [["PATCH", PATCH, { name: "Name" }], ["DELETE", DELETE, { confirmation: "DELETE MY ACCOUNT" }], ["GET", GET, undefined]]) {
  test(`${method} rejects an expired session without reading private records`, async () => {
    session = null;
    const response = await handler(request(method, body));
    assert.equal(response.status, 401);
    verifyHeaders(response);
    assert.equal(calls.length, 0);
  });
}

for (const [method, handler] of [["DELETE", DELETE], ["GET", GET]]) {
  test(`${method} requires a recent login even when a workspace is accessible`, async () => {
    session.user.authenticatedAt -= 601;
    const response = await handler(request(method, method === "DELETE" ? { confirmation: "DELETE MY ACCOUNT" } : undefined));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "Recent authentication required");
    assert.ok(!calls.some(({ name }) => name === "user.delete"));
  });

  test(`${method} works for a recently authenticated account with no workspace`, async () => {
    tables.get("user")[0].activeWorkspaceId = null;
    tables.set("workspaceMember", []);
    const response = await handler(request(method, method === "DELETE" ? { confirmation: "DELETE MY ACCOUNT" } : undefined));
    assert.equal(response.status, 200);
    verifyHeaders(response);
    const body = await response.json();
    if (method === "DELETE") assert.deepEqual(body, { ok: true });
    else {
      assert.equal(body.profile.id, "departing");
      assert.deepEqual(body.memberships, []);
      assert.deepEqual(body.workspaces, []);
      assert.deepEqual(body.finance.transactions, []);
    }
  });
}

test("profile validation handles malformed, oversized, and unsupported request bodies", async () => {
  for (const [body, headers, status] of [
    ["{", {}, 400], ["{}", { "content-type": "text/plain" }, 415],
    [JSON.stringify({ name: "a".repeat(2048) }), {}, 413],
    [JSON.stringify({ name: "Name" }), { "content-length": "2048" }, 413],
    [JSON.stringify({ name: "a".repeat(121) }), {}, 422], [JSON.stringify({ name: 42 }), {}, 422],
  ]) {
    const response = await PATCH(new Request("https://nest.example.test/api/profile", {
      method: "PATCH", headers: { "content-type": "application/json", ...headers }, body,
    }));
    assert.equal(response.status, status);
    verifyHeaders(response);
  }
  assert.ok(!calls.some(({ name }) => name === "user.update"));
});

test("deletion requires exact confirmation and rejects additional fields", async () => {
  for (const confirmation of ["delete my account", "DELETE MY ACCOUNT ", ""]) {
    assert.equal((await DELETE(request("DELETE", { confirmation }))).status, 422);
  }
  assert.equal((await DELETE(request("DELETE", { confirmation: "DELETE MY ACCOUNT", userId: "another" }))).status, 422);
  assert.ok(!calls.some(({ name }) => name === "user.delete"));
});

test("a sole workspace owner receives the workspace list before any record changes", async () => {
  tables.set("workspaceMember", [membership(), membership("household", "member", "MEMBER")]);
  const response = await DELETE(request("DELETE", { confirmation: "DELETE MY ACCOUNT" }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "SOLE_WORKSPACE_OWNER");
  assert.deepEqual(body.workspaces, [{ id: "household", name: "household" }]);
  assert.ok(calls.every(({ name }) => /find/.test(name) || name === "transaction.begin"));
});

test("records in a former workspace block deletion until they can be transferred", async () => {
  tables.set("budgetSource", [{ id: "orphan-source", ownerId: "departing", workspaceId: "former" }]);
  tables.get("workspace").push({ id: "former", name: "Former workspace" });
  const response = await DELETE(request("DELETE", { confirmation: "DELETE MY ACCOUNT" }));
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).workspaces, [{ id: "former", name: "Former workspace" }]);
  assert.ok(!calls.some(({ name }) => name === "user.delete"));
});

test("deletion transfers all financial ownership, anonymizes shared records, and preserves other users", async () => {
  tables.set("workspaceMember", [membership(), membership("household", "earlier-editor", "EDITOR"),
    membership("household", "replacement"), membership("household", "later-editor", "VIEWER"),
    membership("other", "departing", "MEMBER"), membership("other", "other-editor", "EDITOR")]);
  tables.set("budgetEnvelope", [{ id: "budget", workspaceId: "household", createdById: "departing" }]);
  for (const model of ["budgetSource", "monthlyBudgetSource"]) tables.set(model, [{ id: model, workspaceId: "other", ownerId: "departing" }]);
  tables.set("monthlyBudgetPlanSource", [{ id: "plan-source", plan: { workspaceId: "household" }, ownerId: "departing" }]);
  for (const [model, field] of [["note", "createdById"], ["workspaceAuditLog", "actorUserId"], ["postingGroup", "actorUserId"],
    ["backgroundJob", "userId"], ["transaction", "voidedByUserId"]]) {
    tables.set(model, [{ id: "departing-record", [field]: "departing" }, { id: "other-record", [field]: "another" }]);
  }
  tables.set("receivable", [{ id: "out", fromUserId: "departing", toUserId: "another" }, { id: "in", fromUserId: "another", toUserId: "departing" }]);
  tables.set("workspaceInvite", [{ id: "sent", invitedById: "departing" }, { id: "received", invitedById: "another", invitedUserId: "departing" }]);
  tables.set("integrationOAuthState", [{ id: "oauth", userId: "departing" }, { id: "other-oauth", userId: "another" }]);
  tables.set("transactionAgentDraft", [{ id: "draft", userId: "departing" }, { id: "other-draft", userId: "another" }]);
  const response = await DELETE(request("DELETE", { confirmation: "DELETE MY ACCOUNT" }));
  assert.equal(response.status, 200);
  assert.equal(tables.get("budgetEnvelope")[0].createdById, "replacement");
  assert.equal(tables.get("monthlyBudgetPlanSource")[0].ownerId, "replacement");
  assert.equal(tables.get("budgetSource")[0].ownerId, "other-editor");
  assert.equal(tables.get("monthlyBudgetSource")[0].ownerId, "other-editor");
  assert.deepEqual(tables.get("user").map(({ id }) => id), ["another"]);
  assert.deepEqual(tables.get("transactionAgentDraft").map(({ id }) => id), ["other-draft"]);
  assert.deepEqual(tables.get("integrationOAuthState").map(({ id }) => id), ["other-oauth"]);
  assert.deepEqual(tables.get("workspaceInvite"), [{ id: "received", invitedById: "another", invitedUserId: null }]);
  assert.deepEqual(tables.get("receivable"), [{ id: "out", fromUserId: null, toUserId: "another" }, { id: "in", fromUserId: "another", toUserId: null }]);
  for (const [model, field] of [["note", "createdById"], ["workspaceAuditLog", "actorUserId"], ["postingGroup", "actorUserId"], ["backgroundJob", "userId"], ["transaction", "voidedByUserId"]]) {
    assert.equal(tables.get(model)[0][field], null);
    assert.equal(tables.get(model)[1][field], "another");
  }
  const audit = tables.get("workspaceAuditLog").filter(({ action }) => action === "ACCOUNT_DELETED");
  assert.equal(audit.length, 2);
  assert.ok(audit.every(({ actorUserId }) => actorUserId === null));
  assert.ok(calls.filter(({ name }) => /update|delete|create/.test(name)).every(({ inTransaction }) => inTransaction));
});

test("a failed account deletion rolls back ownership transfers and audit changes", async () => {
  tables.set("budgetSource", [{ id: "source", workspaceId: "household", ownerId: "departing" }]);
  failOperation = "user.delete";
  const snapshot = structuredClone(tables);
  const response = await DELETE(request("DELETE", { confirmation: "DELETE MY ACCOUNT" }));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "Failed to delete account");
  assert.deepEqual(tables, snapshot);
  verifyHeaders(response);
});

test("account exports paginate without duplicates, scope dependent records, and omit credentials", async () => {
  tables.set("workspaceMember", [membership(), membership("travel"), membership("secret", "another")]);
  tables.set("workspace", [{ id: "household", name: "Home" }, { id: "travel", name: "Travel" }, { id: "secret", name: "Secret" }]);
  const transactionRows = Array.from({ length: 1000 }, (_, index) => ({ id: `tx-${String(index).padStart(4, "0")}`, workspaceId: index % 2 ? "travel" : "household", amountCents: index }));
  tables.set("transaction", [...transactionRows, { id: "private", workspaceId: "secret" }]);
  tables.set("investmentAccount", [{ id: "account-one", workspaceId: "household" }, { id: "empty-account", workspaceId: "travel" }]);
  tables.set("investmentEntry", [{ id: "entry-one", accountId: "account-one" }, { id: "entry-two", accountId: "account-one" }, { id: "other-entry", accountId: "private-account" }]);
  tables.set("mileRedemption", [{ id: "redemption-one", workspaceId: "household" }, { id: "empty-redemption", workspaceId: "travel" }]);
  tables.set("mileRedemptionDetail", [{ id: "detail-one", redemptionId: "redemption-one" }, { id: "detail-two", redemptionId: "redemption-one" }, { id: "private-detail", redemptionId: "private-redemption" }]);
  tables.set("passkeyCredential", [{ id: "passkey", userId: "departing", name: "Phone", credentialId: "hidden-id", publicKey: "hidden-key" }]);
  tables.set("loginSession", [{ id: "session", userId: "departing", deviceName: "Phone", sessionToken: "hidden-session" }]);
  const response = await GET(request());
  assert.equal(response.status, 200);
  verifyHeaders(response);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="nest-export-2026-10-10.json"');
  const raw = await response.text();
  assert.doesNotMatch(raw, /hidden-|sessionVersion|private-account|private-detail|private-redemption/);
  const body = JSON.parse(raw);
  assert.equal(body.format, "nest-account-export");
  assert.equal(body.version, 1);
  assert.equal(body.exportedAt, now.toISOString());
  assert.equal(body.memberships.length, 2);
  assert.deepEqual(body.workspaces.map(({ id }) => id), ["household", "travel"]);
  assert.deepEqual(body.finance.transactions, transactionRows);
  assert.deepEqual(body.finance.investments.find(({ id }) => id === "account-one").entries.map(({ id }) => id), ["entry-one", "entry-two"]);
  assert.deepEqual(body.finance.investments.find(({ id }) => id === "empty-account").entries, []);
  assert.deepEqual(body.finance.rewards.mileRedemptions.find(({ id }) => id === "redemption-one").details.map(({ id }) => id), ["detail-one", "detail-two"]);
  assert.deepEqual(body.finance.rewards.mileRedemptions.find(({ id }) => id === "empty-redemption").details, []);
  const pages = calls.filter(({ name }) => name === "transaction.findMany");
  assert.deepEqual(pages.map(({ options }) => [options.take, options.cursor?.id, options.skip]), [[500, undefined, undefined], [500, "tx-0499", 1], [500, "tx-0999", 1]]);
  for (const model of ["financialAccount", "budgetEnvelope", "creditCardAccount", "creditCardTransaction", "receivable", "frequentFlyerAccount", "hotelRewardAccount", "creditCardReward", "mileProgram", "note"]) {
    assert.deepEqual(calls.find(({ name }) => name === `${model}.findMany`).options.where, { workspaceId: { in: ["household", "travel"] } });
  }
});

test("export returns a private 404 for a deleted account and masks database failures", async () => {
  tables.set("user", []);
  let response = await GET(request());
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Account not found");
  verifyHeaders(response);
  tables.set("user", [user()]);
  failOperation = "transaction.findMany";
  response = await GET(request());
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "Failed to export account data");
});

test("profile update failures return a private, correlated error", async () => {
  failOperation = "user.update";
  const response = await PATCH(request("PATCH", { name: "New name" }));
  assert.equal(response.status, 500);
  verifyHeaders(response);
  assert.equal((await response.json()).error, "Failed to update profile");
});
