import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, waitFor, within } = ui;
const require = createRequire(import.meta.url);
let pathname = "/w/fixture-workspace/transactions";
let searchParams = new URLSearchParams();
const navigation = [];
const router = { replace: (...args) => navigation.push(args), push: (...args) => navigation.push(args), refresh() {} };
mock.module("next/navigation", { namedExports: {
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
  useRouter: () => router,
} });
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { TransactionsPage } = require("../components/transactions-page.tsx");
const { CreditCardsPage } = require("../components/credit-cards-page.tsx");
const { InvestmentsPage } = require("../components/investments-page.tsx");
const { ReceivablesPage } = require("../components/receivables-page.tsx");
const { CreditTransactionsPage } = require("../components/credit-transactions-page.tsx");
const { RewardsPage } = require("../components/rewards-page.tsx");
const { BudgetPlanPage } = require("../components/budget-plan-page.tsx");
const { ConfirmDialogProvider } = require("../components/confirm-dialog.tsx");

const card = { id: "card-one", cardName: "Daily card", bankName: "DBS", last4Digit: "1234" };
const rewardProps = { initialCreditCards: [], initialFrequentFlyers: [], initialHotelRewards: [], initialConversions: [], availableCards: [] };

let client;
let requests;
let fixtures;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  requests = [];
  navigation.length = 0;
  searchParams = new URLSearchParams();
  ui.window.sessionStorage.clear();
  ui.window.localStorage.clear();
  fixtures = new Map([
    ["/api/context", { workspaceId: "fixture-workspace", workspaceName: "Test household", baseCurrency: "SGD", role: "OWNER", workspaces: [], accounts: [] }],
    ["/api/accounts", []],
    ["/api/budgets", []],
    ["/api/transaction-groups", []],
    ["/api/transactions", { transactions: [], total: 0, page: 1, limit: 50, hasMore: false, nextCursor: null, summary: { incomeCents: 0, expenseCents: 0 } }],
    ["/api/transactions/months", { months: [], total: 0 }],
    ["/api/credit-cards", []],
    ["/api/investments", []],
    ["/api/receivables", []],
    ["/api/receivables/summary", { totalCents: 0 }],
    ["/api/credit-transactions", { transactions: [], cardCounts: [], total: 0, page: 1, limit: 50, hasMore: false, nextCursor: null, summary: { totalAmountCents: 0, unaccountedAmountCents: 0, earliestPaymentDueDate: null } }],
    ["/api/credit-transactions/payment-due", { months: [] }],
    ["/api/rewards", { creditCards: [], frequentFlyers: [], hotelRewards: [], conversions: [], cardsWithoutRewards: [] }],
    ["/api/budgets/plan", { setup: { items: [], sources: [] }, monthlyPlan: null, members: [], subAccounts: [] }],
  ]);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3100");
    const method = init.method ?? "GET";
    const request = { url, method, headers: new Headers(init.headers), body: init.body && JSON.parse(init.body) };
    requests.push(request);
    const fixture = fixtures.get(`${method} ${url.pathname}`) ?? fixtures.get(url.pathname);
    assert.notEqual(fixture, undefined, `Missing response fixture for ${method} ${url.pathname}`);
    if (typeof fixture === "function") return fixture(request);
    assert.equal(method, "GET", "mutations need an explicit response fixture");
    return Response.json(fixture);
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(() => {
  ui.cleanup();
  client.clear();
  globalThis.fetch = originalFetch;
});
after(() => ui.dispose());

function show(Component, route, props = {}) {
  pathname = `/w/fixture-workspace/${route}`;
  ui.window.history.replaceState(null, "", pathname);
  return render(h(QueryClientProvider, { client }, h(ConfirmDialogProvider, null, h(Component, props))));
}

for (const [route, Component, emptyTitle, action, dialog] of [
  ["transactions", TransactionsPage, "No transactions", "Add transaction", "Add transaction"],
  ["credit-cards", CreditCardsPage, "No credit cards yet", "+ Add Your First Card", "Credit card"],
  ["investments", InvestmentsPage, "No investment accounts yet", "+ Add Investment Account", "Investment account"],
  ["receivables", ReceivablesPage, "No open receivables for this month", "+ Add Receivable", "Add receivable"],
]) {
  test(`${route} loads the selected workspace and offers a cancellable first-record form`, async () => {
    const view = show(Component, route);
    await view.findByRole("heading", { name: emptyTitle });
    assert.ok(requests.some((request) => request.url.pathname === "/api/context"));
    assert.ok(requests.every((request) => request.headers.get("x-workspace-id") === "fixture-workspace"));
    fireEvent.click(view.getByRole("button", { name: action, exact: true }));
    const form = await view.findByRole("dialog", { name: dialog, exact: true });
    assert.ok(form.querySelector("input"), "a user can enter a new record");
    fireEvent.click(within(form).getByRole("button", { name: "Cancel", exact: true }));
    assert.equal(view.queryByRole("dialog"), null);
    assert.ok(requests.every((request) => request.method === "GET"), "cancel must not persist any changes");
  });
}

