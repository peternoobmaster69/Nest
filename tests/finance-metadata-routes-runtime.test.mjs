import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, calls, context, dataCalls, given,
  invocations, request, require, responseBody, state,
} from "./finance-route-harness.mjs";

const budgets = require("../app/api/budgets/[id]/route.ts");
const workspaces = require("../app/api/workspaces/[id]/route.ts");
const receivables = require("../app/api/receivables/[id]/route.ts");
const groups = require("../app/api/transaction-groups/[id]/route.ts");
const timestamp = "2026-10-09T12:00:00.000Z";
const existing = { id: "record", workspaceId: "home", budgetId: "daily", updatedAt: new Date(timestamp) };
const entries = [
  [budgets, "PATCH", "budgetEnvelope", { name: "Savings" }],
  [budgets, "DELETE", "budgetEnvelope"],
  [receivables, "PATCH", "receivable", { expectedUpdatedAt: timestamp }],
  [receivables, "DELETE", "receivable"],
  [groups, "GET", "transactionGroup"],
  [groups, "PATCH", "transactionGroup", { name: "Holiday" }],
  [groups, "DELETE", "transactionGroup"],
];

for (const [routes, method, model, body] of entries) {
  test(`${model} ${method} denies missing records without attempting a write`, async () => {
    given(`${model}.findUnique`, null);
    await responseBody(await routes[method](request(method, body), context()), 404);
    assert.deepEqual(accessChecks, []);
    assertNoWrites();
  });
  test(`${model} ${method} enforces access on the stored workspace`, async () => {
    given(`${model}.findUnique`, existing);
    state.accessError = new ApiAuthError(403, "Forbidden");
    await responseBody(await routes[method](request(method, body), context()), 403);
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: method === "GET" ? undefined : "EDITOR" }]);
    assertNoWrites();
  });
}

test("all metadata mutations reject foreign origins before reading or changing records", async () => {
  for (const [routes, method, , body] of [...entries.filter((entry) => entry[1] !== "GET"), [workspaces, "PATCH", "workspace", {}], [workspaces, "DELETE", "workspace"]]) {
    const response = await routes[method](request(method, body, { headers: { origin: "https://untrusted.example" } }), context());
    assert.equal((await responseBody(response, 403)).code, "FORBIDDEN");
  }
  assert.deepEqual(accessChecks, []);
  assert.ok(calls.every(({ name }) => name === "log"));
});

test("metadata validation rejects invalid fields and reports flattened field errors", async () => {
  for (const [routes, body, field] of [
    [budgets, { availableCents: -1 }, "availableCents"],
    [workspaces, { name: "   " }, "name"],
    [receivables, { expectedUpdatedAt: "yesterday" }, "expectedUpdatedAt"],
    [groups, { name: "   " }, "name"],
  ]) {
    const result = await responseBody(await routes.PATCH(request("PATCH", body), context()), 400);
    assert.ok(result.error.fieldErrors[field].length);
  }
  assert.deepEqual(accessChecks, []);
  assertNoWrites();
});

test("budget edits persist validated metadata and delete only the authorized record", async () => {
  given("budgetEnvelope.findUnique", existing, existing);
  const update = { name: "Rainy day", icon: "☔", targetCents: 100_000, availableCents: 90_000, isSavings: true, isActive: false };
  given("budgetEnvelope.update", { ...existing, ...update });
  given("budgetEnvelope.delete", existing);
  const edited = await responseBody(await budgets.PATCH(request("PATCH", { ...update, workspaceId: "foreign" }), context()));
  assert.equal(edited.workspaceId, "home");
  assert.deepEqual(dataCalls("budgetEnvelope.update"), [{ where: { id: "record" }, data: update }]);
  assert.deepEqual(await responseBody(await budgets.DELETE(request("DELETE"), context())), { ok: true });
  assert.deepEqual(dataCalls("budgetEnvelope.delete"), [{ where: { id: "record" } }]);
});

test("metadata database failures return safe diagnostics with no private exception text", async () => {
  given("budgetEnvelope.findUnique", new Error("private database connection"));
  const result = await responseBody(await budgets.PATCH(request("PATCH", {}), context()), 500);
  assert.equal(result.error, "Failed to update budget");
  assert.equal(result.code, "INTERNAL_ERROR");
  assert.ok(invocations("log").some(({ args }) => args[1] === "api.unhandled_error"));
  assertNoWrites();
});

