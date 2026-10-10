import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const requests = [], invalidations = [], clients = [];
let responses;
mock.module("../lib/api/client.ts", { namedExports: { apiFetch: async (url, options = {}) => {
  const request = { url, ...options, body: options.body ? JSON.parse(options.body) : undefined };
  requests.push(request);
  const path = url.split("?")[0];
  assert.ok(responses.has(path), `Unexpected API request: ${url}`);
  const response = responses.get(path);
  if (response instanceof Error) throw response;
  return typeof response === "function" ? response(request) : response;
} } });
mock.module("../components/workspace-provider.tsx", { namedExports: { useWorkspaceId: () => "workspace-one" } });
mock.module("../lib/use-money-format.ts", { namedExports: { useMoneyFormat: () => ({ mask: (value) => value }) } });
const { DataImportSection } = require("../components/data-import-section.tsx");
const { useDataImport } = require("../hooks/use-data-import.ts");
const row = (values = {}) => ({ Direction: "DEBIT", Subject: "Groceries", Date: "2026-10-01", AmountCents: 1250, ...values });
const chunkReply = (values = {}) => ({
  success: true, imported: 1, duplicates: 0, duplicateRecords: [], failed: 0, total: 1, errors: [],
  chunked: true, chunkIndex: 0, processedCount: 1, remainingCount: 0, isComplete: true, recalculated: true, ...values,
});
function clientWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (options) => { invalidations.push(options.queryKey); return invalidate(options); };
  clients.push(client);
  return ({ children }) => ui.h(QueryClientProvider, { client }, children);
}
function show(props = {}) {
  const Wrapper = clientWrapper();
  const element = (values) => ui.h(Wrapper, null, ui.h(DataImportSection, { workspaceId: "workspace-one", baseCurrency: "SGD", ...values }));
  return { ...ui.render(element(props)), element };
}
async function fill(view, rows = [row()]) {
  await view.findByRole("option", { name: "Daily bank (DBS)" });
  ui.fireEvent.change(view.getByLabelText("Bank Account"), { target: { value: "bank-one" } });
  await view.findByRole("option", { name: "Food" });
  ui.fireEvent.change(view.getByLabelText("Sub Account (Budget)"), { target: { value: "food" } });
  ui.fireEvent.change(view.getByLabelText("JSON Data"), { target: { value: JSON.stringify(rows) } });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  requests.length = invalidations.length = 0;
  responses = new Map([
    ["/api/context", { workspaces: [{ id: "workspace-one", name: "Household" }, { id: "workspace-two", name: "Travel" }] }],
    ["/api/accounts", [
      { id: "bank-one", name: "Daily bank", bankName: "DBS", isActive: true },
      { id: "bank-empty", name: "Spare bank", bankName: null, isActive: true },
      { id: "bank-closed", name: "Closed bank", bankName: "DBS", isActive: false },
    ]],
    ["/api/budgets", [
      { id: "food", accountId: "bank-one", name: "Food", isActive: true },
      { id: "travel", accountId: "bank-one", name: "Travel savings", isActive: true },
      { id: "closed", accountId: "bank-one", name: "Closed subaccount", isActive: false },
      { id: "unrelated", accountId: "bank-other", name: "Other bank subaccount", isActive: true },
    ]],
    ["/api/transactions/bulk-import", chunkReply()],
    ["/api/budgets/recalculate", { success: true, recalculated: 1, budgets: [{ id: "food", name: "Food", previousCents: 1000, newCents: 1500, difference: 500 }] }],
  ]);
});
afterEach(() => { ui.cleanup(); for (const client of clients.splice(0)) client.clear(); });
after(() => ui.dispose());

