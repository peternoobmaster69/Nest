import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, calls, dataCalls, given, invocations,
  request, require, state,
} from "./finance-route-harness.mjs";

const { GET, POST } = require("../app/api/receivables/route.ts");
const date = "2026-10-09T12:00:00.000Z";
const input = (values = {}) => ({ workspaceId: "home", amountCents: 2500, receivableDate: date, ...values });
const read = () => GET(request("GET", undefined, { query: "?workspaceId=home" }));
async function bodyOf(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

test("receivable lists require a workspace and membership before any data lookup", async () => {
  assert.deepEqual(await bodyOf(await GET(request("GET")), 400), { error: "workspaceId is required" });
  assert.deepEqual(accessChecks, []);
  state.accessError = new ApiAuthError(403, "Forbidden");
  assert.deepEqual(await bodyOf(await read(), 403), { error: "Forbidden" });
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: undefined }]);
  assert.deepEqual(calls, []);
});

test("receivable lists without source aliases skip all cross-workspace lookups", async () => {
  const local = { id: "local", accountId: "local-bank", budgetId: "local-budget", account: { id: "local-bank" }, budget: { id: "local-budget" } };
  given("receivable.findMany", [local]);
  assert.deepEqual(await bodyOf(await read()), [local]);
  const [query] = dataCalls("receivable.findMany");
  assert.deepEqual(query.where, { workspaceId: "home" });
  assert.deepEqual(query.orderBy, { date: "desc" });
  assert.equal(query.take, 100);
  assert.deepEqual(query.include.budget.select, { id: true, name: true, availableCents: true });
  assert.deepEqual(calls.map(({ name }) => name), ["receivable.findMany"]);
  assertNoWrites();
});

test("receivable source details are read only from workspaces the current user can access", async () => {
  const localAccount = { id: "fallback-bank", name: "Local bank" };
  const localBudget = { id: "fallback-budget", name: "Local budget" };
  const rows = [
    { id: "own-source", sourceWorkspaceId: "home", sourceAccountId: "own-bank", sourceBudgetId: "own-budget", account: null, budget: null },
    { id: "shared-source", sourceWorkspaceId: "other", sourceAccountId: "shared-bank", sourceBudgetId: "shared-budget", account: null, budget: null },
    { id: "private-source", sourceWorkspaceId: "private", sourceAccountId: "private-bank", sourceBudgetId: "private-budget", account: null, budget: null },
    { id: "missing-source", sourceWorkspaceId: "other", sourceAccountId: "missing-bank", sourceBudgetId: "missing-budget", account: localAccount, budget: localBudget },
    { id: "unlinked", sourceWorkspaceId: "other", sourceAccountId: null, sourceBudgetId: null, accountId: "fallback-bank", budgetId: "fallback-budget", account: localAccount, budget: localBudget },
  ];
  given("receivable.findMany", rows);
  given("workspaceMember.findMany", [{ workspaceId: "other" }]);
  const accounts = [{ id: "own-bank", name: "Own bank" }, { id: "shared-bank", name: "Shared bank" }];
  const budgets = [{ id: "own-budget", name: "Own budget" }, { id: "shared-budget", name: "Shared budget" }];
  given("financialAccount.findMany", accounts);
  given("budgetEnvelope.findMany", budgets);
  const body = await bodyOf(await read());
  assert.deepEqual(dataCalls("workspaceMember.findMany"), [{ where: { userId: "editor", workspaceId: { in: ["home", "other", "private"] } }, take: 500, select: { workspaceId: true } }]);
  assert.deepEqual(dataCalls("financialAccount.findMany")[0].where, { id: { in: ["own-bank", "shared-bank", "missing-bank"] }, workspaceId: { in: ["home", "other"] } });
  assert.deepEqual(dataCalls("budgetEnvelope.findMany")[0].where, { id: { in: ["own-budget", "shared-budget", "missing-budget"] }, workspaceId: { in: ["home", "other"] } });
  assert.equal(dataCalls("financialAccount.findMany")[0].take, 100);
  assert.equal(dataCalls("budgetEnvelope.findMany")[0].take, 100);
  assert.deepEqual(body[0].account, accounts[0]);
  assert.deepEqual(body[1].budget, budgets[1]);
  assert.equal(body[1].accountId, "shared-bank");
  assert.equal(body[1].budgetId, "shared-budget");
  assert.equal(body[2].account, null);
  assert.equal(body[2].budget, null);
  assert.deepEqual(body[3].account, localAccount);
  assert.deepEqual(body[3].budget, localBudget);
  assert.equal(body[4].accountId, "fallback-bank");
  assert.equal(body[4].budgetId, "fallback-budget");
  assertNoWrites();
});

test("source references with no remaining membership never query private account or budget details", async () => {
  given("receivable.findMany", [{ id: "record", sourceWorkspaceId: "private", sourceAccountId: "private-bank", sourceBudgetId: "private-budget", account: null, budget: null }]);
  given("workspaceMember.findMany", []);
  const body = await bodyOf(await read());
  assert.equal(body[0].account, null);
  assert.equal(body[0].budget, null);
  assert.equal(invocations("financialAccount.findMany").length, 0);
  assert.equal(invocations("budgetEnvelope.findMany").length, 0);
});