for (const [label, body, expectedData, details] of [
  ["full preferences", { name: "  Family  ", isShared: false, sidebarMoneyPages: { budgets: false, rewards: true } }, { name: "Family", isShared: false, sidebarMoneyPages: '{"budgets":false,"rewards":true}' }, 'Workspace updated: name="Family" isShared=false'],
  ["sharing", { isShared: true }, { isShared: true }, "Workspace updated: isShared=true"],
  ["name", { name: "Family" }, { name: "Family" }, 'Workspace updated: name="Family"'],
  ["empty optional fields", {}, {}, "Workspace updated:"],
]) {
  test(`workspace ${label} editing requires sensitive access and records an attributed audit`, async () => {
    const updated = { id: "record", name: "Family", isShared: false, sidebarMoneyPages: null, ...expectedData };
    given("workspace.update", updated);
    given("workspaceAuditLog.create", { id: "audit" });
    assert.deepEqual(await responseBody(await workspaces.PATCH(request("PATCH", body), context())), updated);
    assert.deepEqual(dataCalls("workspace.update")[0].data, expectedData);
    assert.deepEqual(dataCalls("workspaceAuditLog.create")[0].data, { workspaceId: "record", actorUserId: "owner", action: "WORKSPACE_UPDATED", details });
    assert.deepEqual(accessChecks, [{ workspaceId: "record", sensitive: true }]);
  });
}

test("sensitive workspace authorization failures prevent edits and deletion", async () => {
  state.accessError = new ApiAuthError(401, "Recent authentication required");
  for (const method of ["PATCH", "DELETE"]) {
    const body = method === "PATCH" ? { name: "Family" } : undefined;
    const result = await responseBody(await workspaces[method](request(method, body), context()), 401);
    assert.equal(result.error, "Recent authentication required");
  }
  assertNoWrites();
});

test("workspace deletion retains at least one membership", async () => {
  given("workspaceMember.count", 0, 1);
  for (let i = 0; i < 2; i += 1) {
    const body = await responseBody(await workspaces.DELETE(request("DELETE"), context()), 400);
    assert.equal(body.error, "At least one workspace must remain.");
  }
  assertNoWrites();
});

for (const [cookie, nextId, expectedCookieCall] of [
  ["record", "next", "cookie.set"],
  ["record", null, "cookie.clear"],
  ["another", "next", null],
  [null, null, null],
]) {
  test(`workspace deletion updates the fallback membership with cookie=${cookie} and next=${nextId}`, async () => {
    state.activeCookie = cookie;
    given("workspaceMember.count", 2);
    given("workspace.delete", existing);
    given("workspaceMember.findFirst", nextId ? { workspaceId: nextId } : null);
    given("user.update", { id: "owner" });
    assert.deepEqual(await responseBody(await workspaces.DELETE(request("DELETE"), context())), { ok: true, activeWorkspaceId: nextId });
    assert.deepEqual(dataCalls("workspaceMember.count"), [{ where: { userId: "owner" } }]);
    assert.deepEqual(dataCalls("workspaceMember.findFirst"), [{ where: { userId: "owner" }, orderBy: { createdAt: "asc" }, select: { workspaceId: true } }]);
    assert.deepEqual(dataCalls("user.update"), [{ where: { id: "owner" }, data: { activeWorkspaceId: nextId } }]);
    const cookies = calls.filter(({ name }) => name.startsWith("cookie."));
    assert.deepEqual(cookies, expectedCookieCall ? [{ name: expectedCookieCall, args: nextId ? [nextId] : [] }] : []);
    assert.deepEqual(dataCalls("workspace.delete"), [{ where: { id: "record" } }]);
  });
}

for (const [label, input, sourceWorkspace, expected] of [
  ["omitted values", { title: "Lunch" }, undefined, { title: "Lunch", transactionDate: undefined, accountId: undefined, budgetId: undefined, sourceWorkspaceId: undefined }],
  ["explicit clearing", { transactionDate: null, accountId: null, budgetId: null, notes: null }, undefined, { transactionDate: null, accountId: null, budgetId: null, sourceWorkspaceId: null, sourceAccountId: null, sourceBudgetId: null, notes: null }],
  ["same workspace", { accountId: "bank", budgetId: "daily", transactionDate: timestamp, date: timestamp, remarks: "Shared meal", amountCents: 400, status: "PARTIAL", isFamily: true, isMom: false }, "home", { transactionDate: new Date(timestamp), date: new Date(timestamp), accountId: "bank", budgetId: "daily", sourceWorkspaceId: "home", sourceAccountId: "bank", sourceBudgetId: "daily", remarkTogether: "Shared meal", amountCents: 400, status: "PARTIAL", isFamily: true, isMom: false }],
  ["cross workspace", { accountId: "bank", budgetId: "daily" }, "shared", { accountId: null, budgetId: null, sourceWorkspaceId: "shared", sourceAccountId: "bank", sourceBudgetId: "daily" }],
  ["account without subaccount", { accountId: "bank" }, "home", { accountId: "bank", budgetId: undefined, sourceWorkspaceId: "home" }],
  ["cleared subaccount only", { budgetId: null }, undefined, { accountId: undefined, budgetId: null, sourceWorkspaceId: undefined, sourceBudgetId: null }],
]) {
  test(`receivable updates preserve ${label} and compare the expected revision`, async () => {
    given("receivable.findUnique", existing);
    if (input.accountId) given("financialAccount.findUnique", { id: "bank", workspaceId: sourceWorkspace, kind: "BANK", isActive: true });
    if (input.budgetId) given("budgetEnvelope.findFirst", { id: "daily" });
    given("receivable.updateMany", { count: 1 });
    given("receivable.findUniqueOrThrow", { ...existing, title: "Updated" });
    const result = await responseBody(await receivables.PATCH(request("PATCH", { expectedUpdatedAt: timestamp, ...input }), context()));
    assert.equal(result.title, "Updated");
    const [query] = dataCalls("receivable.updateMany");
    assert.deepEqual(query.where, { id: "record", updatedAt: new Date(timestamp) });
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(query.data[key], value, key);
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }, ...(sourceWorkspace ? [{ workspaceId: sourceWorkspace, minimumRole: "EDITOR" }] : [])]);
    if (input.budgetId) assert.deepEqual(dataCalls("budgetEnvelope.findFirst")[0].where, { id: "daily", workspaceId: sourceWorkspace, accountId: "bank", isActive: true });
  });
}

