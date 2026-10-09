import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

export const bankFixture = (overrides = {}) => ({ id: "bank-home", workspaceId: "household", name: "Household bank", bankName: "DBS", startingCents: 100000, currentBalanceCents: 100000, linkedBudgetTotalCents: 80000, discrepancyCents: 20000, description: null, isActive: true, updatedAt: "2026-10-10T00:00:00.000Z", ...overrides });
export const budgetFixture = (overrides = {}) => ({ id: "food", accountId: "bank-home", name: "Food", icon: "🍔", isSavings: false, availableCents: 60000, targetCents: 10000, receivableReservedCents: 0, ...overrides });
export const transactionFixture = (overrides = {}) => ({ id: "groceries", accountId: "bank-home", budgetId: "food", groupId: null, group: null, subject: "Groceries", details: null, notes: null, amountCents: 1200, direction: "DEBIT", kind: "EXPENSE", date: "2026-10-09T00:00:00.000Z", ...overrides });
export const transactionResponse = (rows = [transactionFixture()], overrides = {}) => ({ transactions: rows, total: rows.length, page: 1, limit: 50, hasMore: false, nextCursor: null, summary: { incomeCents: 0, expenseCents: 1200 }, ...overrides });
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

export async function createTransactionsPageHarness() {
  const ui = await createReactHarness();
  const require = createRequire(import.meta.url);
  let searchParams = new URLSearchParams();
  const navigation = [];
  mock.module("next/navigation", { namedExports: {
    usePathname: () => ui.window.location.pathname,
    useSearchParams: () => searchParams,
    useRouter: () => ({ push: (path) => navigation.push(path), replace: (path) => navigation.push(path) }),
  } });
  const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
  const { ConfirmDialogProvider } = require("../components/confirm-dialog.tsx");
  const { TransactionsPage } = require("../components/transactions-page.tsx");
  const { setPrivacyMode } = require("../lib/privacy-mode.ts");
  const fixtures = new Map();
  const requests = [], unexpected = [], invalidations = [];
  let client;
  const setUrl = (query = "period=all") => {
    searchParams = new URLSearchParams(query);
    ui.window.history.replaceState(null, "", `/w/household/transactions?${searchParams}`);
  };
  beforeEach((t) => {
    fixtures.clear();
    for (const array of [requests, unexpected, invalidations, navigation]) array.length = 0;
    ui.window.sessionStorage.clear();
    ui.window.localStorage.clear();
    for (const cookie of document.cookie.split(";")) document.cookie = `${cookie.split("=")[0].trim()}=; Max-Age=0; Path=/`;
    setPrivacyMode(false);
    setUrl();
    fixtures.set("GET /api/context", { workspaceId: "household", workspaceName: "Home", role: "OWNER", baseCurrency: "SGD" });
    fixtures.set("GET /api/accounts", [bankFixture(), bankFixture({ id: "bank-joint", name: "Joint bank", bankName: null, currentBalanceCents: 40000, linkedBudgetTotalCents: 40000 })]);
    fixtures.set("GET /api/budgets", [budgetFixture(), budgetFixture({ id: "savings", name: "Save", isSavings: true, icon: null, availableCents: 20000, targetCents: 0 }), budgetFixture({ id: "travel", accountId: "bank-joint", name: "Travel", icon: "✈️", availableCents: 40000 })]);
    fixtures.set("GET /api/transaction-groups", []);
    fixtures.set("GET /api/transactions", transactionResponse());
    fixtures.set("GET /api/transactions/months", { months: [{ monthKey: "2026-10", monthLabel: "October 2026", count: 1, incomeCents: 0, expenseCents: 1200 }], total: 1 });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
    const invalidate = client.invalidateQueries.bind(client);
    t.mock.method(client, "invalidateQueries", (options, ...args) => { invalidations.push(options); return invalidate(options, ...args); });
    t.mock.method(globalThis, "fetch", async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3100");
      const method = init.method ?? "GET";
      const request = { url, method, headers: new Headers(init.headers), body: init.body && JSON.parse(init.body) };
      requests.push(request);
      const key = `${method} ${url.pathname}`;
      if (!fixtures.has(key)) { unexpected.push(key); throw new Error(`Missing response fixture: ${key}`); }
      const fixture = fixtures.get(key);
      if (typeof fixture === "function") return fixture(request);
      return fixture instanceof Response ? fixture.clone() : Response.json(fixture);
    });
  });
  afterEach(async () => {
    ui.cleanup();
    client.clear();
    await ui.window.happyDOM.abort();
    assert.deepEqual(unexpected, [], "Unexpected requests cannot be hidden by the application's error handling");
  });
  after(() => ui.dispose());
  const element = () => ui.h(QueryClientProvider, { client }, ui.h(ConfirmDialogProvider, null, ui.h(TransactionsPage)));
  return { ui, require, fixtures, requests, invalidations, navigation, setUrl, client: () => client, element, show: () => ui.render(element()), loaded: (view) => view.findByRole("button", { name: "Correct transaction Groceries" }), writes: () => requests.filter((request) => request.method !== "GET") };
}
