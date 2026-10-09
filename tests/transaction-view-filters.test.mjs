import assert from "node:assert/strict";
import test from "node:test";
import { resolveTransactionUrlFilters, transactionMonthSummaryUrl } from "../lib/transaction-view-filters.ts";
import { getBudgetIcon, getContextualGroupDefaults, groupTransactionsByMonth } from "../lib/transaction-presentation.ts";

const accounts = [{ id: "home", name: "Daily account", bankName: "DBS" }, { id: "joint", name: "Joint account", bankName: "OCBC" }, { id: "cash", name: "Cash", bankName: null }];
const budgets = [{ id: "food", accountId: "home", name: "Groceries" }, { id: "travel", accountId: "joint", name: "Travel fund" }];
const now = new Date(2026, 9, 10, 12);
const resolve = (query, bankOptions = accounts, budgetOptions = budgets) => resolveTransactionUrlFilters(new URLSearchParams(query), bankOptions, budgetOptions, now);

test("recognized URL filters scope the bank and sub-account together and reject conflicting records", () => {
  for (const query of ["", "unrelated=value", "period=custom", "period=unknown", "accountName=Daily", "search=   "]) assert.equal(resolve(query), null);
  assert.deepEqual(resolve("accountId=home&budgetId=food&groupId=weekly"), { accountId: "home", budgetId: "food", groupId: "weekly", search: "", dates: null });
  assert.equal(resolve("accountId=joint&budgetId=food&groupId=weekly").budgetId, "ALL");
  assert.equal(resolve("accountId=joint&budgetId=food&groupId=weekly").groupId, "ALL");
  assert.equal(resolve("budgetId=travel").accountId, "joint");
  assert.equal(resolve("accountId=unknown&budgetId=food").accountId, "home");
  assert.equal(resolve("accountId=unknown&budgetId=missing").accountId, "");
  assert.equal(resolve("budgetId=unknown&budgetName=Groceries").budgetId, "ALL");
  assert.equal(resolve("transactionId=target").budgetId, "ALL");
  assert.equal(resolve("groupId=unscoped").groupId, "ALL");
});

test("assistant links resolve account and budget names without accepting an unrelated account", () => {
  for (const name of ["  daily  ", "  dBs  "]) assert.equal(resolve(new URLSearchParams({ view: "ask-nest", accountName: name })).accountId, "home");
  assert.equal(resolve("view=ask-nest&accountId=missing&accountName=joint").accountId, "joint");
  assert.equal(resolve("view=ask-nest&accountName=missing").accountId, "");
  assert.equal(resolve("view=ask-nest&budgetName=+TRAVEL+").budgetId, "travel");
  assert.equal(resolve("view=ask-nest&budgetName=missing").budgetId, "ALL");
  assert.equal(resolve("view=ask-nest&accountName=cash&budgetName=Travel").budgetId, "ALL");
  assert.equal(resolve("view=ask-nest&accountName=cash").accountId, "cash");
});

test("All and quick periods override stale date ranges and custom-month selections", () => {
  assert.deepEqual(resolve("period=all&from=2020-01-01&to=2020-02-01&months=2020-01").dates, { activeQuickSelect: null, customMonths: [], dateFilter: {} });
  for (const [period, from, to] of [["thisMonth", "2026-10-01", "2026-10-31"], ["lastMonth", "2026-09-01", "2026-09-30"], ["thisYear", "2026-01-01", "2026-12-31"]]) {
    assert.deepEqual(resolve(`period=${period}&months=2020-01&from=2020-01-01`).dates, { activeQuickSelect: period, customMonths: [], dateFilter: { from, to } });
  }
  assert.deepEqual(resolve("view=ask-nest").dates, { activeQuickSelect: null, customMonths: [], dateFilter: {} });
  assert.equal(resolve("search=groceries").dates, null);
});

test("custom months are unique, bounded, sorted, and expanded to UTC calendar boundaries", () => {
  assert.deepEqual(resolve("months=2026-03,2026-01,2026-03,2026-13,invalid&from=2000-01-01").dates, { activeQuickSelect: "custom", customMonths: ["2026-01", "2026-03"], dateFilter: { from: "2026-01-01", to: "2026-03-31" } });
  assert.equal(resolve("months=2024-02").dates.dateFilter.to, "2024-02-29");
  const many = Array.from({ length: 30 }, (_, index) => `${2020 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`);
  assert.equal(resolve(new URLSearchParams({ months: many.join(",") })).dates.customMonths.length, 24);
  assert.deepEqual(resolve("months=invalid&from=2026-01-10").dates.dateFilter, { from: "2026-01-10", to: undefined });
  assert.deepEqual(resolve("to=2026-02-12").dates.dateFilter, { from: undefined, to: "2026-02-12" });
  assert.deepEqual(resolve("from=2026-01-10&to=2026-02-12").dates.dateFilter, { from: "2026-01-10", to: "2026-02-12" });
  assert.equal(resolve("months=invalid").dates, null);
});

