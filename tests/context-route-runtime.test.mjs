import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";
import { normalizeWorkspaceRole } from "../lib/workspace-roles.ts";

const require = createRequire(import.meta.url);
const calls = [];
const accessChecks = [];
const events = [];
let fixtures;
let cookieWorkspaceId;
let sessionError;
let accessError;
let serverSession;

class ApiAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function databaseCall(operation) {
  return async (options) => {
    calls.push({ operation, options });
    assert.ok(fixtures.has(operation), `Unexpected database call: ${operation}`);
    const value = fixtures.get(operation);
    if (value instanceof Error) throw value;
    return typeof value === "function" ? value(options) : value;
  };
}

const prisma = Object.fromEntries(Object.entries({
  user: ["findUnique"],
  workspace: ["findUnique", "update"],
  workspaceMember: ["findMany"],
  workspaceInvite: ["count"],
  financialAccount: ["findFirst"],
  budgetEnvelope: ["findFirst"],
}).map(([model, operations]) => [model, Object.fromEntries(operations.map((operation) => [operation, databaseCall(`${model}.${operation}`)]))]));

async function requireAccess(workspaceId, minimumRole) {
  accessChecks.push({ workspaceId, minimumRole });
  if (accessError) throw accessError;
  return { workspaceId, userId: "owner", role: "OWNER" };
}
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("next/headers", { namedExports: {
  cookies: async () => ({ get: () => cookieWorkspaceId ? { value: cookieWorkspaceId } : undefined }),
} });
mock.module("../lib/workspace-auth.ts", { namedExports: {
  ApiAuthError,
  normalizeWorkspaceRole,
  requireSessionUserId: async () => { if (sessionError) throw sessionError; return "owner"; },
  requireRecentAuthentication: async () => "owner",
  requireWorkspaceAccess: requireAccess,
  requireWorkspaceRole: requireAccess,
} });
mock.module("../lib/server-session.ts", { namedExports: {
  getDatabaseReadyServerSession: async () => serverSession,
} });
mock.module("../lib/observability/logger.ts", { namedExports: { logEvent: (...args) => events.push(args) } });
const { GET, PATCH } = require("../app/api/context/route.ts");

