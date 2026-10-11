import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { ApiAuthError, accessChecks, assertNoWrites, calls, dataCalls, given, require, state } from "./finance-route-harness.mjs";

const { GET } = require("../app/api/dashboard/summary/route.ts");
const now = new Date("2026-10-10T12:00:00.000Z");
const budget = (id, extra = {}) => ({ id, name: id, icon: null, isSavings: false, accountId: "bank", availableCents: 12000, targetCents: 20000, ...extra });
const total = (key, id, cents) => ({ [key]: id, _sum: { amountCents: cents } });
const flow = (extra = {}) => ({ year: 2026, month: 10, accountId: "bank", budgetId: "daily", direction: "CREDIT", amountCents: 5000n, ...extra });
const statement = (cardId, offset, cents = 1000n) => ({ cardId, cardName: cardId, bankName: null, statementMonth: 9, statementYear: 2026, paymentDueDate: new Date(now.getTime() + offset), outstandingCents: cents });

beforeEach(t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  given("budgetEnvelope.findMany", []);
  given("transaction.groupBy", []);
  given("receivable.groupBy", []);
  given("transaction.findMany", []);
  given("financialAccount.findMany", []);
  given("$queryRaw", [], []);
});

async function read(status = 200) {
  const response = await GET(new Request("https://nest.example.test/api/dashboard/summary"));
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie, X-Workspace-Id");
  assert.match(response.headers.get("x-request-id"), /^[a-f\d-]{36}$/);
  assertNoWrites();
  return { body, requestId: response.headers.get("x-request-id") };
}