test("an import with zero failed rows is displayed as a successful operation", async () => {
  const view = show();
  await fill(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Import Transactions" }));
  const notice = await view.findByText("Import complete! Imported 1 transactions. 0 duplicates skipped. 0 failed. Balance recalculated.");
  assert.equal(notice.tagName, "OUTPUT");
  assert.ok(notice.classList.contains("is-success"));
  assert.ok(!notice.classList.contains("is-danger"));
  assert.equal(view.getByLabelText("JSON Data").value, "");
  assert.ok(view.getByRole("button", { name: "Import Transactions" }).disabled);
});

test("an in-flight import locks the workspace selector until its original target has completed", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(chunkReply()));
  responses.set("/api/transactions/bulk-import", () => pending.promise);
  const view = show();
  await fill(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Import Transactions" }));
  await view.findByRole("button", { name: "Importing..." });
  assert.ok(view.getByLabelText("Workspace").disabled);
  assert.ok(view.getByLabelText("Bank Account").disabled);
  assert.ok(view.getByLabelText("Sub Account (Budget)").disabled);
  assert.ok(view.getByRole("button", { name: "Recalculate" }).disabled);
  await ui.act(async () => pending.resolve(chunkReply()));
  await view.findByText(/Import complete!/);
  assert.ok(!view.getByLabelText("Workspace").disabled);
});

test("import targets show only active accounts and their active subaccounts and reset when switching workspaces", async () => {
  const view = show({ workspaceId: null });
  await view.findByRole("option", { name: "Household" });
  assert.ok(view.getByText("Select a workspace first"));
  assert.ok(view.getByLabelText("Bank Account").disabled);
  assert.ok(view.getByLabelText("Sub Account (Budget)").disabled);
  assert.ok(view.getByRole("button", { name: "Import Transactions" }).disabled);
  assert.ok(view.getByRole("button", { name: "Recalculate" }).disabled);
  ui.fireEvent.change(view.getByLabelText("Workspace"), { target: { value: "workspace-one" } });
  await fill(view);
  assert.ok(!view.queryByRole("option", { name: "Closed bank (DBS)" }));
  assert.ok(!view.queryByRole("option", { name: "Closed subaccount" }));
  assert.ok(!view.queryByRole("option", { name: "Other bank subaccount" }));
  ui.fireEvent.change(view.getByLabelText("Bank Account"), { target: { value: "bank-empty" } });
  assert.equal(view.getByLabelText("Sub Account (Budget)").value, "");
  assert.ok(view.getByText("No active sub accounts for this bank account"));
  assert.ok(view.getByRole("button", { name: "Import Transactions" }).disabled);
  await fill(view);
  ui.fireEvent.change(view.getByLabelText("Workspace"), { target: { value: "workspace-two" } });
  assert.equal(view.getByLabelText("Bank Account").value, "");
  assert.equal(view.getByLabelText("Sub Account (Budget)").value, "");
  await ui.waitFor(() => assert.ok(requests.some(({ url }) => url === "/api/accounts?workspaceId=workspace-two")));
  await fill(view);
  ui.fireEvent.change(view.getByLabelText("Transaction Kind"), { target: { value: "EXPENSE" } });
  assert.ok(view.getByText("Duplicate detection: Transactions with the same Date + Subject + AmountCents will be skipped."));
  ui.fireEvent.click(view.getByRole("button", { name: "Import Transactions" }));
  await view.findByRole("status");
  const mutation = requests.find(({ method }) => method === "POST");
  assert.equal(mutation.body.workspaceId, "workspace-two");
  assert.equal(mutation.body.kind, "EXPENSE");
});

test("the import preview explains invalid input, caps visible errors, and clears all preview state", async () => {
  const view = show({ baseCurrency: "USD" });
  await fill(view, []);
  assert.ok(view.getByText("No valid transactions found"));
  assert.ok(view.getByRole("button", { name: "Import Transactions" }).disabled);
  ui.fireEvent.change(view.getByLabelText("JSON Data"), { target: { value: "{" } });
  assert.ok(view.getByText(/Invalid JSON:/));
  await fill(view, [row(), null, null, null, null, null]);
  assert.ok(view.getByText("Valid: 1, Invalid: 5"));
  assert.equal(view.container.querySelectorAll(".settings-import-preview-error").length, 4);
  assert.ok(view.getByText("...and 2 more"));
  assert.ok(view.container.querySelector(".settings-import-preview.is-warning"));
  await fill(view, [row({ AmountCents: 12345 })]);
  assert.ok(view.getByText("Valid: 1 transactions (123.45 USD)"));
  assert.ok(view.container.querySelector(".settings-import-preview.is-success"));
  ui.fireEvent.click(view.getByRole("button", { name: "Clear" }));
  assert.equal(view.getByLabelText("JSON Data").value, "");
  assert.ok(!view.container.querySelector(".settings-import-preview"));
  assert.ok(!view.queryByRole("button", { name: "Clear" }));
  assert.ok(!requests.some(({ method }) => method === "POST"));
});

