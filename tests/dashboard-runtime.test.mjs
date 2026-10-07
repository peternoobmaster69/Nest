import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, waitFor, within } = ui;
const require = createRequire(import.meta.url);
const navigation = [];
const router = { push: (href) => navigation.push(href), replace: (href) => navigation.push(href), refresh() {} };
mock.module("next/navigation", { namedExports: {
  usePathname: () => "/w/household",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => router,
} });
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { DashboardShell } = require("../components/dashboard-shell.tsx");
const { CashFlowChart } = require("../components/dashboard/cash-flow-chart.tsx");
const { ConfirmDialogProvider } = require("../components/confirm-dialog.tsx");
const { ToastProvider } = require("../components/toast-provider.tsx");
const now = new Date("2026-10-07T04:00:00Z");
const bank = { id: "bank", workspaceId: "household", name: "Daily bank", bankName: "DBS", startingCents: 10_000, currentBalanceCents: 10_000, linkedBudgetTotalCents: 7_000, discrepancyCents: 3_000, description: null, isActive: true, updatedAt: "2026-10-06T00:00:00Z" };
const secondBank = { ...bank, id: "spare", name: "Spare bank", bankName: "Local cooperative", startingCents: 2_000, currentBalanceCents: 2_000, linkedBudgetTotalCents: 3_000, discrepancyCents: -1_000 };
const budget = { id: "dining", accountId: "bank", name: "Dining", isSavings: false, availableCents: 4_000, targetCents: 6_000, monthlyOutgoingCents: 2_000 };
const baseContext = { workspaceId: "household", workspaceName: "Test household", baseCurrency: "SGD", role: "OWNER", defaultUserId: "owner", defaultAccountId: "bank", accounts: [], workspaces: [] };
const emptySummary = { totalBalanceCents: 0, bankDiscrepancies: [], budgets: [], recentTransactions: [], cashFlow: [] };
const originalFetch = globalThis.fetch;
let requests;
let fixtures;
let client;
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  requests = [];
  fixtures = new Map([
    ["/api/context", baseContext], ["/api/dashboard/summary", emptySummary],
    ["/api/accounts", []], ["/api/budgets", []], ["/api/receivables", []], ["/api/investments", []],
    ["/api/transactions", { transactions: [], total: 0, page: 1, limit: 5, hasMore: false, nextCursor: null }],
  ]);
  navigation.length = 0;
  ui.window.sessionStorage.clear();
  ui.window.localStorage.clear();
  ui.window.history.replaceState(null, "", "/w/household");
  for (const cookie of ui.window.document.cookie.split(";")) {
    ui.window.document.cookie = `${cookie.split("=")[0].trim()}=; Max-Age=0; Path=/`;
  }
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3100");
    const method = init.method ?? "GET";
    const request = { url, method, headers: new Headers(init.headers), body: init.body && JSON.parse(init.body) };
    requests.push(request);
    const fixture = fixtures.get(`${method} ${url.pathname}`) ?? fixtures.get(url.pathname);
    assert.notEqual(fixture, undefined, `Missing ${method} ${url.pathname} fixture`);
    if (typeof fixture === "function") return fixture(request);
    assert.equal(method, "GET", "Mutations must have an explicit response fixture");
    return Response.json(fixture);
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  ui.cleanup();
  client.clear();
  await ui.window.happyDOM.abort();
  globalThis.fetch = originalFetch;
});
after(() => ui.dispose());
function show() {
  return render(h(QueryClientProvider, { client }, h(ToastProvider, null, h(ConfirmDialogProvider, null, h(DashboardShell, { userName: "Test Owner", userEmail: "owner@example.test" })))));
}
function populated() {
  const savings = { ...budget, id: "savings", name: "Emergency fund", icon: "🛡️", isSavings: true, availableCents: 3_000 };
  const spareBudget = { ...budget, id: "travel", name: "Travel", accountId: "spare", availableCents: -500 };
  fixtures.set("/api/accounts", [bank, secondBank]);
  fixtures.set("/api/budgets", [budget, savings, spareBudget]);
  fixtures.set("/api/receivables", [{ status: "OPEN" }, { status: "PAID" }]);
  fixtures.set("/api/investments", [{ id: "fund", entries: [
    { id: "old", date: "2026-08-01", createdAt: "2026-08-01", investedCents: 100, currentValueCents: 1_000 },
    { id: "new", date: "2026-09-01", createdAt: "2026-09-01", investedCents: 2_000, currentValueCents: 2_500 },
  ] }, { id: "no-valuations", entries: [] }]);
  fixtures.set("/api/dashboard/summary", { ...emptySummary, totalBalanceCents: 12_000, budgets: [budget, savings, spareBudget], bankDiscrepancies: [bank, secondBank] });
  fixtures.set("/api/transactions", { transactions: [
    { id: "salary", accountId: "bank", budgetId: "savings", subject: "Salary", date: "2026-10-01", direction: "CREDIT", kind: "STANDARD", amountCents: 10_000 },
    { id: "lunch", accountId: "bank", budgetId: "dining", subject: "Restaurant lunch", date: "2026-10-02", direction: "DEBIT", kind: "STANDARD", amountCents: 500 },
    { id: "taxi", accountId: "spare", budgetId: null, subject: "Taxi", date: "2026-10-03", direction: "DEBIT", kind: "STANDARD", amountCents: 0 },
  ], total: 3, page: 1, limit: 5, hasMore: false, nextCursor: null });
}