function workspace(id = "workspace-one", extra = {}) {
  return {
    id, name: id === "workspace-one" ? "Household" : "Travel", baseCurrency: "SGD",
    receivableDefaultAccountId: "bank-one", receivableDefaultBudgetId: "food",
    isShared: true, sidebarMoneyPages: null, publicNetWorthEnabled: true, publicNetWorthToken: "owner-only-token",
    financials: [{ id: "bank-one", name: "Daily bank", kind: "BANK" }, { id: "investment", name: "Broker", kind: "INVESTMENT" }],
    members: [{ userId: "owner" }], _count: { members: 2 }, ...extra,
  };
}
function membership(workspaceId = "workspace-one", role = "OWNER") {
  return { workspaceId, role, workspace: {
    id: workspaceId, name: workspaceId === "workspace-one" ? "Household" : "Travel",
    _count: { budgetEnvelopes: 3, creditCards: 2 },
  } };
}
function request(method = "GET", body, headers = {}) {
  return new Request("https://nest.example.test/api/context", {
    method, headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function verifyHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
  assert.match(response.headers.get("vary"), /Cookie/);
}
beforeEach(() => {
  calls.length = 0;
  accessChecks.length = 0;
  events.length = 0;
  cookieWorkspaceId = null;
  sessionError = null;
  accessError = null;
  serverSession = { user: { id: "owner", email: "owner@example.test" } };
  fixtures = new Map([
    ["user.findUnique", { id: "owner", activeWorkspaceId: "workspace-one" }],
    ["workspaceMember.findMany", [membership(), membership("workspace-two")]],
    ["workspace.findUnique", ({ where }) => workspace(where.id)],
    ["workspaceInvite.count", 4],
    ["financialAccount.findFirst", { id: "bank-two" }],
    ["budgetEnvelope.findFirst", { id: "travel", accountId: "bank-two" }],
    ["workspace.update", ({ where, data }) => ({ ...workspace(where.id), ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) })],
  ]);
});

test("workspace context returns owner setup information and correlates every query with the response", async () => {
  const response = await GET(request());
  assert.equal(response.status, 200);
  verifyHeaders(response);
  const body = await response.json();
  assert.equal(body.workspaceId, "workspace-one");
  assert.equal(body.workspaceName, "Household");
  assert.equal(body.role, "OWNER");
  assert.equal(body.isCollaborative, true);
  assert.equal(body.pendingInviteCount, 4);
  assert.equal(body.publicNetWorthToken, "owner-only-token");
  assert.deepEqual(body.setupProgress, { bankAccountCount: 1, subAccountCount: 3, creditCardCount: 2 });
  assert.deepEqual(body.accounts, workspace().financials);
  assert.equal(body.workspaces.length, 2);
  assert.match(response.headers.get("set-cookie"), /nest-active-workspace=workspace-one/);
  assert.ok(events.every(([, , fields]) => fields.requestId === response.headers.get("x-request-id")));
  assert.equal(events.filter(([, event]) => event === "database.query_group").length, 2);
});

test("an explicit workspace is authorized and takes precedence without overwriting the active tab cookie", async () => {
  cookieWorkspaceId = "workspace-one";
  const response = await GET(request("GET", undefined, { "x-workspace-id": " workspace-two " }));
  assert.equal((await response.json()).workspaceId, "workspace-two");
  assert.deepEqual(accessChecks, [{ workspaceId: "workspace-two", minimumRole: undefined }]);
  assert.equal(response.headers.get("set-cookie"), null);
  const lookup = calls.find(({ operation }) => operation === "workspace.findUnique");
  assert.deepEqual(lookup.options.where, { id: "workspace-two" });
});

test("the tab cookie overrides the user default, and an expired membership falls back to an accessible workspace", async () => {
  cookieWorkspaceId = "workspace-two";
  let response = await GET(request());
  assert.equal((await response.json()).workspaceId, "workspace-two");
  assert.equal(response.headers.get("set-cookie"), null);
  cookieWorkspaceId = "removed-workspace";
  response = await GET(request());
  assert.equal((await response.json()).workspaceId, "workspace-one");
  assert.match(response.headers.get("set-cookie"), /nest-active-workspace=workspace-one/);
});

for (const role of ["VIEWER", "MEMBER"]) {
  test(`${role.toLowerCase()} context hides owner-only sharing details`, async () => {
    fixtures.set("workspaceMember.findMany", [membership("workspace-one", role)]);
    const response = await GET(request());
    const body = await response.json();
    assert.equal(body.role, role === "MEMBER" ? "EDITOR" : "VIEWER");
    assert.equal(body.pendingInviteCount, 0);
    assert.equal(body.publicNetWorthEnabled, false);
    assert.equal(body.publicNetWorthToken, null);
  });
}

test("workspace preferences recover from malformed JSON and retain valid visibility options", async () => {
  for (const [sidebarMoneyPages, expected] of [["bad-json", true], ["", true], ['{"transactions":false}', false]]) {
    fixtures.set("workspace.findUnique", workspace("workspace-one", { sidebarMoneyPages, baseCurrency: "", members: [] }));
    const body = await (await GET(request())).json();
    assert.equal(body.sidebarMoneyPages.transactions, expected);
    assert.equal(body.baseCurrency, "SGD");
    assert.equal(body.defaultUserId, null);
  }
});

test("missing memberships and deleted workspaces return an empty setup without creating records", async () => {
  fixtures.set("workspaceMember.findMany", []);
  let response = await GET(request());
  verifyHeaders(response);
  let body = await response.json();
  assert.equal(body.workspaceId, null);
  assert.deepEqual(body.workspaces, []);
  assert.deepEqual(body.accounts, []);
  assert.deepEqual(body.setupProgress, { bankAccountCount: 0, subAccountCount: 0, creditCardCount: 0 });
  fixtures.set("workspaceMember.findMany", [membership()]);
  fixtures.set("workspace.findUnique", null);
  response = await GET(request());
  body = await response.json();
  assert.equal(body.workspaceId, null);
  assert.equal(body.workspaces.length, 1);
  assert.ok(calls.every(({ operation }) => !operation.endsWith("update")));
});

test("context denies expired sessions and inaccessible tenants before looking up private workspace data", async () => {
  for (const status of [401, 403, 404]) {
    calls.length = 0;
    sessionError = new ApiAuthError(status, status === 401 ? "Unauthorized" : "Forbidden");
    const response = await GET(request());
    assert.equal(response.status, status === 404 ? 200 : status);
    verifyHeaders(response);
    assert.equal(calls.length, 0);
  }
  sessionError = null;
  fixtures.set("user.findUnique", null);
  assert.equal((await GET(request())).status, 401);
  fixtures.set("user.findUnique", { id: "owner" });
  calls.length = 0;
  accessError = new ApiAuthError(403, "Forbidden");
  assert.equal((await GET(request("GET", undefined, { "x-workspace-id": "other-tenant" }))).status, 403);
  assert.ok(!calls.some(({ operation }) => operation === "workspace.findUnique"));
});

test("context failure responses preserve cache protection and never disclose database diagnostics", async () => {
  for (const [error, status] of [[Object.assign(new Error("private connection information"), { code: "P1001" }), 503], [new Error("private query information"), 500]]) {
    fixtures.set("user.findUnique", error);
    const response = await GET(request());
    assert.equal(response.status, status);
    verifyHeaders(response);
    assert.doesNotMatch(await response.text(), /private (connection|query)/);
  }
});

test("changing the current tab workspace sets a cookie only after verifying access", async () => {
  const response = await PATCH(request("PATCH", { activeWorkspaceId: "workspace-two" }));
  assert.equal(response.status, 200);
  verifyHeaders(response);
  assert.deepEqual(accessChecks, [{ workspaceId: "workspace-two", minimumRole: undefined }]);
  assert.equal(calls.length, 0);
  assert.match(response.headers.get("set-cookie"), /nest-active-workspace=workspace-two/);
  assert.equal((await response.json()).activeWorkspaceId, "workspace-two");
  accessError = new ApiAuthError(403, "Forbidden");
  const denied = await PATCH(request("PATCH", { activeWorkspaceId: "private-workspace" }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("set-cookie"), null);
});

test("only owners can change defaults, and each referenced account is checked within that workspace", async () => {
  const response = await PATCH(request("PATCH", {
    workspaceId: "workspace-one", baseCurrency: "USD", receivableDefaultAccountId: "bank-two", receivableDefaultBudgetId: "travel",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(accessChecks, [{ workspaceId: "workspace-one", minimumRole: "OWNER" }]);
  assert.deepEqual(calls.find(({ operation }) => operation === "financialAccount.findFirst").options.where,
    { id: "bank-two", workspaceId: "workspace-one", kind: "BANK", isActive: true });
  assert.deepEqual(calls.find(({ operation }) => operation === "budgetEnvelope.findFirst").options.where,
    { id: "travel", workspaceId: "workspace-one", isActive: true });
  assert.deepEqual(await response.json(), {
    workspaceId: "workspace-one", baseCurrency: "USD", defaultAccountId: "bank-two", defaultBudgetId: "travel", activeWorkspaceId: null,
  });
  accessError = new ApiAuthError(403, "Forbidden");
  calls.length = 0;
  assert.equal((await PATCH(request("PATCH", { workspaceId: "workspace-one", baseCurrency: "EUR" }))).status, 403);
  assert.equal(calls.length, 0);
});

test("changing or clearing a bank clears its old subaccount while a currency-only edit preserves defaults", async () => {
  for (const accountId of ["bank-two", null]) {
    const response = await PATCH(request("PATCH", { workspaceId: "workspace-one", receivableDefaultAccountId: accountId }));
    const body = await response.json();
    assert.equal(body.defaultAccountId, accountId);
    assert.equal(body.defaultBudgetId, null);
  }
  const response = await PATCH(request("PATCH", { workspaceId: "workspace-one", baseCurrency: "EUR" }));
  const body = await response.json();
  assert.equal(body.defaultAccountId, "bank-one");
  assert.equal(body.defaultBudgetId, "food");
});

for (const [label, operation, value, payload, status] of [
  ["deleted workspace", "workspace.findUnique", null, { baseCurrency: "USD" }, 404],
  ["unavailable account", "financialAccount.findFirst", null, { receivableDefaultAccountId: "bank-two" }, 400],
  ["unavailable subaccount", "budgetEnvelope.findFirst", null, { receivableDefaultBudgetId: "travel" }, 400],
  ["subaccount in another bank", "budgetEnvelope.findFirst", { id: "travel", accountId: "different-bank" }, { receivableDefaultBudgetId: "travel" }, 400],
]) {
  test(`workspace defaults reject a ${label} without writing`, async () => {
    fixtures.set(operation, value);
    const response = await PATCH(request("PATCH", { workspaceId: "workspace-one", ...payload }));
    assert.equal(response.status, status);
    verifyHeaders(response);
    assert.ok(!calls.some(({ operation: called }) => called === "workspace.update"));
  });
}

test("invalid context changes and cross-origin requests cannot touch persisted defaults", async () => {
  for (const payload of [null, { baseCurrency: "INVALID" }, { workspaceId: "" }]) {
    assert.equal((await PATCH(request("PATCH", payload))).status, 400);
  }
  assert.equal((await PATCH(request("PATCH", { workspaceId: "workspace-one", baseCurrency: "USD" }, { origin: "https://other.example.test" }))).status, 403);
  assert.equal(calls.length, 0);
  assert.equal(accessChecks.length, 0);
});

test("failed context updates return a traceable generic error", async () => {
  fixtures.set("workspace.update", new Error("private update diagnostic"));
  const response = await PATCH(request("PATCH", { workspaceId: "workspace-one", baseCurrency: "EUR" }));
  assert.equal(response.status, 500);
  verifyHeaders(response);
  assert.doesNotMatch(await response.text(), /private update/);
});

test("context chooses the first membership when the user has no saved workspace", async () => {
  fixtures.set("user.findUnique", { id: "owner", activeWorkspaceId: null });
  const response = await GET(request());
  assert.equal((await response.json()).workspaceId, "workspace-one");
  assert.deepEqual(calls.find(({ operation }) => operation === "workspace.findUnique").options.where, { id: "workspace-one" });
});

test("sessions without identity details remain unauthorized without exposing context", async () => {
  for (const session of [null, {}, { user: {} }]) {
    serverSession = session;
    sessionError = new ApiAuthError(401, "Unauthorized");
    const response = await GET(request());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
    verifyHeaders(response);
  }
  assert.equal(calls.length, 0);
});

for (const [isShared, members, pending, collaborative] of [
  [false, 2, 4, false],
  [true, 1, 0, false],
  [true, 1, 1, true],
]) {
  test(`collaboration requires sharing and another member or invite (${isShared}, ${members}, ${pending})`, async () => {
    fixtures.set("workspace.findUnique", workspace("workspace-one", { isShared, _count: { members } }));
    fixtures.set("workspaceInvite.count", pending);
    const body = await (await GET(request())).json();
    assert.equal(body.isCollaborative, collaborative);
    assert.equal(body.memberCount, members);
    assert.equal(body.pendingInviteCount, pending);
  });
}

test("empty and workspace-only updates acknowledge the selection without changing defaults", async () => {
  for (const [payload, workspaceId] of [[{}, null], [{ workspaceId: "workspace-one" }, "workspace-one"], [{ baseCurrency: "USD" }, null]]) {
    const response = await PATCH(request("PATCH", payload));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      workspaceId, baseCurrency: null, defaultAccountId: null, defaultBudgetId: null, activeWorkspaceId: null,
    });
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(calls.length, 0);
  assert.equal(accessChecks.length, 0);
});

test("subaccount-only updates validate the existing bank and distinguish null from an omitted default", async () => {
  fixtures.set("budgetEnvelope.findFirst", { id: "travel", accountId: "bank-one" });
  let response = await PATCH(request("PATCH", { workspaceId: "workspace-one", receivableDefaultBudgetId: "travel" }));
  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(body.defaultAccountId, "bank-one");
  assert.equal(body.defaultBudgetId, "travel");

  response = await PATCH(request("PATCH", { workspaceId: "workspace-one", receivableDefaultBudgetId: null }));
  body = await response.json();
  assert.equal(body.defaultAccountId, "bank-one");
  assert.equal(body.defaultBudgetId, null);
  assert.ok(!calls.some(({ operation }) => operation === "financialAccount.findFirst"));
});

test("a subaccount cannot be selected when its default bank is cleared", async () => {
  const response = await PATCH(request("PATCH", {
    workspaceId: "workspace-one", receivableDefaultAccountId: null, receivableDefaultBudgetId: "travel",
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Default receivable subaccount must belong to the selected default account." });
  assert.ok(!calls.some(({ operation }) => operation === "workspace.update"));
});

test("a combined switch and defaults edit authorizes both operations before setting the tab cookie", async () => {
  const response = await PATCH(request("PATCH", {
    activeWorkspaceId: "workspace-two", workspaceId: "workspace-one", baseCurrency: "EUR",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(accessChecks, [
    { workspaceId: "workspace-two", minimumRole: undefined },
    { workspaceId: "workspace-one", minimumRole: "OWNER" },
  ]);
  const body = await response.json();
  assert.equal(body.workspaceId, "workspace-one");
  assert.equal(body.baseCurrency, "EUR");
  assert.equal(body.activeWorkspaceId, "workspace-two");
  assert.match(response.headers.get("set-cookie"), /nest-active-workspace=workspace-two/);

  fixtures.set("workspace.findUnique", null);
  const failed = await PATCH(request("PATCH", {
    activeWorkspaceId: "workspace-two", workspaceId: "workspace-one", baseCurrency: "EUR",
  }));
  assert.equal(failed.status, 404);
  assert.deepEqual(await failed.json(), { error: "Workspace not found." });
  assert.equal(failed.headers.get("set-cookie"), null);
});
