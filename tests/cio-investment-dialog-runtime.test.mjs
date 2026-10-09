import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createCioDialogHarness } from "./cio-dialog-harness.mjs";

const harness = await createCioDialogHarness();
const { ui, require, fixtures, requests, events, fill, writes } = harness;
const { fireEvent, waitFor, within } = ui;
const { CioInvestmentProfileDialog } = require("../components/cio/dialogs/cio-investment-profile-dialog.tsx");
const { CIO_ASSET_CLASSES, CIO_GEOGRAPHIES } = require("../components/cio/types.ts");
const { queryKeys } = require("../lib/query-keys.ts");
const snapshot = (id = "fund-a", overrides = {}) => ({ id, classificationStatus: "UNCLASSIFIED", liquidityClass: "LIQUID", portfolioRole: "OTHER", includeInRetirementProjection: false, ...overrides });
const defaultSnapshots = [snapshot()];
const profile = (overrides = {}) => ({ id: "classification", investmentAccountId: "fund-a", liquidityClass: "LIQUID", portfolioRole: "CORE", riskLevel: "MODERATE",
  includeInRetirementProjection: true, lockUntil: null, classificationStatus: "USER_CONFIRMED", classificationSource: "USER", notes: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...overrides });
function account(id, stored = null, exposures = []) {
  const path = `/api/cio/investments/${encodeURIComponent(id)}`;
  fixtures.set(`${path}/profile`, { profile: stored });
  fixtures.set(`${path}/exposures`, { exposures });
  fixtures.set(`PUT ${path}/profile`, ({ body }) => Response.json({ profile: profile({ ...body, investmentAccountId: id }) }));
  fixtures.set(`PUT ${path}/exposures`, ({ body }) => Response.json(body));
}
beforeEach(() => {
  fixtures.set("/api/investments", [
    { id: "fund-a", displayName: "Global fund", institutionName: "Broker", productName: "ETF" },
    { id: "fund-b", displayName: "", institutionName: "Other broker", productName: "Bond fund" },
  ]);
  account("fund-a");
  account("fund-b");
});
const show = (props = {}) => harness.show(CioInvestmentProfileDialog, { investments: defaultSnapshots, ...props });
const element = (props = {}) => harness.element(CioInvestmentProfileDialog, { investments: defaultSnapshots, ...props });
const ready = (view) => view.findByLabelText(/^How quickly can you use/);
const submit = (view) => fireEvent.submit(view.getByLabelText(/^How quickly can you use/).closest("form"));
const rows = (view) => view.getAllByLabelText(/^Break down by/).map((input) => within(input.closest(".cio-exposure-row")));

test("investment classification waits for an open workspace and selects accounts that arrive after an empty list", async () => {
  const view = show({ open: false, investments: [], workspaceId: null });
  assert.deepEqual(requests, []);
  assert.ok(!view.queryByRole("dialog"));
  view.rerender(element({ investments: [], workspaceId: null }));
  assert.ok(view.getByText("No investment accounts"));
  assert.equal(view.getByRole("button", { name: "Save classification" }).disabled, true);
  const id = "fund / new";
  account(id);
  view.rerender(element({ investments: [snapshot(id)] }));
  await ready(view);
  assert.equal(view.getByLabelText(/^Investment account/).value, id);
  assert.ok(view.getByRole("option", { name: "Investment fund / n · Needs review" }));
  assert.ok(requests.some(({ url }) => url.pathname === "/api/cio/investments/fund%20%2F%20new/profile"));
  assert.equal(view.getByLabelText(/^What job/).value, "OTHER");
  assert.equal(view.getByLabelText(/^How much can/).value, "UNKNOWN");
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  assert.deepEqual(events, ["close"]);
});

