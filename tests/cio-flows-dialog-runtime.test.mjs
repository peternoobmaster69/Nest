import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, within, waitFor } = ui;
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { ConfirmDialogProvider } = require("../components/confirm-dialog.tsx");
const { CioFlowsDialog } = require("../components/cio/dialogs/cio-flows-dialog.tsx");
const { setPrivacyMode, MASKED_AMOUNT } = require("../lib/privacy-mode.ts");
const requests = [];
const events = [];
let fixtures;
let client;
const flow = (overrides = {}) => ({ id: "flow", type: "EXTERNAL_CONTRIBUTION", label: "Monthly saving", amountCents: 12_500, cadence: "MONTHLY", startsOn: "2026-01-01T00:00:00.000Z", endsOn: null, sourceFinancialAccountId: null, sourceInvestmentAccountId: null, destinationInvestmentAccountId: null, includeInRetirementProjection: true, notes: null, ...overrides });
beforeEach((t) => {
  requests.length = 0;
  events.length = 0;
  ui.window.history.replaceState(null, "", "/w/household/cio");
  setPrivacyMode(false);
  fixtures = new Map([
    ["/api/cio/recurring-flows", { items: [] }],
    ["/api/context", { accounts: [{ id: "bank", name: "Daily bank", kind: "BANK" }, { id: "card", name: "Credit card", kind: "CREDIT_CARD" }] }],
    ["/api/investments", [{ id: "fund-a", displayName: "Global fund", institutionName: "Broker", productName: "ETF" }, { id: "fund-b", displayName: "", institutionName: "Other broker", productName: "Bond fund" }]],
  ]);
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3100");
    const method = init.method ?? "GET";
    const request = { url, method, body: init.body && JSON.parse(init.body), headers: new Headers(init.headers) };
    requests.push(request);
    const key = method === "GET" ? url.pathname : `${method} ${url.pathname}`;
    assert.ok(fixtures.has(key), `Missing request fixture: ${key}`);
    const fixture = fixtures.get(key);
    if (typeof fixture === "function") return fixture(request);
    return Response.json(fixture);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { ui.cleanup(); client.clear(); await ui.window.happyDOM.abort(); });
after(() => ui.dispose());
function element(props = {}) {
  return h(QueryClientProvider, { client }, h(ConfirmDialogProvider, null, h(CioFlowsDialog, { open: true, workspaceId: "household", currency: "SGD", onClose: () => events.push("close"), onSaved: () => events.push("saved"), ...props })));
}
function show(props) { return render(element(props)); }
function fill(view, name, value) { fireEvent.change(view.getByLabelText(name), { target: { value } }); }
function submit(view) { fireEvent.submit(view.getByLabelText(/^Name/).closest("form")); }
async function newFlow(view) {
  await view.findByText("No recurring plans yet");
  fireEvent.click(view.getByRole("button", { name: "Add recurring flow" }));
  assert.ok(view.getByRole("heading", { name: "New recurring flow" }));
}
function validForm(view) { fill(view, /^Name/, "  New savings  "); fill(view, /^Amount each time/, "125.75"); }
const writes = () => requests.filter(({ method }) => method !== "GET");

test("recurring flow queries wait for an open workspace and tolerate missing account context", async () => {
  const view = show({ open: false, workspaceId: null });
  assert.equal(view.queryByRole("dialog"), null);
  assert.deepEqual(requests, []);
  fixtures.set("/api/context", {});
  view.rerender(element({ workspaceId: null }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0].url.pathname, "/api/context");
  await newFlow(view);
  fill(view, /^What happens/, "INTERNAL_REALLOCATION");
  assert.equal(view.getByLabelText(/^Source bank account/).options.length, 1);
  assert.equal(view.getByLabelText(/^Destination investment/).options.length, 1);
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Close", exact: true }));
  assert.deepEqual(events, ["close"]);
});

test("recurring flow rows display dates, contribution roles and privacy masking", async () => {
  fixtures.set("/api/cio/recurring-flows", { items: [
    flow(), flow({ id: "transfer", label: "Fund transfer", type: "INTERNAL_REALLOCATION", endsOn: "2027-01-01T00:00:00Z" }),
    flow({ id: "withdrawal", label: "Spending", type: "EXTERNAL_WITHDRAWAL", includeInRetirementProjection: false }),
  ] });
  const view = show();
  await view.findByText("Monthly saving");
  assert.ok(view.getByText("Included in retirement projection"));
  assert.ok(view.getByText("Retirement-related; not new savings"));
  assert.ok(view.getByText("Excluded from retirement projection"));
  const rows = view.getAllByRole("article");
  assert.match(rows[0].textContent, /ongoing/);
  assert.match(rows[1].textContent, /to 1 Jan 2027/);
  assert.match(rows[0].textContent, /125\.00 each time/);
  await ui.act(async () => setPrivacyMode(true));
  assert.match(rows[0].textContent, new RegExp(MASKED_AMOUNT));
  assert.doesNotMatch(rows[0].textContent, /125\.00/);
});

test("a new contribution stores integer cents, optional references and a trimmed name and notes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00Z") });
  fixtures.set("POST /api/cio/recurring-flows", ({ body }) => {
    fixtures.set("/api/cio/recurring-flows", { items: [flow(body)] });
    return Response.json({ flow: flow(body) });
  });
  const view = show();
  await newFlow(view);
  validForm(view);
  assert.equal(view.getByLabelText(/^First occurrence/).value, "2026-10-09");
  fill(view, /^How often/, "QUARTERLY");
  fill(view, /^Last occurrence/, "2027-01-01");
  fill(view, /^Destination investment/, "fund-a");
  fill(view, /^Notes/, "  Future plan  ");
  fireEvent.click(view.getByRole("checkbox", { name: /Include in retirement/ }));
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved"]));
  assert.equal(view.queryByRole("heading", { name: "New recurring flow" }), null);
  assert.deepEqual(writes()[0].body, { type: "EXTERNAL_CONTRIBUTION", label: "New savings", amountCents: 12_575, cadence: "QUARTERLY", startsOn: "2026-10-09T00:00:00.000Z", endsOn: "2027-01-01T00:00:00.000Z", sourceFinancialAccountId: null, sourceInvestmentAccountId: null, destinationInvestmentAccountId: "fund-a", includeInRetirementProjection: false, notes: "Future plan" });
  assert.ok(requests.filter(({ url }) => url.pathname === "/api/cio/recurring-flows").length >= 3);
});