for (const invalidAccount of [null, { kind: "INVESTMENT", isActive: true }, { kind: "BANK", isActive: false }]) {
  test(`receivable edits reject an invalid source account: ${JSON.stringify(invalidAccount)}`, async () => {
    given("receivable.findUnique", existing);
    given("financialAccount.findUnique", invalidAccount);
    const result = await responseBody(await receivables.PATCH(request("PATCH", { expectedUpdatedAt: timestamp, accountId: "bank" }), context()), 400);
    assert.equal(result.error, "Selected deduction account is invalid.");
    assertNoWrites();
  });
}

test("receivable edits deny unauthorized cross-workspace deductions", async () => {
  given("receivable.findUnique", existing);
  given("financialAccount.findUnique", { id: "bank", workspaceId: "shared", kind: "BANK", isActive: true });
  state.workspaceErrors.set("shared", new ApiAuthError(403, "Forbidden"));
  await responseBody(await receivables.PATCH(request("PATCH", { expectedUpdatedAt: timestamp, accountId: "bank" }), context()), 403);
  assertNoWrites();
});

test("receivable subaccount changes require a matching source account", async () => {
  for (const accountId of [undefined, null, "bank"]) {
    given("receivable.findUnique", existing);
    if (accountId) {
      given("financialAccount.findUnique", { id: "bank", workspaceId: "home", kind: "BANK", isActive: true });
      given("budgetEnvelope.findFirst", null);
    }
    const result = await responseBody(await receivables.PATCH(request("PATCH", { expectedUpdatedAt: timestamp, accountId, budgetId: "wrong-budget" }), context()), 400);
    assert.equal(result.error, "Selected deduction subaccount is invalid.");
  }
  assertNoWrites();
});

for (const current of [{ updatedAt: new Date("2026-10-09T13:00:00.000Z") }, null]) {
  test(`stale receivable writes return the current revision when ${current ? "changed" : "deleted"}`, async () => {
    given("receivable.findUnique", existing, current);
    given("receivable.updateMany", { count: 0 });
    const result = await responseBody(await receivables.PATCH(request("PATCH", { expectedUpdatedAt: timestamp, title: "Updated" }), context()), 412);
    assert.equal(result.code, "STALE_WRITE");
    assert.equal(result.currentUpdatedAt, current?.updatedAt.toISOString() ?? null);
    assert.equal(invocations("receivable.findUniqueOrThrow").length, 0);
  });
}

test("authorized receivable deletion removes exactly the requested record", async () => {
  given("receivable.findUnique", existing);
  given("receivable.delete", existing);
  assert.deepEqual(await responseBody(await receivables.DELETE(request("DELETE"), context())), { ok: true });
  assert.deepEqual(dataCalls("receivable.delete"), [{ where: { id: "record" } }]);
});