test("search filters preserve text while bounding its length and summary URLs encode every selected identifier", () => {
  const result = resolve(new URLSearchParams({ search: `  ${"a".repeat(130)}  ` }));
  assert.equal(result.search, "a".repeat(120));
  const defaults = resolveTransactionUrlFilters(new URLSearchParams("period=all"), [], []);
  assert.equal(defaults.accountId, "");
  assert.equal(defaults.budgetId, "ALL");
  const url = new URL(transactionMonthSummaryUrl("a&b", "bank/id", "food & drink"), "https://example.test");
  assert.equal(url.pathname, "/api/transactions/months");
  assert.deepEqual(Object.fromEntries(url.searchParams), { workspaceId: "a&b", accountId: "bank/id", budgetId: "food & drink" });
  assert.equal(transactionMonthSummaryUrl("home", "", "ALL"), "/api/transactions/months?workspaceId=home");
});

test("transaction month groups use UTC dates, descending months, and separate income and expense totals", () => {
  const rows = [
    { id: "a", date: "2026-10-01T00:30:00+08:00", amountCents: 1000, direction: "CREDIT" },
    { id: "b", date: "2026-10-02T00:00:00Z", amountCents: 200, direction: "DEBIT" },
    { id: "c", date: "2026-10-03T00:00:00Z", amountCents: 300, direction: "CREDIT" },
    { id: "d", date: "2026-09-29T00:00:00Z", amountCents: 100, direction: "DEBIT" },
  ];
  const original = structuredClone(rows);
  const result = groupTransactionsByMonth(rows);
  assert.deepEqual(result.map((item) => [item.monthKey, item.totalIncome, item.totalExpense, item.transactions.map((row) => row.id)]), [["2026-10", 300, 200, ["b", "c"]], ["2026-09", 1000, 100, ["a", "d"]]]);
  assert.ok(result[0].monthLabel.includes("2026"));
  assert.deepEqual(rows, original);
  assert.deepEqual(groupTransactionsByMonth([]), []);
});

test("budget icons honor saved choices and supply recognizable defaults for common sub-accounts", () => {
  assert.equal(getBudgetIcon("Save", "⭐"), "⭐");
  for (const [name, icon] of [["SAVE", "🛡️"], ["Home loan", "🏠"], ["Insurance", "🧾"], ["Phone", "📱"], ["Credit card", "💳"], ["Groceries", "💰"]]) assert.equal(getBudgetIcon(name), icon);
});

test("group suggestions follow the sub-account's purpose and most recent valid transaction date", () => {
  const cases = [["Holiday", "🧳", "Japan trip"], ["Home", "🛠️", "Kitchen renovation"], ["Medical", "🏥", "Insurance claim"], ["Car", "🚗", "Major service"], ["Family", "🎁", "Mum's birthday"], ["Education", "🎓", "Design course"], ["Business", "💼", "Client project"], ["Wedding", "💍", "Wedding expenses"]];
  for (const [name, icon, example] of cases) {
    const result = getContextualGroupDefaults({ name, icon: "other" }, [{ date: "2026-01-01T12:00:00Z" }, { date: "invalid" }, { date: "2026-08-10T12:00:00Z" }], now);
    assert.equal(result.icon, icon);
    assert.equal(result.placeholder, `e.g. ${example}`);
    assert.equal(result.suggestedName, `${name} · ${new Date("2026-08-10T12:00:00Z").toLocaleDateString(undefined, { month: "short", year: "numeric" })}`);
  }
  assert.equal(getContextualGroupDefaults({ name: "Miscellaneous", icon: "⭐" }, [], now).icon, "⭐");
  const fallback = getContextualGroupDefaults(undefined, [{ date: "invalid" }], now);
  assert.equal(fallback.icon, "📌");
  assert.equal(fallback.placeholder, "e.g. Annual renewal");
  assert.ok(fallback.suggestedName.startsWith("Transactions · "));
  assert.equal(getContextualGroupDefaults({ name: "Other" }, []).icon, "📌");
});
