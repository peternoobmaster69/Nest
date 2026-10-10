import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { queryKeys } = require("../lib/query-keys.ts");
const requests = [], invalidations = [], clients = [];
let responses;
mock.module("../lib/api/client.ts", { namedExports: { apiFetch: async (url, options) => {
  const request = { url, ...options, body: JSON.parse(options.body) };
  requests.push(request);
  assert.ok(responses.has(url), `Unexpected API request: ${url}`);
  const response = responses.get(url);
  if (response instanceof Error) throw response;
  return typeof response === "function" ? response(request) : response;
} } });
const { WorkspaceSetupGuide } = require("../components/onboarding/workspace-setup-guide.tsx");
const prefKey = "nest:workspace-setup:v1:household";
const empty = { bankAccountCount: 0, subAccountCount: 0, creditCardCount: 0 };
const bank = { id: "bank-one", name: "Daily bank", kind: "BANK" };
function show(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (options) => { invalidations.push(options); return invalidate(options); };
  const element = (values) => ui.h(QueryClientProvider, { client }, ui.h(WorkspaceSetupGuide, {
    key: values.workspaceId ?? "household", workspaceId: "household", baseCurrency: "SGD", accounts: [], progress: empty, ...values,
  }));
  return { ...ui.render(element(props)), element };
}
function started() { ui.window.localStorage.setItem(prefKey, "started"); }
function change(view, label, value) { ui.fireEvent.change(view.getByLabelText(label), { target: { value } }); }
function submit(view) { ui.fireEvent.submit(view.getByRole("dialog").querySelector("form")); }
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  requests.length = invalidations.length = 0;
  ui.window.localStorage.clear();
  ui.window.sessionStorage.clear();
  responses = new Map([
    ["/api/accounts", { account: { ...bank, bankName: "DBS Bank" } }],
    ["/api/budgets", { id: "food" }],
    ["/api/credit-cards", { id: "card-one" }],
  ]);
});
afterEach(() => { ui.cleanup(); for (const client of clients.splice(0)) client.clear(); });
after(() => ui.dispose());

test("a pending setup save prevents duplicate submissions and locks its fields", async (t) => {
  started();
  const pending = deferred();
  t.after(() => pending.resolve({ account: { ...bank, bankName: "DBS Bank" } }));
  responses.set("/api/accounts", () => pending.promise);
  const view = show();
  await view.findByRole("dialog", { name: "Add your bank account" });
  change(view, "Account name", "Everyday");
  const form = view.getByRole("dialog").querySelector("form");
  await ui.act(async () => { ui.fireEvent.submit(form); ui.fireEvent.submit(form); });
  assert.equal(requests.length, 1);
  assert.ok(view.getByLabelText("Account name").disabled);
  assert.ok(view.getByLabelText("Bank").disabled);
  assert.ok(view.getByLabelText("Current balance (SGD)").disabled);
  assert.ok(view.getByRole("button", { name: "Saving…" }).disabled);
  assert.ok(view.getByRole("button", { name: "Not now" }).disabled);
  ui.fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(view.getByRole("dialog"));
  await ui.act(async () => pending.resolve({ account: { ...bank, bankName: "DBS Bank" } }));
  await view.findByRole("dialog", { name: "Create a sub-account" });
});

test("invalid card dates are rejected locally instead of sending null or fractional values", async () => {
  started();
  const view = show({ accounts: [bank], progress: { ...empty, bankAccountCount: 1, subAccountCount: 1 } });
  await view.findByRole("dialog", { name: "Add a credit card (optional)" });
  change(view, "Card name", "Travel card");
  change(view, "Last 4 digits", "1234");
  for (const [statement, due] of [["invalid", "10"], ["25", "NaN"], ["1.5", "10"], ["25", "2.5"], ["0", "10"], ["32", "10"], ["25", "0"], ["25", "32"]]) {
    change(view, "Statement day", statement);
    change(view, "Payment due day", due);
    submit(view);
    assert.equal(view.getByRole("alert").textContent, "Statement and due days must be between 1 and 31.");
    assert.equal(requests.length, 0);
  }
});

