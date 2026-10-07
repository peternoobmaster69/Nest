import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const context = { workspaceId: "household", userId: "owner", currency: "SGD", callId: "answer-1" };
const now = new Date("2026-10-07T16:30:00Z");
const date = (value) => new Date(`${value}T00:00:00Z`);
const calls = [];
let responses = new Map();
let marketConfigured = false;
let newsConfigured = false;
let external = {};
let cioResult = null;
const models = ["workspace", "transaction", "financialAccount", "budgetEnvelope", "receivable", "creditCardTransaction", "creditCardAccount", "monthlyBudgetPlan", "investmentAccount", "transactionGroup"];
const prisma = Object.fromEntries(models.map((model) => [model, Object.fromEntries(
  ["findUnique", "findMany", "groupBy", "aggregate", "count"].map((method) => [method, async (options) => {
    const operation = `${model}.${method}`;
    calls.push({ operation, options });
    const scope = model === "workspace" ? options.where.id : options.where.workspaceId_year_month?.workspaceId ?? options.where.workspaceId;
    assert.equal(scope, context.workspaceId, `${operation} must query the current workspace`);
    if (responses.has(operation)) {
      const response = responses.get(operation);
      return typeof response === "function" ? response(options) : response;
    }
    if (method === "findUnique") return null;
    if (method === "count") return 0;
    if (method === "aggregate") return { _sum: { amountCents: null }, _count: { _all: 0 } };
    return [];
  }]),
)]));
function reply(operation, value) { responses.set(operation, value); }
function request(operation) { return calls.find((call) => call.operation === operation).options; }
async function boundary(name, args) {
  calls.push({ operation: name, options: args });
  if (external[name] instanceof Error) throw external[name];
  assert.ok(name in external, `Missing external fixture for ${name}`);
  return external[name];
}
class ProviderError extends Error {
  constructor(code, message, retryAfterSeconds = 30) {
    super(message);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
class MarketError extends ProviderError {}
class NewsError extends ProviderError {}
class PublicSourceError extends ProviderError {}
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/ai/tools/cio-tools.ts", { namedExports: {
  executeCioAskNestTool: async () => cioResult,
  getCioAskNestTools: () => [{ type: "function", name: "get_cio_profile" }],
} });
mock.module("../lib/ai/knowledge-search.ts", { namedExports: { searchAskNestKnowledge: (args) => boundary("knowledge", args) } });
mock.module("../lib/ai/massive-market-data.ts", { namedExports: {
  getMassiveDailyMarketHistory: (args) => boundary("market", args),
  isMassiveMarketDataConfigured: () => marketConfigured,
  MassiveMarketDataError: MarketError,
} });
mock.module("../lib/ai/serpapi-news.ts", { namedExports: {
  isSerpApiNewsConfigured: () => newsConfigured,
  searchSerpApiFinancialWeb: (args) => boundary("publicSearch", args),
  searchSerpApiNews: (args) => boundary("news", args),
  SerpApiNewsError: NewsError,
} });
mock.module("../lib/ai/public-financial-source.ts", { namedExports: {
  readPublicFinancialSource: (args) => boundary("publicSource", args),
  PublicFinancialSourceError: PublicSourceError,
} });
const { executeAskNestTool: execute, getAskNestTools, AskNestToolInputError } = require("../lib/ai/ask-nest-tools.ts");
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  calls.length = 0;
  responses = new Map();
  marketConfigured = false;
  newsConfigured = false;
  external = {};
  cioResult = null;
});
const range = { start_date: "2026-09-01", end_date: "2026-09-30" };
const filters = { account_name: null, budget_name: null };
const comparison = { period_a_start: "2026-09-01", period_a_end: "2026-09-30", period_b_start: "2026-08-01", period_b_end: "2026-08-31" };
const run = (name, args) => execute(name, args, context);
const sum = (amountCents, count = 1, extra = {}) => ({ ...extra, _sum: { amountCents }, _count: { _all: count } });
const account = { id: "bank", name: "Daily Bank", bankName: "DBS", workspaceId: "household", startingCents: 10_000 };
const budget = { id: "food", name: "Dining", workspaceId: "household", accountId: "bank", account, targetCents: 8_000, availableCents: 7_000 };
const transaction = (extra = {}) => ({ id: "lunch", accountId: "bank", budgetId: "food", date: date("2026-09-03"), subject: "Lunch", amountCents: 1_200, direction: "DEBIT", kind: "STANDARD", details: null, notes: null, account, budget, ...extra });

test("tool discovery exposes only configured external sources and routes CIO tools without ledger reads", async () => {
  const names = () => getAskNestTools(false).map((tool) => tool.name);
  assert.ok(names().includes("get_financial_snapshot"));
  assert.ok(names().includes("get_cio_profile"));
  for (const hidden of ["get_market_history", "search_market_news", "search_workspace_knowledge"]) assert.ok(!names().includes(hidden));
  marketConfigured = true;
  newsConfigured = true;
  const enabled = getAskNestTools(true).map((tool) => tool.name);
  for (const name of ["get_market_history", "search_market_news", "search_public_financial_sources", "read_authoritative_financial_source", "search_workspace_knowledge"]) assert.ok(enabled.includes(name));
  assert.equal(new Set(enabled).size, enabled.length);
  cioResult = { output: { ok: true, profile: "owner plan" }, evidence: [] };
  assert.equal(await run("get_cio_profile", {}), cioResult);
  assert.equal(calls.length, 0);
});

