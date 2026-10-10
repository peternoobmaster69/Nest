import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const requests = [], clients = [], invalidations = [];
let responses, routeWorkspaceId, savedRules;
mock.module("../components/workspace-provider.tsx", { namedExports: { useWorkspaceId: () => routeWorkspaceId } });
mock.module("../lib/use-money-format.ts", { namedExports: { useMoneyFormat: () => ({ format: (value) => `$${(value / 100).toFixed(2)}` }) } });
mock.module("next/navigation", { namedExports: { usePathname: () => "/w/household/settings", useSearchParams: () => new URLSearchParams() } });
mock.module("../components/confirm-dialog.tsx", { namedExports: { useConfirmDialog: () => ({ confirm: async () => false }) } });
mock.module("../lib/api/client.ts", { namedExports: { apiFetch: async (input, options = {}) => {
  const url = new URL(input, "http://localhost:3100");
  const request = { url, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : undefined };
  requests.push(request);
  const key = `${request.method} ${url.pathname}`;
  assert.ok(responses.has(key), `Unexpected API request: ${key}`);
  const response = responses.get(key);
  if (response instanceof Error) throw response;
  return typeof response === "function" ? response(request) : response;
} } });
const { SettingsPage } = require("../components/settings-page.tsx");
const { useAutoRuleSettings } = require("../hooks/use-auto-rule-settings.ts");
const { AutoRuleEditorDialog } = require("../components/settings/auto-rule-editor-dialog.tsx");
const { createEmptyAutoRule, getAutoRuleValidationMessage, sanitizeAutoRule } = require("../components/settings/auto-rule-data.ts");
const sameRule = (extra = {}) => ({ id: "daily", name: "Daily spending", enabled: true, action: "DEDUCT_SAME_WORKSPACE", filters: ["Card Transaction Alert"], sourceBudgetId: "daily-budget", destinationBudgetId: "settlement-budget", ...extra });
const bank = (id, name, workspaceId = "household", extra = {}) => ({ id, name, workspaceId, bankName: "DBS", startingCents: 0, description: null, isActive: true,
  updatedAt: "2026-10-10T10:00:00Z", currentBalanceCents: 0, linkedBudgetTotalCents: 0, discrepancyCents: 0, ...extra });