for (const [route, Component, failureTitle, emptyTitle] of [
  ["investments", InvestmentsPage, "Failed to load investments", "No investment accounts yet"],
  ["receivables", ReceivablesPage, "Failed to load receivables", "No open receivables for this month"],
]) {
  test(`${route} recovers from a failed request when the user retries`, async () => {
    fixtures.set(`/api/${route}`, () => Response.json({ error: "Temporary failure" }, { status: 503 }));
    const view = show(Component, route);
    await view.findByRole("heading", { name: failureTitle });
    fixtures.set(`/api/${route}`, []);
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await view.findByRole("heading", { name: emptyTitle });
    assert.equal(view.queryByRole("heading", { name: failureTitle }), null);
    assert.equal(requests.filter((request) => request.url.pathname === `/api/${route}`).length, 2);
  });
}

test("transaction search survives a refresh and sends a scoped filter to the server", async () => {
  ui.window.sessionStorage.setItem("nest:view:transactions:search", JSON.stringify("groceries"));
  const view = show(TransactionsPage, "transactions");
  await view.findByRole("heading", { name: "No matching transactions" });
  await waitFor(() => {
    const request = requests.find((item) => item.url.pathname === "/api/transactions" && item.url.searchParams.get("search") === "groceries");
    assert.ok(request);
    assert.equal(request.url.searchParams.get("workspaceId"), "fixture-workspace");
  });
  assert.ok(view.getByText("No transactions match “groceries”."));
});

test("card transactions explain the required card and link to the current workspace", async () => {
  const view = show(CreditTransactionsPage, "credit-transactions", { initialCards: [] });
  await view.findByRole("heading", { name: "Add a credit card first" });
  assert.equal(view.getByRole("link", { name: "Add a credit card" }).getAttribute("href"), "/w/fixture-workspace/credit-cards?add=1");
  assert.equal(view.queryByRole("button", { name: "Add card transaction" }), null);
});

test("card transactions open a form for the selected card without persisting a cancelled entry", async () => {
  const view = show(CreditTransactionsPage, "credit-transactions", { initialCards: [card] });
  await view.findByRole("heading", { name: "No transactions yet" });
  fireEvent.click(view.getByRole("button", { name: "Add card transaction" }));
  const dialog = await view.findByRole("dialog", { name: "Credit card transaction" });
  assert.ok(within(dialog).getByRole("option", { name: /Daily card/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  assert.equal(view.queryByRole("dialog"), null);
  assert.ok(requests.every((request) => request.method === "GET"));
});

test("rewards tabs show each empty state and preserve cancellable program forms", async () => {
  const view = show(RewardsPage, "rewards", rewardProps);
  await view.findByRole("heading", { name: "No credit card rewards" });
  for (const [tab, title, action, dialogName] of [
    ["Frequent flyer", "No frequent flyer programs", "Add frequent flyer", "Frequent flyer account"],
    ["Hotel rewards", "No hotel rewards programs", "Add hotel rewards", "Hotel reward account"],
  ]) {
    fireEvent.click(view.getByRole("button", { name: tab, exact: true }));
    await view.findByRole("heading", { name: title });
    fireEvent.click(view.getByRole("button", { name: action, exact: true }));
    const dialog = await view.findByRole("dialog", { name: dialogName });
    assert.ok(within(dialog).getByLabelText(/Program Name/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    assert.equal(view.queryByRole("dialog"), null);
  }
  fireEvent.click(view.getByRole("button", { name: "Conversions", exact: true }));
  await view.findByRole("heading", { name: "No conversions yet" });
  assert.ok(view.getByText("Add at least one credit card reward and one frequent flyer program to create conversions."));
  assert.equal(view.queryByRole("button", { name: "Add conversion rate" }), null);
  fireEvent.click(view.getByRole("button", { name: "Credit cards", exact: true }));
  await view.findByRole("heading", { name: "No credit card rewards" });
  assert.ok(requests.every((request) => request.method === "GET"));
});

test("budget setup is separate from a monthly plan and supports cancelling both template forms", async () => {
  const view = show(BudgetPlanPage, "budgets");
  await view.findByRole("heading", { name: "No monthly budget" });
  assert.equal(view.getByRole("button", { name: "Start from Setup" }).disabled, true);
  fireEvent.click(view.getByRole("button", { name: "Budget Setup", exact: true }));
  await view.findByRole("heading", { name: "Budget Setup" });
  for (const kind of ["Source", "Item"]) {
    fireEvent.click(view.getByRole("button", { name: `Add ${kind}`, exact: true }));
    const dialog = await view.findByRole("dialog", { name: `Add Setup ${kind}` });
    assert.ok(within(dialog).getByLabelText("Title"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    assert.equal(view.queryByRole("dialog"), null);
  }
  fireEvent.click(view.getByRole("button", { name: "Monthly Budget", exact: true }));
  await view.findByRole("heading", { name: "No monthly budget" });
  assert.ok(requests.every((request) => request.method === "GET"));
});