test("the first unreviewed investment is selected and switching accounts loads their own stored descriptions", async () => {
  account("fund-b", profile({ investmentAccountId: "fund-b", classificationStatus: "SUGGESTED", liquidityClass: "LOCKED", lockUntil: "2030-01-01", notes: "Original note" }), [{ id: "stored-row", dimension: "GEOGRAPHY", key: "GLOBAL", weightBps: 10000 }]);
  const investments = [snapshot("fund-a", { classificationStatus: "USER_CONFIRMED" }), snapshot("fund-b")];
  const view = show({ investments });
  await ready(view);
  assert.equal(view.getByLabelText(/^Investment account/).value, "fund-b");
  assert.ok(view.getByRole("option", { name: "Other broker · Bond fund · Needs review" }));
  assert.equal(view.getByLabelText(/^Locked until/).value, "2030-01-01");
  assert.equal(view.getByLabelText(/^Notes/).value, "Original note");
  assert.ok(view.getByText(/Nest has a suggested description/));
  assert.equal(view.getByRole("checkbox", { name: /I have reviewed/ }).checked, false);
  fill(view, /^Investment account/, "fund-a");
  await ready(view);
  assert.equal(view.getByLabelText(/^Notes/).value, "");
  assert.equal(view.getByRole("checkbox", { name: /I have reviewed/ }).checked, true);
  assert.ok(view.getByText(/This account was confirmed before/));
  assert.ok(view.getByText(/Breakdown unknown/));
  assert.ok(!view.queryByLabelText(/^Locked until/));
});

test("an investment classification saves reviewed choices and separately balanced breakdowns without losing row focus", async () => {
  const view = show();
  await ready(view);
  fill(view, /^How quickly/, "LOCKED");
  fill(view, /^Locked until/, "2030-01-01");
  fill(view, /^What job/, "CORE");
  fill(view, /^How much can/, "MODERATE");
  fireEvent.click(view.getByRole("checkbox", { name: /Count this toward retirement/ }));
  fill(view, /^Notes/, "  Future retirement holding  ");
  const add = view.getByRole("button", { name: "Add breakdown row" });
  fireEvent.click(add);
  fill(rows(view)[0], /^What does it own/, "EQUITY");
  fill(rows(view)[0], /^Share of account/, "60");
  fireEvent.click(add);
  fill(rows(view)[1], /^Share of account/, "40");
  fireEvent.click(add);
  const dimension = rows(view)[2].getByLabelText(/^Break down by/);
  dimension.focus();
  fill(rows(view)[2], /^Break down by/, "GEOGRAPHY");
  assert.ok(document.activeElement === dimension, "changing breakdown type preserves keyboard focus");
  fill(rows(view)[2], /^Where is it exposed/, "GLOBAL");
  fireEvent.click(add);
  fill(rows(view)[3], /^Break down by/, "SECURITY");
  fill(rows(view)[3], /^Ticker or security/, " vwra.l ");
  assert.ok(view.getByText("Asset Class: 100% (complete)"));
  assert.ok(view.getByText("Geography: 100% (complete)"));
  assert.ok(view.getByText("Security: 100% (complete)"));
  fireEvent.click(view.getByRole("checkbox", { name: /I have reviewed/ }));
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
  assert.deepEqual(writes()[0].body, { liquidityClass: "LOCKED", portfolioRole: "CORE", riskLevel: "MODERATE", includeInRetirementProjection: true,
    lockUntil: "2030-01-01T00:00:00.000Z", classificationStatus: "USER_CONFIRMED", classificationSource: "USER", notes: "Future retirement holding" });
  assert.deepEqual(writes()[1].body, { exposures: [
    { dimension: "ASSET_CLASS", key: "EQUITY", weightBps: 6000 }, { dimension: "ASSET_CLASS", key: "CASH", weightBps: 4000 },
    { dimension: "GEOGRAPHY", key: "GLOBAL", weightBps: 10000 }, { dimension: "SECURITY", key: "VWRA.L", weightBps: 10000 },
  ] });
  assert.ok(writes().every(({ headers }) => headers.get("x-workspace-id") === "household"));
  assert.deepEqual(harness.client().getQueryData(queryKeys.cioInvestmentExposures("household", "fund-a")), writes()[1].body.exposures);
});

test("an unknown breakdown can be confirmed and locked investments can leave their unlock date unset", async () => {
  account("fund-a", profile({ liquidityClass: "LOCKED", classificationStatus: "SUGGESTED", lockUntil: null }));
  const view = show({ investments: [snapshot("fund-a", { classificationStatus: "USER_CONFIRMED" })] });
  await ready(view);
  assert.equal(view.getByLabelText(/^Locked until/).value, "");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /Confirm that you have reviewed/);
  assert.deepEqual(writes(), []);
  fireEvent.click(view.getByRole("checkbox", { name: /I have reviewed/ }));
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
  assert.equal(writes()[0].body.lockUntil, null);
  assert.equal(writes()[0].body.notes, null);
  assert.deepEqual(writes()[1].body, { exposures: [] });
});