test("welcome can be snoozed, resumed, and started without affecting another workspace", async () => {
  ui.window.localStorage.setItem("nest:workspace-setup:v1:other", "complete");
  ui.window.localStorage.setItem(prefKey, "unrecognized");
  const view = show();
  await view.findByRole("dialog", { name: "Welcome to Nest" });
  assert.ok(view.getByLabelText("0 of 3 setup steps completed"));
  ui.fireEvent.click(view.getByRole("button", { name: "Not now" }));
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(ui.window.sessionStorage.getItem(`${prefKey}:snoozed`), "1");
  ui.fireEvent.click(view.getByRole("button", { name: /Set up Nest/ }));
  assert.equal(ui.window.sessionStorage.getItem(`${prefKey}:snoozed`), null);
  ui.fireEvent.click(view.getByRole("button", { name: "Start setup" }));
  await view.findByRole("dialog", { name: "Add your bank account" });
  assert.equal(ui.window.localStorage.getItem(prefKey), "started");
  assert.equal(ui.window.localStorage.getItem("nest:workspace-setup:v1:other"), "complete");
  ui.fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(view.getByRole("button", { name: /Finish setup/ }));
  assert.equal(requests.length, 0);
});

test("setup creates a bank, a sub-account, and an optional card with scoped refreshes", async () => {
  const view = show();
  ui.fireEvent.click(await view.findByRole("button", { name: "Start setup" }));
  change(view, "Bank", "OCBC Bank");
  change(view, "Account name", "  Daily savings  ");
  change(view, "Current balance (SGD)", "12.34");
  submit(view);
  await view.findByRole("dialog", { name: "Create a sub-account" });
  assert.equal(view.getByLabelText("Bank account").value, "bank-one");
  assert.ok(view.getByText("Bank account added. Next, give some of that money a purpose."));
  assert.ok(view.getByLabelText("1 of 3 setup steps completed"));
  change(view, "Sub-account name", "  Food  ");
  change(view, "Monthly limit (optional)", "15.25");
  submit(view);
  await view.findByRole("dialog", { name: "Add a credit card (optional)" });
  assert.equal(view.getByLabelText("Bank").value, "DBS Bank");
  assert.ok(view.getByText("Sub-account created. A credit card is optional."));
  change(view, "Card name", "  Everyday card  ");
  change(view, "Bank", "UOB");
  change(view, "Last 4 digits", "12x3456");
  assert.equal(view.getByLabelText("Last 4 digits").value, "1234");
  change(view, "Statement day", "31");
  change(view, "Payment due day", "1");
  submit(view);
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  assert.deepEqual(requests.map(({ body }) => body), [
    { workspaceId: "household", name: "Daily savings", bankName: "OCBC Bank", startingCents: 1234 },
    { workspaceId: "household", accountId: "bank-one", name: "Food", icon: "💰", targetCents: 1525 },
    { workspaceId: "household", cardName: "Everyday card", bankName: "UOB", last4Digit: "1234", themeKey: "bank-default", statementDay: 31, paymentDueDay: 1 },
  ]);
  assert.ok(requests.every(({ method, headers }) => method === "POST" && headers["Content-Type"] === "application/json"));
  assert.equal(invalidations.filter(({ queryKey }) => JSON.stringify(queryKey) === JSON.stringify(queryKeys.context("household"))).length, 3);
  for (const root of ["bank-accounts", "budgets", "credit-cards", "dashboard-summary"]) {
    assert.ok(invalidations.some(({ queryKey, refetchType }) => JSON.stringify(queryKey) === JSON.stringify(queryKeys.scoped(root, "household")) && refetchType === "active"));
  }
  assert.equal(ui.window.localStorage.getItem(prefKey), "complete");
  assert.equal(ui.window.sessionStorage.getItem(`${prefKey}:snoozed`), null);
});

