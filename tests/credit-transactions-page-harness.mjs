import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";
import { bankFixture, budgetFixture, deferred } from "./transactions-page-harness.mjs";

export { bankFixture, budgetFixture, deferred };
export const cardFixture = (overrides = {}) => ({ id: "card-one", cardName: "Daily card", bankName: "DBS", last4Digit: "1234", ...overrides });
export const creditFixture = (overrides = {}) => ({
  id: "cafe", updatedAt: "2026-10-10T08:00:00.000Z", creditCardId: "card-one", transactionDate: "2026-10-10T00:00:00.000Z",
  paymentDueDate: "2026-10-20T00:00:00.000Z", statementMonth: 10, statementYear: 2026, amountCents: 1200,
  subject: "Cafe", isAllocated: false, creditCard: { cardName: "Daily card", bankName: "DBS" }, ...overrides,
});
export const creditResponse = (rows = [creditFixture()], overrides = {}) => {
  const counts = new Map();
  for (const row of rows) if (!row.isAllocated) counts.set(row.creditCardId, (counts.get(row.creditCardId) ?? 0) + 1);
  return { transactions: rows, total: rows.length, page: 1, limit: 50, hasMore: false, nextCursor: null,
    cardCounts: [...counts].map(([creditCardId, count]) => ({ creditCardId, _count: { id: count } })),
    summary: { totalAmountCents: rows.reduce((sum, row) => sum + row.amountCents, 0), unaccountedAmountCents: rows.filter(row => !row.isAllocated).reduce((sum, row) => sum + row.amountCents, 0), earliestPaymentDueDate: rows[0]?.paymentDueDate ?? null }, ...overrides };
};
export const deductAction = (overrides = {}) => ({ type: "DEDUCT", accountId: "bank-home", accountName: "Household bank", budgetId: "food", budgetName: "Food", ...overrides });
export const suggestionFixture = (overrides = {}) => ({ transactionId: "cafe", inputFingerprint: "trusted-fingerprint", generatedAt: "2026-10-11T00:00:00.000Z", normalizedMerchant: "Cafe", nameRecommendation: null, confidence: "STRONG_MATCH", state: "UNACCOUNTED", action: deductAction(), evidence: ["Matched prior accounting"], supportingCount: 3, canApprove: true, generatedBy: "DETERMINISTIC", ...overrides });

export async function createCreditTransactionsHarness() {
  const ui = await createReactHarness();
  const oldCss = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  Object.defineProperty(globalThis, "CSS", { configurable: true, writable: true, value: ui.window.CSS });
  const require = createRequire(import.meta.url);
  let searchParams = new URLSearchParams();
  const navigation = [];
  const router = { push: path => navigation.push(path), replace: path => navigation.push(path) };
  mock.module("next/navigation", { namedExports: {
    usePathname: () => ui.window.location.pathname, useSearchParams: () => searchParams, useRouter: () => router,
  } });
  const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
  const { ConfirmDialogProvider } = require("../components/confirm-dialog.tsx");
  const { CreditTransactionsPage } = require("../components/credit-transactions-page.tsx");
  const { setPrivacyMode } = require("../lib/privacy-mode.ts");
  const fixtures = new Map(), requests = [], invalidations = [], unexpected = [];
  let client, refetchOnInvalidation;
  const setUrl = (query = "cardId=card-one&month=10&year=2026&unaccounted=0", pathname = "/w/household/credit-transactions") => {
    searchParams = new URLSearchParams(query);
    ui.window.history.replaceState(null, "", `${pathname}?${searchParams}`);
  };
  beforeEach(t => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T00:00:00.000Z") });
    for (const list of [navigation, requests, invalidations, unexpected]) list.length = 0;
    fixtures.clear();
    ui.window.sessionStorage.clear();
    ui.window.localStorage.clear();
    for (const cookie of document.cookie.split(";")) document.cookie = `${cookie.split("=")[0].trim()}=; Max-Age=0; Path=/`;
    setPrivacyMode(false);
    setUrl();
    fixtures.set("GET /api/context", { workspaceId: "household", workspaceName: "Home", role: "OWNER", baseCurrency: "SGD", defaultAccountId: "bank-home", defaultBudgetId: "card-fund", workspaces: [{ id: "household", name: "Home" }, { id: "shared", name: "Family" }] });
    fixtures.set("GET /api/accounts", [bankFixture(), bankFixture({ id: "bank-joint", name: "Joint bank", bankName: null })]);
    fixtures.set("GET /api/budgets", [budgetFixture({ isActive: true }), budgetFixture({ id: "card-fund", name: "Card fund", isActive: true, availableCents: 1200 }), budgetFixture({ id: "travel", accountId: "bank-joint", name: "Travel", isActive: true })]);
    fixtures.set("GET /api/receivables/summary", { totalCents: 0 });
    fixtures.set("GET /api/credit-transactions", creditResponse());
    fixtures.set("GET /api/credit-transactions/payment-due", { months: [{ statementMonth: 10, paymentDueDate: "2026-10-20T00:00:00.000Z" }] });
    fixtures.set("POST /api/ai/smart-review", { suggestions: [suggestionFixture()], providerStatus: "READY", generatedAt: "2026-10-11T00:00:00.000Z" });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } } });
    refetchOnInvalidation = true;
    const invalidate = client.invalidateQueries.bind(client);
    t.mock.method(client, "invalidateQueries", (options, ...args) => {
      invalidations.push(options);
      return refetchOnInvalidation ? invalidate(options, ...args) : Promise.resolve();
    });
    t.mock.method(globalThis, "fetch", async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3100");
      const method = init.method ?? "GET";
      const received = { url, method, headers: new Headers(init.headers), body: init.body && JSON.parse(init.body) };
      requests.push(received);
      const key = `${method} ${url.pathname}`;
      if (!fixtures.has(key)) { unexpected.push(key); throw new Error(`Missing response fixture: ${key}`); }
      const fixture = fixtures.get(key);
      if (typeof fixture === "function") return fixture(received);
      return fixture instanceof Response ? fixture.clone() : Response.json(fixture);
    });
  });
  afterEach(async () => {
    ui.cleanup();
    client.clear();
    await ui.window.happyDOM.abort();
    assert.deepEqual(unexpected, [], "No error state may conceal an unconfigured request");
  });
  after(async () => {
    await ui.dispose();
    if (oldCss) Object.defineProperty(globalThis, "CSS", oldCss);
    else delete globalThis.CSS;
  });
  const element = (cards = [cardFixture()]) => ui.h(QueryClientProvider, { client }, ui.h(ConfirmDialogProvider, null, ui.h(CreditTransactionsPage, { initialCards: cards })));
  const writes = () => requests.filter(({ method, url }) => method !== "GET" && url.pathname !== "/api/ai/smart-review");
  const row = (view, subject = "Cafe") => ui.within(view.getByRole("button", { name: `Edit transaction: ${subject}` }).closest("tr"));
  return { ui, require, fixtures, requests, invalidations, navigation, setUrl, element, row, writes,
    client: () => client, holdRefetches: () => { refetchOnInvalidation = false; },
    show: cards => ui.render(element(cards)), loaded: view => view.findByRole("button", { name: "Edit transaction: Cafe" }),
    change: (view, label, value) => ui.fireEvent.change(view.getByLabelText(label), { target: { value } }),
  };
}
