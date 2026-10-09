import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createCioDialogHarness } from "./cio-dialog-harness.mjs";

const harness = await createCioDialogHarness();
const { ui, require, fixtures, requests, events, fill, writes } = harness;
const { fireEvent, waitFor, within } = ui;
const { CioPolicyDialog } = require("../components/cio/dialogs/cio-policy-dialog.tsx");
const { CIO_ASSET_CLASSES, CIO_GEOGRAPHIES } = require("../components/cio/types.ts");
const { queryKeys } = require("../lib/query-keys.ts");
const policy = (overrides = {}) => ({
  id: "policy", minimumLiquidityReserveCents: null, minimumLiquidityMonths: null,
  maximumAccountConcentrationBps: null, maximumSingleSecurityConcentrationBps: null, maximumSatelliteAllocationBps: null,
  valuationStaleAfterDays: 90, allowsOptions: null, allowsMargin: null, allowsLeverage: null, allowsAdditionalIlpTopUps: null,
  confirmedAt: null, assetClassBands: [], geographyLimits: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", ...overrides,
});
beforeEach(() => {
  fixtures.set("/api/cio/policy", { policy: null });
  fixtures.set("PATCH /api/cio/policy", ({ body }) => Response.json({ policy: policy(body) }));
});
const show = (props) => harness.show(CioPolicyDialog, props);
const element = (props) => harness.element(CioPolicyDialog, props);
const submit = (view) => fireEvent.submit(view.getByLabelText(/^Minimum cash reserve/).closest("form"));
const ready = (view) => view.findByLabelText(/^Minimum cash reserve/);
const bandRows = (view) => view.getAllByLabelText(/^Asset class/).map((input) => within(input.closest(".cio-policy-band-row")));
const geographyRows = (view) => view.getAllByLabelText(/^Geography/).map((input) => within(input.closest(".cio-policy-geography-row")));

test("policy queries wait for an open workspace, show loading, and populate an empty draft", async () => {
  const pending = Promise.withResolvers();
  fixtures.set("/api/cio/policy", () => pending.promise);
  const view = show({ open: false, workspaceId: null });
  assert.ok(!view.queryByRole("dialog"));
  assert.deepEqual(requests, []);
  view.rerender(element({ workspaceId: null }));
  assert.equal(view.getByLabelText(/^Consider valuations/).value, "90");
  assert.deepEqual(requests, []);
  view.rerender(element());
  assert.equal(view.getByText("Loading policy…").getAttribute("aria-busy"), "true");
  await ui.act(async () => pending.resolve(Response.json({ policy: null })));
  await ready(view);
  assert.equal(requests[0].headers.get("x-workspace-id"), "household");
  assert.equal(view.getByLabelText(/^Minimum cash reserve/).value, "");
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  assert.deepEqual(events, ["close"]);
});

test("an empty policy saves null optional rules, empty limits and an unconfirmed review", async () => {
  const view = show();
  await ready(view);
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
  const { id, createdAt, updatedAt, ...expected } = policy();
  assert.deepEqual(writes()[0].body, expected);
  assert.deepEqual(harness.client().getQueryData(queryKeys.cioPolicy("household")), policy());
});