const budget = (id, name, accountId, extra = {}) => ({ id, name, accountId, isActive: true, ...extra });
function createClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (options) => { invalidations.push(options.queryKey); return invalidate(options); };
  return client;
}
function show(section = "automation") {
  const client = createClient();
  const page = (nextSection) => ui.h(QueryClientProvider, { client }, ui.h(SettingsPage, { section: nextSection }));
  const view = ui.render(page(section));
  return { ...view, client, section: (nextSection) => view.rerender(page(nextSection)) };
}
function showController(overrides = {}) {
  const client = createClient();
  const initialProps = {
    workspaceId: "household", defaultReceivableBudgetId: "settlement-budget",
    accounts: [bank("household-bank", "Household checking")],
    budgets: [budget("daily-budget", "Daily expenses", "household-bank"), budget("settlement-budget", "Card settlement", "household-bank")],
    workspaces: [{ id: "household", name: "Household" }, { id: "personal", name: "Personal" }], ...overrides,
  };
  const view = ui.renderHook((props) => useAutoRuleSettings(props), {
    initialProps, wrapper: ({ children }) => ui.h(QueryClientProvider, { client }, children),
  });
  return { ...view, client, change: (next) => view.rerender({ ...initialProps, ...next }) };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function openEditor(view, name = /Daily spending/) {
  ui.fireEvent.click(await view.findByRole("button", { name }));
  return view.findByRole("dialog", { name: "Edit auto-accounting rule" });
}
async function addRule(view) {
  await ui.waitFor(() => assert.ok(!view.getByRole("button", { name: "Add Rule" }).disabled));
  ui.fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
  return view.findByRole("dialog", { name: "Edit auto-accounting rule" });
}
const writes = () => requests.filter(({ method }) => method === "PUT");
beforeEach(() => {
  requests.length = invalidations.length = 0;
  routeWorkspaceId = "household";
  savedRules = [sameRule(), sameRule({ id: "backup", name: "Backup spending", filters: ["UOB - Transaction Alert"] })];
  ui.window.history.replaceState(null, "", "/w/household/settings?tab=automation");
  responses = new Map([
    ["GET /api/context", { workspaceId: "household", workspaceName: "Household", baseCurrency: "SGD", role: "OWNER", defaultBudgetId: "settlement-budget",
      workspaces: [{ id: "household", name: "Household" }, { id: "personal", name: "Personal" }] }],
    ["GET /api/accounts", ({ url }) => url.searchParams.get("workspaceId") === "personal" ? [bank("personal-bank", "Personal checking", "personal")] : [bank("household-bank", "Household checking")]],
    ["GET /api/budgets", ({ url }) => url.searchParams.get("workspaceId") === "personal"
      ? [budget("personal-budget", "Personal expenses", "personal-bank", { receivableReservedCents: 1500 })]
      : [budget("daily-budget", "Daily expenses", "household-bank"), budget("settlement-budget", "Card settlement", "household-bank")]],
    ["GET /api/gmail/status", { connected: false, requiresReconnect: false, integration: null }],
    ["GET /api/credit-transactions/auto-rules", () => ({ workspaceId: "household", rules: structuredClone(savedRules) })],
    ["PUT /api/credit-transactions/auto-rules", ({ body }) => { savedRules = structuredClone(body.rules); return { workspaceId: body.workspaceId, rules: savedRules }; }],
    ["POST /api/credit-transactions/auto-rules/run", { ok: true, scanned: 5, matched: 3, accounted: 2, skipped: 1 }],
  ]);
});
afterEach(() => { ui.cleanup(); for (const client of clients.splice(0)) client.clear(); });
after(() => ui.dispose());

test("rule toggles are independent native controls outside the editor button", async () => {
  const view = show();
  const toggle = await view.findByRole("checkbox", { name: "Daily spending enabled" });
  assert.ok(!toggle.closest("button"));
  ui.fireEvent.click(toggle);
  await view.findByText("Rule paused");
  assert.ok(!view.queryByRole("dialog"));
});

test("a new cross-workspace rule loads the selected workspace's bank accounts and sub accounts", async () => {
  const view = show();
  const dialog = await addRule(view);
  ui.fireEvent.change(ui.within(dialog).getByRole("combobox", { name: "Action" }), { target: { value: "RECEIVABLE_OTHER_WORKSPACE" } });
  await ui.within(dialog).findByRole("option", { name: "Personal checking" });
  ui.fireEvent.change(ui.within(dialog).getByRole("combobox", { name: "Bank Account" }), { target: { value: "personal-bank" } });
  await ui.within(dialog).findByRole("option", { name: "Personal expenses ($15.00)" });
  assert.equal(ui.within(dialog).getByRole("combobox", { name: "Sub Account" }).value, "personal-budget");
});

test("save failures remain visible inside the open rule editor", async () => {
  responses.set("PUT /api/credit-transactions/auto-rules", new Error("Unable to save rules."));
  const view = show();
  const dialog = await openEditor(view);
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Save Rule" }));
  await ui.within(dialog).findByText("Unable to save rules");
  assert.equal(writes().length, 1);
  assert.ok(view.getByRole("dialog", { name: "Edit auto-accounting rule" }));
});

test("a failed deletion preserves the rule and the editor for a retry", async () => {
  responses.set("PUT /api/credit-transactions/auto-rules", new Error("Rule deletion failed."));
  const view = show();
  const dialog = await openEditor(view);
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Delete rule" }));
  await view.findByText("Rule deletion failed");
  assert.ok(view.queryByRole("dialog", { name: "Edit auto-accounting rule" }));
  assert.ok(view.getByRole("checkbox", { name: "Daily spending enabled" }));
  assert.equal(savedRules.length, 2);
});

test("saving one rule blocks competing toggles and manual accounting until the response arrives", async (t) => {
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve({ workspaceId: "household", rules: savedRules })));
  responses.set("PUT /api/credit-transactions/auto-rules", () => pending.promise);
  const view = show();
  ui.fireEvent.click(await view.findByRole("checkbox", { name: "Daily spending enabled" }));
  await ui.waitFor(() => assert.equal(writes().length, 1));
  assert.ok(view.getByRole("checkbox", { name: "Backup spending enabled" }).disabled);
  assert.ok(view.getByRole("button", { name: "Run Now" }).disabled);
  await ui.act(async () => pending.resolve({ workspaceId: "household", rules: savedRules }));
});