test("unsupported, malformed, reversed, and excessive date ranges fail before reading financial data", async () => {
  await assert.rejects(run("delete_transactions", {}), AskNestToolInputError);
  for (const dates of [
    { start_date: "2026/09/01", end_date: "2026-09-30" },
    { start_date: "2026-02-30", end_date: "2026-03-01" },
    { start_date: "2026-13-01", end_date: "2026-12-01" },
    { start_date: "2026-10-01", end_date: "2026-09-01" },
    { start_date: "2020-01-01", end_date: "2026-09-01" },
  ]) await assert.rejects(run("get_financial_snapshot", dates));
  await assert.rejects(run("get_financial_snapshot", { ...range, workspaceId: "someone-else" }));
  await assert.rejects(run("get_category_spending", { ...comparison, period_b_end: null, category: "ALL", account_name: null, limit: 5 }), /both be supplied/);
  assert.equal(calls.length, 0);
});

test("empty workspaces produce explicit zero totals, missing plans, and evidence links", async () => {
  const cases = [
    ["get_financial_snapshot", { start_date: null, end_date: null }, (o) => { assert.equal(o.cashFlow.netCents, 0); assert.equal(o.workspace, "Current workspace"); assert.deepEqual(o.period, { start: "2026-10-01", end: "2026-10-08" }); }],
    ["compare_spending", { ...comparison, ...filters }, (o) => { assert.equal(o.changeCents, 0); assert.equal(o.changePercent, null); }],
    ["get_category_spending", { ...comparison, period_b_start: null, period_b_end: null, account_name: null, category: "ALL", limit: 5 }, (o) => { assert.equal(o.periodA.confirmedCoveragePercent, 0); assert.equal(o.periodB, null); }],
    ["find_transactions", { start_date: null, end_date: null, ...filters, query: null, limit: 10 }, (o) => { assert.equal(o.totalMatches, 0); assert.equal(o.filters.start, "2026-07-11"); assert.equal(o.filters.end, "2026-10-08"); }],
    ["get_card_obligations", { before_date: null }, (o) => { assert.equal(o.cardCount, 0); assert.equal(o.totalCents, 0); }],
    ["find_card_transactions", { ...range, card_name: null, query: null, allocation_status: "ANY", limit: 10 }, (o) => assert.deepEqual(o.transactions, [])],
    ["get_receivables", { status: "ANY", through_date: null, limit: 10 }, (o) => assert.equal(o.totalCents, 0)],
    ["get_budget_plan", { year: 2026, month: 9 }, (o) => { assert.equal(o.found, false); assert.deepEqual(o.sources, []); assert.deepEqual(o.items, []); }],
    ["explain_reconciliation", { account_name: null }, (o) => assert.deepEqual(o.rows, [])],
    ["get_spending_breakdown", { ...range, ...filters, granularity: "MONTH" }, (o) => { assert.equal(o.totalCents, 0); assert.deepEqual(o.presentation.points, []); }],
    ["get_investment_summary", { account_name: null, as_of_date: null }, (o) => { assert.equal(o.asOf, "2026-10-08"); assert.equal(o.totals.currentValueCents, 0); }],
    ["get_trip_spending", { ...range, query: null, destination_hints: [] }, (o) => { assert.equal(o.totalCents, 0); assert.equal(o.estimated, false); assert.equal(o.disclaimer, null); }],
    ["explain_cash_flow_change", { ...comparison, account_name: null }, (o) => { assert.equal(o.change.netCents, 0); assert.deepEqual(o.drivers, []); }],
    ["compare_income", { ...comparison, account_name: null }, (o) => { assert.equal(o.changePercent, null); assert.deepEqual(o.sources, []); }],
    ["get_top_spending_drivers", { ...range, ...filters, dimension: "MERCHANT", limit: 10 }, (o) => assert.equal(o.totalCents, 0)],
    ["get_budget_vs_actual", { year: 2026, month: 12, budget_name: null }, (o) => { assert.equal(o.foundPlan, false); assert.equal(o.period, "2026-12"); assert.deepEqual(o.rows, []); }],
    ["find_recurring_spend", { ...range, ...filters, min_occurrences: 2, limit: 10 }, (o) => { assert.equal(o.truncated, false); assert.deepEqual(o.patterns, []); }],
  ];
  for (const [name, args, verify] of cases) {
    const result = await run(name, args);
    assert.equal(result.output.ok, true, name);
    verify(result.output);
    assert.ok(result.evidence.length > 0, name);
    assert.deepEqual(result.output.evidence, result.evidence);
    assert.ok(result.evidence.every((item) => item.id.startsWith("answer-1:") && item.href.startsWith("/")));
  }
});

test("snapshots combine cash flow, configured bank balances, budgets, receivables, and card obligations", async () => {
  reply("workspace.findUnique", { name: "Family" });
  reply("transaction.groupBy", [sum(90_000, 2, { direction: "CREDIT" }), sum(15_000, 3, { direction: "DEBIT" })]);
  reply("financialAccount.findMany", [account, { ...account, id: "spare", name: "Spare", startingCents: 0 }]);
  reply("budgetEnvelope.findMany", [budget, { ...budget, id: "travel", name: "Travel", availableCents: 2_000 }]);
  reply("receivable.aggregate", sum(2_300));
  reply("receivable.count", 2);
  reply("creditCardTransaction.groupBy", [sum(5_000, 1, { creditCardId: "visa", statementMonth: 9, statementYear: 2026, _min: { paymentDueDate: date("2026-10-10") } })]);
  reply("creditCardAccount.findMany", [{ id: "visa", cardName: "Travel Visa", bankName: "DBS" }]);
  const { output } = await run("get_financial_snapshot", range);
  assert.equal(output.workspace, "Family");
  assert.equal(output.cashFlow.netCents, 75_000);
  assert.equal(output.cashFlow.transactionCount, 5);
  assert.deepEqual(output.bankReconciliation.map((row) => [row.discrepancy, row.reconciled]), [["SGD 10.00", false], ["SGD 0.00", true]]);
  assert.equal(output.budgets[0].available, "SGD 70.00");
  assert.equal(output.openReceivables.totalCents, 2_300);
  assert.equal(output.outstandingCardStatements.statementCount, 1);
  assert.match(output.outstandingCardStatements.summary, /1 outstanding statement across 1 card/);
  const where = request("transaction.groupBy").where;
  assert.deepEqual(where, { workspaceId: "household", voidedAt: null, kind: { not: "REVERSAL" }, date: { gte: date("2026-09-01"), lt: date("2026-10-01") } });
});