test("policy inputs save cents, basis points, three-state product rules and review confirmation", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00Z") });
  const view = show();
  await ready(view);
  for (const [label, value] of [
    [/^Minimum cash reserve/, "30000.25"], [/^Months of essential/, "6"], [/^Maximum in one account/, "40.25"],
    [/^Maximum in one security/, "10.5"], [/^Maximum in satellite/, "20"], [/^Consider valuations/, "120"],
    [/^Options trading/, "true"], [/^Borrowing on margin/, "false"], [/^Leveraged investing/, "true"], [/^More ILP/, "false"],
  ]) fill(view, label, value);
  fireEvent.click(view.getByRole("button", { name: "Add asset class" }));
  fireEvent.click(view.getByRole("button", { name: "Add asset class" }));
  const [first, second] = bandRows(view);
  const assetClassControl = first.getByLabelText(/^Asset class/);
  assetClassControl.focus();
  fill(first, /^Asset class/, "EQUITY");
  assert.ok(document.activeElement === assetClassControl, "changing an asset class preserves keyboard focus");
  fill(first, /^Minimum %/, "20");
  fill(first, /^Target %/, "30.25");
  fill(first, /^Maximum %/, "40.5");
  fill(second, /^Minimum %/, "10");
  fill(second, /^Target %/, "50");
  fill(second, /^Maximum %/, "70");
  fireEvent.click(view.getByRole("button", { name: "Add region" }));
  fireEvent.click(view.getByRole("button", { name: "Add region" }));
  fill(geographyRows(view)[0], /^Geography/, "GLOBAL");
  fill(geographyRows(view)[0], /^Maximum %/, "75.5");
  fill(geographyRows(view)[1], /^Maximum %/, "25");
  fireEvent.click(view.getByRole("checkbox", { name: /Mark this policy as reviewed/ }));
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
  assert.deepEqual(writes()[0].body, {
    minimumLiquidityReserveCents: 3000025, minimumLiquidityMonths: 6,
    maximumAccountConcentrationBps: 4025, maximumSingleSecurityConcentrationBps: 1050, maximumSatelliteAllocationBps: 2000,
    valuationStaleAfterDays: 120, allowsOptions: true, allowsMargin: false, allowsLeverage: true, allowsAdditionalIlpTopUps: false,
    confirmedAt: "2026-10-09T12:00:00.000Z",
    assetClassBands: [{ assetClass: "EQUITY", minimumBps: 2000, targetBps: 3025, maximumBps: 4050 }, { assetClass: "FIXED_INCOME", minimumBps: 1000, targetBps: 5000, maximumBps: 7000 }],
    geographyLimits: [{ geography: "GLOBAL", maximumBps: 7550 }, { geography: "UNITED_STATES", maximumBps: 2500 }],
  });
});

test("a saved policy round-trips its stored limits and review timestamp and allows rules to be unset", async () => {
  const existing = policy({ minimumLiquidityReserveCents: 250050, minimumLiquidityMonths: 12, maximumAccountConcentrationBps: 5025,
    allowsOptions: true, allowsMargin: false, confirmedAt: "2026-01-01T00:00:00.000Z",
    assetClassBands: [{ assetClass: "EQUITY", minimumBps: 2000, targetBps: 3000, maximumBps: 5000 }],
    geographyLimits: [{ geography: "SINGAPORE", maximumBps: 4000 }],
  });
  fixtures.set("/api/cio/policy", { policy: existing });
  const view = show();
  await ready(view);
  assert.equal(view.getByLabelText(/^Minimum cash reserve/).value, "2500.5");
  assert.equal(view.getByLabelText(/^Months of essential/).value, "12");
  assert.equal(view.getByLabelText(/^Maximum in one account/).value, "50.25");
  assert.equal(view.getByLabelText(/^Options trading/).value, "true");
  assert.equal(view.getByLabelText(/^Borrowing on margin/).value, "false");
  assert.equal(view.getByLabelText(/^Leveraged investing/).value, "");
  assert.equal(bandRows(view)[0].getByLabelText(/^Target %/).value, "30");
  assert.equal(geographyRows(view)[0].getByLabelText(/^Maximum %/).value, "40");
  fill(view, /^Options trading/, "");
  fill(view, /^Months of essential/, "");
  submit(view);
  await waitFor(() => assert.equal(writes().length, 1));
  assert.equal(writes()[0].body.confirmedAt, existing.confirmedAt);
  assert.equal(writes()[0].body.allowsOptions, null);
  assert.equal(writes()[0].body.minimumLiquidityMonths, null);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
});