test("breakdown rows prefer unused categories, display incomplete totals and preserve neighboring controls when removed", async () => {
  const view = show();
  await ready(view);
  const add = view.getByRole("button", { name: "Add breakdown row" });
  for (let count = 0; count < CIO_ASSET_CLASSES.length + CIO_GEOGRAPHIES.length + 1; count += 1) fireEvent.click(add);
  assert.equal(rows(view).at(-1).getByLabelText(/^Break down by/).value, "SECURITY");
  assert.ok(view.getByText("Asset Class: 800% (must total 100%)"));
  assert.ok(view.getByText("Geography: 700% (must total 100%)"));
  const last = () => rows(view).at(-1);
  fill(last(), /^Break down by/, "GEOGRAPHY");
  assert.equal(last().getByLabelText(/^Where is it exposed/).value, "SINGAPORE");
  fill(last(), /^Break down by/, "ASSET_CLASS");
  assert.equal(last().getByLabelText(/^What does it own/).value, "CASH");
  fill(last(), /^Break down by/, "SECURITY");
  assert.equal(last().getByLabelText(/^Ticker or security/).value, "");
  const retained = rows(view)[1].getByLabelText(/^Share of account/);
  fireEvent.click(rows(view)[0].getByRole("button", { name: "Remove Asset Class exposure" }));
  assert.ok(retained.isConnected);
  for (const remove of view.getAllByRole("button", { name: /^Remove .* exposure$/ })) fireEvent.click(remove);
  assert.ok(view.getByText(/Breakdown unknown/));
});

test("classification disables adding rows at the API limit and saves all 100 valid securities", async () => {
  const exposures = Array.from({ length: 100 }, (_, i) => ({ dimension: "SECURITY", key: `F${i}`, weightBps: 100 }));
  account("fund-a", profile(), exposures);
  const view = show();
  await ready(view);
  assert.equal(view.getByRole("button", { name: "Add breakdown row" }).disabled, true);
  assert.equal(rows(view).length, 100);
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
  assert.deepEqual(writes()[1].body, { exposures });
});

test("classification query and partial-save failures can be retried while a pending save locks the selected account", async () => {
  fixtures.set("/api/cio/investments/fund-a/profile", () => Response.json({ error: "Profile unavailable" }, { status: 500 }));
  const view = show({ investments: [snapshot(), snapshot("fund-b")] });
  await view.findByText("Profile unavailable");
  fixtures.set("/api/cio/investments/fund-a/profile", { profile: null });
  fixtures.set("/api/cio/investments/fund-a/exposures", () => Response.json({ error: "Breakdown unavailable" }, { status: 500 }));
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await view.findByText("Breakdown unavailable");
  fixtures.set("/api/cio/investments/fund-a/exposures", { exposures: [] });
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await ready(view);
  fireEvent.click(view.getByRole("checkbox", { name: /I have reviewed/ }));
  fixtures.set("PUT /api/cio/investments/fund-a/profile", () => Response.json({ error: "Profile save failed" }, { status: 422 }));
  submit(view);
  await view.findByText("Profile save failed");
  assert.equal(writes().length, 1);
  fill(view, /^Notes/, "Keep this draft");
  assert.ok(!view.queryByRole("alert"));
  fixtures.set("PUT /api/cio/investments/fund-a/profile", ({ body }) => Response.json({ profile: profile(body) }));
  fixtures.set("PUT /api/cio/investments/fund-a/exposures", () => Response.json({ error: "Breakdown save failed" }, { status: 422 }));
  submit(view);
  await view.findByText("Breakdown save failed");
  assert.equal(view.getByLabelText(/^Notes/).value, "Keep this draft");
  assert.deepEqual(events, []);
  const pending = Promise.withResolvers();
  fixtures.set("PUT /api/cio/investments/fund-a/exposures", () => pending.promise);
  submit(view);
  await waitFor(() => assert.equal(writes().length, 5));
  assert.equal(view.getByLabelText(/^Investment account/).disabled, true);
  assert.equal(view.getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.deepEqual(events, []);
  await ui.act(async () => pending.resolve(Response.json({ exposures: [] })));
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
  assert.equal(harness.client().getQueryData(queryKeys.cioInvestmentProfile("household", "fund-a")).notes, "Keep this draft");
  assert.equal(harness.client().getQueryData(queryKeys.cioInvestmentProfile("household", "fund-b")), undefined);
});