test("pending account and subaccount queries disable their selectors, and a single workspace needs no selector", async (t) => {
  const accounts = deferred(), budgets = deferred();
  const accountRows = responses.get("/api/accounts"), budgetRows = responses.get("/api/budgets");
  t.after(() => { accounts.resolve(accountRows); budgets.resolve(budgetRows); });
  responses.set("/api/context", { workspaces: [{ id: "workspace-one", name: "Household" }] });
  responses.set("/api/accounts", () => accounts.promise);
  responses.set("/api/budgets", () => budgets.promise);
  const view = show();
  assert.ok(view.getByLabelText("Bank Account").disabled);
  assert.ok(!view.queryByLabelText("Workspace"));
  await ui.act(async () => accounts.resolve(accountRows));
  await view.findByRole("option", { name: "Daily bank (DBS)" });
  ui.fireEvent.change(view.getByLabelText("Bank Account"), { target: { value: "bank-one" } });
  assert.ok(view.getByLabelText("Sub Account (Budget)").disabled);
  assert.ok(!view.queryByText("No active sub accounts for this bank account"));
  await ui.act(async () => budgets.resolve(budgetRows));
  await view.findByRole("option", { name: "Food" });
  assert.ok(!view.getByLabelText("Sub Account (Budget)").disabled);
});

test("chunked imports report bounded progress, retain repeated duplicate details, and limit displayed errors", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(chunkReply({ imported: 250, recalculated: false })));
  const duplicate = { date: "2026-10-01", subject: "Repeated income", amountCents: 1500, direction: "CREDIT", notes: "<b>Original note</b>", reason: "EXISTING_TRANSACTION" };
  responses.set("/api/transactions/bulk-import", ({ body }) => {
    if (body.chunkIndex === 0) return chunkReply({
      imported: 241, duplicates: 3, failed: 6, recalculated: false,
      errors: Array.from({ length: 6 }, () => "Invalid posting date"),
      duplicateRecords: [duplicate, duplicate, { ...duplicate, direction: "DEBIT", subject: "Repeated expense", notes: null, reason: "DUPLICATE_IN_PAYLOAD" }],
    });
    if (body.chunkIndex === 1) return pending.promise;
    return chunkReply();
  });
  const view = show();
  await fill(view, Array.from({ length: 501 }, () => row()));
  ui.fireEvent.click(view.getByRole("button", { name: "Import Transactions" }));
  await view.findByText("Importing... 250 of 501 records");
  assert.ok(view.getByText("50%"));
  assert.equal(view.container.querySelector(".settings-import-progress-value").style.width, "50%");
  assert.ok(view.getByText("Imported: 241"));
  assert.ok(view.getByText("Duplicates: 3"));
  assert.ok(view.getByText("Failed: 6"));
  assert.ok(!view.queryByText("Skipped duplicates (3)"));
  await ui.act(async () => pending.resolve(chunkReply({ imported: 250, recalculated: false })));
  const notice = await view.findByRole("alert");
  assert.equal(notice.textContent, "Import complete! Imported 492 transactions. 3 duplicates skipped. 6 failed. Balance recalculated.");
  assert.ok(notice.classList.contains("is-danger"));
  assert.equal(view.getAllByText("• Invalid posting date").length, 5);
  assert.ok(view.getByText("...and 1 more"));
  assert.ok(view.getByText("Skipped duplicates (3)"));
  assert.equal(view.container.querySelectorAll(".settings-import-duplicate-item").length, 3);
  assert.equal(view.getAllByText("Repeated income").length, 2);
  assert.equal(view.getAllByText("Notes: <b>Original note</b>").length, 2);
  assert.equal(view.getAllByText("Already exists in this subaccount").length, 2);
  assert.ok(view.getByText("Repeated in uploaded JSON"));
  assert.equal(view.getAllByText("+15.00 SGD").length, 2);
  assert.ok(view.getByText("−15.00 SGD"));
  assert.ok(!view.container.querySelector(".settings-import-duplicate-item b"));
  const chunks = requests.filter(({ method }) => method === "POST");
  assert.deepEqual(chunks.map(({ body }) => body.transactions.length), [250, 250, 1]);
  const runId = chunks[0].body.importRunId;
  assert.match(runId, /^[a-f\d-]{36}$/);
  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.url, "/api/transactions/bulk-import");
    assert.equal(chunk.body.chunkIndex, index);
    assert.equal(chunk.body.chunkSize, 250);
    assert.equal(chunk.body.totalChunks, 3);
    assert.equal(chunk.body.recalculate, true);
    assert.equal(chunk.body.importRunId, runId);
    assert.equal(chunk.headers["Idempotency-Key"], `json-import:${runId}:${index}`);
  }
  assert.deepEqual(invalidations.map((key) => key.at(-1)), ["transactions", "bank-accounts", "budgets", "dashboard-summary"]);
  ui.fireEvent.change(view.getByLabelText("JSON Data"), { target: { value: "[]" } });
  assert.ok(!view.queryByText("Skipped duplicates (3)"));
  assert.ok(!view.queryByText("Errors:"));
  assert.ok(!view.queryByRole("alert"));
});