test("rule data validation covers names, keywords and both posting destinations before any save", () => {
  const other = { id: "other", name: "Shared spending", enabled: true, action: "RECEIVABLE_OTHER_WORKSPACE", filters: ["merchant"],
    sourceWorkspaceId: "personal", sourceAccountId: "personal-bank", sourceBudgetId: "personal-budget" };
  for (const [rule, expected] of [
    [sameRule({ name: "  " }), "Rule 1 needs a name."],
    [sameRule({ filters: [" ", "\t"] }), 'Rule "Daily spending" needs at least one subject keyword.'],
    [sameRule({ sourceBudgetId: "" }), 'Rule "Daily spending" needs a source sub account.'],
    [sameRule({ destinationBudgetId: "" }), 'Rule "Daily spending" needs a destination sub account.'],
    [sameRule({ destinationBudgetId: "daily-budget" }), 'Rule "Daily spending" needs different source and destination sub accounts.'],
    [{ ...other, sourceWorkspaceId: "" }, 'Rule "Shared spending" needs a source workspace.'],
    [{ ...other, sourceAccountId: "" }, 'Rule "Shared spending" needs a source bank account.'],
    [{ ...other, sourceBudgetId: "" }, 'Rule "Shared spending" needs a source sub account.'],
  ]) assert.equal(getAutoRuleValidationMessage([rule]), expected);
  assert.equal(getAutoRuleValidationMessage([]), null);
  assert.equal(getAutoRuleValidationMessage([sameRule(), other]), null);
  assert.deepEqual(sanitizeAutoRule(sameRule({ name: "  Trim me  ", filters: ["  card  ", ""], destinationAccountId: "obsolete" })),
    sameRule({ name: "Trim me", filters: ["card"] }));
  assert.deepEqual(sanitizeAutoRule({ ...other, name: "  Shared  ", filters: ["  merchant  ", " "] }), { ...other, name: "Shared", filters: ["merchant"] });
});

test("new rules use secure identifiers and preserve empty or supplied destination defaults", () => {
  const first = createEmptyAutoRule();
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.equal(first.sourceBudgetId, "");
  assert.equal(first.destinationBudgetId, "");
  assert.deepEqual(first.filters, []);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: (array) => { array.set([1, 2, 3, 4]); return array; } } });
    const fallback = createEmptyAutoRule({ sourceBudgetId: "source", destinationBudgetId: "destination" });
    assert.equal(fallback.id, "rule-00000001000000020000000300000004");
    assert.equal(fallback.sourceBudgetId, "source");
    assert.equal(fallback.destinationBudgetId, "destination");
  } finally { Object.defineProperty(globalThis, "crypto", descriptor); }
});

test("new rules support named fields, trimmed keywords, status and destination changes before a single save", async () => {
  const view = show();
  const dialog = await addRule(view);
  const form = ui.within(dialog);
  assert.equal(form.getByRole("combobox", { name: "Source Sub Account" }).value, "daily-budget");
  assert.equal(form.getByRole("combobox", { name: "Destination Sub Account" }).value, "settlement-budget");
  ui.fireEvent.change(form.getByRole("textbox", { name: "Rule Name" }), { target: { value: "  Travel spending  " } });
  const keyword = form.getByRole("textbox", { name: "Subject keyword" });
  ui.fireEvent.change(keyword, { target: { value: "  AIRLINE  " } });
  ui.fireEvent.keyDown(keyword, { key: "Enter" });
  assert.ok(form.getByRole("button", { name: "Remove AIRLINE" }));
  assert.equal(keyword.value, "");
  ui.fireEvent.keyDown(keyword, { key: "Tab" });
  ui.fireEvent.click(form.getByRole("button", { name: "Add", exact: true }));
  ui.fireEvent.change(keyword, { target: { value: "HOTEL" } });
  ui.fireEvent.click(form.getByRole("button", { name: "Add", exact: true }));
  ui.fireEvent.click(form.getByRole("button", { name: "Remove AIRLINE" }));
  ui.fireEvent.click(form.getByRole("checkbox", { name: "Rule is active" }));
  ui.fireEvent.change(form.getByRole("combobox", { name: "Source Sub Account" }), { target: { value: "settlement-budget" } });
  ui.fireEvent.change(form.getByRole("combobox", { name: "Destination Sub Account" }), { target: { value: "daily-budget" } });
  ui.fireEvent.click(form.getByRole("button", { name: "Save Rule" }));
  await view.findByText('Rule "Travel spending" saved');
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].body.workspaceId, "household");
  assert.equal(writes()[0].body.rules.length, 3);
  assert.deepEqual(savedRules[2], { id: savedRules[2].id, name: "Travel spending", enabled: false, action: "DEDUCT_SAME_WORKSPACE",
    filters: ["HOTEL"], sourceBudgetId: "settlement-budget", destinationBudgetId: "daily-budget" });
  assert.deepEqual(invalidations, [["credit-txn-auto-rules", "household"]]);
});

test("invalid edits show their validation inside the editor and never reach the save API", async () => {
  const view = show();
  const dialog = await openEditor(view);
  const form = ui.within(dialog);
  ui.fireEvent.change(form.getByRole("textbox", { name: "Rule Name" }), { target: { value: "" } });
  ui.fireEvent.click(form.getByRole("button", { name: "Save Rule" }));
  await form.findByText("Rule 1 needs a name");
  assert.equal(writes().length, 0);
  assert.ok(!form.getByRole("button", { name: "Save Rule" }).disabled);
});