test("policy amounts, percentages and whole-number periods enforce their inclusive bounds", async () => {
  const view = show();
  await ready(view);
  for (const [label, value, message] of [
    [/^Minimum cash reserve/, "$30", /must be a number/], [/^Minimum cash reserve/, "-1", /cannot be negative/], [/^Minimum cash reserve/, "21474836.48", /21,474,836.47 or less/],
    [/^Months of essential/, "1.5", /whole number/], [/^Months of essential/, "-1", /between 0 and 120/], [/^Months of essential/, "121", /between 0 and 120/],
    [/^Maximum in one account/, "not a number", /must be a number/], [/^Maximum in one account/, "-1", /between 0% and 100%/], [/^Maximum in one account/, "101", /between 0% and 100%/],
    [/^Maximum in one security/, "101", /Maximum in one security/], [/^Maximum in satellite/, "101", /Maximum in satellite holdings/],
    [/^Consider valuations/, "", /Enter out-of-date valuation period/], [/^Consider valuations/, "1.5", /whole number/], [/^Consider valuations/, "0", /between 1 and 3,650/], [/^Consider valuations/, "3651", /between 1 and 3,650/],
  ]) {
    fill(view, label, value);
    submit(view);
    assert.match(view.getByRole("alert").textContent, message);
    assert.deepEqual(writes(), []);
    fill(view, label, label.source.startsWith("^Consider") ? "90" : "");
    assert.ok(!view.queryByRole("alert"));
  }
  fill(view, /^Minimum cash reserve/, "21474836.47");
  fill(view, /^Months of essential/, "120");
  fill(view, /^Consider valuations/, "3650");
  fill(view, /^Maximum in one account/, "100");
  fill(view, /^Maximum in one security/, "0");
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
  assert.equal(writes()[0].body.minimumLiquidityReserveCents, 2147483647);
  assert.equal(writes()[0].body.maximumSingleSecurityConcentrationBps, 0);
});

test("policy ranges and regions reject duplicates, missing percentages and inverted allocation bands", async () => {
  const view = show();
  await ready(view);
  fireEvent.click(view.getByRole("button", { name: "Add asset class" }));
  fireEvent.click(view.getByRole("button", { name: "Add asset class" }));
  fill(bandRows(view)[1], /^Asset class/, "CASH");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /Cash has been added more than once/);
  fill(bandRows(view)[1], /^Asset class/, "FIXED_INCOME");
  fireEvent.click(view.getByRole("button", { name: "Add region" }));
  fireEvent.click(view.getByRole("button", { name: "Add region" }));
  fill(geographyRows(view)[1], /^Geography/, "SINGAPORE");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /Singapore has been added more than once/);
  fill(geographyRows(view)[1], /^Geography/, "UNITED_STATES");
  const first = () => bandRows(view)[0];
  fill(first(), /^Minimum %/, "20");
  fill(first(), /^Target %/, "30");
  fill(first(), /^Maximum %/, "40");
  for (const [field, value, reset, message] of [
    [/^Minimum %/, "", "20", /Enter a percentage for cash minimum/],
    [/^Target %/, "", "30", /Enter a percentage for cash target/],
    [/^Maximum %/, "", "40", /Enter a percentage for cash maximum/],
    [/^Minimum %/, "money", "20", /Cash minimum must be a number/],
    [/^Minimum %/, "-1", "20", /between 0% and 100%/],
    [/^Target %/, "101", "30", /between 0% and 100%/],
    [/^Minimum %/, "31", "20", /minimum, then target, then maximum/],
    [/^Target %/, "41", "30", /minimum, then target, then maximum/],
  ]) {
    fill(first(), field, value);
    submit(view);
    assert.match(view.getByRole("alert").textContent, message);
    fill(first(), field, reset);
  }
  fill(geographyRows(view)[1], /^Maximum %/, "");
  submit(view);
  assert.match(view.getByRole("alert").textContent, /Enter a percentage for united states maximum/);
  assert.deepEqual(writes(), []);
});