test("flow validation rejects missing names, invalid money, reversed dates and incomplete or self-directed transfers", async () => {
  const view = show();
  await newFlow(view);
  submit(view);
  assert.match(view.getByRole("alert").textContent, /Give this plan a short name/);
  fill(view, /^Name/, "Transfer");
  for (const amount of ["", "-1", "not money", "100000000000000000000"]) {
    fill(view, /^Amount each time/, amount);
    submit(view);
    assert.match(view.getByRole("alert").textContent, /amount greater than 0/);
  }
  fill(view, /^Amount each time/, "10");
  fill(view, /^First occurrence/, "");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /Choose when/);
  fill(view, /^First occurrence/, "2026-10-09");
  fill(view, /^Last occurrence/, "2026-10-08");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /on or after/);
  fill(view, /^Last occurrence/, "");
  fill(view, /^What happens/, "INTERNAL_REALLOCATION");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /choose where the money comes from/);
  fill(view, /^Source bank account/, "bank");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /which investment receives it/);
  fill(view, /^Source investment/, "fund-a");
  fill(view, /^Destination investment/, "fund-a");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /different destination/);
  assert.deepEqual(writes(), []);
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Add recurring flow" }));
  assert.equal(view.getByLabelText(/^Name/).value, "");
  assert.equal(view.queryByRole("alert"), null);
});