test("an empty dashboard produces twelve ordered zero months and bounded workspace-scoped queries", async () => {
  const { body, requestId } = await read();
  assert.equal(body.totalBalanceCents, 0);
  assert.deepEqual(body.budgets, []);
  assert.deepEqual(body.recentTransactions, []);
  assert.deepEqual(body.bankDiscrepancies, []);
  assert.deepEqual(body.creditCardSummary, { nextDueCards: [], totalOutstandingCents: 0, overdueCount: 0, dueSoonCount: 0 });
  assert.deepEqual(body.cashFlow.map(({ key }) => key), ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12", "2025-11"]);
  for (const month of body.cashFlow) assert.deepEqual({ ...month, key: null, label: null }, { key: null, label: null, inflowCents: 0, outflowCents: 0, netCents: 0, accounts: {}, budgets: {} });
  assert.deepEqual(accessChecks, [{ workspaceId: undefined, minimumRole: undefined }]);
  assert.deepEqual(dataCalls("budgetEnvelope.findMany"), [{ where: { workspaceId: "home" }, orderBy: { name: "asc" }, take: 500 }]);
  const outgoing = dataCalls("transaction.groupBy")[0];
  assert.deepEqual(outgoing.where, { workspaceId: "home", budgetId: { not: null }, voidedAt: null, kind: { not: "REVERSAL" }, direction: "DEBIT", date: { gte: new Date(2026, 9, 1), lt: new Date(2026, 10, 1) } });
  assert.deepEqual(dataCalls("receivable.groupBy").map(({ where }) => where), [{ sourceWorkspaceId: "home", sourceBudgetId: { not: null }, status: { in: ["OPEN", "PARTIAL"] } }]);
  const recent = dataCalls("transaction.findMany")[0];
  assert.deepEqual(recent.where, { workspaceId: "home", voidedAt: null, kind: { not: "REVERSAL" } });
  assert.equal(recent.take, 8);
  assert.deepEqual(recent.orderBy, [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
  const cashQuery = dataCalls("$queryRaw")[1];
  assert.match(cashQuery.sql, /TOP \(10000\)/);
  assert.match(cashQuery.sql, /\[voidedAt\] IS NULL/);
  assert.match(cashQuery.sql, /\[kind\] <> 'REVERSAL'/);
  assert.deepEqual(cashQuery.values, ["home", new Date(2025, 10, 1), new Date(2026, 10, 1)]);
  const telemetry = calls.filter(({ name, args }) => name === "log" && args[1] === "database.query_group");
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].args[2].requestId, requestId);
  assert.equal(telemetry[0].args[2].workspaceId, "home");
});

test("dashboard budgets merge source and legacy receivables and preserve balances, null totals and recent transaction labels", async () => {
  const budgets = [budget("daily"), budget("savings", { isSavings: true, accountId: "second" }), budget("legacy"), budget("empty"), budget("unallocated")];
  given("budgetEnvelope.findMany", budgets, [{ accountId: "bank", availableCents: 12000 }, { accountId: "bank", availableCents: 8000 }, { accountId: "second", availableCents: 5000 }]);
  given("financialAccount.findMany", [{ id: "bank", name: "DBS", startingCents: 20000 }, { id: "second", name: "UOB", startingCents: 7000 }]);
  given("transaction.groupBy", [total("budgetId", "daily", 3500), total("budgetId", "savings", null), total("budgetId", null, 900)]);
  given("receivable.groupBy",
    [total("sourceBudgetId", "daily", 1000), total("sourceBudgetId", "savings", null), total("sourceBudgetId", null, 600)],
    [total("budgetId", "daily", 500), total("budgetId", "legacy", 900), total("budgetId", "empty", null), total("budgetId", null, 700)],
  );
  given("transaction.findMany", [
    { id: "named", subject: "Groceries", amountCents: 2500, direction: "DEBIT", date: now, budget: { name: "Food" } },
    { id: "unassigned", subject: "Salary", amountCents: 10000, direction: "CREDIT", date: now, budget: null },
  ]);
  const { body, requestId } = await read();
  assert.equal(body.totalBalanceCents, 27000);
  assert.deepEqual(body.bankDiscrepancies, [{ id: "second", name: "UOB", currentBalanceCents: 7000, linkedBudgetTotalCents: 5000, discrepancyCents: 2000 }]);
  assert.deepEqual(body.budgets, budgets.map((value, index) => ({ ...value, monthlyOutgoingCents: index === 0 ? 3500 : 0, receivableReservedCents: [1500, 0, 900, 0, 0][index] })));
  assert.deepEqual(body.recentTransactions.map(({ budgetName, date, ...rest }) => ({ ...rest, budgetName, date })), [
    { id: "named", subject: "Groceries", amountCents: 2500, direction: "DEBIT", budgetName: "Food", date: now.toISOString() },
    { id: "unassigned", subject: "Salary", amountCents: 10000, direction: "CREDIT", budgetName: null, date: now.toISOString() },
  ]);
  const legacy = dataCalls("receivable.groupBy")[1];
  assert.deepEqual(legacy.where, { budgetId: { in: budgets.map(({ id }) => id) }, sourceBudgetId: null, status: { in: ["OPEN", "PARTIAL"] } });
  const telemetry = calls.find(({ name, args }) => name === "log" && args[2]?.operation === "legacy_receivable_totals");
  assert.equal(telemetry.args[2].requestId, requestId);
});

test("cash flow groups signed aggregate amounts by month, bank and sub-account without mixing unassigned or out-of-range rows", async () => {
  given("$queryRaw", [], [
    flow(), flow({ amountCents: 2500, direction: "DEBIT" }),
    flow({ accountId: "second", budgetId: "savings", amountCents: 9000n }),
    flow({ accountId: "second", budgetId: "savings", amountCents: -1000n, direction: "DEBIT" }),
    flow({ budgetId: null, amountCents: 200 }), flow({ budgetId: null, amountCents: 300, direction: "DEBIT" }),
    flow({ month: 9, amountCents: 1500 }), flow({ year: 2025, month: 11, amountCents: 1100 }),
    flow({ year: 2025, month: 10, amountCents: 999999 }), flow({ year: 2026, month: 11, amountCents: 999999 }),
  ]);
  const { body } = await read();
  const october = body.cashFlow[0];
  assert.deepEqual({ inflowCents: october.inflowCents, outflowCents: october.outflowCents, netCents: october.netCents }, { inflowCents: 14200, outflowCents: 1800, netCents: 12400 });
  assert.deepEqual(october.accounts, { bank: { inflowCents: 5200, outflowCents: 2800, netCents: 2400 }, second: { inflowCents: 9000, outflowCents: -1000, netCents: 10000 } });
  assert.deepEqual(october.budgets, { daily: { inflowCents: 5000, outflowCents: 2500, netCents: 2500 }, savings: { inflowCents: 9000, outflowCents: -1000, netCents: 10000 } });
  assert.equal(body.cashFlow[1].inflowCents, 1500);
  assert.equal(body.cashFlow.at(-1).inflowCents, 1100);
  assert.equal(body.cashFlow[2].inflowCents, 0);
});

test("overdue and due-soon card counts are disjoint at the exact current and seven-day boundaries", async () => {
  const day = 86400000;
  const statements = [statement("yesterday", -day), statement("recently overdue", -1), statement("now", 0), statement("next week", 7 * day), statement("later", 7 * day + 1)];
  given("$queryRaw", statements, []);
  const { body } = await read();
  assert.equal(body.creditCardSummary.totalOutstandingCents, 5000);
  assert.equal(body.creditCardSummary.overdueCount, 2);
  assert.equal(body.creditCardSummary.dueSoonCount, 2);
  assert.deepEqual(body.creditCardSummary.nextDueCards, statements.map(row => ({ ...row, outstandingCents: 1000, paymentDueDate: row.paymentDueDate.toISOString() })));
});

test("nullable aggregate amounts cannot turn dashboard values into NaN", async () => {
  given("$queryRaw", [statement("no balance", 0, null)], [flow({ amountCents: null })]);
  const { body } = await read();
  assert.equal(body.creditCardSummary.totalOutstandingCents, 0);
  assert.equal(body.cashFlow[0].inflowCents, 0);
  assert.equal(body.cashFlow[0].accounts.bank.netCents, 0);
});

test("users with no workspace receive the empty onboarding dashboard without any data query", async () => {
  state.accessError = new ApiAuthError(404, "No workspace");
  const { body } = await read();
  assert.deepEqual(body, { totalBalanceCents: 0, bankDiscrepancies: [], budgets: [], recentTransactions: [], cashFlow: [] });
  assert.ok(calls.every(({ name }) => name === "log"));
});

for (const status of [401, 403]) {
  test(`dashboard authorization failures remain private (${status})`, async () => {
    state.accessError = new ApiAuthError(status, "Access denied");
    const { body, requestId } = await read(status);
    assert.equal(body.error, "Access denied");
    assert.equal(body.requestId, requestId);
    assert.ok(calls.every(({ name }) => name === "log"));
  });
}

for (const failure of [new Error("Internal database detail"), "Internal infrastructure detail"]) {
  test(`dashboard authentication infrastructure failures never expose backend details (${typeof failure})`, async () => {
    state.accessError = failure;
    const { body, requestId } = await read(500);
    assert.deepEqual(body, { error: "Failed to fetch dashboard summary", code: "INTERNAL_ERROR", requestId });
  });
}

test("a failed summary query reports an error instead of an apparently valid zero balance", async () => {
  given("budgetEnvelope.findMany", new Error("Internal query detail"));
  const { body, requestId } = await read(500);
  assert.deepEqual(body, { error: "Failed to fetch dashboard summary", code: "INTERNAL_ERROR", requestId });
  assert.equal(Object.hasOwn(body, "totalBalanceCents"), false);
});

test("legacy receivable failures cannot return a partially calculated dashboard", async () => {
  given("budgetEnvelope.findMany", [budget("daily")]);
  given("receivable.groupBy", [], new Error("Legacy aggregation unavailable"));
  const { body } = await read(500);
  assert.equal(body.error, "Failed to fetch dashboard summary");
  assert.equal(Object.hasOwn(body, "budgets"), false);
});