test("policy row limits disable further additions and removing a row preserves the remaining rules", async () => {
  const view = show();
  await ready(view);
  for (const assetClass of CIO_ASSET_CLASSES) {
    fireEvent.click(view.getByRole("button", { name: "Add asset class" }));
    assert.ok(view.getByRole("button", { name: `Remove ${assetClass.toLowerCase().split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")} band` }));
  }
  assert.equal(view.getByRole("button", { name: "Add asset class" }).disabled, true);
  const retainedTarget = bandRows(view)[1].getByLabelText(/^Target %/);
  fireEvent.click(view.getByRole("button", { name: "Remove Cash band" }));
  assert.ok(retainedTarget.isConnected, "removing another range keeps the remaining inputs mounted");
  assert.equal(bandRows(view).length, CIO_ASSET_CLASSES.length - 1);
  assert.equal(bandRows(view)[0].getByLabelText(/^Asset class/).value, "FIXED_INCOME");
  assert.equal(view.getByRole("button", { name: "Add asset class" }).disabled, false);
  for (const _ of CIO_GEOGRAPHIES) fireEvent.click(view.getByRole("button", { name: "Add region" }));
  assert.equal(view.getByRole("button", { name: "Add region" }).disabled, true);
  fireEvent.click(view.getByRole("button", { name: "Remove Singapore limit" }));
  assert.equal(geographyRows(view)[0].getByLabelText(/^Geography/).value, "UNITED_STATES");
  assert.equal(view.getByRole("button", { name: "Add region" }).disabled, false);
  for (const button of view.getAllByRole("button", { name: /^Remove .* band$/ })) fireEvent.click(button);
  for (const button of view.getAllByRole("button", { name: /^Remove .* limit$/ })) fireEvent.click(button);
  assert.ok(view.getByText(/No target ranges yet/));
  assert.ok(view.getByText(/No geography limits yet/));
});

test("policy fetch and save failures can be retried and pending writes block dismissal", async () => {
  fixtures.set("/api/cio/policy", () => Response.json({ error: "Unavailable" }, { status: 500 }));
  const view = show();
  await view.findByRole("heading", { name: "Policy could not be loaded" });
  fixtures.set("/api/cio/policy", { policy: policy() });
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await ready(view);
  fixtures.set("PATCH /api/cio/policy", () => Response.json({ error: "Review failed" }, { status: 422 }));
  submit(view);
  await view.findByText("Review failed");
  fill(view, /^Months of essential/, "6");
  assert.ok(!view.queryByRole("alert"));
  const pending = Promise.withResolvers();
  fixtures.set("PATCH /api/cio/policy", () => pending.promise);
  submit(view);
  await waitFor(() => assert.equal(writes().length, 2));
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Cancel", exact: true }).disabled, true));
  assert.equal(view.getByRole("button", { name: "Save policy" }).disabled, true);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.deepEqual(events, []);
  await ui.act(async () => pending.resolve(Response.json({ policy: policy({ minimumLiquidityMonths: 6 }) })));
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
});

test("a malformed stored policy cannot add more rows beyond the supported limits", async () => {
  fixtures.set("/api/cio/policy", { policy: policy({
    assetClassBands: Array.from({ length: CIO_ASSET_CLASSES.length + 1 }, (_, index) => ({ id: `band-${index}`, assetClass: "CASH", minimumBps: 0, targetBps: 0, maximumBps: 10000 })),
    geographyLimits: Array.from({ length: CIO_GEOGRAPHIES.length + 1 }, (_, index) => ({ id: `region-${index}`, geography: "GLOBAL", maximumBps: 10000 })),
  }) });
  const view = show();
  await ready(view);
  assert.equal(view.getByRole("button", { name: "Add asset class" }).disabled, true);
  assert.equal(view.getByRole("button", { name: "Add region" }).disabled, true);
  submit(view);
  assert.match(view.getByRole("alert").textContent, /added more than once/);
  assert.deepEqual(writes(), []);
});
