import assert from "node:assert/strict";
import test from "node:test";
import { createCioUiHarness, overviewFixture } from "./cio-ui-harness.mjs";

const harness = await createCioUiHarness();
const { ui, require, navigation, show, element } = harness;
const { h, fireEvent, within, waitFor } = ui;
const { CioOverview } = require("../components/cio/cio-overview.tsx");
const { CioLiquidityCard } = require("../components/cio/cio-liquidity-card.tsx");
const { CioPolicyExceptions } = require("../components/cio/cio-policy-exceptions.tsx");
const { renderToString } = require("react-dom/server");
const { hydrateRoot } = require("react-dom/client");

test("liquidity totals and annual flows stay distinct and the setup action opens recurring flows", () => {
  const configured = [];
  const overview = overviewFixture();
  const props = { overview, onConfigure: (section) => configured.push(section) };
  const view = ui.render(h(CioLiquidityCard, props));
  assert.ok(view.getByText("3.0 months of essential spending is readily available."));
  for (const [label, percentage, amount] of [["Immediate", 10, "100.00"], ["Liquid", 20, "200.00"], ["Restricted", 30, "300.00"], ["Locked", 40, "400.00"]]) {
    const row = view.getByText(label).closest("dt").parentElement;
    assert.ok(within(row).getByText(`${percentage}%`));
    assert.match(row.textContent, new RegExp(amount.replace(".", "\\.")));
  }
  assert.match(view.getByText("External contributions").parentElement.textContent, /120\.00\/yr/);
  assert.match(view.getByText("External withdrawals").parentElement.textContent, /30\.00\/yr/);
  assert.match(view.getByText("Internal reallocations").parentElement.textContent, /50\.00\/yr/);
  assert.match(view.getByText(/Net external/).textContent, /90\.00\/year/);
  fireEvent.click(view.getByRole("button", { name: "Manage flows" }));
  assert.deepEqual(configured, ["flows"]);
  for (const [spending, runway, expected] of [
    [null, null, "Set essential monthly spending to calculate emergency runway."],
    [0, null, "Essential monthly spending is set to zero; emergency runway does not apply."],
    [100, null, "Emergency runway is not available."],
  ]) {
    view.rerender(h(CioLiquidityCard, { ...props, overview: { ...overview, liquidity: { immediateCents: 0, liquidCents: 0, restrictedCents: 0, lockedCents: 0, essentialMonthlyExpenseCents: spending, emergencyRunwayMonths: runway } } }));
    assert.ok(view.getByText(expected));
    assert.equal(view.getAllByText("0%").length, 4);
    assert.doesNotMatch(view.container.textContent, /NaN|Infinity/);
  }
});

test("policy exceptions sort by severity without mutating recorded data and explain every metric unit", () => {
  const configured = [];
  const overview = overviewFixture();
  const props = { overview, onConfigure: (section) => configured.push(section) };
  const view = ui.render(h(CioPolicyExceptions, props));
  assert.ok(view.getByText("No policy exceptions"));
  fireEvent.click(view.getByRole("button", { name: "Configure" }));
  assert.deepEqual(configured, ["policy"]);
  const values = [
    ["DAYS", 31, "31 days"], ["CENTS", 12300, "123.00"], ["BPS", 1250, "12.5%"],
    ["MONTHS", 2.5, "2.5 months"], ["COUNT", 3, "3"], ["CENTS", null, "not available"],
  ];
  const exceptions = values.map(([unit, value], index) => ({ code: `EXCEPTION_${index}`, title: `Exception ${index}`, severity: index === 1 ? "CRITICAL" : index === 2 ? "WARNING" : "INFO", reviewAction: `Review action ${index}`, actual: { unit, value }, threshold: index === 0 ? { unit: "DAYS", value: 30 } : null }));
  const original = structuredClone(exceptions);
  view.rerender(h(CioPolicyExceptions, { ...props, overview: { ...overview, policyExceptions: exceptions } }));
  assert.match(view.getAllByRole("listitem")[0].textContent, /Exception 1Critical/);
  assert.match(view.getAllByRole("listitem")[1].textContent, /Exception 2Warning/);
  for (const [index, [, , expected]] of values.entries()) {
    const row = view.getByText(`Exception ${index}`).closest("li");
    assert.ok(row.textContent.includes(expected));
    assert.ok(within(row).getByText(`Review action ${index}`));
    assert.equal(row.textContent.includes("Threshold:"), index === 0);
  }
  assert.match(view.getByText("Exception 0").closest("li").textContent, /Threshold: 30 days/);
  assert.deepEqual(exceptions, original);
});