test("spending comparison resolves account aliases and preserves unknown and unassigned budgets", async () => {
  reply("financialAccount.findMany", [account]);
  reply("budgetEnvelope.findMany", [budget]);
  reply("transaction.findMany", [transaction(), transaction({ id: "private", budget: { workspaceId: "other", name: "Private" }, budgetId: null })]);
  reply("transaction.groupBy", ({ where }) => where.date.gte.getUTCMonth() === 8
    ? [sum(2_000, 2, { budgetId: "food" }), sum(1_000, 1, { budgetId: null }), sum(null, 1, { budgetId: "removed" })]
    : [sum(2_000, 1, { budgetId: "food" })]);
  const result = await run("compare_spending", { ...comparison, account_name: "DBS", budget_name: "Dining" });
  assert.equal(result.output.changeCents, 1_000);
  assert.equal(result.output.changePercent, 50);
  assert.deepEqual(result.output.periodA.byBudget.map((row) => row.name), ["Dining", "Unassigned", "Unknown budget"]);
  assert.ok(result.output.filters.entityResolution.every((resolution) => resolution.matched));
  const where = request("transaction.groupBy").where;
  assert.deepEqual(where.accountId, { in: ["bank"] });
  assert.deepEqual(where.budgetId, { in: ["food"] });
  assert.equal(where.direction, "DEBIT");
  assert.equal(result.evidence.length, 4);
  assert.ok(result.evidence.every((item) => new URL(item.href, "https://example.test").searchParams.has("transactionId")));
  assert.ok(result.evidence.some((item) => item.detail.endsWith("Unassigned")));
});

test("transaction search keeps unmatched filters and hides related records from another workspace", async () => {
  reply("transaction.findMany", [transaction(), transaction({ id: "other", account: { workspaceId: "other", name: "Private bank", bankName: "Private" }, budget: null })]);
  reply("transaction.count", 20);
  const { output } = await run("find_transactions", { ...range, account_name: "Unknown bank", budget_name: "Unknown budget", query: "coffee shop", limit: 2 });
  assert.equal(output.totalMatches, 20);
  assert.equal(output.returned, 2);
  assert.equal(output.transactions[0].bank, "DBS");
  assert.deepEqual([output.transactions[1].account, output.transactions[1].bank, output.transactions[1].budget], ["Unavailable", null, "Unassigned"]);
  const { where, take } = request("transaction.findMany");
  assert.equal(take, 2);
  assert.equal(where.account.workspaceId, "household");
  assert.equal(where.budget.workspaceId, "household");
  assert.equal(where.AND[0].OR[0].OR[0].subject.contains, "coffee shop");
  assert.equal(where.AND[0].OR[1].AND.length, 2);
  assert.deepEqual(request("transaction.count").where, where);
  reply("transaction.findMany", []);
  reply("transaction.count", 1);
  const fallback = await run("find_transactions", { ...range, ...filters, query: "tea", limit: 1 });
  assert.match(fallback.evidence[0].label, /^1 matching transaction$/);
  assert.match(fallback.evidence[0].detail, /“tea”/);
  assert.equal(new URL(fallback.evidence[0].href, "https://example.test").searchParams.get("search"), "tea");
});

test("card obligations exclude paid, missing, and later statements and sort the inclusive due-date cutoff", async () => {
  const statement = (cardId, amount, due) => sum(amount, 1, { creditCardId: cardId, statementYear: 2026, statementMonth: 9, _min: { paymentDueDate: due ? date(due) : null } });
  reply("creditCardTransaction.groupBy", [
    statement("visa", 5_000, "2026-10-10"), statement("visa", 2_000, "2026-10-02"),
    statement("amex", 3_000, "2026-10-10"), statement("amex", -50, "2026-10-01"),
    statement("visa", null, "2026-10-01"), statement("visa", 100, null),
    statement("unknown", 100, "2026-10-01"), statement("visa", 10_000, "2026-10-11"),
  ]);
  reply("creditCardAccount.findMany", [{ id: "visa", cardName: "Visa", bankName: "DBS" }, { id: "amex", cardName: "Amex", bankName: null }]);
  const { output } = await run("get_card_obligations", { before_date: "2026-10-10" });
  assert.equal(output.totalCents, 10_000);
  assert.equal(output.statementCount, 3);
  assert.equal(output.cardCount, 2);
  assert.deepEqual(output.statements.map((row) => row.paymentDueDate), ["2026-10-02", "2026-10-10", "2026-10-10"]);
  await assert.rejects(run("get_card_obligations", { before_date: "2026-02-30" }), /valid calendar date/);
});