test("recalculation locks the form and shows positive, negative, and unchanged balances", async (t) => {
  const pending = deferred();
  const result = { recalculated: 3, budgets: [
    { id: "positive", name: "Positive", previousCents: 1000, newCents: 1200, difference: 200 },
    { id: "negative", name: "Negative", previousCents: 1000, newCents: -500, difference: -1500 },
    { id: "unchanged", name: "Unchanged", previousCents: 0, newCents: 0, difference: 0 },
  ] };
  t.after(() => pending.resolve(result));
  responses.set("/api/budgets/recalculate", () => pending.promise);
  const view = show();
  await fill(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Recalculate" }));
  await view.findByRole("button", { name: "Calculating..." });
  for (const label of ["Workspace", "Bank Account", "Sub Account (Budget)", "Transaction Kind", "JSON Data"]) {
    assert.ok(view.getByLabelText(label).disabled, `${label} must stay disabled during recalculation`);
  }
  assert.ok(view.getByRole("button", { name: "Import Transactions" }).disabled);
  assert.ok(!view.queryByRole("button", { name: "Clear" }));
  await ui.act(async () => pending.resolve(result));
  const notice = await view.findByRole("status");
  assert.equal(notice.textContent, "Budget recalculated! 3 budget(s) updated.");
  assert.ok(notice.classList.contains("is-success"));
  assert.equal(view.container.querySelectorAll(".settings-recalculation-item").length, 3);
  assert.equal(view.container.querySelectorAll(".settings-recalculation-difference").length, 2);
  assert.ok(view.getByText("Difference: +2.00"));
  assert.ok(view.getByText("Difference: -15.00"));
  assert.equal(view.container.querySelector(".settings-recalculation-values .is-negative").textContent, "-5.00");
  const mutation = requests.find(({ method }) => method === "POST");
  assert.deepEqual(mutation.body, { workspaceId: "workspace-one", budgetId: "food" });
  assert.equal(mutation.url, "/api/budgets/recalculate");
  ui.fireEvent.change(view.getByLabelText("Sub Account (Budget)"), { target: { value: "travel" } });
  assert.ok(!view.queryByText("Recalculation Results"));
});

const target = (values = {}) => ({ workspaceId: "workspace-one", accountId: "bank-one", budgetId: "food", kind: "Migration", ...values });
function importHook(values = {}) {
  return ui.renderHook((props) => useDataImport(props), { initialProps: target(values), wrapper: clientWrapper() });
}

test("import and recalculation boundary guards reject missing targets and invalid previews without API calls", async () => {
  for (const field of ["workspaceId", "accountId", "budgetId"]) {
    const hook = importHook({ [field]: "" });
    await ui.act(async () => hook.result.current.handleImport());
    assert.equal(hook.result.current.notice.message, "Please select Workspace, Bank Account, and Sub Account");
    assert.equal(hook.result.current.canImport, false);
    if (field !== "accountId") {
      await ui.act(async () => hook.result.current.handleRecalculate());
      assert.equal(hook.result.current.notice.message, "Please select Workspace and Sub Account");
      assert.equal(hook.result.current.canRecalculate, false);
    }
    hook.unmount();
  }
  const hook = importHook();
  await ui.act(async () => hook.result.current.handleImport());
  assert.equal(hook.result.current.notice.message, "No valid transactions to import");
  await ui.act(async () => hook.result.current.handleJsonChange("[null]"));
  await ui.act(async () => hook.result.current.handleImport());
  assert.equal(hook.result.current.notice.message, "No valid transactions to import");
  assert.equal(hook.result.current.canImport, false);
  assert.deepEqual(requests, []);
});

test("a synchronous second action cannot overlap an import or change its input", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(chunkReply()));
  responses.set("/api/transactions/bulk-import", () => pending.promise);
  const hook = importHook();
  const input = JSON.stringify([row()]);
  await ui.act(async () => hook.result.current.handleJsonChange(input));
  let operation;
  await ui.act(async () => {
    operation = hook.result.current.handleImport();
    await hook.result.current.handleImport();
    await hook.result.current.handleRecalculate();
    hook.result.current.handleJsonChange("[]");
  });
  assert.equal(requests.length, 1);
  assert.equal(hook.result.current.jsonInput, input);
  assert.equal(hook.result.current.canImport, false);
  assert.equal(hook.result.current.canRecalculate, false);
  await ui.act(async () => { pending.resolve(chunkReply()); await operation; });
  assert.equal(hook.result.current.isImporting, false);
  assert.equal(hook.result.current.canRecalculate, true);
});