test("editing a rule preserves other rules and can switch posting types without retaining obsolete fields", async () => {
  const view = show();
  const dialog = await openEditor(view);
  const form = ui.within(dialog);
  ui.fireEvent.change(form.getByRole("combobox", { name: "Action" }), { target: { value: "RECEIVABLE_OTHER_WORKSPACE" } });
  await form.findByRole("option", { name: "Personal checking" });
  ui.fireEvent.change(form.getByRole("combobox", { name: "Bank Account" }), { target: { value: "personal-bank" } });
  assert.equal(form.getByRole("combobox", { name: "Sub Account" }).value, "personal-budget");
  ui.fireEvent.change(form.getByRole("combobox", { name: "Sub Account" }), { target: { value: "" } });
  ui.fireEvent.change(form.getByRole("combobox", { name: "Sub Account" }), { target: { value: "personal-budget" } });
  ui.fireEvent.click(form.getByRole("button", { name: "Save Rule" }));
  await view.findByText('Rule "Daily spending" saved');
  assert.equal(savedRules.length, 2);
  assert.deepEqual(savedRules[0], { id: "daily", name: "Daily spending", enabled: true, action: "RECEIVABLE_OTHER_WORKSPACE", filters: ["Card Transaction Alert"],
    sourceWorkspaceId: "personal", sourceAccountId: "personal-bank", sourceBudgetId: "personal-budget" });
  const reopened = ui.within(await openEditor(view));
  ui.fireEvent.change(reopened.getByRole("combobox", { name: "Action" }), { target: { value: "DEDUCT_SAME_WORKSPACE" } });
  assert.equal(reopened.getByRole("combobox", { name: "Source Sub Account" }).value, "daily-budget");
  ui.fireEvent.click(reopened.getByRole("button", { name: "Save Rule" }));
  await ui.waitFor(() => assert.equal(writes().length, 2));
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  assert.deepEqual(savedRules[0], sameRule());
});

test("changing a source workspace clears stale account choices and excludes inactive or unrelated records", async () => {
  responses.set("GET /api/accounts", ({ url }) => url.searchParams.get("workspaceId") === "personal"
    ? [bank("inactive", "Closed account", "personal", { isActive: false }), bank("personal-bank", "Personal checking", "personal")] : [bank("household-bank", "Household checking")]);
  responses.set("GET /api/budgets", ({ url }) => url.searchParams.get("workspaceId") === "personal" ? [
    budget("wrong-account", "Other bank", "inactive"), budget("inactive-budget", "Closed budget", "personal-bank", { isActive: false }),
    budget("personal-budget", "Personal expenses", "personal-bank"),
  ] : [budget("daily-budget", "Daily expenses", "household-bank"), budget("settlement-budget", "Card settlement", "household-bank")]);
  const view = show();
  const form = ui.within(await addRule(view));
  ui.fireEvent.change(form.getByRole("combobox", { name: "Action" }), { target: { value: "RECEIVABLE_OTHER_WORKSPACE" } });
  await form.findByRole("option", { name: "Personal checking" });
  assert.ok(!form.queryByRole("option", { name: "Closed account" }));
  ui.fireEvent.change(form.getByRole("combobox", { name: "Bank Account" }), { target: { value: "personal-bank" } });
  assert.equal(form.getByRole("combobox", { name: "Sub Account" }).value, "personal-budget");
  assert.ok(!form.queryByRole("option", { name: "Other bank" }));
  assert.ok(!form.queryByRole("option", { name: "Closed budget" }));
  ui.fireEvent.change(form.getByRole("combobox", { name: "Workspace" }), { target: { value: "" } });
  assert.equal(form.getByRole("combobox", { name: "Bank Account" }).value, "");
  assert.equal(form.getByRole("combobox", { name: "Sub Account" }).value, "");
  assert.ok(!form.queryByRole("option", { name: "Personal checking" }));
});

test("rule order changes persist while the editor stays open and deletion closes it only after success", async () => {
  const view = show();
  const form = ui.within(await openEditor(view, /Backup spending/));
  assert.ok(form.getByRole("button", { name: "Move down" }).disabled);
  ui.fireEvent.click(form.getByRole("button", { name: "Move up" }));
  await form.findByText("Rule order saved");
  assert.deepEqual(savedRules.map((rule) => rule.id), ["backup", "daily"]);
  await ui.waitFor(() => assert.ok(!form.getByRole("button", { name: "Move down" }).disabled));
  assert.ok(form.getByRole("button", { name: "Move up" }).disabled);
  ui.fireEvent.click(form.getByRole("button", { name: "Move down" }));
  await ui.waitFor(() => assert.equal(writes().length, 2));
  await ui.waitFor(() => assert.ok(!form.getByRole("button", { name: "Delete rule" }).disabled));
  assert.deepEqual(savedRules.map((rule) => rule.id), ["daily", "backup"]);
  ui.fireEvent.click(form.getByRole("button", { name: "Delete rule" }));
  await view.findByText("Rule deleted");
  assert.deepEqual(savedRules.map((rule) => rule.id), ["daily"]);
  assert.ok(!view.queryByRole("dialog"));
  assert.ok(!view.queryByRole("checkbox", { name: "Backup spending enabled" }));
});