test("overview actions connect to their setup sections and scoped bank and sub-account destinations", async () => {
  const configured = [];
  const warnings = ["BANK_BALANCE_AFTER_DATA_DATE", "SAVINGS_BALANCE_AFTER_DATA_DATE", "MISSING_PROFILE"].map((code) => ({ code, severity: "WARNING", message: code }));
  const base = overviewFixture();
  const overview = { ...base, dataQuality: { ...base.dataQuality, warnings }, allocation: { totalCents: 10000, assetClasses: [{ key: "EQUITY", valueCents: 10000, allocationBps: 10000, isUnknown: false }], geographies: [] } };
  const policy = { confirmedAt: "2026-10-01", assetClassBands: [{ assetClass: "EQUITY", targetBps: 10000, minimumBps: 9000, maximumBps: 10000 }] };
  const props = { overview, policy, canEdit: true, onConfigure: (section) => configured.push(section) };
  const view = show(CioOverview, props);
  await view.findByText("No strategy report yet");
  assert.ok(view.getByRole("heading", { level: 1, name: "Your personal Chief Investment Officer (CIO)" }));
  assert.ok(view.getByText("Within 90%–100% band"));
  fireEvent.click(view.getByTitle("Configure CIO inputs"));
  fireEvent.click(view.getByRole("button", { name: "Edit policy" }));
  fireEvent.click(view.getByRole("button", { name: "Manage flows" }));
  fireEvent.click(view.getByRole("button", { name: "Complete profile" }));
  fireEvent.click(within(view.getByRole("region", { name: "Exceptions" })).getByRole("button", { name: "Configure" }));
  fireEvent.click(view.getByRole("button", { name: "Review", exact: true }));
  assert.deepEqual(configured, [undefined, "policy", "flows", "profile", "policy", "profile"]);
  fireEvent.click(view.getByRole("button", { name: "Open bank controls" }));
  fireEvent.click(view.getByRole("button", { name: "Open sub-accounts" }));
  assert.deepEqual(navigation, ["/w/household/settings?tab=workspaces#bank-accounts", "/w/household/transactions"]);
  const launcher = document.createElement("button");
  launcher.setAttribute("aria-controls", "ask-nest-panel");
  let opened = 0;
  launcher.onclick = () => { opened += 1; };
  document.body.appendChild(launcher);
  fireEvent.click(view.getByRole("button", { name: "Ask CIO" }));
  assert.equal(opened, 1);
  launcher.remove();
  fireEvent.click(view.getByRole("button", { name: "Ask CIO" }));
  assert.equal(opened, 1);
  ui.window.history.replaceState(null, "", "/cio");
  ui.window.innerWidth = 600;
  view.rerender(element(CioOverview, { ...props, policy: { ...policy, confirmedAt: null }, canEdit: false }));
  assert.ok(view.getByRole("heading", { level: 1, name: "Your personal CIO" }));
  assert.ok(view.getByText("You have view-only access. An owner or editor can update CIO assumptions."));
  assert.ok(!view.queryByText("Within 90%–100% band"));
  assert.equal(view.getAllByTitle("Editor access is required")[0].disabled, true);
  fireEvent.click(view.getByRole("button", { name: "Open bank controls" }));
  fireEvent.click(view.getByRole("button", { name: "Open sub-accounts" }));
  assert.deepEqual(navigation.slice(-2), ["/settings?tab=workspaces#bank-accounts", "/transactions"]);
});

test("the overview renders on the server without relying on a browser window", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    delete globalThis.window;
    const markup = renderToString(element(CioOverview, { overview: overviewFixture(), canEdit: false, onConfigure: () => {} }));
    assert.match(markup, /Your personal CIO/);
    assert.match(markup, /view-only access/);
  } finally {
    Object.defineProperty(globalThis, "window", descriptor);
  }
});

test("the CIO title hydrates without replacing server markup and follows viewport changes", async (t) => {
  const listeners = new Set();
  let wide = true;
  t.mock.method(ui.window, "matchMedia", () => ({
    get matches() { return wide; },
    addEventListener: (type, listener) => { assert.equal(type, "change"); listeners.add(listener); },
    removeEventListener: (type, listener) => { assert.equal(type, "change"); listeners.delete(listener); },
  }));
  const content = element(CioOverview, { overview: overviewFixture(), canEdit: false, onConfigure: () => {} });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let markup;
  try {
    delete globalThis.window;
    markup = renderToString(content);
  } finally {
    Object.defineProperty(globalThis, "window", descriptor);
  }
  const container = document.createElement("div");
  container.innerHTML = markup;
  document.body.appendChild(container);
  const failures = [];
  let root;
  try {
    await ui.act(async () => { root = hydrateRoot(container, content, { onRecoverableError: (error) => failures.push(error.message) }); });
    await waitFor(() => assert.equal(container.querySelector("h1").textContent, "Your personal Chief Investment Officer (CIO)"));
    assert.deepEqual(failures, [], "Server and initial client markup must agree");
    await ui.act(async () => { wide = false; for (const listener of listeners) listener(); });
    assert.equal(container.querySelector("h1").textContent, "Your personal CIO");
  } finally {
    await ui.act(async () => root?.unmount());
    container.remove();
  }
  assert.equal(listeners.size, 0, "Unmount removes viewport subscriptions");
});