test("bank and sub-account validation preserves drafts and reconciles refreshed account choices", async () => {
  started();
  responses.set("/api/accounts", { account: { ...bank, bankName: null } });
  const view = show({ accounts: [{ id: "broker", name: "Brokerage", kind: "INVESTMENT" }] });
  await view.findByRole("dialog", { name: "Add your bank account" });
  for (const value of ["invalid", "-1", "Infinity"]) {
    change(view, "Current balance (SGD)", value);
    submit(view);
    assert.equal(view.getByRole("alert").textContent, "Enter a valid starting balance.");
    assert.equal(requests.length, 0);
  }
  change(view, "Current balance (SGD)", "");
  change(view, "Bank", "OCBC Bank");
  submit(view);
  await view.findByLabelText("Sub-account name");
  assert.equal(requests[0].body.startingCents, 0);
  const props = { accounts: [{ id: "bank-two", name: "Second bank", kind: "BANK" }, bank, { id: "broker", name: "Brokerage", kind: "INVESTMENT" }],
    progress: { ...empty, bankAccountCount: 2 } };
  view.rerender(view.element(props));
  assert.equal(view.getByLabelText("Bank account").options.length, 2);
  assert.equal(view.getByLabelText("Bank account").value, "bank-one");
  change(view, "Bank account", "bank-two");
  submit(view);
  assert.equal(view.getByRole("alert").textContent, "Give the sub-account a name.");
  change(view, "Sub-account name", "Food");
  for (const target of ["invalid", "-1"]) {
    change(view, "Monthly limit (optional)", target);
    submit(view);
    assert.equal(view.getByRole("alert").textContent, "Enter a valid monthly limit.");
    assert.equal(requests.length, 1);
  }
  change(view, "Monthly limit (optional)", "");
  submit(view);
  await view.findByRole("dialog", { name: "Add a credit card (optional)" });
  assert.equal(requests[1].body.accountId, "bank-two");
  assert.equal(requests[1].body.targetCents, 0);
  assert.equal(view.getByLabelText("Bank").value, "OCBC Bank");
  ui.fireEvent.click(view.getByRole("button", { name: "Skip for now" }));
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(ui.window.localStorage.getItem(prefKey), "complete");
  assert.equal(requests.length, 2);
});

test("a temporarily missing bank selection blocks sub-account creation", async () => {
  started();
  const view = show({ progress: { ...empty, bankAccountCount: 1 } });
  await view.findByLabelText("Sub-account name");
  change(view, "Sub-account name", "Food");
  submit(view);
  assert.equal(view.getByRole("alert").textContent, "Select a bank account.");
  assert.equal(requests.length, 0);
});

test("card validation requires a name and four digits before starting a request", async () => {
  started();
  const view = show({ accounts: [bank], progress: { ...empty, bankAccountCount: 1, subAccountCount: 1 } });
  await view.findByLabelText("Card name");
  submit(view);
  assert.equal(view.getByRole("alert").textContent, "Give the card a name.");
  change(view, "Card name", "Card");
  change(view, "Last 4 digits", "12");
  submit(view);
  assert.equal(view.getByRole("alert").textContent, "Enter exactly the last 4 digits.");
  assert.equal(requests.length, 0);
});

