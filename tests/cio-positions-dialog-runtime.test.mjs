import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createCioDialogHarness } from "./cio-dialog-harness.mjs";

const harness = await createCioDialogHarness();
const { ui, require, fixtures, requests, events, fill, writes } = harness;
const { fireEvent, waitFor, within } = ui;
const { CioPositionsDialog } = require("../components/cio/dialogs/cio-positions-dialog.tsx");
const { setPrivacyMode, MASKED_AMOUNT } = require("../lib/privacy-mode.ts");
const position = (overrides = {}) => ({ id: "balance", side: "ASSET", category: "PROPERTY", label: "Family home", currentValueCents: 5000125,
  asOfDate: "2026-10-01T00:00:00.000Z", liquidityClass: "RESTRICTED", includeInInvestableAllocation: false,
  includeInRetirementProjection: false, notes: null, createdAt: "2026-10-01", updatedAt: "2026-10-01", ...overrides });
beforeEach(() => {
  fixtures.set("/api/cio/planning-positions", { items: [] });
  fixtures.set("POST /api/cio/planning-positions", ({ body }) => Response.json({ position: position(body) }));
});
const show = (props) => harness.show(CioPositionsDialog, props);
const element = (props) => harness.element(CioPositionsDialog, props);
const submit = (view) => fireEvent.submit(view.getByLabelText(/^Name/).closest("form"));
async function add(view) {
  await view.findByText("No extra planning balances yet");
  fireEvent.click(view.getByRole("button", { name: "Add asset or debt" }));
}
const moneyField = /^(Current value|Amount still owed)/;

test("planning balances wait for an open workspace and closing discards an unfinished form", async () => {
  const view = show({ open: false });
  assert.ok(!view.queryByRole("dialog"));
  assert.deepEqual(requests, []);
  view.rerender(element({ workspaceId: null }));
  await add(view);
  assert.deepEqual(requests, []);
  fill(view, /^Name/, "Unsaved balance");
  view.rerender(element({ open: false }));
  assert.ok(!view.queryByRole("dialog"));
  view.rerender(element());
  await add(view);
  assert.equal(view.getByLabelText(/^Name/).value, "");
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Close", exact: true }));
  assert.deepEqual(events, ["close"]);
});

test("planning rows explain net-worth, investment and retirement use and honor privacy masking", async () => {
  fixtures.set("/api/cio/planning-positions", { items: [position(),
    position({ id: "pension", label: "Pension", includeInInvestableAllocation: true, includeInRetirementProjection: true }),
    position({ id: "debt", label: "Mortgage", side: "LIABILITY" }),
  ] });
  const view = show();
  await view.findByText("Family home");
  assert.ok(view.getByText("CIO planning net worth only"));
  assert.ok(view.getByText("Investable allocation · Retirement projection"));
  assert.ok(view.getByText("Reduces CIO planning net worth"));
  const row = view.getByText("Family home").closest("article");
  assert.match(row.textContent, /checked 1 Oct 2026/);
  assert.match(row.textContent, /50,001\.25/);
  ui.act(() => setPrivacyMode(true));
  assert.ok(row.textContent.includes(MASKED_AMOUNT));
  assert.doesNotMatch(row.textContent, /50,001/);
});

test("new planning assets save normalized categories, integer cents, dates and inclusion choices", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00Z") });
  fixtures.set("POST /api/cio/planning-positions", ({ body }) => {
    fixtures.set("/api/cio/planning-positions", { items: [position(body)] });
    return Response.json({ position: position(body) });
  });
  const view = show();
  await add(view);
  assert.equal(view.getByLabelText(/^Balance checked on/).value, "2026-10-09");
  fill(view, /^Category/, "  __cpf special__  ");
  fill(view, /^Name/, "  CPF savings  ");
  fill(view, moneyField, "1234.56");
  fill(view, /^Balance checked on/, "2026-10-08");
  fill(view, /^Liquidity/, "LOCKED");
  fireEvent.click(view.getByRole("checkbox", { name: /Include in investable/ }));
  fireEvent.click(view.getByRole("checkbox", { name: /Include in retirement/ }));
  fill(view, /^Notes/, "  Statement balance  ");
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved"]));
  assert.ok(!view.queryByRole("heading", { name: "New planning balance" }));
  assert.deepEqual(writes()[0].body, { side: "ASSET", category: "CPF_SPECIAL", label: "CPF savings", currentValueCents: 123456,
    asOfDate: "2026-10-08T00:00:00.000Z", liquidityClass: "LOCKED", includeInInvestableAllocation: true, includeInRetirementProjection: true, notes: "Statement balance" });
  assert.ok(requests.filter(({ method }) => method === "GET").length >= 2);
});

test("planning validation rejects missing names, unusable categories, invalid values and missing valuation dates", async () => {
  const view = show();
  await add(view);
  for (const side of ["ASSET", "LIABILITY"]) {
    fill(view, /^Asset or liability/, side);
    fill(view, /^Name/, "");
    submit(view);
    assert.match(view.getByRole("alert").textContent, side === "ASSET" ? /Give this asset a short name/ : /Give this debt a short name/);
    fill(view, /^Name/, "Balance");
    fill(view, /^Category/, "!!!");
    submit(view);
    assert.match(view.getByRole("alert").textContent, side === "ASSET" ? /CPF, PROPERTY, or PENSION/ : /MORTGAGE, LOAN, or OTHER/);
    fill(view, /^Category/, "OTHER");
  }
  for (const amount of ["", "NaN", "-1", "1000000000000000000"]) {
    fill(view, moneyField, amount);
    submit(view);
    assert.match(view.getByRole("alert").textContent, /valid current value of 0 or more/);
  }
  fill(view, moneyField, "0");
  fill(view, /^Balance checked on/, "");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /date when you last checked/);
  assert.deepEqual(writes(), []);
  fill(view, /^Balance checked on/, "2026-10-01");
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved"]));
  assert.equal(writes()[0].body.currentValueCents, 0);
  assert.equal(writes()[0].body.notes, null);
});