test("card activity filters allocation and resolved cards while protecting related names", async () => {
  reply("creditCardAccount.findMany", [{ id: "visa", cardName: "Travel Visa", bankName: "DBS" }]);
  reply("budgetEnvelope.findMany", [budget]);
  const cardRow = { transactionDate: date("2026-09-03"), paymentDueDate: date("2026-10-01"), statementMonth: 9, statementYear: 2026, subject: "Hotel", amountCents: 12_000, isAllocated: true, budgetId: "food", creditCard: { workspaceId: "household", cardName: "Travel Visa", bankName: "DBS" } };
  reply("creditCardTransaction.findMany", [cardRow, { ...cardRow, paymentDueDate: null, budgetId: "deleted", creditCard: { ...cardRow.creditCard, workspaceId: "other" } }, { ...cardRow, budgetId: null }]);
  reply("creditCardTransaction.count", 3);
  const base = { ...range, query: "Hotel", card_name: "DBS", allocation_status: "ALLOCATED", limit: 10 };
  const { output } = await run("find_card_transactions", base);
  assert.deepEqual(output.transactions.map((row) => row.budget), ["Dining", null, null]);
  assert.equal(output.transactions[0].statement, "2026-09");
  assert.deepEqual([output.transactions[1].card, output.transactions[1].bank, output.transactions[1].paymentDueDate], ["Unavailable", null, null]);
  assert.deepEqual(request("creditCardTransaction.findMany").where.creditCardId, { in: ["visa"] });
  for (const [status, expected] of [["UNALLOCATED", false], ["ANY", undefined]]) {
    calls.length = 0;
    reply("creditCardTransaction.findMany", []);
    reply("creditCardTransaction.count", 1);
    const result = await run("find_card_transactions", { ...base, card_name: "missing", allocation_status: status });
    const where = request("creditCardTransaction.findMany").where;
    assert.equal(where.isAllocated, expected);
    assert.equal(where.creditCard.workspaceId, "household");
    assert.match(result.evidence[0].label, /^1 matching card transaction$/);
  }
});