test("cancel and deleting an unsaved rule discard editor changes without changing saved rules", async () => {
  const view = show();
  let form = ui.within(await openEditor(view));
  ui.fireEvent.change(form.getByRole("textbox", { name: "Rule Name" }), { target: { value: "Discard me" } });
  ui.fireEvent.click(form.getByRole("button", { name: "Remove Card Transaction Alert" }));
  ui.fireEvent.click(form.getByRole("button", { name: "Cancel" }));
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(savedRules[0].name, "Daily spending");
  assert.deepEqual(savedRules[0].filters, ["Card Transaction Alert"]);
  form = ui.within(await addRule(view));
  assert.ok(form.getByRole("button", { name: "Move up" }).disabled);
  assert.ok(form.getByRole("button", { name: "Move down" }).disabled);
  ui.fireEvent.click(form.getByRole("button", { name: "Delete rule" }));
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(writes().length, 0);
  form = ui.within(await openEditor(view));
  ui.fireEvent.click(form.getByRole("button", { name: "Close Edit Auto Accounting Rule" }));
  assert.ok(!view.queryByRole("dialog"));
});

test("pause and resume preserve rule contents and Reset clears operation feedback", async () => {
  const view = show();
  ui.fireEvent.click(await view.findByRole("checkbox", { name: "Daily spending enabled" }));
  await view.findByText("Rule paused");
  assert.equal(savedRules[0].enabled, false);
  await ui.waitFor(() => assert.ok(!view.getByRole("checkbox", { name: "Daily spending enabled" }).disabled));
  ui.fireEvent.click(view.getByRole("checkbox", { name: "Daily spending enabled" }));
  await view.findByText("Rule enabled");
  assert.equal(savedRules[0].enabled, true);
  await ui.waitFor(() => assert.ok(!view.getByRole("button", { name: "Reset" }).disabled));
  ui.fireEvent.click(view.getByRole("button", { name: "Reset" }));
  assert.ok(!view.queryByText("Rule enabled"));
  assert.ok(view.getByRole("button", { name: "Reset" }).disabled);
  assert.deepEqual(savedRules[0].filters, ["Card Transaction Alert"]);
});

test("failed optimistic toggles roll back and expose a retryable message", async () => {
  responses.set("PUT /api/credit-transactions/auto-rules", () => { throw "offline"; });
  const view = show();
  ui.fireEvent.click(await view.findByRole("checkbox", { name: "Daily spending enabled" }));
  await view.findByText("Failed to save auto-accounting rules");
  assert.ok(view.getByRole("checkbox", { name: "Daily spending enabled" }).checked);
  assert.ok(!view.getByRole("checkbox", { name: "Daily spending enabled" }).disabled);
  assert.equal(invalidations.length, 0);
});

test("recent-authentication save failures present the sign-in action inside the editor", async () => {
  responses.set("PUT /api/credit-transactions/auto-rules", new Error("Recent authentication required"));
  const view = show();
  const form = ui.within(await openEditor(view));
  ui.fireEvent.click(form.getByRole("button", { name: "Save Rule" }));
  await form.findByText("Re-authentication required");
  assert.ok(form.getByRole("button", { name: "Re-authenticate" }));
  assert.ok(!form.getByRole("button", { name: "Save Rule" }).disabled);
});

for (const accounted of [0, 1, 2]) {
  test(`manual accounting summarizes ${accounted} posted transactions and refreshes affected financial data`, async () => {
    responses.set("POST /api/credit-transactions/auto-rules/run", { ok: true, scanned: 5, matched: accounted, accounted, skipped: 0 });
    const view = show();
    await view.findByRole("checkbox", { name: "Daily spending enabled" });
    ui.fireEvent.click(view.getByRole("button", { name: "Run Now" }));
    await view.findByText(accounted ? `Auto-accounted ${accounted} transaction${accounted === 1 ? "" : "s"}` : "No transactions auto-accounted");
    assert.deepEqual(requests.find(({ method }) => method === "POST").body, { workspaceId: "household" });
    assert.deepEqual(invalidations, ["credit-transactions", "transactions", "receivables", "budgets", "bank-accounts", "receivables-summary", "dashboard-summary"].map((root) => [root]));
  });
}