test("receivable creation validates amounts and dates and requires EDITOR before source resolution", async () => {
  for (const invalid of [null, input({ amountCents: 0 }), input({ transactionDate: "invalid" }), input({ status: "OTHER" })]) {
    const body = await bodyOf(await POST(request("POST", invalid)), 400);
    assert.ok(body.error.formErrors.length || Object.keys(body.error.fieldErrors).length);
  }
  assert.deepEqual(accessChecks, []);
  state.accessError = new ApiAuthError(403, "Editor access required");
  assert.deepEqual(await bodyOf(await POST(request("POST", input())), 403), { error: "Editor access required" });
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
  assert.deepEqual(calls, []);
});

test("receivable dates are required even when other creation fields are valid", async () => {
  assert.deepEqual(await bodyOf(await POST(request("POST", { workspaceId: "home", amountCents: 2500 })), 400), { error: "receivableDate is required" });
  assertNoWrites();
});

for (const [label, payload, sourceWorkspaceId] of [
  ["unlinked defaults", input(), null],
  ["legacy date", { workspaceId: "home", amountCents: 2500, date, accountId: "", budgetId: "" }, null],
  ["same workspace source", input({ accountId: "bank", budgetId: "daily", date: "2020-01-01T00:00:00.000Z", title: "Lunch refund", transactionDate: "2026-10-08T12:00:00.000Z", remarks: "Shared lunch", notes: "Receipt", fromUserId: "payer", status: "PARTIAL" }), "home"],
  ["cross-workspace source", input({ accountId: "bank", budgetId: "daily" }), "other"],
  ["source account without a budget", input({ accountId: "bank" }), "home"],
]) {
  test(`receivable creation preserves ${label} and valid local foreign keys`, async () => {
    if (sourceWorkspaceId) {
      given("financialAccount.findUnique", { id: "bank", workspaceId: sourceWorkspaceId, kind: "BANK", isActive: true });
      if (payload.budgetId) given("budgetEnvelope.findFirst", { id: "daily" });
    }
    given("receivable.create", { id: "created" });
    assert.deepEqual(await bodyOf(await POST(request("POST", payload)), 201), { id: "created" });
    assert.deepEqual(dataCalls("receivable.create"), [{ data: {
      workspaceId: "home", title: payload.title ?? "Receivable", amountCents: 2500, date: new Date(date),
      transactionDate: payload.transactionDate ? new Date(payload.transactionDate) : null,
      remarkTogether: payload.remarks, notes: payload.notes,
      accountId: sourceWorkspaceId === "home" ? payload.accountId : null,
      budgetId: sourceWorkspaceId === "home" ? payload.budgetId : null,
      sourceWorkspaceId, sourceAccountId: payload.accountId, sourceBudgetId: payload.budgetId,
      fromUserId: payload.fromUserId, status: payload.status ?? "OPEN",
    } }]);
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }, ...(sourceWorkspaceId ? [{ workspaceId: sourceWorkspaceId, minimumRole: "EDITOR" }] : [])]);
  });
}

for (const account of [null, { kind: "INVESTMENT", isActive: true }, { kind: "BANK", isActive: false }]) {
  test(`receivable creation rejects invalid source account ${JSON.stringify(account)}`, async () => {
    given("financialAccount.findUnique", account);
    assert.deepEqual(await bodyOf(await POST(request("POST", input({ accountId: "bank" }))), 400), { error: "Selected deduction account is invalid." });
    assertNoWrites();
  });
}

test("receivable source budgets must belong to an authorized active bank account", async () => {
  assert.deepEqual(await bodyOf(await POST(request("POST", input({ budgetId: "daily" }))), 400), { error: "Selected deduction subaccount is invalid." });
  given("financialAccount.findUnique", { id: "bank", workspaceId: "other", kind: "BANK", isActive: true });
  state.workspaceErrors.set("other", new ApiAuthError(403, "Private source"));
  assert.deepEqual(await bodyOf(await POST(request("POST", input({ accountId: "bank", budgetId: "daily" }))), 403), { error: "Private source" });
  assert.equal(invocations("budgetEnvelope.findFirst").length, 0);
  state.workspaceErrors.clear();
  given("financialAccount.findUnique", { id: "bank", workspaceId: "home", kind: "BANK", isActive: true });
  given("budgetEnvelope.findFirst", null);
  assert.deepEqual(await bodyOf(await POST(request("POST", input({ accountId: "bank", budgetId: "daily" }))), 400), { error: "Selected deduction subaccount is invalid." });
  assert.deepEqual(dataCalls("budgetEnvelope.findFirst"), [{ where: { id: "daily", workspaceId: "home", accountId: "bank", isActive: true }, select: { id: true } }]);
  assertNoWrites();
});

test("receivable storage failures retain the documented read and write error responses", async () => {
  for (const failure of [new Error("Receivables unavailable"), "Unavailable"]) {
    given("receivable.findMany", () => Promise.reject(failure));
    assert.deepEqual(await bodyOf(await read(), 500), { error: "Failed to fetch receivables", message: failure instanceof Error ? failure.message : "Unknown error" });
    given("receivable.create", () => Promise.reject(failure));
    assert.deepEqual(await bodyOf(await POST(request("POST", input())), 500), { error: "Failed to create receivable", message: failure instanceof Error ? failure.message : "Unknown error" });
  }
});