test("changing flow types and source choices clears incompatible references before saving", async () => {
  fixtures.set("POST /api/cio/recurring-flows", { flow: flow() });
  const view = show();
  await newFlow(view);
  validForm(view);
  assert.equal(view.queryByLabelText(/^Source bank/), null);
  fill(view, /^Destination investment/, "fund-a");
  fill(view, /^What happens/, "EXTERNAL_WITHDRAWAL");
  assert.equal(view.queryByLabelText(/^Destination investment/), null);
  assert.ok(view.getByText(/Subtracts this withdrawal/));
  fill(view, /^Source bank account/, "bank");
  assert.equal(view.queryByRole("option", { name: "Credit card" }), null);
  fill(view, /^Source investment/, "fund-b");
  assert.equal(view.getByLabelText(/^Source bank account/).value, "");
  fill(view, /^Source bank account/, "bank");
  assert.equal(view.getByLabelText(/^Source investment/).value, "");
  fill(view, /^Source investment/, "");
  assert.equal(view.getByLabelText(/^Source bank account/).value, "bank");
  fill(view, /^What happens/, "INTERNAL_REALLOCATION");
  assert.equal(view.getByLabelText(/^Destination investment/).value, "");
  assert.ok(view.getByText(/Marks this move as retirement-related/));
  fill(view, /^Source investment/, "fund-a");
  fill(view, /^Destination investment/, "fund-b");
  fill(view, /^What happens/, "EXTERNAL_CONTRIBUTION");
  assert.equal(view.queryByLabelText(/^Source bank/), null);
  submit(view);
  await waitFor(() => assert.equal(events.length, 1));
  assert.equal(writes()[0].body.sourceFinancialAccountId, null);
  assert.equal(writes()[0].body.sourceInvestmentAccountId, null);
  assert.equal(writes()[0].body.destinationInvestmentAccountId, "fund-b");
  assert.equal(writes()[0].body.notes, null);
});

test("editing a transfer preserves stored fields and updates its encoded resource ID", async () => {
  const existing = flow({ id: "transfer & one", label: "Fund transfer", type: "INTERNAL_REALLOCATION", sourceInvestmentAccountId: "fund-a", destinationInvestmentAccountId: "fund-b", endsOn: "2027-01-01", notes: "Existing note" });
  fixtures.set("/api/cio/recurring-flows", { items: [existing] });
  fixtures.set("PATCH /api/cio/recurring-flows/transfer%20%26%20one", { flow: existing });
  const view = show();
  fireEvent.click(await view.findByRole("button", { name: "Edit Fund transfer" }));
  assert.ok(view.getByRole("heading", { name: "Edit recurring flow" }));
  assert.equal(view.getByLabelText(/^Source investment/).value, "fund-a");
  assert.equal(view.getByLabelText(/^Destination investment/).value, "fund-b");
  assert.equal(view.getByLabelText(/^Amount each time/).value, "125");
  assert.equal(view.getByLabelText(/^Notes/).value, "Existing note");
  fill(view, /^Notes/, "");
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved"]));
  assert.equal(writes()[0].method, "PATCH");
  assert.equal(writes()[0].body.sourceInvestmentAccountId, "fund-a");
  assert.equal(writes()[0].body.notes, null);
  assert.equal(writes()[0].body.endsOn, "2027-01-01T00:00:00.000Z");
});