test("changing an asset to a liability clears investment and retirement inclusion", async () => {
  const view = show();
  await add(view);
  fill(view, /^Name/, "Loan");
  fill(view, moneyField, "25");
  for (const name of [/Include in investable/, /Include in retirement/]) fireEvent.click(view.getByRole("checkbox", { name }));
  fill(view, /^Asset or liability/, "LIABILITY");
  assert.ok(!view.queryByRole("checkbox"));
  assert.ok(view.getByText(/Debts reduce CIO planning net worth/));
  fill(view, /^Asset or liability/, "ASSET");
  for (const name of [/Include in investable/, /Include in retirement/]) assert.equal(view.getByRole("checkbox", { name }).checked, false);
  fill(view, /^Asset or liability/, "LIABILITY");
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved"]));
  assert.equal(writes()[0].body.side, "LIABILITY");
  assert.equal(writes()[0].body.includeInInvestableAllocation, false);
  assert.equal(writes()[0].body.includeInRetirementProjection, false);
});

test("editing a planning balance preserves optional notes and uses an encoded update URL", async () => {
  const existing = position({ id: "home & savings", notes: "Original source" });
  fixtures.set("/api/cio/planning-positions", { items: [existing, position({ id: "other", label: "Other balance" })] });
  fixtures.set("PATCH /api/cio/planning-positions/home%20%26%20savings", { position: existing });
  const view = show();
  fireEvent.click(await view.findByRole("button", { name: "Edit Other balance" }));
  assert.equal(view.getByLabelText(/^Notes/).value, "");
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Edit Family home" }));
  assert.ok(view.getByRole("heading", { name: "Edit planning balance" }));
  assert.equal(view.getByLabelText(moneyField).value, "50001.25");
  assert.equal(view.getByLabelText(/^Notes/).value, "Original source");
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved"]));
  assert.equal(writes()[0].method, "PATCH");
  assert.equal(writes()[0].body.notes, "Original source");
});

test("failed planning queries and saves remain retryable and pending saves block dismissal", async () => {
  fixtures.set("/api/cio/planning-positions", () => Response.json({ error: "Unavailable" }, { status: 500 }));
  const view = show();
  await view.findByRole("heading", { name: "Planning assets and debts could not be loaded" });
  fixtures.set("/api/cio/planning-positions", { items: [] });
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await add(view);
  fill(view, /^Name/, "Balance");
  fill(view, moneyField, "1");
  fixtures.set("POST /api/cio/planning-positions", () => Response.json({ error: "Save failed" }, { status: 422 }));
  submit(view);
  await view.findByText("Save failed");
  fill(view, moneyField, "2");
  assert.ok(!view.queryByRole("alert"));
  const pending = Promise.withResolvers();
  fixtures.set("POST /api/cio/planning-positions", () => pending.promise);
  submit(view);
  await waitFor(() => assert.equal(writes().length, 2));
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Cancel", exact: true }).disabled, true));
  assert.equal(view.getByRole("button", { name: "Close", exact: true }).disabled, true);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.deepEqual(events, []);
  await ui.act(async () => pending.resolve(Response.json({ position: position() })));
  await waitFor(() => assert.deepEqual(events, ["saved"]));
});

test("planning deletion requires confirmation, reports failures and locks dismissal until success", async () => {
  fixtures.set("/api/cio/planning-positions", { items: [position()] });
  fixtures.set("DELETE /api/cio/planning-positions/balance", () => Response.json({ error: "Delete failed" }, { status: 500 }));
  const view = show();
  fireEvent.click(await view.findByRole("button", { name: "Delete Family home" }));
  let confirmation = within(view.getByRole("dialog", { name: "Delete planning position?" }));
  assert.ok(confirmation.getByText(/Dashboard net worth is not affected/));
  fireEvent.click(confirmation.getByRole("button", { name: "Cancel" }));
  assert.deepEqual(writes(), []);
  fireEvent.click(view.getByRole("button", { name: "Delete Family home" }));
  confirmation = within(view.getByRole("dialog", { name: "Delete planning position?" }));
  fireEvent.click(confirmation.getByRole("button", { name: "Delete", exact: true }));
  await view.findByText("Delete failed");
  const pending = Promise.withResolvers();
  fixtures.set("DELETE /api/cio/planning-positions/balance", () => pending.promise);
  fireEvent.click(view.getByRole("button", { name: "Delete Family home" }));
  confirmation = within(view.getByRole("dialog", { name: "Delete planning position?" }));
  fireEvent.click(confirmation.getByRole("button", { name: "Delete", exact: true }));
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Close", exact: true }).disabled, true));
  fireEvent.keyDown(document, { key: "Escape" });
  assert.deepEqual(events, []);
  fixtures.set("/api/cio/planning-positions", { items: [] });
  await ui.act(async () => pending.resolve(Response.json({ deleted: { id: "balance" } })));
  await view.findByText("No extra planning balances yet");
  assert.deepEqual(events, ["saved"]);
});