test("retrying an interrupted import reuses its run ID while changed input or target starts a new run", async () => {
  responses.set("/api/transactions/bulk-import", new Error("Connection lost"));
  const hook = importHook();
  const input = JSON.stringify([row()]);
  await ui.act(async () => hook.result.current.handleJsonChange(input));
  await ui.act(async () => hook.result.current.handleImport());
  assert.deepEqual(hook.result.current.notice, { message: "Import failed: Connection lost", tone: "danger" });
  assert.equal(hook.result.current.jsonInput, input);
  assert.equal(hook.result.current.canImport, true);
  await ui.act(async () => hook.result.current.handleImport());
  assert.equal(requests[0].body.importRunId, requests[1].body.importRunId);
  assert.deepEqual(requests[0].headers, requests[1].headers);
  hook.rerender(target({ budgetId: "travel" }));
  await ui.act(async () => hook.result.current.handleImport());
  assert.notEqual(requests[1].body.importRunId, requests[2].body.importRunId);
  assert.equal(requests[2].body.budgetId, "travel");
  await ui.act(async () => hook.result.current.handleJsonChange(input));
  responses.set("/api/transactions/bulk-import", chunkReply({ recalculated: false }));
  await ui.act(async () => hook.result.current.handleImport());
  assert.notEqual(requests[2].body.importRunId, requests[3].body.importRunId);
  assert.equal(hook.result.current.notice.message, "Import complete! Imported 1 transactions. 0 duplicates skipped. 0 failed.");
  assert.equal(hook.result.current.jsonInput, "");
  assert.equal(hook.result.current.preview, null);
  assert.equal(invalidations.length, 16);
});

test("non-Error import failures remain visible and never leave the import controls pending", async () => {
  responses.set("/api/transactions/bulk-import", () => Promise.reject("offline"));
  const hook = importHook();
  await ui.act(async () => hook.result.current.handleJsonChange(JSON.stringify([row()])));
  await ui.act(async () => hook.result.current.handleImport());
  assert.deepEqual(hook.result.current.notice, { message: "Import failed: Unknown error", tone: "danger" });
  assert.equal(hook.result.current.isImporting, false);
  assert.equal(hook.result.current.canImport, true);
});

test("recalculation failures release pending state, preserve input, and refresh potentially committed changes", async () => {
  const hook = importHook();
  await ui.act(async () => hook.result.current.handleJsonChange(JSON.stringify([row()])));
  for (const [response, message] of [
    [new Error("Budget unavailable"), "Recalculation failed: Budget unavailable"],
    [() => Promise.reject("offline"), "Recalculation failed: Unknown error"],
  ]) {
    responses.set("/api/budgets/recalculate", response);
    await ui.act(async () => hook.result.current.handleRecalculate());
    assert.deepEqual(hook.result.current.notice, { message, tone: "danger" });
    assert.equal(hook.result.current.isRecalculating, false);
    assert.equal(hook.result.current.recalcResult, null);
    assert.equal(hook.result.current.canImport, true);
    assert.equal(hook.result.current.canRecalculate, true);
  }
  assert.equal(invalidations.length, 8);
});