test("editing a withdrawal keeps its bank source and clears optional empty fields", async () => {
  const existing = flow({ type: "EXTERNAL_WITHDRAWAL", sourceFinancialAccountId: "bank" });
  fixtures.set("/api/cio/recurring-flows", { items: [existing] });
  fixtures.set("PATCH /api/cio/recurring-flows/flow", { flow: existing });
  const view = show();
  fireEvent.click(await view.findByRole("button", { name: "Edit Monthly saving" }));
  assert.equal(view.getByLabelText(/^Source bank account/).value, "bank");
  assert.equal(view.getByLabelText(/^Source investment/).value, "");
  assert.equal(view.getByLabelText(/^Last occurrence/).value, "");
  assert.equal(view.getByLabelText(/^Notes/).value, "");
  assert.ok(!view.queryByLabelText(/^Destination investment/));
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved"]));
  assert.equal(writes()[0].body.type, "EXTERNAL_WITHDRAWAL");
  assert.equal(writes()[0].body.sourceFinancialAccountId, "bank");
  assert.equal(writes()[0].body.sourceInvestmentAccountId, null);
  assert.equal(writes()[0].body.destinationInvestmentAccountId, null);
  assert.equal(writes()[0].body.endsOn, null);
  assert.equal(writes()[0].body.notes, null);
});

test("flow load failures can be retried and unknown thrown values use the generic error message", async () => {
  fixtures.set("/api/cio/recurring-flows", () => Response.json({ error: "Service unavailable" }, { status: 500 }));
  const view = show();
  await view.findByRole("heading", { name: "Recurring flows could not be loaded" });
  assert.ok(view.getByText("Service unavailable"));
  fixtures.set("/api/cio/recurring-flows", () => { throw "Connection closed"; });
  fireEvent.click(view.getByRole("button", { name: /Retry/ }));
  await waitFor(() => assert.ok(!view.queryByText("Service unavailable")));
  await view.findByRole("heading", { name: "Recurring flows could not be loaded" });
  fixtures.set("/api/cio/recurring-flows", { items: [] });
  fireEvent.click(view.getByRole("button", { name: /Retry/ }));
  await view.findByText("No recurring plans yet");
});

test("flow save failures remain editable and a pending save prevents form dismissal", async () => {
  fixtures.set("POST /api/cio/recurring-flows", () => Response.json({ error: "Review these values" }, { status: 422 }));
  const view = show();
  await newFlow(view);
  validForm(view);
  submit(view);
  await view.findByText("Review these values");
  fill(view, /^Name/, "Corrected");
  assert.equal(view.queryByRole("alert"), null);
  const pending = Promise.withResolvers();
  fixtures.set("POST /api/cio/recurring-flows", () => pending.promise);
  submit(view);
  await waitFor(() => assert.equal(writes().length, 2));
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Close", exact: true }).disabled, true));
  assert.equal(view.getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.deepEqual(events, []);
  await ui.act(async () => pending.resolve(Response.json({ flow: flow() })));
  await waitFor(() => assert.deepEqual(events, ["saved"]));
});

test("deleting a recurring flow requires confirmation and retains failures for review", async () => {
  fixtures.set("/api/cio/recurring-flows", { items: [flow()] });
  fixtures.set("DELETE /api/cio/recurring-flows/flow", () => Response.json({ error: "Delete failed" }, { status: 500 }));
  const view = show();
  fireEvent.click(await view.findByRole("button", { name: "Delete Monthly saving" }));
  let confirmation = view.getByRole("dialog", { name: "Delete recurring flow?" });
  assert.match(confirmation.textContent, /Monthly saving will no longer contribute/);
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  assert.deepEqual(writes(), []);
  fireEvent.click(view.getByRole("button", { name: "Delete Monthly saving" }));
  confirmation = view.getByRole("dialog", { name: "Delete recurring flow?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Delete", exact: true }));
  await view.findByText("Delete failed");
  fixtures.set("DELETE /api/cio/recurring-flows/flow", () => { fixtures.set("/api/cio/recurring-flows", { items: [] }); return Response.json({ deleted: { id: "flow" } }); });
  fireEvent.click(view.getByRole("button", { name: "Delete Monthly saving" }));
  confirmation = view.getByRole("dialog", { name: "Delete recurring flow?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Delete", exact: true }));
  await view.findByText("No recurring plans yet");
  assert.deepEqual(events, ["saved"]);
  assert.deepEqual(writes().map(({ method }) => method), ["DELETE", "DELETE"]);
});