test("receivables and budget plans retain amounts and redact foreign workspace destinations", async () => {
  const receivable = { title: "Shared lunch", amountCents: 500, date: date("2026-09-03"), transactionDate: date("2026-09-01"), status: "PARTIAL", account, budget };
  reply("receivable.findMany", [receivable, { ...receivable, account: null, budget: { workspaceId: "other", name: "Private" }, transactionDate: null }]);
  reply("receivable.count", 1);
  reply("receivable.aggregate", sum(1_000));
  const receivables = await run("get_receivables", { status: "PARTIAL", through_date: "2026-09-30", limit: 10 });
  assert.equal(receivables.output.totalCents, 1_000);
  assert.equal(receivables.output.receivables[0].account, "Daily Bank");
  assert.deepEqual([receivables.output.receivables[1].account, receivables.output.receivables[1].budget, receivables.output.receivables[1].transactionDate], [null, null, null]);
  assert.equal(request("receivable.findMany").where.date.lt.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(request("receivable.findMany").where.status, "PARTIAL");
  assert.equal(receivables.evidence[0].label, "1 receivable");
  reply("monthlyBudgetPlan.findUnique", { status: "CONFIRMED", updatedAt: now, confirmedAt: now, sources: [{ title: "Salary", amountCents: 10_000 }], items: [
    { title: "Dining", amountCents: 5_000, appliedCents: 2_000, destinationSubAccount: budget },
    { title: "Travel", amountCents: 1_000, appliedCents: 0, destinationSubAccount: { workspaceId: "other", name: "Private" } },
  ] });
  const plan = await run("get_budget_plan", { year: 2026, month: 9 });
  assert.equal(plan.output.remainingCents, 4_000);
  assert.equal(plan.output.confirmedAt, now.toISOString());
  assert.deepEqual(plan.output.items.map((item) => item.destination), ["Dining", null]);
  assert.equal(plan.output.items[0].applied, "SGD 20.00");
});

test("category spending separates confirmed, possible, and unclassified amounts before comparing periods", async () => {
  const recent = [
    transaction({ id: "ride", subject: "GrabCar", amountCents: 1_200 }),
    transaction({ id: "bus", subject: "Bus ticket", amountCents: 800 }),
    transaction({ id: "maybe", subject: "GrabPay", amountCents: 500, account: { workspaceId: "other", name: "Private" }, budget: null }),
    transaction({ id: "unknown", subject: "XYZ", amountCents: 700, budget: null }),
    transaction({ id: "coffee", subject: "Starbucks", amountCents: 600 }),
  ];
  reply("transaction.findMany", ({ where }) => where.date.gte.getUTCMonth() === 8 ? recent : [transaction({ subject: "GrabCar", amountCents: 1_000 })]);
  const args = { ...comparison, account_name: null, category: "TRANSPORT", limit: 5 };
  const { output, evidence } = await run("get_category_spending", args);
  assert.equal(output.periodA.confirmedCents, 2_000);
  assert.equal(output.periodA.possibleAdditionalCents, 500);
  assert.equal(output.periodA.potentialMaximumCents, 2_500);
  assert.equal(output.periodA.unclassifiedCents, 700);
  assert.equal(output.periodA.allDebitCents, 3_800);
  assert.equal(output.periodA.confirmedCoveragePercent, 68.42);
  assert.equal(output.changeCents, 1_000);
  assert.equal(output.changePercent, 100);
  assert.equal(output.periodA.uncertainTransactions[0].account, "Unavailable");
  assert.deepEqual(output.periodA.merchants.map((merchant) => [merchant.merchant, merchant.shareOfConfirmedPercent]), [["Grab", 60], ["Bus Ticket", 40]]);
  assert.equal(output.presentation.points[0].valueCents, 1_000);
  assert.equal(evidence.length, 4);
  const all = await run("get_category_spending", { ...args, category: "ALL", period_b_start: null, period_b_end: null });
  assert.equal(all.output.periodA.confirmedCents, 2_600);
  assert.deepEqual(all.output.periodA.categories.map((category) => category.category), ["TRANSPORT", "DINING"]);
  assert.deepEqual(all.output.periodA.merchants, []);
  assert.equal(all.output.returned, 2);
});

test("reconciliation filters resolved aliases and unresolved names without altering bank balances", async () => {
  reply("financialAccount.findMany", [account]);
  reply("budgetEnvelope.findMany", [budget]);
  const resolved = await run("explain_reconciliation", { account_name: "DBS" });
  assert.equal(resolved.output.entityResolution.matched, true);
  assert.equal(resolved.output.rows[0].configuredBalanceCents, 10_000);
  assert.equal(resolved.output.rows[0].discrepancyCents, 3_000);
  reply("financialAccount.findMany", ({ where }) => where.kind === "BANK" ? [account] : []);
  const fallback = await run("explain_reconciliation", { account_name: "Daily" });
  assert.equal(fallback.output.entityResolution.matched, false);
  assert.equal(fallback.output.rows.length, 1);
  assert.deepEqual((await run("explain_reconciliation", { account_name: "Missing" })).output.rows, []);
});

test("monthly and yearly spending breakdowns keep all amounts when grouping small budgets into Other", async () => {
  const budgets = Array.from({ length: 32 }, (_, index) => ({ id: `b${index}`, name: `Budget ${String(index).padStart(2, "0")}` }));
  reply("budgetEnvelope.findMany", budgets);
  reply("transaction.groupBy", [
    sum(100, 1, { date: date("2026-08-01"), budgetId: "b0" }),
    ...budgets.map(({ id }) => sum(100, 1, { date: date("2026-09-01"), budgetId: id })),
    sum(50, 1, { date: date("2026-09-01"), budgetId: null }),
    sum(null, 1, { date: date("2026-09-01"), budgetId: "removed" }),
  ]);
  const args = { ...range, start_date: "2026-08-01", ...filters };
  const monthly = await run("get_spending_breakdown", { ...args, granularity: "MONTH" });
  assert.equal(monthly.output.totalCents, 3_350);
  assert.deepEqual(monthly.output.periods.map((period) => period.period), ["2026-08", "2026-09"]);
  assert.equal(monthly.output.periods[1].subAccounts.length, 31);
  assert.deepEqual(monthly.output.periods[1].subAccounts.at(-1), { name: "Other (4 sub-accounts)", amountCents: 250, amount: "SGD 2.50", transactionCount: 4 });
  reply("transaction.findMany", [transaction()]);
  const yearly = await run("get_spending_breakdown", { ...args, granularity: "YEAR" });
  assert.equal(yearly.output.periods.length, 1);
  assert.equal(yearly.output.periods[0].subAccounts[0].amountCents, 200);
  assert.equal(yearly.output.periods[0].transactionCount, 35);
  assert.equal(yearly.output.presentation.points[0].valueCents, 3_350);
  assert.match(yearly.evidence[0].id, /spending-breakdown-lunch$/);
});

test("investment summaries use recorded valuations and only user-confirmed asset allocations", async () => {
  const base = { id: "fund", displayName: "Retirement fund", productName: "Fund", institutionName: "Broker", inceptionDate: date("2026-01-01"), divestedDate: null, isLiquid: true, cioProfile: { classificationStatus: "USER_CONFIRMED", liquidityClass: "LIQUID", portfolioRole: "CORE", riskLevel: "MODERATE" }, cioExposures: [{ exposureKey: "EQUITY", weightBps: 6_250 }, { exposureKey: "BONDS", weightBps: 3_750 }], entries: [{ date: date("2026-09-01"), investedCents: 5_000, currentValueCents: 6_000 }] };
  reply("investmentAccount.findMany", [base, { ...base, id: "suggested", displayName: "", cioProfile: { classificationStatus: "AI_SUGGESTED" }, entries: [{ date: date("2026-09-02"), investedCents: 2_000, currentValueCents: 1_500 }], divestedDate: date("2026-09-30") }, { ...base, id: "empty", cioProfile: null, entries: [] }]);
  const { output } = await run("get_investment_summary", { account_name: "Broker", as_of_date: "2026-09-30" });
  assert.equal(output.totals.gainLossCents, 500);
  assert.equal(output.totals.investedCents, 7_000);
  assert.equal(output.accounts[0].assetClassSummary, "EQUITY 62.5%, BONDS 37.5%");
  assert.equal(output.accounts[1].name, "Fund");
  assert.deepEqual(output.accounts[1].assetClasses, []);
  assert.equal(output.accounts[2].classificationStatus, "UNCLASSIFIED");
  assert.equal(output.accounts[2].hasValuation, false);
  assert.equal(output.presentation.items.length, 2);
  const query = request("investmentAccount.findMany");
  assert.equal(query.where.OR[2].institutionName.contains, "Broker");
  assert.equal(query.select.entries.where.date.lt.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(query.select.entries.take, 1);
});

test("market history calculates changes and volume from recorded daily bars with dated evidence", async () => {
  const market = { ticker: "ACME", adjusted: true, fetchedAt: now, fromCache: true, sourceUrl: "https://example.test/market", bars: [
    { t: date("2026-09-01").getTime(), o: 9, h: 12, l: 8, c: 10, v: 100 },
    { t: date("2026-09-02").getTime(), o: 10, h: 15, l: 9, c: 12, v: 201 },
  ] };
  external.market = market;
  const { output, evidence } = await run("get_market_history", { ticker: "ACME", ...range });
  assert.equal(output.latestClose, "USD 12.00");
  assert.equal(output.changePercent, 20);
  assert.equal(output.averageVolume, 151);
  assert.equal(output.periodHigh, "USD 15.00");
  assert.equal(output.periodLow, "USD 8.00");
  assert.deepEqual(output.actualPeriod, { start: "2026-09-01", end: "2026-09-02" });
  assert.equal(output.dataRecency, "END_OF_DAY");
  assert.match(evidence[0].detail, /2 trading days · Massive cached/);
  assert.deepEqual(request("market"), { ticker: "ACME", from: "2026-09-01", to: "2026-09-30" });
  external.market = { ...market, fromCache: false, bars: [{ ...market.bars[0], c: 0 }] };
  const single = await run("get_market_history", { ticker: "ACME", ...range });
  assert.equal(single.output.changePercent, null);
  assert.equal(single.output.changePercentFormatted, null);
  assert.match(single.evidence[0].detail, /1 trading day · Massive$/);
});

test("news and financial research retain publisher attribution, authority, and source links", async () => {
  external.news = { query: "interest rates", fetchedAt: now, fromCache: false, articles: [
    { title: "Rates held", source: "Publisher", publishedAt: "2026-09-03", publishedLabel: "yesterday", link: "https://example.test/rates" },
    { title: "Second story", source: null, publishedAt: null, publishedLabel: "2 hours ago", link: "https://example.test/story" },
    { title: "Undated", source: null, publishedAt: null, publishedLabel: null, link: "https://example.test/undated" },
  ] };
  const news = await run("search_market_news", { query: "interest rates" });
  assert.equal(news.output.articleCount, 3);
  assert.deepEqual(news.evidence.map((item) => item.detail), ["Publisher · 2026-09-03", "2 hours ago", "Recent public news result"]);
  assert.ok(news.output.articles.every((article, index) => article.evidenceId === news.evidence[index].id));
  assert.equal(request("news"), "interest rates");
  const authorities = ["OFFICIAL_GOVERNMENT", "ACADEMIC_OR_MULTILATERAL", "REGULATED_OR_PRIMARY", "OTHER"];
  external.publicSearch = { query: "retirement rules", fetchedAt: now, fromCache: true, sources: authorities.map((authority, index) => ({
    title: `Source ${index}`, authority, domain: "example.test", link: `https://example.test/source-${index}`, snippet: "Documented rule", publishedLabel: index === 0 ? "September 2026" : null, normalizedFinancialValues: ["SGD 100.00"],
  })) };
  const research = await run("search_public_financial_sources", { query: "retirement rules" });
  assert.equal(research.output.sourceCount, 4);
  assert.deepEqual(research.evidence.map((item) => item.detail.split(" · ")[0]), ["Official government source", "Academic or multilateral source", "Regulated or primary source", "Other public source"]);
  assert.deepEqual(research.output.sources[0].normalizedFinancialValues, ["SGD 100.00"]);
  external.publicSource = { title: "Public guidance", domain: "example.test", url: "https://example.test/guidance", contentType: "text/html", retrievedAt: now, normalizedFinancialValues: ["SGD 100.00"], excerpt: "The published amount is SGD 100.00." };
  const source = await run("read_authoritative_financial_source", { url: "https://example.test/guidance" });
  assert.equal(source.output.excerpt, external.publicSource.excerpt);
  assert.equal(source.evidence[0].href, external.publicSource.url);
  assert.equal(source.output.retrievedAt, now.toISOString());
});

test("known provider failures return unavailable results while unexpected failures propagate", async () => {
  const cases = [
    ["get_market_history", { ...range, ticker: "ACME" }, "market", MarketError],
    ["search_market_news", { query: "interest rates" }, "news", NewsError],
    ["search_public_financial_sources", { query: "retirement rules" }, "publicSearch", NewsError],
    ["read_authoritative_financial_source", { url: "https://example.test/guidance" }, "publicSource", PublicSourceError],
  ];
  for (const [tool, args, service, ErrorType] of cases) {
    external[service] = new ErrorType("RATE_LIMITED", "Retry later", 45);
    const result = await run(tool, args);
    assert.equal(result.output.ok, false);
    assert.equal(result.output.unavailable, true);
    assert.equal(result.output.code, "RATE_LIMITED");
    assert.equal(result.output.error, "Retry later");
    if (service !== "publicSource") assert.equal(result.output.retryAfterSeconds, 45);
    assert.deepEqual(result.evidence, []);
    const unexpected = new Error("Unexpected failure");
    external[service] = unexpected;
    await assert.rejects(run(tool, args), (error) => error === unexpected);
  }
});

test("knowledge search forwards both workspace and user scope and does not expose provider failures", async () => {
  external.knowledge = [{ title: "Dinner record", content: "Shared dinner", sourceType: "TRANSACTION", sourceId: "dinner", href: "/transactions?transactionId=dinner", score: 0.9, rerankerScore: 0.8 }];
  const result = await run("search_workspace_knowledge", { query: "shared dinner", limit: 4 });
  assert.deepEqual(request("knowledge"), { workspaceId: "household", userId: "owner", query: "shared dinner", limit: 4 });
  assert.equal(result.output.passages[0].content, "Shared dinner");
  assert.equal(result.output.passages[0].evidenceId, result.evidence[0].id);
  external.knowledge = new Error("Private upstream address and credentials");
  const unavailable = await run("search_workspace_knowledge", { query: "shared dinner", limit: 4 });
  assert.equal(unavailable.output.unavailable, true);
  assert.equal(unavailable.output.totalMatches, 0);
  assert.match(unavailable.output.error, /Do not infer/);
  assert.doesNotMatch(JSON.stringify(unavailable), /Private upstream/);
});

test("explicit trip groups show recorded totals and destination flags with scoped supporting links", async () => {
  const trip = { id: "tokyo", name: "Tokyo holiday", icon: null, budget, transactions: [{ date: date("2026-09-01"), amountCents: 1_000 }, { date: date("2026-09-03"), amountCents: 2_000 }] };
  reply("transactionGroup.findMany", [trip, { ...trip, id: "local", name: "Weekend", icon: "🇸🇬", transactions: [{ date: date("2026-09-04"), amountCents: 500 }] }, { ...trip, name: "Household supplies", icon: null, budget: { ...budget, name: "General" } }]);
  const result = await run("get_trip_spending", { ...range, query: null, destination_hints: [] });
  assert.equal(result.output.method, "EXPLICIT_TRIP_GROUPS");
  assert.equal(result.output.estimated, false);
  assert.equal(result.output.totalCents, 3_500);
  assert.deepEqual(result.output.trips.map((trip) => trip.flag), ["🇯🇵", "🇸🇬"]);
  assert.deepEqual(result.output.presentation.items.map((item) => item.dateRange), ["2026-09-01 to 2026-09-03", "2026-09-04"]);
  assert.equal(new URL(result.output.trips[0].href, "https://example.test").searchParams.get("groupId"), "tokyo");
  const where = request("transactionGroup.findMany").select.transactions.where;
  assert.equal(where.workspaceId, "household");
  assert.equal(where.voidedAt, null);
  assert.deepEqual(where.kind, { not: "REVERSAL" });
  const filtered = await run("get_trip_spending", { ...range, query: "TOKYO", destination_hints: [] });
  assert.equal(filtered.output.trips.length, 1);
  assert.equal(filtered.output.totalCents, 3_000);
});

test("trip estimates disclose text matching and derive date extents without exposing foreign subaccounts", async () => {
  reply("transaction.findMany", [
    transaction({ id: "berlin-middle", subject: "Berlin ticket", date: date("2026-09-03"), amountCents: 300 }),
    transaction({ id: "berlin-first", subject: "Berlin museum", date: date("2026-09-01"), amountCents: 200 }),
    transaction({ id: "berlin-last", subject: "Berlin train", date: date("2026-09-06"), amountCents: 500 }),
    transaction({ id: "uk", subject: "UK souvenir", amountCents: 1_200, budget: { workspaceId: "other", name: "Private" } }),
    transaction({ id: "osaka", subject: "Osaka sightseeing", amountCents: 800, budget: null }),
    transaction({ id: "skip", subject: "Weekly groceries", amountCents: 9_000 }),
  ]);
  const result = await run("get_trip_spending", { ...range, query: null, destination_hints: [" Berlin ", "Berlin"] });
  assert.equal(result.output.method, "TRANSACTION_TEXT_ESTIMATE");
  assert.equal(result.output.totalCents, 3_000);
  assert.equal(result.output.estimated, true);
  assert.match(result.output.disclaimer, /may be missed or assigned to the wrong destination/);
  assert.deepEqual(result.output.trips.map((trip) => [trip.name, trip.amountCents, trip.flag]), [["UK", 1_200, "🇬🇧"], ["Berlin", 1_000, "🧳"], ["Osaka", 800, "🇯🇵"]]);
  assert.equal(result.output.trips[0].subAccount, "Matched transactions");
  assert.equal(result.output.trips[1].startDate, "2026-09-01");
  assert.equal(result.output.trips[1].endDate, "2026-09-06");
  const queryHint = await run("get_trip_spending", { ...range, query: "Berlin", destination_hints: [] });
  assert.ok(queryHint.output.trips.some((trip) => trip.name === "Berlin"));
});

test("cash-flow and income comparisons merge merchant aliases and attribute directional changes", async () => {
  reply("transaction.groupBy", ({ where, by }) => {
    const recent = where.date.gte.getUTCMonth() === 8;
    if (by.length === 1) return [sum(recent ? 10_000 : 8_000, 2, { direction: "CREDIT" }), sum(recent ? 3_000 : 4_000, 3, { direction: "DEBIT" })];
    return recent
      ? [sum(10_000, 1, { subject: "Employer", direction: "CREDIT" }), sum(1_000, 1, { subject: "Starbucks", direction: "DEBIT" }), sum(1_000, 1, { subject: "STARBUCKS SG", direction: "DEBIT" }), sum(1_000, 1, { subject: "Grab", direction: "DEBIT" })]
      : [sum(7_000, 1, { subject: "Employer", direction: "CREDIT" }), sum(1_000, 1, { subject: "Bonus", direction: "CREDIT" }), sum(3_000, 1, { subject: "Starbucks", direction: "DEBIT" }), sum(1_000, 1, { subject: "Grab", direction: "DEBIT" })];
  });
  reply("transaction.findMany", [transaction()]);
  const args = { ...comparison, account_name: null };
  const cash = await run("explain_cash_flow_change", args);
  assert.deepEqual([cash.output.change.incomeCents, cash.output.change.spendingCents, cash.output.change.netCents], [2_000, -1_000, 3_000]);
  assert.equal(cash.output.drivers[0].name, "Employer");
  assert.equal(cash.output.drivers[0].changeCents, 3_000);
  assert.equal(cash.output.drivers.find((row) => row.name === "Starbucks").changeCents, -1_000);
  assert.equal(cash.output.periodA.subjects, undefined);
  assert.equal(cash.evidence.length, 2);
  calls.length = 0;
  const income = await run("compare_income", args);
  assert.equal(income.output.changePercent, 25);
  assert.equal(income.output.periodA.totalCents, 10_000);
  assert.deepEqual(income.output.sources.map((row) => row.name), ["Employer", "Bonus"]);
  assert.ok(calls.filter((call) => call.operation === "transaction.findMany").every((call) => call.options.where.direction === "CREDIT"));
});

test("spending drivers merge duplicate merchant names and calculate shares against the full total", async () => {
  reply("transaction.aggregate", sum(4_000, 4));
  reply("transaction.groupBy", [sum(1_000, 1, { subject: "Starbucks" }), sum(2_000, 2, { subject: "STARBUCKS SG" }), sum(1_000, 1, { subject: "Grab" })]);
  reply("transaction.findMany", [transaction()]);
  const args = { ...range, ...filters, dimension: "MERCHANT", limit: 1 };
  const result = await run("get_top_spending_drivers", args);
  assert.equal(result.output.totalCents, 4_000);
  assert.deepEqual(result.output.drivers, [{ name: "Starbucks", amountCents: 3_000, transactionCount: 3, amount: "SGD 30.00", sharePercent: 75 }]);
  assert.deepEqual(request("transaction.findMany").orderBy[0], { amountCents: "desc" });
  reply("transaction.groupBy", [sum(500, 1, { budgetId: "food" }), sum(200, 1, { budgetId: null }), sum(null, 1, { budgetId: "deleted" })]);
  reply("budgetEnvelope.findMany", [budget]);
  const subaccounts = await run("get_top_spending_drivers", { ...args, dimension: "SUB_ACCOUNT", limit: 10 });
  assert.deepEqual(subaccounts.output.drivers.map((row) => row.name), ["Dining", "Unassigned", "Unknown sub-account"]);
  reply("transaction.aggregate", sum(null, 0));
  const zero = await run("get_top_spending_drivers", { ...args, dimension: "SUB_ACCOUNT", limit: 10 });
  assert.equal(zero.output.drivers[2].sharePercent, 0);
});

test("budget versus actual combines allocations and distinguishes overruns, savings, and unplanned spending", async () => {
  const travel = { ...budget, id: "travel", name: "Travel" };
  const fixed = { ...budget, id: "fixed", name: "Fixed" };
  const item = (destination, amountCents) => ({ title: destination.name, amountCents, destinationSubAccountId: destination.id, destinationSubAccount: destination });
  reply("monthlyBudgetPlan.findUnique", { status: "CONFIRMED", updatedAt: now, items: [
    item(budget, 5_000), item(budget, 1_000), item(travel, 2_000), item(fixed, 1_000),
    { title: "Misc", amountCents: 500, destinationSubAccountId: null, destinationSubAccount: null },
  ] });
  reply("budgetEnvelope.findMany", [budget, travel, fixed]);
  const actuals = [sum(7_000, 3, { budgetId: "food" }), sum(500, 1, { budgetId: "travel" }), sum(1_000, 1, { budgetId: "fixed" }), sum(300, 1, { budgetId: null })];
  reply("transaction.groupBy", ({ where }) => where.budgetId?.in ? actuals.filter((row) => where.budgetId.in.includes(row.budgetId)) : actuals);
  reply("transaction.findMany", [transaction()]);
  const args = { year: 2026, month: 9, budget_name: null };
  const { output, evidence } = await run("get_budget_vs_actual", args);
  assert.deepEqual([output.totals.plannedCents, output.totals.actualCents, output.totals.varianceCents], [9_500, 8_800, 700]);
  const byName = new Map(output.rows.map((row) => [row.name, row]));
  assert.equal(byName.get("Dining").status, "OVER");
  assert.equal(byName.get("Dining").usagePercent, 116.67);
  assert.equal(byName.get("Travel").status, "UNDER");
  assert.equal(byName.get("Fixed").status, "ON_PLAN");
  assert.equal(byName.get("Unassigned").status, "UNPLANNED");
  assert.equal(byName.get("Unassigned").usagePercent, null);
  assert.equal(byName.get("Misc").plannedCents, 500);
  assert.match(evidence[0].id, /budget-actual-lunch$/);
  const matched = await run("get_budget_vs_actual", { ...args, budget_name: "Dining" });
  assert.equal(matched.output.rows.length, 1);
  assert.equal(matched.output.rows[0].plannedCents, 6_000);
  reply("budgetEnvelope.findMany", []);
  reply("transaction.groupBy", []);
  const fallback = await run("get_budget_vs_actual", { ...args, budget_name: "Misc" });
  assert.equal(fallback.output.rows.length, 1);
  assert.equal(fallback.output.rows[0].plannedCents, 500);
});

test("recurring payments require enough occurrences at a recognized cadence and report measured totals", async () => {
  const patterns = [["Weekly plan", 7, 100, 2, "WEEKLY"], ["Fortnight plan", 14, 200, 2, "FORTNIGHTLY"], ["Monthly plan", 30, 300, 3, "MONTHLY"], ["Quarterly plan", 90, 400, 2, "QUARTERLY"], ["Annual plan", 365, 500, 2, "ANNUAL"]];
  const transactions = patterns.flatMap(([subject, gap, amountCents, count]) => Array.from({ length: count }, (_, index) => transaction({ id: `${subject}-${index}`, subject, amountCents, date: new Date(date("2025-09-01").getTime() + gap * index * 86400_000) })));
  transactions.push(transaction({ subject: "One-time fee" }), transaction({ subject: "Irregular", date: date("2026-09-01") }), transaction({ subject: "Irregular", date: date("2026-09-21") }));
  transactions.sort((a, b) => a.date - b.date);
  reply("transaction.findMany", transactions);
  const args = { start_date: "2025-09-01", end_date: "2026-09-30", ...filters, min_occurrences: 2, limit: 10 };
  const result = await run("find_recurring_spend", args);
  assert.equal(result.output.totalMatches, 5);
  assert.equal(result.output.patterns[0].cadence, "ANNUAL");
  for (const [name, gap, amount, count, cadence] of patterns) {
    const pattern = result.output.patterns.find((row) => row.merchant.toLowerCase() === name.toLowerCase());
    assert.equal(pattern.medianIntervalDays, gap);
    assert.equal(pattern.cadence, cadence);
    assert.equal(pattern.averageCents, amount);
    assert.equal(pattern.totalCents, amount * count);
    assert.equal(pattern.occurrences, count);
  }
  assert.equal(result.evidence.length, 8);
  assert.equal(request("transaction.findMany").take, 2_000);
  reply("transaction.findMany", Array.from({ length: 2_000 }, (_, index) => transaction({ id: `bulk-${index}`, subject: "Same day purchases" })));
  const capped = await run("find_recurring_spend", args);
  assert.equal(capped.output.truncated, true);
  assert.equal(capped.output.analyzedTransactions, 2_000);
  assert.equal(capped.output.totalMatches, 0);
  assert.match(capped.evidence[0].detail, /2000\+ debit transactions/);
});
