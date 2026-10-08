import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, within, waitFor } = ui;
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { CioHealthSummary } = require("../components/cio/cio-health-summary.tsx");
const { CioContributionProgressCard } = require("../components/cio/cio-contribution-progress.tsx");
const { CioAllocationCard } = require("../components/cio/cio-allocation-card.tsx");
const { CioRetirementCard } = require("../components/cio/cio-retirement-card.tsx");
const { RetirementProjectionChart } = require("../components/cio/charts/retirement-projection-chart.tsx");
const format = require("../components/cio/cio-format.ts");
const { setPrivacyMode, MASKED_AMOUNT } = require("../lib/privacy-mode.ts");
let client;
let reply;
const requests = [];
beforeEach((t) => {
  requests.length = 0;
  ui.window.history.replaceState(null, "", "/w/home/cio");
  setPrivacyMode(false);
  reply = async () => { throw new Error("Unexpected request"); };
  t.mock.method(globalThis, "fetch", async (url, init) => { requests.push({ url, ...init }); return reply(); });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { ui.cleanup(); client.clear(); await ui.window.happyDOM.abort(); });
after(() => ui.dispose());

function snapshot(overrides = {}) {
  return {
    asOfDate: "2026-10-08", baseCurrency: "SGD",
    totals: { financialAssetsCents: 90_000, savingsSubAccountCents: 20_000, investableAssetsCents: 70_000, retirementIncludedAssetsCents: 50_000, planningLiabilitiesCents: 1_000 },
    dataQuality: { warnings: [], completenessPercentage: 75, latestValuationDate: "2026-10-07", oldestValuationDate: "2026-09-01" },
    annualContributions: { usedExternalAnnualCents: 12_000 },
    retirement: { status: "NOT_READY", missingFields: [], projection: null },
    allocation: { totalCents: 0, assetClasses: [], geographies: [] },
    contributionProgress: null,
    ...overrides,
  };
}
function scenario(name, overrides = {}) {
  return {
    scenario: name, nominalReturnBps: 500,
    fundAtRetirementRealCents: 800_000, fundAtRetirementNominalCents: 1_000_000,
    sustainableMonthlyIncomeRealCents: 3_000, sustainableMonthlyIncomeNominalCents: 4_000,
    targetGapOrSurplusRealCents: -50_000, targetGapOrSurplusNominalCents: 100_000,
    points: [
      { date: "2026-10-08", age: null, realCents: 50_000, nominalCents: 50_000 },
      { date: "2027-10-08", age: 31, realCents: 800_000, nominalCents: 1_000_000 },
    ],
    ...overrides,
  };
}
const projection = (scenarios = [scenario("BEAR"), scenario("BASE"), scenario("BULL")]) => ({ scenarios, assumptions: { asOfDate: "2026-10-08", retirementDate: "2027-10-08" } });
function showRetirement(overview, onConfigure = () => {}) {
  return render(h(QueryClientProvider, { client }, h(CioRetirementCard, { overview, onConfigure })));
}

test("contribution progress explains configured and recurring-flow targets and clamps its visual and accessible range", () => {
  const view = render(h(CioContributionProgressCard, { overview: snapshot() }));
  assert.equal(view.container.textContent, "");
  for (const [status, targetSource, bps, expected, heading] of [["ON_TRACK", "OVERRIDE", 12_500, 100, "On track for 2026"], ["BEHIND", "DERIVED", -200, 0, "Behind 2026 pace"], ["ON_TRACK", "DERIVED", 5000, 50, "On track for 2026"]]) {
    const progress = { status, year: 2026, targetSource, annualProgressBps: bps, calendarProgressBps: 7500, paceGapCents: status === "ON_TRACK" ? 5000 : -5000, actualYtdCents: 75_000, expectedToDateCents: 70_000, annualTargetCents: 100_000, contributionGrowthRateBps: 500 };
    view.rerender(h(CioContributionProgressCard, { overview: snapshot({ contributionProgress: progress }) }));
    assert.ok(view.getByRole("heading", { name: heading }));
    const bar = view.getByRole("progressbar", { name: "2026 annual contribution progress" });
    assert.equal(bar.tagName, "PROGRESS");
    assert.equal(bar.value, expected);
    assert.equal(bar.max, 100);
    assert.equal(view.container.querySelector(".cio-contribution-progress-track > span").style.width, `${expected}%`);
    assert.match(view.container.textContent, targetSource === "OVERRIDE" ? /configured annual target/ : /retirement-eligible recurring flows/);
    assert.match(view.getByText("Recorded invested change YTD").parentElement.textContent, /750\.00/);
  }
});

test("CIO readiness distinguishes critical and advisory issues and routes each review to its relevant controls", () => {
  const actions = [];
  const props = { onConfigure: (section) => actions.push(section), onOpenBankControls: () => actions.push("banks"), onOpenSubAccounts: () => actions.push("subaccounts") };
  const base = snapshot();
  const view = render(h(CioHealthSummary, { ...props, overview: base }));
  assert.ok(view.getByRole("heading", { name: "Ready" }));
  assert.equal(view.queryByText("Improve decision quality"), null);
  const details = view.container.querySelector("details");
  fireEvent.click(details.querySelector("summary"));
  assert.equal(details.open, true);
  assert.equal(view.getByRole("progressbar", { name: "CIO data completeness" }).value, 75);
  for (const [code, expected] of [["MISSING_PROFILE", "profile"], ["MISSING_POLICY", "policy"], ["POSSIBLE_DUPLICATE", "positions"], ["STALE_VALUATION", "investments"], ["BANK_BALANCE_AFTER_DATA_DATE", "banks"], ["SAVINGS_BALANCE_AFTER_DATA_DATE", "subaccounts"]]) {
    const warning = { code, entityId: "position", severity: code === "MISSING_PROFILE" ? "CRITICAL" : "WARNING", message: `Resolve ${code}` };
    const overview = snapshot({ dataQuality: { ...base.dataQuality, warnings: [warning], completenessPercentage: 125 } });
    view.rerender(h(CioHealthSummary, { ...props, overview }));
    assert.ok(view.getByRole("heading", { name: warning.severity === "CRITICAL" ? "Action required" : "Review recommended" }));
    assert.ok(view.getByText("1 issue"));
    const row = view.getByText(warning.message).closest("li");
    fireEvent.click(within(row).getByRole("button"));
    assert.equal(actions.at(-1), expected);
    assert.equal(view.getByRole("progressbar").value, 100);
  }
  const warnings = Array.from({ length: 5 }, (_, index) => ({ code: `ISSUE_${index}`, severity: "WARNING", message: `Issue ${index}` }));
  view.rerender(h(CioHealthSummary, { ...props, overview: snapshot({ totals: { ...base.totals, planningLiabilitiesCents: 0 }, dataQuality: { ...base.dataQuality, warnings, completenessPercentage: -10 } }) }));
  assert.ok(view.getByText("5 issues"));
  assert.equal(view.getAllByRole("listitem").length, 4);
  assert.equal(view.queryByText("Issue 4"), null);
  assert.equal(view.getByRole("progressbar").value, 0);
});

test("allocation controls switch dimensions and show policy bands, unclassified amounts, and equivalent table data", () => {
  const actions = [];
  const base = snapshot();
  const view = render(h(CioAllocationCard, { overview: base, policy: null, onConfigure: (section) => actions.push(section) }));
  assert.ok(view.getByText("No classified value is available for this view yet."));
  assert.equal(view.getByRole("group", { name: "Allocation dimension" }).tagName, "FIELDSET");
  const bucket = (key, valueCents, allocationBps, isUnknown = false) => ({ key, valueCents, allocationBps, isUnknown, sourceCount: 2 });
  const allocation = { totalCents: 100_000, assetClasses: [bucket("EQUITY", 60_000, 6000), bucket("BOND", 10_000, 1000), bucket("UNKNOWN", 0, 3000, true), bucket("CASH", 30_000, 0), bucket("ALTERNATIVES", 1, 12_000), bucket("EMPTY", 0, 0)], geographies: [bucket("SINGAPORE", 100_000, 10_000)] };
  const policy = { assetClassBands: [
    { assetClass: "EQUITY", targetBps: 6000, minimumBps: 5000, maximumBps: 7000 },
    { assetClass: "BOND", targetBps: 4000, minimumBps: 3000, maximumBps: 5000 },
    { assetClass: "ALTERNATIVES", targetBps: 12_000, minimumBps: 0, maximumBps: 1000 },
  ] };
  view.rerender(h(CioAllocationCard, { overview: snapshot({ allocation }), policy, onConfigure: (section) => actions.push(section) }));
  assert.ok(view.getByRole("img", { name: "Asset class allocation" }));
  assert.ok(view.getByText("Within 50%–70% band"));
  assert.ok(view.getByText("Outside 30%–50% band"));
  assert.ok(view.getByText("Outside 0%–10% band"));
  assert.ok(view.getByText("Needs classification"));
  assert.equal(view.queryByText("Empty"), null);
  assert.equal(view.container.querySelectorAll("tbody tr").length, 5);
  assert.equal(view.container.querySelectorAll(".cio-allocation-target")[2].style.left, "100%");
  fireEvent.click(view.getByRole("button", { name: "Geography", exact: true }));
  assert.equal(view.getByRole("button", { name: "Geography", exact: true }).getAttribute("aria-pressed"), "true");
  assert.ok(view.getByRole("img", { name: "Geographic allocation" }));
  assert.equal(view.queryByText("Within 50%–70% band"), null);
  fireEvent.click(view.getByRole("button", { name: "Asset class", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Edit policy" }));
  assert.deepEqual(actions, ["policy"]);
  view.rerender(h(CioAllocationCard, { overview: snapshot({ allocation }), policy: undefined, onConfigure: () => {} }));
  assert.equal(view.queryByText("Within 50%–70% band"), null);
});

test("projection charts preserve scenario selection, real and nominal values, missing ages, and privacy masking", () => {
  const view = render(h(RetirementProjectionChart, { scenarios: [], mode: "real", currency: "SGD" }));
  assert.ok(view.getByText("No projection points are available."));
  const scenarios = [scenario("BEAR", { points: [] }), scenario("BASE"), scenario("BULL")];
  for (const mode of ["real", "nominal"]) {
    view.rerender(h(RetirementProjectionChart, { scenarios, mode, currency: "SGD" }));
    assert.ok(view.getByRole("img", { name: /Bear, base, and bull retirement projections/ }));
    assert.equal(view.container.querySelectorAll("tbody tr").length, 2);
    assert.ok(view.getByText("—"));
    assert.match(view.container.querySelector("tbody").textContent, mode === "real" ? /8,000\.00/ : /10,000\.00/);
    const details = view.container.querySelector("details");
    details.open = true;
    assert.equal(view.getByRole("group", { name: "Yearly projection scenario" }).tagName, "FIELDSET");
    fireEvent.click(view.getByRole("button", { name: "Bull scenario, 5% configured return" }));
    assert.match(view.container.querySelector("caption").textContent, /^Bull/);
    fireEvent.click(view.getByRole("button", { name: "Base scenario, 5% configured return" }));
  }
  view.rerender(h(RetirementProjectionChart, { scenarios: [scenario("BULL", { points: [{ date: "2026-10-08", age: 30, nominalCents: 0, realCents: 0 }] })], mode: "real", currency: "SGD" }));
  assert.match(view.container.querySelector("caption").textContent, /^Bull/);
  assert.doesNotMatch(view.container.innerHTML, /NaN|Infinity/);
  ui.act(() => setPrivacyMode(true));
  view.rerender(h(RetirementProjectionChart, { scenarios: [scenario("BASE")], mode: "real", currency: "SGD" }));
  assert.ok(view.container.querySelector("svg").textContent.includes(MASKED_AMOUNT));
  assert.ok(view.container.querySelector("tbody").textContent.includes(MASKED_AMOUNT));
});

test("retirement scenarios preserve the saved projection, send scoped amounts, and reset their temporary changes", async () => {
  const original = projection();
  const overview = snapshot({ retirement: { status: "READY", missingFields: [], projection: original } });
  const view = showRetirement(overview);
  const fund = () => view.getByText("Base fund at retirement").parentElement.textContent;
  assert.match(fund(), /8,000\.00/);
  assert.equal(view.getByRole("group", { name: "Projection value basis" }).tagName, "FIELDSET");
  assert.ok(view.getByText("Base target gap / surplus").parentElement.querySelector(".is-negative"));
  fireEvent.click(view.getByRole("button", { name: "Nominal", exact: true }));
  assert.match(fund(), /10,000\.00/);
  assert.ok(view.getByText("Base target gap / surplus").parentElement.querySelector(".is-positive"));
  fireEvent.click(view.getByRole("button", { name: "Today's money", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Try a contribution scenario" }));
  const assets = view.getByRole("textbox", { name: "Retirement assets (SGD)" });
  const contributions = view.getByRole("textbox", { name: "Annual external contribution (SGD)" });
  assert.equal(assets.value, "500");
  assert.equal(contributions.value, "120");
  fireEvent.change(assets, { target: { value: "1234.56" } });
  fireEvent.change(contributions, { target: { value: "100.99" } });
  let finish;
  reply = () => new Promise((resolve) => { finish = resolve; });
  fireEvent.submit(assets.closest("form"));
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Run scenario" }).disabled, true));
  assert.equal(requests[0].url, "/api/cio/retirement-projection");
  assert.equal(new Headers(requests[0].headers).get("x-workspace-id"), "home");
  assert.deepEqual(JSON.parse(requests[0].body), { currentRetirementAssetsCents: 123456, annualExternalContributionCents: 10099 });
  await ui.act(async () => finish(Response.json({ projection: { retirement: { status: "READY", missingFields: [], projection: projection([scenario("BASE", { fundAtRetirementRealCents: 880_000 })]) } } })));
  await waitFor(() => assert.match(fund(), /8,800\.00/));
  fireEvent.click(view.getByRole("button", { name: "Close scenario" }));
  assert.match(fund(), /8,000\.00/);
  fireEvent.click(view.getByRole("button", { name: "Try a contribution scenario" }));
  assert.equal(view.getByRole("textbox", { name: "Retirement assets (SGD)" }).value, "500");
  assert.equal(view.getByRole("textbox", { name: "Annual external contribution (SGD)" }).value, "120");
});

test("incomplete retirement assumptions explain their missing fields and failed scenarios remain retryable", async () => {
  const actions = [];
  const view = showRetirement(snapshot(), (section) => actions.push(section));
  assert.ok(view.getByText("Missing: profile details."));
  fireEvent.click(view.getByRole("button", { name: "Complete profile" }));
  assert.deepEqual(actions, ["profile"]);
  fireEvent.click(view.getByRole("button", { name: "Try a contribution scenario" }));
  reply = async () => Response.json({ projection: { retirement: { status: "NOT_READY", missingFields: ["RETIREMENT_DATE", "BASE_RETURN"], projection: null } } });
  fireEvent.submit(view.getByRole("textbox", { name: "Retirement assets (SGD)" }).closest("form"));
  await view.findByText("Projection assumptions are incomplete: RETIREMENT_DATE, BASE_RETURN");
  assert.equal(view.getByRole("button", { name: "Run scenario" }).disabled, false);
  reply = async () => Response.json({ projection: { retirement: { status: "READY", projection: projection([scenario("BEAR")]), missingFields: [] } } });
  fireEvent.click(view.getByRole("button", { name: "Run scenario" }));
  await view.findByRole("img", { name: /Bear, base, and bull retirement projections/ });
  assert.equal(view.queryByText("Base fund at retirement"), null);
  view.unmount();
  const missing = showRetirement(snapshot({ retirement: { status: "NOT_READY", missingFields: ["RETIREMENT_DATE"], projection: null } }));
  assert.ok(missing.getByText("Missing: RETIREMENT DATE."));
});

test("CIO formatting handles missing values, invalid inputs, UTC dates, precision, and privacy", () => {
  assert.equal(format.formatCioMoney(null, "SGD"), "Not set");
  assert.equal(format.formatCioPercent(undefined), "Not set");
  assert.equal(format.formatCioPercent(1234), "12.34%");
  assert.equal(format.formatCioLabel("FIXED_INCOME"), "Fixed Income");
  for (const value of [undefined, "invalid"]) {
    assert.equal(format.formatCioDate(value), "Not set");
    assert.equal(format.toDateInput(value), "");
  }
  assert.equal(format.toDateInput("2026-10-08T12:00:00Z"), "2026-10-08");
  assert.equal(format.toIsoDate("2026-10-08"), "2026-10-08T00:00:00.000Z");
  assert.equal(format.toIsoDate(""), null);
  for (const convert of [format.moneyInputFromCents, format.percentInputFromBps]) {
    assert.equal(convert(null), "");
    assert.equal(convert(123), "1.23");
  }
  for (const convert of [format.centsFromMoneyInput, format.bpsFromPercentInput]) {
    for (const value of [" ", "not-a-number", "Infinity"]) {
      assert.equal(convert(value), 0);
      assert.equal(convert(value, true), null);
    }
    assert.equal(convert("1.235"), 124);
    assert.equal(convert("-1.23", true), -123);
  }
  setPrivacyMode(true);
  assert.equal(format.formatCioMoney(100, "SGD"), MASKED_AMOUNT);
});