for (const search of [undefined, "   ", "  meal  ", "x".repeat(100)]) {
  test(`group search uses bounded workspace-scoped active transactions: ${JSON.stringify(search)}`, async () => {
    const activeSearch = search?.trim();
    const group = { ...existing, name: "Food", icon: "🍜" };
    const member = { id: "member", subject: "Lunch", date: new Date(timestamp), amountCents: 300, direction: "DEBIT", groupId: "record", group: null };
    const candidate = { ...member, id: "candidate", groupId: null };
    given("transactionGroup.findUnique", group);
    given("transaction.findMany", [member], [candidate, { ...member, subject: "Current lunch" }]);
    const result = await responseBody(await groups.GET(request("GET", undefined, { query: search === undefined ? "" : `?search=${encodeURIComponent(search)}` }), context()));
    assert.deepEqual(result.memberIds, ["member"]);
    assert.deepEqual(result.transactions.map(({ id }) => id), activeSearch ? ["candidate", "member"] : ["member", "candidate"]);
    assert.equal(result.transactions.find(({ id }) => id === "member").subject, "Current lunch");
    assert.equal(result.transactions[0].date, timestamp);
    assert.equal(result.candidateLimit, activeSearch ? 150 : 100);
    const [members, candidates] = dataCalls("transaction.findMany");
    for (const query of [members, candidates]) {
      assert.equal(query.where.workspaceId, "home");
      assert.equal(query.where.budgetId, "daily");
      assert.equal(query.where.voidedAt, null);
      assert.deepEqual(query.where.kind, { not: "REVERSAL" });
    }
    assert.equal(members.take, 5000);
    assert.equal(members.where.groupId, "record");
    assert.equal(candidates.take, result.candidateLimit);
    assert.deepEqual(candidates.where.OR, activeSearch ? ["subject", "details", "notes"].map((field) => ({ [field]: { contains: activeSearch } })) : [{ groupId: null }, { groupId: { not: "record" } }]);
  });
}

test("group searches reject oversized terms before reading the database", async () => {
  await responseBody(await groups.GET(request("GET", undefined, { query: `?search=${"a".repeat(101)}` }), context()), 400);
  assert.ok(calls.every(({ name }) => name === "log"));
});

for (const [label, body, add, remove] of [
  ["rename only", { name: "  Food  " }, [], []],
  ["clear icon", { icon: null }, [], []],
  ["no changes", {}, [], []],
  ["deduplicated additions and removals", { addTransactionIds: ["a", "a"], removeTransactionIds: ["b", "b"] }, ["a"], ["b"]],
  ["removal only", { removeTransactionIds: ["b"] }, [], ["b"]],
  ["addition only", { addTransactionIds: ["a"] }, ["a"], []],
]) {
  test(`transaction group ${label} keeps all membership writes atomic`, async () => {
    given("transactionGroup.findUnique", existing);
    if (add.length) given("transaction.count", add.length);
    given("transaction.updateMany", ...Array.from({ length: Number(Boolean(add.length)) + Number(Boolean(remove.length)) }, () => ({ count: 1 })));
    given("transactionGroup.update", { ...existing, name: "Food" });
    const result = await responseBody(await groups.PATCH(request("PATCH", body), context()));
    assert.equal(result.name, "Food");
    const writes = invocations("transaction.updateMany");
    assert.ok(writes.every((call) => call.inTransaction));
    assert.ok(invocations("transactionGroup.update")[0].inTransaction);
    if (remove.length) assert.deepEqual(writes[0].args[0], { where: { id: { in: remove }, groupId: "record" }, data: { groupId: null } });
    if (add.length) {
      const expected = { id: { in: add }, workspaceId: "home", budgetId: "daily", voidedAt: null, kind: { not: "REVERSAL" } };
      assert.deepEqual(dataCalls("transaction.count")[0].where, expected);
      assert.deepEqual(writes.at(-1).args[0], { where: expected, data: { groupId: "record" } });
    }
    const update = dataCalls("transactionGroup.update")[0].data;
    if (body.name) assert.equal(update.name, "Food");
    if (body.icon === null) assert.equal(update.icon, null);
    assert.equal(update.updatedAt instanceof Date, Boolean(add.length || remove.length));
  });
}

test("group membership rejects transactions outside the selected subaccount", async () => {
  given("transactionGroup.findUnique", existing);
  given("transaction.count", 0);
  const result = await responseBody(await groups.PATCH(request("PATCH", { addTransactionIds: ["foreign"] }), context()), 400);
  assert.match(result.error, /belong to this group's sub-account/);
  assertNoWrites();
});

test("group deletion detaches its transactions and deletes its metadata atomically", async () => {
  given("transactionGroup.findUnique", existing);
  given("transaction.updateMany", { count: 2 });
  given("transactionGroup.delete", existing);
  assert.deepEqual(await responseBody(await groups.DELETE(request("DELETE"), context())), { ok: true });
  assert.deepEqual(dataCalls("transaction.updateMany"), [{ where: { groupId: "record" }, data: { groupId: null } }]);
  assert.deepEqual(dataCalls("transactionGroup.delete"), [{ where: { id: "record" } }]);
  assert.ok([...invocations("transaction.updateMany"), ...invocations("transactionGroup.delete")].every((call) => call.inTransaction));
});
