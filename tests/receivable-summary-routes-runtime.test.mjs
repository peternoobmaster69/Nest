import assert from "node:assert/strict";
import test from "node:test";
import { ApiAuthError, accessChecks, assertNoWrites, calls, dataCalls, given, request, require, state } from "./finance-route-harness.mjs";

const summary = require("../app/api/receivables/summary/route.ts");
const source = require("../app/api/receivables/source-summary/route.ts");
const budget = require("../app/api/receivables/budget-summary/route.ts");
const read = (route, values = { workspaceId: "home", budgetId: "daily" }) => route.GET(request("GET", undefined, { query: `?${new URLSearchParams(values)}` }));
const aggregate = (cents, count) => ({ _sum: { amountCents: cents }, _count: { id: count } });
const row = (values = {}) => ({ id: "record", workspaceId: "home", sourceWorkspaceId: null, title: "Lunch", amountCents: 1200, date: new Date("2026-10-08T12:00:00Z"), status: "OPEN", budgetId: "daily", sourceBudgetId: null, workspace: { name: "Home" }, ...values });
async function bodyOf(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

for (const [name, route, needsBudget, message] of [
  ["workspace", summary, false, "Failed to fetch receivables summary"],
  ["source", source, true, "Failed to fetch receivable source summary"],
  ["budget", budget, true, "Failed to fetch receivable budget summary"],
]) {
  test(`${name} receivable summaries validate scope before querying private records`, async () => {
    for (const values of [{}, { budgetId: "daily" }, ...(needsBudget ? [{ workspaceId: "home" }] : [])]) {
      assert.deepEqual(await bodyOf(await read(route, values), 400), { error: needsBudget ? "workspaceId and budgetId are required" : "workspaceId is required" });
    }
    assert.deepEqual(accessChecks, []);
    assert.deepEqual(calls, []);
  });

  test(`${name} receivable summaries preserve workspace authorization failures`, async () => {
    state.accessError = new ApiAuthError(403, "Forbidden");
    assert.deepEqual(await bodyOf(await read(route), 403), { error: "Forbidden" });
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: undefined }]);
    assert.deepEqual(calls, []);
  });

  test(`${name} receivable summaries surface storage failures without reporting a total`, async () => {
    for (const failure of [new Error("Summary unavailable"), "Unavailable"]) {
      given("receivable.aggregate", ...Array.from({ length: route === budget ? 2 : 1 }, () => () => Promise.reject(failure)));
      assert.deepEqual(await bodyOf(await read(route), 500), { error: message, message: failure instanceof Error ? failure.message : "Unknown error" });
    }
    assertNoWrites();
  });
}

test("workspace and source summaries count only open and partial receivables in the authorized scope", async () => {
  given("receivable.aggregate", aggregate(5000, 3));
  assert.deepEqual(await bodyOf(await read(summary)), { workspaceId: "home", totalCents: 5000, count: 3 });
  assert.deepEqual(dataCalls("receivable.aggregate")[0].where, { workspaceId: "home", status: { in: ["OPEN", "PARTIAL"] } });
  given("receivable.aggregate", aggregate(2000, 2));
  assert.deepEqual(await bodyOf(await read(source)), { workspaceId: "home", budgetId: "daily", receivableReservedCents: 2000, count: 2 });
  assert.deepEqual(dataCalls("receivable.aggregate")[1].where, { sourceWorkspaceId: "home", sourceBudgetId: "daily", status: { in: ["OPEN", "PARTIAL"] } });
  assertNoWrites();
});

test("missing aggregate values produce explicit zeros for both summary variants", async () => {
  given("receivable.aggregate", aggregate(null, null), aggregate(null, null));
  assert.deepEqual(await bodyOf(await read(summary)), { workspaceId: "home", totalCents: 0, count: 0 });
  assert.deepEqual(await bodyOf(await read(source)), { workspaceId: "home", budgetId: "daily", receivableReservedCents: 0, count: 0 });
});

test("legacy budget summaries must include the authorized workspace in both total and row queries", async () => {
  given("receivable.aggregate", aggregate(null, null), aggregate(null, null));
  given("receivable.findMany", [], []);
  const body = await bodyOf(await read(budget, { workspaceId: "home", budgetId: "another-workspace-budget" }));
  assert.deepEqual(body, { workspaceId: "home", budgetId: "another-workspace-budget", receivableReservedCents: 0, count: 0, items: [] });
  const aggregates = dataCalls("receivable.aggregate");
  const rows = dataCalls("receivable.findMany");
  const sourceWhere = { sourceWorkspaceId: "home", sourceBudgetId: "another-workspace-budget", status: { in: ["OPEN", "PARTIAL"] } };
  const legacyWhere = { workspaceId: "home", budgetId: "another-workspace-budget", sourceBudgetId: null, status: { in: ["OPEN", "PARTIAL"] } };
  assert.deepEqual(aggregates.map(({ where }) => where), [sourceWhere, legacyWhere]);
  assert.deepEqual(rows.map(({ where }) => where), [sourceWhere, legacyWhere]);
  assert.ok(rows.every(({ take }) => take === 100));
  assertNoWrites();
});

test("budget summaries combine source and legacy amounts and list the newest receivables first", async () => {
  const older = row({ id: "older" });
  const newer = row({ id: "newer", workspaceId: "shared", sourceWorkspaceId: "home", budgetId: null, sourceBudgetId: "daily", date: new Date("2026-10-09T12:00:00Z"), workspace: { name: "Shared" } });
  given("receivable.aggregate", aggregate(2500, 2), aggregate(1200, 1));
  given("receivable.findMany", [newer], [older]);
  const body = await bodyOf(await read(budget));
  assert.equal(body.receivableReservedCents, 3700);
  assert.equal(body.count, 3);
  assert.deepEqual(body.items.map(({ id, budgetId, workspaceName, date }) => ({ id, budgetId, workspaceName, date })), [
    { id: "newer", budgetId: "daily", workspaceName: "Shared", date: newer.date.toISOString() },
    { id: "older", budgetId: "daily", workspaceName: "Home", date: older.date.toISOString() },
  ]);
  assert.equal(body.items[0].sourceBudgetId, "daily");
  assert.equal(body.items[1].sourceBudgetId, null);
  assertNoWrites();
});