for (const [error, expected] of [[new Error("Recent authentication required"), "Re-authentication required"], ["offline", "Failed to run auto-accounting"]]) {
  test(`manual accounting failure ${expected} unlocks controls without invalidating financial data`, async () => {
    responses.set("POST /api/credit-transactions/auto-rules/run", () => { throw error; });
    const view = show();
    await view.findByRole("checkbox", { name: "Daily spending enabled" });
    ui.fireEvent.click(view.getByRole("button", { name: "Run Now" }));
    await view.findByText(expected);
    assert.ok(!view.getByRole("button", { name: "Run Now" }).disabled);
    assert.equal(invalidations.length, 0);
  });
}

test("pending accounting blocks concurrent saves and reports progress until it finishes", async (t) => {
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve({ accounted: 0, matched: 0 })));
  responses.set("POST /api/credit-transactions/auto-rules/run", () => pending.promise);
  const view = show();
  await view.findByRole("checkbox", { name: "Daily spending enabled" });
  ui.act(() => {
    ui.fireEvent.click(view.getByRole("button", { name: "Run Now" }));
    ui.fireEvent.click(view.getByRole("checkbox", { name: "Daily spending enabled" }));
    ui.fireEvent.click(view.getByRole("button", { name: "Add Rule" }));
  });
  assert.ok((await view.findByRole("button", { name: "Running..." })).disabled);
  assert.ok(view.getByRole("checkbox", { name: "Daily spending enabled" }).disabled);
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(writes().length, 0);
  await ui.act(async () => pending.resolve({ accounted: 0, matched: 0 }));
  await view.findByText("No transactions auto-accounted");
});

test("loading and failed rule queries expose their state without rendering stale rule cards", async (t) => {
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve({ workspaceId: "household", rules: savedRules })));
  responses.set("GET /api/credit-transactions/auto-rules", () => pending.promise);
  const view = show();
  await ui.waitFor(() => assert.equal(view.client.getQueryState(["credit-txn-auto-rules", "household"])?.fetchStatus, "fetching"));
  assert.ok(!view.queryByRole("checkbox", { name: "Daily spending enabled" }));
  await ui.act(async () => pending.reject(new Error("Rules unavailable")));
  await view.findByText("Failed to load auto-accounting rules");
  assert.ok(!view.queryByRole("checkbox", { name: "Daily spending enabled" }));
});

test("card summaries handle paused, unnamed, multiple-keyword and deleted destination references", async () => {
  savedRules = [sameRule({ name: "", enabled: false, filters: [], sourceBudgetId: "missing", destinationBudgetId: "missing-two" }),
    { id: "cross", name: "Cross workspace", enabled: true, action: "RECEIVABLE_OTHER_WORKSPACE", filters: ["one", "two"], sourceWorkspaceId: "deleted", sourceAccountId: "deleted", sourceBudgetId: "deleted" }];
  const view = show();
  await view.findByRole("button", { name: "Rule 1" });
  assert.ok(view.getByText("Paused"));
  assert.ok(view.getByText("No keyword"));
  assert.ok(view.getByText("+1"));
  assert.ok(view.getByText("Sub account -> Sub account"));
  assert.ok(view.getByText("Workspace · Bank account · Sub account"));
});

test("an editor draft survives tab changes without changing the persisted rule", async () => {
  const view = show();
  const form = ui.within(await openEditor(view));
  ui.fireEvent.change(form.getByRole("textbox", { name: "Rule Name" }), { target: { value: "Draft name" } });
  view.section("workspaces");
  assert.ok(!view.queryByRole("dialog"));
  view.section("automation");
  const reopened = ui.within(await view.findByRole("dialog", { name: "Edit auto-accounting rule" }));
  assert.equal(reopened.getByRole("textbox", { name: "Rule Name" }).value, "Draft name");
  assert.equal(savedRules[0].name, "Daily spending");
});

test("missing workspace state disables rule actions and never submits or loads scoped data", async () => {
  responses.set("GET /api/context", { workspaceId: null, role: "OWNER", workspaces: [] });
  const view = show();
  await view.findByText("Credit Card Auto Accounting");
  assert.ok(view.getByRole("button", { name: "Run Now" }).disabled);
  assert.ok(view.getByRole("button", { name: "Add Rule" }).disabled);
  assert.equal(requests.filter(({ url }) => url.pathname.includes("auto-rules")).length, 0);
});