test("empty dashboard distinguishes missing records and supplies scoped first actions", async () => {
  const view = show();
  await view.findByRole("heading", { name: "No cash flow yet" });
  await view.findByRole("heading", { name: "No transactions yet" });
  await view.findByRole("heading", { name: "No credit card transactions" });
  assert.ok(requests.every((request) => request.headers.get("x-workspace-id") === "household"));
  const overview = view.getByRole("region", { name: "Available bank balance" });
  assert.equal(within(overview).getByRole("link", { name: "Transactions" }).getAttribute("href"), "/w/household/transactions");
  fireEvent.click(view.getByRole("button", { name: "New sub-account" }));
  const dialog = await view.findByRole("dialog", { name: "Create sub-account" });
  assert.ok(within(dialog).getByLabelText("Name"));
  assert.ok(within(dialog).getByLabelText("Bank account"));
  assert.ok(within(dialog).getByLabelText("Monthly limit (optional)"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  assert.ok(!view.queryByRole("dialog"));
  assert.ok(requests.every((request) => request.method === "GET"));
});

test("dashboard totals use the latest valuation and bank selection persists in the current workspace", async () => {
  populated();
  const view = show();
  const overview = await view.findByRole("region", { name: "Available bank balance" });
  await waitFor(() => assert.match(overview.textContent, /55\.00/));
  assert.match(overview.textContent, /120\.00/);
  assert.match(overview.textContent, /65\.00/);
  assert.match(overview.textContent, /25\.00%/);
  assert.ok(view.getByText("Daily bank has funds not represented in sub-accounts."));
  assert.ok(view.getByText("Spare bank sub-accounts exceed its bank balance."));
  fireEvent.click(within(overview).getByRole("button", { name: /Dining/ }));
  assert.equal(navigation.at(-1), "/w/household/transactions?budgetId=dining&accountId=bank");
  fireEvent.click(view.getByRole("button", { name: "Choose bank" }));
  fireEvent.click(within(view.getByRole("menu", { name: "Bank options" })).getByRole("button", { name: "Spare bank" }));
  await view.findByRole("button", { name: "Edit Spare bank balance" });
  await waitFor(() => assert.ok(requests.some((request) => request.url.pathname === "/api/transactions" && request.url.searchParams.get("accountId") === "spare")));
  assert.match(ui.window.document.cookie, /spare/);
  assert.ok(!within(overview).queryByRole("button", { name: /Dining/ }));
  fireEvent.click(view.getByRole("button", { name: "Choose bank" }));
  fireEvent.mouseDown(ui.window.document.body);
  assert.ok(!view.queryByRole("menu", { name: "Bank options" }));
  fireEvent.click(view.getByRole("button", { name: "Choose bank" }));
  fireEvent.click(within(view.getByRole("menu", { name: "Bank options" })).getByRole("button", { name: "All banks" }));
  await waitFor(() => assert.ok(!view.queryByRole("button", { name: "Edit Spare bank balance" })));
  fireEvent.click(within(view.getByRole("region", { name: "Recent transactions" })).getByRole("button", { name: "View all" }));
  assert.equal(navigation.at(-1), "/w/household/transactions");
});

test("sub-account creation rolls back an optimistic change and preserves the form for a retry", async () => {
  populated();
  let finishRequest;
  fixtures.set("POST /api/budgets", () => new Promise((resolve) => { finishRequest = resolve; }));
  const view = show();
  await view.findByRole("region", { name: "Available bank balance" });
  await waitFor(() => assert.equal(client.getQueryData(["budgets", "household"])?.length, 3));
  fireEvent.click(view.getByRole("button", { name: "New sub-account" }));
  const dialog = await view.findByRole("dialog", { name: "Create sub-account" });
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Holiday fund  " } });
  fireEvent.change(within(dialog).getByLabelText("Bank account"), { target: { value: "bank" } });
  fireEvent.change(within(dialog).getByLabelText("Monthly limit (optional)"), { target: { value: "123.45" } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create", exact: true }));
  await waitFor(() => assert.ok(finishRequest));
  assert.equal(client.getQueryData(["budgets", "household"])[0].name, "Holiday fund");
  assert.equal(client.getQueryData(["budgets", "household"])[0].targetCents, 12_345);
  await ui.act(async () => finishRequest(Response.json({ error: "Try again later" }, { status: 503 })));
  await view.findByText("Budget creation failed.");
  assert.equal(within(dialog).getByLabelText("Name").value, "  Holiday fund  ");
  await waitFor(() => assert.equal(client.getQueryData(["budgets", "household"]).length, 3));
  fixtures.set("POST /api/budgets", () => Response.json({ id: "holiday" }, { status: 201 }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create", exact: true }));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Create sub-account" })));
  await view.findByText("Budget created.");
  const writes = requests.filter((request) => request.method === "POST");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, { workspaceId: "household", accountId: "bank", name: "Holiday fund", icon: "🛡️", targetCents: 12_345, isSavings: true });
  assert.match(writes[1].headers.get("idempotency-key"), /^budget-create:/);
  fireEvent.click(view.getByRole("button", { name: "New sub-account" }));
  const fresh = await view.findByRole("dialog", { name: "Create sub-account" });
  assert.equal(within(fresh).getByLabelText("Name").value, "");
  assert.equal(within(fresh).getByRole("checkbox").checked, false);
  fireEvent.click(within(fresh).getByRole("button", { name: "Close New Sub-Account" }));
});

test("bank balance edits require confirmation, retain rejected values, and send a concurrency version", async () => {
  populated();
  fixtures.set("/api/accounts", [bank]);
  fixtures.set("PATCH /api/accounts/bank", () => Response.json({ error: "Balance changed elsewhere" }, { status: 409 }));
  const view = show();
  fireEvent.click(await view.findByRole("button", { name: "Edit Daily bank balance" }));
  const dialog = await view.findByRole("dialog", { name: "Edit bank balance" });
  const input = within(dialog).getByLabelText("Balance (SGD)");
  assert.equal(input.value, "100.00");
  fireEvent.change(input, { target: { value: "150.25" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Balance" }));
  const confirmation = await view.findByRole("dialog", { name: "Confirm bank balance adjustment" });
  assert.match(confirmation.textContent, /Test household/);
  assert.match(confirmation.textContent, /50\.25/);
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  assert.ok(!requests.some((request) => request.method === "PATCH"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Balance" }));
  fireEvent.click(within(await view.findByRole("dialog", { name: "Confirm bank balance adjustment" })).getByRole("button", { name: "Update balance" }));
  await view.findByText("Balance changed elsewhere");
  assert.equal(input.value, "150.25");
  fixtures.set("PATCH /api/accounts/bank", () => Response.json({ ...bank, currentBalanceCents: 15_025 }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Balance" }));
  fireEvent.click(within(await view.findByRole("dialog", { name: "Confirm bank balance adjustment" })).getByRole("button", { name: "Update balance" }));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Edit bank balance" })));
  await view.findByText("Bank balance updated.");
  const writes = requests.filter((request) => request.method === "PATCH");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, { startingCents: 15_025, expectedUpdatedAt: bank.updatedAt });
  assert.match(writes[1].headers.get("idempotency-key"), /^account-balance:bank:/);
  fireEvent.click(view.getByRole("button", { name: "Edit Daily bank balance" }));
  fireEvent.click(within(await view.findByRole("dialog", { name: "Edit bank balance" })).getByRole("button", { name: "Cancel" }));
  assert.ok(!view.queryByRole("dialog", { name: "Edit bank balance" }));
});

test("card due groups combine statements by bank and day while exposing each statement's route", async () => {
  const statement = { cardId: "visa", cardName: "Travel Visa", bankName: "DBS", statementYear: 2026, statementMonth: 9, paymentDueDate: "2026-10-08T00:00:00Z", outstandingCents: 1_000 };
  fixtures.set("/api/dashboard/summary", { ...emptySummary, creditCardSummary: { totalOutstandingCents: 6_000, overdueCount: 1, dueSoonCount: 3, nextDueCards: [
    statement, { ...statement, cardId: "amex", cardName: "Amex", outstandingCents: 2_000 },
    { ...statement, cardId: "overdue", bankName: null, cardName: "Overdue card", paymentDueDate: "2026-10-05T00:00:00Z" },
    { ...statement, cardId: "today", bankName: "Unknown", cardName: "Today card", paymentDueDate: "2026-10-07T00:00:00Z" },
    { ...statement, cardId: "later", bankName: "UOB", cardName: "Later card", paymentDueDate: "2026-10-22T00:00:00Z" },
    { ...statement, cardId: "future", bankName: "DBS", cardName: "Future card", paymentDueDate: "2026-10-28T00:00:00Z" },
  ] } });
  const view = show();
  const firstStatement = await view.findByRole("button", { name: "View Travel Visa September 2026 transactions" });
  const payments = view.getByRole("region", { name: "Payments due" });
  assert.ok(within(payments).getByText("2 cards"));
  for (const label of ["Overdue by 2d", "Due today", "Due in 1d", "Due in 15d"]) assert.ok(within(payments).getByText(label));
  assert.ok(!within(payments).queryByText("Due in 21d"));
  for (const logo of payments.querySelectorAll("img")) fireEvent.error(logo);
  assert.equal(payments.querySelectorAll("img").length, 0);
  fireEvent.click(firstStatement);
  const target = new URL(navigation.at(-1), "https://example.test");
  assert.equal(target.pathname, "/w/household/credit-transactions");
  assert.equal(target.searchParams.get("cardId"), "visa");
  assert.equal(target.searchParams.get("month"), "9");
  assert.equal(target.searchParams.get("year"), "2026");
  fireEvent.click(within(payments).getByRole("button", { name: "View all" }));
  assert.equal(navigation.at(-1), "/w/household/credit-transactions");
});

test("cash-flow filters select the correct sub-account and reset when the chosen bank removes it", async () => {
  populated();
  const summary = fixtures.get("/api/dashboard/summary");
  fixtures.set("/api/dashboard/summary", { ...summary, cashFlow: [{
    key: "2026-09", label: "September", inflowCents: 13_000, outflowCents: 4_000, netCents: 9_000,
    accounts: { bank: { inflowCents: 10_000, outflowCents: 3_000, netCents: 7_000 } },
    budgets: { dining: { inflowCents: 1_500, outflowCents: 500, netCents: 1_000 } },
  }] });
  const view = show();
  const point = await view.findByRole("button", { name: /^September: In/ });
  assert.match(point.getAttribute("aria-label"), /130\.00/);
  const flow = view.getByRole("region", { name: "Cash flow" });
  fireEvent.click(within(flow).getByRole("button", { name: "Dining", exact: true }));
  await waitFor(() => assert.match(view.getByRole("button", { name: /^September: In/ }).getAttribute("aria-label"), /15\.00/));
  fireEvent.click(view.getByRole("button", { name: "Choose bank" }));
  fireEvent.click(within(view.getByRole("menu", { name: "Bank options" })).getByRole("button", { name: "Spare bank" }));
  await within(flow).findByRole("heading", { name: "No cash flow yet" });
  assert.ok(within(flow).getByText("All sub-accounts in Spare bank - last 12 months"));
  fixtures.set("/api/context", { ...baseContext, sidebarMoneyPages: { creditCards: false, creditTransactions: false } });
  await ui.act(async () => client.invalidateQueries({ queryKey: ["app-context", "household"] }));
  await waitFor(() => assert.ok(!view.queryByRole("region", { name: "Payments due" })));
});

test("cash-flow chart supports zoom limits, focus and pointer details, and clearing removed points", (t) => {
  t.mock.method(ui.window.HTMLElement.prototype, "getBoundingClientRect", () => new ui.window.DOMRect(10, 20, 800, 300));
  const points = [
    { key: "aug", label: "August", inflowCents: 10_000, outflowCents: 5_000, netCents: 5_000 },
    { key: "sep", label: "September", inflowCents: 0, outflowCents: 5_000, netCents: -5_000 },
  ];
  const props = { points, formatShort: (cents) => String(cents / 100), formatFull: (cents) => `$${(cents / 100).toFixed(2)}` };
  const view = render(h(CashFlowChart, props));
  const chart = view.getByRole("group", { name: "Cash flow over the last 12 months" });
  assert.equal(chart.style.width, "800px");
  const zoomIn = view.getByRole("button", { name: "Zoom in cash flow months" });
  const zoomOut = view.getByRole("button", { name: "Zoom out cash flow months" });
  assert.equal(zoomOut.disabled, true);
  for (let i = 0; i < 4; i += 1) fireEvent.click(zoomIn);
  assert.equal(chart.style.width, "2400px");
  assert.equal(zoomIn.disabled, true);
  fireEvent.click(zoomOut);
  assert.equal(chart.style.width, "2000px");
  fireEvent.click(view.getByRole("button", { name: "Reset cash flow zoom" }));
  assert.equal(chart.style.width, "800px");
  const august = view.getByRole("button", { name: "August: In $100.00, out $50.00, net +$50.00" });
  const september = view.getByRole("button", { name: "September: In $0.00, out $50.00, net -$50.00" });
  fireEvent.focus(august);
  assert.match(view.container.querySelector(".chart-cursor-tooltip").textContent, /AugustIn \$100\.00/);
  fireEvent.blur(august);
  assert.ok(!view.container.querySelector(".chart-cursor-tooltip"));
  fireEvent.pointerEnter(september, { clientX: 785, clientY: 80 });
  fireEvent.pointerMove(september, { clientX: 785, clientY: 90 });
  assert.match(view.container.querySelector(".chart-cursor-tooltip").textContent, /Net -\$50\.00/);
  fireEvent.click(august, { clientX: 30, clientY: 50 });
  assert.ok(view.container.querySelector(".chart-cursor-tooltip.right"));
  fireEvent.mouseEnter(view.container.querySelectorAll(".cash-flow-net-point")[1]);
  assert.match(view.container.querySelector(".chart-cursor-tooltip").textContent, /September/);
  fireEvent.pointerLeave(chart);
  assert.ok(!view.container.querySelector(".chart-cursor-tooltip"));
  fireEvent.focus(september);
  view.rerender(h(CashFlowChart, { ...props, points: [] }));
  assert.ok(!view.container.querySelector(".chart-cursor-tooltip"));
  assert.equal(view.container.querySelectorAll(".cash-flow-net-point").length, 0);
});