for (const [step, endpoint, props, fields] of [
  ["bank", "/api/accounts", {}, [["Account name", "Bank"]]],
  ["sub-account", "/api/budgets", { accounts: [bank], progress: { ...empty, bankAccountCount: 1 } }, [["Sub-account name", "Food"]]],
  ["card", "/api/credit-cards", { accounts: [bank], progress: { ...empty, bankAccountCount: 1, subAccountCount: 1 } }, [["Card name", "Card"], ["Last 4 digits", "1234"]]],
]) {
  test(`${step} API failures keep the draft available and release the save guard for retries`, async (t) => {
    started();
    const success = responses.get(endpoint);
    responses.set(endpoint, new Error("Please retry this save."));
    const view = show(props);
    await view.findByLabelText(fields[0][0]);
    for (const [label, value] of fields) change(view, label, value);
    submit(view);
    assert.equal((await view.findByRole("alert")).textContent, "Please retry this save.");
    for (const [label, value] of fields) {
      assert.equal(view.getByLabelText(label).value, value);
      assert.ok(!view.getByLabelText(label).disabled);
    }
    assert.equal(invalidations.length, 0);
    const pending = deferred();
    t.after(() => ui.act(async () => pending.resolve(success)));
    responses.set(endpoint, () => pending.promise);
    submit(view);
    await view.findByRole("button", { name: step === "card" ? "Adding…" : "Saving…" });
    assert.ok(view.getByLabelText(fields[0][0]).disabled);
    const dismiss = step === "card" ? "Skip for now" : "Not now";
    assert.ok(view.getByRole("button", { name: dismiss }).disabled);
    await ui.act(async () => pending.resolve(success));
    await ui.waitFor(() => assert.ok(invalidations.length > 0));
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].body, requests[1].body);
  });
}

test("snoozed setup resumes from storage and switching workspaces discards local form drafts", async () => {
  started();
  ui.window.sessionStorage.setItem(`${prefKey}:snoozed`, "1");
  const view = show();
  assert.ok(!view.queryByRole("dialog"));
  ui.fireEvent.click(await view.findByRole("button", { name: /Finish setup/ }));
  change(view, "Account name", "Private household draft");
  view.rerender(view.element({ workspaceId: "travel" }));
  ui.fireEvent.click(await view.findByRole("button", { name: "Start setup" }));
  assert.equal(view.getByLabelText("Account name").value, "");
  assert.equal(ui.window.localStorage.getItem("nest:workspace-setup:v1:travel"), "started");
  assert.equal(requests.length, 0);
});

for (const storageFailure of [false, true]) {
  test(`completed setup stays closed when persisting completion ${storageFailure ? "fails" : "succeeds"}`, async (t) => {
    started();
    if (storageFailure) t.mock.method(ui.window.localStorage, "setItem", () => { throw new Error("Storage blocked"); });
    const view = show({ accounts: [bank], progress: { bankAccountCount: 1, subAccountCount: 1, creditCardCount: 1 } });
    assert.ok(!view.queryByRole("dialog"));
    assert.ok(!view.queryByRole("button"));
    assert.equal(ui.window.localStorage.getItem(prefKey), storageFailure ? "started" : "complete");
    assert.equal(requests.length, 0);
  });
}

test("configured workspaces stay quiet while missing required accounts remain resumable", async () => {
  ui.window.localStorage.setItem(prefKey, "complete");
  const props = { accounts: [bank], progress: { ...empty, bankAccountCount: 1, subAccountCount: 1 } };
  const view = show(props);
  assert.ok(!view.queryByRole("dialog"));
  view.rerender(view.element({ accounts: [bank], progress: { ...empty, bankAccountCount: 1 } }));
  await view.findByRole("dialog", { name: "Create a sub-account" });
  assert.equal(requests.length, 0);
});

test("blocked browser storage does not prevent starting, pausing, resuming, or completing setup", async (t) => {
  const blocked = () => { throw new Error("Storage blocked"); };
  t.mock.method(ui.window.localStorage, "getItem", blocked);
  t.mock.method(ui.window.localStorage, "setItem", blocked);
  t.mock.method(ui.window.sessionStorage, "setItem", blocked);
  t.mock.method(ui.window.sessionStorage, "removeItem", blocked);
  const view = show();
  ui.fireEvent.click(await view.findByRole("button", { name: "Start setup" }));
  ui.fireEvent.click(view.getByRole("button", { name: "Not now" }));
  ui.fireEvent.click(view.getByRole("button", { name: /Finish setup/ }));
  submit(view);
  await view.findByLabelText("Sub-account name");
  change(view, "Sub-account name", "Food");
  submit(view);
  ui.fireEvent.click(await view.findByRole("button", { name: "Skip for now" }));
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(requests.length, 2);
});