for (const [budgets, defaultBudgetId, source, destination] of [
  [[], null, "", ""],
  [[budget("only", "Only budget", "bank")], "only", "only", ""],
  [[budget("first", "First", "bank"), budget("second", "Second", "bank"), budget("inactive", "Inactive", "bank", { isActive: false })], "missing", "first", "second"],
]) {
  test(`new-rule destinations adapt safely to available sub accounts ${source}/${destination}`, async () => {
    const context = responses.get("GET /api/context");
    responses.set("GET /api/context", { ...context, defaultBudgetId });
    responses.set("GET /api/budgets", budgets);
    const view = show();
    await view.findByRole("checkbox", { name: "Daily spending enabled" });
    const form = ui.within(await addRule(view));
    assert.equal(form.getByRole("combobox", { name: "Source Sub Account" }).value, source);
    assert.equal(form.getByRole("combobox", { name: "Destination Sub Account" }).value, destination);
    assert.ok(!form.queryByRole("option", { name: "Inactive" }));
  });
}

for (const operation of ["save", "run"]) {
  for (const outcome of ["success", "error"]) {
    test(`late ${operation} ${outcome} cannot replace the editor or feedback after switching workspaces`, async (t) => {
      const pending = deferred();
      t.after(() => ui.act(async () => pending.resolve({ workspaceId: "household", rules: savedRules, accounted: 1, matched: 1 })));
      const personalRules = [sameRule({ id: "personal-rule", name: "Personal spending" })];
      responses.set("GET /api/credit-transactions/auto-rules", ({ url }) => ({
        workspaceId: url.searchParams.get("workspaceId"),
        rules: url.searchParams.get("workspaceId") === "personal" ? personalRules : savedRules,
      }));
      responses.set(operation === "save" ? "PUT /api/credit-transactions/auto-rules" : "POST /api/credit-transactions/auto-rules/run", () => pending.promise);
      const view = showController();
      await ui.waitFor(() => assert.equal(view.result.current.ruleDrafts.length, 2));
      ui.act(() => view.result.current.openRuleEditor(savedRules[0]));
      ui.act(() => operation === "save" ? view.result.current.saveEditingRule() : view.result.current.runRules());
      await ui.waitFor(() => assert.equal(view.result.current.isBusy, true));
      view.change({ workspaceId: "personal" });
      await ui.waitFor(() => assert.deepEqual(view.result.current.ruleDrafts, personalRules));
      assert.equal(view.result.current.editingAutoRule, null);
      assert.equal(view.result.current.autoRuleNotice, null);
      await ui.act(async () => {
        if (outcome === "success") pending.resolve({ workspaceId: "household", rules: [], accounted: 1, matched: 1 });
        else pending.reject(new Error("Previous workspace failed"));
      });
      await ui.waitFor(() => assert.equal(view.result.current.isBusy, false));
      assert.deepEqual(view.result.current.ruleDrafts, personalRules);
      assert.equal(view.result.current.autoRuleNotice, null);
      ui.act(() => view.result.current.openRuleEditor(personalRules[0]));
      assert.equal(view.result.current.editingAutoRule.name, "Personal spending");
      assert.equal(requests.filter(({ method }) => method !== "GET").length, 1);
      if (operation === "save" && outcome === "success") assert.deepEqual(invalidations, [["credit-txn-auto-rules", "household"]]);
    });
  }
}

test("the synchronous save lock rejects duplicate submissions and queued editor actions before React rerenders", async (t) => {
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve({ workspaceId: "household", rules: savedRules })));
  responses.set("PUT /api/credit-transactions/auto-rules", () => pending.promise);
  const view = showController();
  await ui.waitFor(() => assert.equal(view.result.current.ruleDrafts.length, 2));
  ui.act(() => view.result.current.openRuleEditor(savedRules[0]));
  ui.act(() => view.result.current.setKeywordInput("pending keyword"));
  const controller = view.result.current;
  ui.act(() => {
    controller.saveEditingRule();
    controller.saveEditingRule();
    controller.runRules();
    controller.toggleRuleEnabled("backup", false);
    controller.moveRule("daily", 1);
    controller.openRuleEditor(savedRules[1]);
    controller.closeRuleEditor();
    controller.updateEditingRule((rule) => ({ ...rule, name: "Stale edit" }));
    controller.addRuleFilter();
    controller.removeRule("daily");
    controller.addRule();
    controller.resetRules();
  });
  await ui.waitFor(() => assert.equal(writes().length, 1));
  assert.equal(requests.filter(({ method }) => method === "POST").length, 0);
  assert.equal(view.result.current.editingAutoRule.name, "Daily spending");
  assert.equal(view.result.current.keywordInput, "pending keyword");
  assert.deepEqual(view.result.current.ruleDrafts, savedRules);
  await ui.act(async () => pending.resolve({ workspaceId: "household", rules: savedRules }));
  await ui.waitFor(() => assert.equal(view.result.current.isBusy, false));
  assert.equal(view.result.current.editingAutoRule, null);
});

test("unavailable-workspace and stale-editor actions never submit or invent rule data", () => {
  const view = showController({ workspaceId: null, accounts: undefined, budgets: undefined });
  ui.act(() => {
    view.result.current.runRules();
    view.result.current.toggleRuleEnabled("deleted", false);
    view.result.current.saveEditingRule();
    view.result.current.updateEditingRule((rule) => ({ ...rule, name: "Stale editor" }));
    view.result.current.moveRule("deleted", -1);
    view.result.current.resetRules();
  });
  assert.deepEqual(view.result.current.ruleDrafts, []);
  assert.equal(view.result.current.editingAutoRule, null);
  assert.deepEqual(view.result.current.defaultDestination, { sourceBudgetId: "", destinationBudgetId: "" });
  assert.equal(requests.length, 0);
});

test("out-of-range ordering leaves the list unchanged and resetting an open editor restores query data", async () => {
  const view = showController();
  await ui.waitFor(() => assert.equal(view.result.current.ruleDrafts.length, 2));
  ui.act(() => {
    view.result.current.moveRule("daily", -1);
    view.result.current.moveRule("backup", 1);
    view.result.current.openRuleEditor(savedRules[0]);
  });
  assert.equal(view.result.current.canReset, true);
  ui.act(() => view.result.current.resetRules());
  assert.equal(view.result.current.editingAutoRule, null);
  assert.equal(view.result.current.canReset, false);
  assert.deepEqual(view.result.current.ruleDrafts, savedRules);
  assert.equal(view.result.current.getDefaultSourceBudgetId("missing-workspace", "bank"), "");
  assert.equal(writes().length, 0);
});

test("delayed field updaters ignore an incompatible posting type after an action change", () => {
  const changes = [];
  const other = { id: "cross", name: "Shared", enabled: true, action: "RECEIVABLE_OTHER_WORKSPACE", filters: [],
    sourceWorkspaceId: "personal", sourceAccountId: "personal-bank", sourceBudgetId: "personal-budget" };
  const base = {
    rule: sameRule(), displayIndex: 1, ruleIndex: 0, ruleCount: 1, workspaceId: "household", baseCurrency: "SGD",
    workspaces: [], sameWorkspaceBudgets: [budget("second", "Second budget", "bank")],
    sourceAccounts: [bank("personal-bank", "Personal checking")], sourceBudgets: [budget("personal-budget", "Personal expenses", "personal-bank")],
    defaultDestination: { sourceBudgetId: "daily-budget", destinationBudgetId: "settlement-budget" },
    keywordInput: "", actionLabel: "Transfer", targetLabel: "Daily expenses", isSaving: false,
    onUpdate: (update) => changes.push(update), onKeywordInputChange: mock.fn(), onAddFilter: mock.fn(), onRemoveFilter: mock.fn(),
    onMove: mock.fn(), onDelete: mock.fn(), onClose: mock.fn(), onSave: mock.fn(), getDefaultSourceBudgetId: () => "personal-budget",
  };
  const view = ui.render(ui.h(AutoRuleEditorDialog, base));
  ui.fireEvent.change(view.getByRole("textbox", { name: "Rule Name" }), { target: { value: "Queued name" } });
  assert.equal(changes.pop()(sameRule()).name, "Queued name");
  ui.fireEvent.click(view.getByRole("checkbox", { name: "Rule is active" }));
  assert.equal(changes.pop()(sameRule()).enabled, false);
  for (const name of ["Source Sub Account", "Destination Sub Account"]) {
    ui.fireEvent.change(view.getByRole("combobox", { name }), { target: { value: "second" } });
    const update = changes.pop();
    assert.equal(update(other), other);
    assert.equal(update(sameRule())[name === "Source Sub Account" ? "sourceBudgetId" : "destinationBudgetId"], "second");
  }
  ui.fireEvent.change(view.getByRole("combobox", { name: "Action" }), { target: { value: "RECEIVABLE_OTHER_WORKSPACE" } });
  assert.equal(changes.pop()(sameRule()).sourceWorkspaceId, "");
  view.rerender(ui.h(AutoRuleEditorDialog, { ...base, rule: other }));
  const same = sameRule();
  for (const [name, value] of [["Workspace", ""], ["Bank Account", "personal-bank"], ["Sub Account", "personal-budget"]]) {
    ui.fireEvent.change(view.getByRole("combobox", { name }), { target: { value } });
    const update = changes.pop();
    assert.equal(update(same), same);
    const field = { Workspace: "sourceWorkspaceId", "Bank Account": "sourceAccountId", "Sub Account": "sourceBudgetId" }[name];
    assert.equal(update(other)[field], value);
  }
});
