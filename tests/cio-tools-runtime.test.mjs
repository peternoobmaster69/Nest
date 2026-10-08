import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const { ApiRequestError } = require("../lib/api/contracts.ts");
const { CIO_MAX_CENTS } = require("../lib/domains/cio/contracts.ts");
const { monthlyEquivalentCents } = require("../lib/domains/cio/advisor.ts");
const calls = [];
let state;
const read = (key) => async (args) => {
  calls.push({ key, args });
  if (state.failure) throw state.failure;
  return state[key];
};
mock.module("../lib/domains/cio/index.ts", { namedExports: {
  CIO_MAX_CENTS, monthlyEquivalentCents,
  buildCioSnapshot: read("snapshot"), getCioPolicy: read("policy"),
  buildWorkspaceCioStrategyRecommendations: read("strategy"),
  runWorkspaceRetirementProjection: read("projection"),
  buildWorkspaceCioAdvisorBrief: read("brief"), planWorkspaceCioNewMoney: read("newMoney"),
} });
const { executeCioAskNestTool: execute, getCioAskNestTools } = require("../lib/ai/tools/cio-tools.ts");
const context = { workspaceId: "household", userId: "owner", currency: "USD", callId: "call-1" };
const run = (name, args = { as_of_date: null }) => execute(name, args, context);
const dataQuality = () => ({ completenessBps: 8_000, latestValuationDate: "2026-10-08", oldestValuationDate: "2026-09-01", warnings: [] });
const envelope = () => ({ asOfDate: "2026-10-08", baseCurrency: "SGD", dataQuality: dataQuality(), evidence: [] });
function snapshot() {
  return {
    ...envelope(),
    totals: {
      financialAssetsCents: 50_000, bankControlCents: 10_000, savingsSubAccountCents: 5_000, investmentCurrentValueCents: 35_000,
      planningPositionAssetsCents: 20_000, planningLiabilitiesCents: 15_000, planningNetWorthCents: 55_000,
      investableAssetsCents: 40_000, retirementIncludedAssetsCents: 30_000,
    },
    liquidity: { immediateCents: 10_000, liquidCents: 20_000, restrictedCents: 5_000, lockedCents: 15_000, readilyAvailableCents: 30_000, essentialMonthlyExpenseCents: null, emergencyRunwayMonths: null },
    allocation: { totalCents: 50_000, assetClasses: [], geographies: [], securities: [], securityBucketCount: 0, securitiesTruncated: false, omittedSecurityValueCents: 0, omittedSecurityAllocationBps: 0 },
    recurringFlows: { externalContributionAnnualCents: 6_000, externalWithdrawalAnnualCents: 2_000, netExternalContributionAnnualCents: 4_000, internalReallocationAnnualCents: 1_000, retirementEligibleNetExternalAnnualCents: 3_000 },
    annualContributions: { source: "DERIVED", derivedExternalAnnualCents: 4_000, overrideExternalAnnualCents: null, usedExternalAnnualCents: 4_000, internalReallocationAnnualCents: 1_000 },
    policyExceptions: [], retirement: { status: "NOT_READY", missingFields: ["targetRetirementAge"], projection: null },
  };
}
function readyRetirement(count = 3, increase = 0) {
  const assumptions = {
    asOfDate: "2026-10-08", retirementDate: "2056-10-08", horizonYears: 30,
    currentRetirementAssetsCents: 30_000, annualExternalContributionCents: 4_000, contributionGrowthRateBps: 100,
    inflationRateBps: 200, bearReturnBps: 300, baseReturnBps: 500, bullReturnBps: 700, targetMonthlySpendingTodayCents: 10_000,
    sustainableWithdrawalRateBps: 400, contributionTiming: "END_OF_YEAR", finalPeriodFractionBps: 0, horizonRounding: "FULL_YEARS_PLUS_PRORATED_FINAL_PERIOD",
  };
  const points = Array.from({ length: count }, (_, index) => ({ date: `${2026 + index}-10-08`, year: 2026 + index, age: 35 + index, nominalCents: 30_000 + index * 4_000, realCents: 30_000 + index * 3_000, annualContributionCents: 4_000 }));
  return { status: "READY", missingFields: [], projection: { assumptions, scenarios: [{
    scenario: "BASE", nominalReturnBps: 500, points, fundAtRetirementNominalCents: 200_000 + increase, fundAtRetirementRealCents: 150_000 + increase,
    sustainableMonthlyIncomeNominalCents: 700 + increase, sustainableMonthlyIncomeRealCents: 500 + increase,
    targetFundNominalCents: 3_000_000, targetFundRealCents: 2_000_000, targetGapOrSurplusNominalCents: -2_800_000,
    targetGapOrSurplusRealCents: -1_850_000 + increase,
  }] } };
}
const metric = (unit, value) => ({ label: "Recorded value", unit, value });
const recommendation = (current, target, annualChangeCents = null) => ({ code: "LIQUIDITY_REVIEW", category: "LIQUIDITY", severity: "HIGH", title: "Review reserve", action: "Review the household plan", rationale: "Recorded reserve is below its target", scopeKey: "household", current, target, annualChangeCents, requiresUserConfirmation: true });
beforeEach(() => {
  calls.length = 0;
  state = { snapshot: snapshot(), policy: null, strategy: { ...envelope(), recommendations: [] }, projection: { ...envelope(), retirement: readyRetirement() } };
});

test("CIO tools validate dates, bounded money, and mutually exclusive overrides before reading workspace data", async () => {
  for (const value of ["bad", "2026-02-30", "2026-99-99"]) await assert.rejects(run("get_cio_overview", { as_of_date: value }));
  await assert.rejects(run("get_cio_overview", { as_of_date: null, workspaceId: "another-workspace" }));
  await assert.rejects(run("plan_cio_new_money", { as_of_date: null, amount_cents: 0 }));
  await assert.rejects(run("plan_cio_new_money", { as_of_date: null, amount_cents: CIO_MAX_CENTS + 1 }));
  await assert.rejects(run("compare_cio_contribution_scenarios", { as_of_date: null, additional_annual_contribution_cents: -1 }));
  await assert.rejects(run("run_cio_retirement_projection", { as_of_date: null, annual_external_contribution_cents: null, target_retirement_age: 65, target_retirement_date: "2056-10-08" }), /either target retirement age/);
  assert.equal(await run("unsupported_write_operation"), null);
  assert.equal(calls.length, 0);
  assert.ok(getCioAskNestTools().every((tool) => tool.strict && !Object.hasOwn(tool.parameters.properties, "workspaceId")));
});

test("CIO overview keeps the workspace currency, distinct financial totals, missing assumptions, and read-only evidence", async () => {
  const result = await run("get_cio_overview");
  assert.deepEqual(calls, [{ key: "snapshot", args: { workspaceId: "household", asOfDate: undefined } }]);
  assert.equal(result.output.readOnly, true);
  assert.equal(result.output.domain, "CIO");
  assert.equal(result.output.currency, "SGD");
  assert.deepEqual(result.output.facts.financialAssets, { cents: 50_000, formatted: "SGD 500.00" });
  assert.equal(result.output.facts.planningNetWorth.cents, 55_000);
  assert.equal(result.output.calculations.liquidity.essentialMonthlyExpense, null);
  assert.equal(result.output.contributionAssumption.configuredOverrideAnnual, null);
  assert.equal(result.output.contributionAssumption.internalReallocationAnnual.cents, 1_000);
  assert.deepEqual(result.output.calculations.retirement, { status: "NOT_READY", missingFields: ["targetRetirementAge"], assumptions: null, scenarios: [] });
  assert.deepEqual(result.output.dataQuality.completeness, { basisPoints: 8_000, formatted: "80.00%" });
  assert.deepEqual(result.output.evidence, result.evidence);
  assert.equal(result.output.calculations.allocation.unknownAssetClass, null);
});

test("CIO output bounds warnings and evidence, removes query parameters, and rejects external evidence URLs", async () => {
  const warnings = Array.from({ length: 25 }, (_, index) => ({ code: "STALE_VALUATION", severity: "WARNING", message: `Stale source ${index}`, setupHref: ["https://other.example.test", "//other.example.test", "/cio?private=secret"][index % 3] }));
  const refs = Array.from({ length: 12 }, (_, index) => ({ id: `ref-${index}`, kind: "INVESTMENT_VALUATION", label: `Investment ${index}`, href: index ? `/investments/${index}?private=secret` : "https://other.example.test", asOfDate: "2026-10-08" }));
  state.snapshot.dataQuality.warnings = warnings;
  state.snapshot.evidence = [refs[0], ...refs];
  const result = await execute("get_cio_overview", { as_of_date: "2026-10-08" }, { ...context, callId: "c".repeat(200) });
  assert.equal(calls[0].args.asOfDate, "2026-10-08");
  assert.equal(result.output.dataQuality.warningCount, 25);
  assert.equal(result.output.dataQuality.returnedWarningCount, 20);
  assert.equal(result.output.dataQuality.warningsTruncated, true);
  assert.equal(result.evidence.length, 8);
  assert.equal(new Set(result.evidence.map(({ label }) => label)).size, 8);
  assert.equal(result.evidence[0].id, `${"c".repeat(120)}:cio-evidence-1`);
  assert.equal(result.evidence[0].href, "/cio");
  assert.match(result.evidence[0].detail, /INVESTMENT VALUATION data as of 2026-10-08/);
  assert.doesNotMatch(JSON.stringify(result), /private=secret|other\.example/);
});

test("large security allocations retain unknown exposure and account for every omitted bucket", async () => {
  const bucket = (key, valueCents = 100) => ({ key, valueCents, allocationBps: 100, sourceCount: 1, isUnknown: key === "UNKNOWN" });
  const unknown = bucket("UNKNOWN", 50);
  state.snapshot.allocation = {
    totalCents: 2_750, assetClasses: [unknown, bucket("EQUITY")], geographies: [unknown, bucket("GLOBAL")],
    securities: [...Array.from({ length: 22 }, (_, index) => bucket(`SEC-${index}`)), unknown], securityBucketCount: 24,
    securitiesTruncated: true, omittedSecurityValueCents: 500, omittedSecurityAllocationBps: 200,
  };
  let allocation = (await run("get_cio_overview")).output.calculations.allocation;
  assert.equal(allocation.returnedSecurityBucketCount, 20);
  assert.equal(allocation.securityBucketCount, 24);
  assert.equal(allocation.securitiesTruncated, true);
  assert.ok(allocation.securities.some(({ key }) => key === "UNKNOWN"));
  assert.equal(allocation.omittedSecurityValue.cents, 800);
  assert.equal(allocation.omittedSecurityAllocation.basisPoints, 500);
  for (const field of ["unknownAssetClass", "unknownGeography", "unknownSecurity"]) assert.equal(allocation[field].value.cents, 50);
  state.snapshot.allocation.securities = [unknown];
  allocation = (await run("get_cio_overview")).output.calculations.allocation;
  assert.equal(allocation.securities[0].key, "UNKNOWN");
  assert.equal(allocation.omittedSecurityValue.cents, 500);
});

test("policy status distinguishes absent, unconfirmed, and confirmed policy and preserves metric units", async () => {
  let result = (await run("get_cio_policy_status")).output;
  assert.equal(result.policyConfigured, false);
  assert.equal(result.policyConfirmed, false);
  assert.equal(result.configuredPolicy, null);
  state.policy = {
    confirmedAt: null, minimumLiquidityReserveCents: 10_000, minimumLiquidityMonths: 3,
    maximumAccountConcentrationBps: 5_000, maximumSingleSecurityConcentrationBps: null, maximumSatelliteAllocationBps: 1_000,
    valuationStaleAfterDays: 30, allowsOptions: false, allowsMargin: false, allowsLeverage: false, allowsAdditionalIlpTopUps: null,
    assetClassBands: [{ assetClass: "EQUITY", minimumBps: 5_000, targetBps: 6_000, maximumBps: 7_000 }],
    geographyLimits: [{ geography: "GLOBAL", maximumBps: 8_000 }],
  };
  state.snapshot.policyExceptions = Array.from({ length: 22 }, (_, index) => ({
    code: "LIQUIDITY_BELOW_FLOOR", severity: "WARNING", title: "Review reserve", reviewAction: "Review policy",
    actual: [metric("CENTS", 5_000), metric("BPS", 2_500), metric("MONTHS", 2)][index % 3],
    threshold: index % 2 ? null : metric("CENTS", 10_000),
  }));
  result = (await run("get_cio_policy_status", { as_of_date: "2026-10-08" })).output;
  assert.equal(result.policyConfigured, true);
  assert.equal(result.policyConfirmed, false);
  assert.equal(result.configuredPolicy.maximumSingleSecurityConcentration, null);
  assert.equal(result.configuredPolicy.assetClassBands[0].target.basisPoints, 6_000);
  assert.equal(result.configuredPolicy.geographyLimits[0].maximum.basisPoints, 8_000);
  assert.equal(result.exceptionCount, 22);
  assert.equal(result.returnedExceptionCount, 20);
  assert.equal(result.exceptionsTruncated, true);
  assert.deepEqual(result.exceptions[0].actual, { unit: "CENTS", amount: { cents: 5_000, formatted: "SGD 50.00" } });
  assert.deepEqual(result.exceptions[1].actual, { unit: "BPS", percentage: { basisPoints: 2_500, formatted: "25.00%" } });
  assert.deepEqual(result.exceptions[2].actual, { unit: "MONTHS", value: 2 });
  assert.equal(result.exceptions[1].threshold, null);
  state.policy.confirmedAt = new Date("2026-10-08");
  assert.equal((await run("get_cio_policy_status")).output.policyConfirmed, true);
  assert.ok(calls.filter(({ key }) => key === "policy").every(({ args }) => args === "household"));
});

test("strategy recommendations render monetary, percentage, scalar, and missing values without inventing a rank", async () => {
  state.strategy.recommendations = [
    recommendation(metric("CENTS", 1_000), metric("BPS", 2_500), 3_600),
    recommendation(metric("MONTHS", 2), null),
    recommendation(null, metric("CENTS", 2_000)),
  ];
  const output = (await run("get_cio_strategy_recommendations", { as_of_date: "2026-10-08" })).output;
  assert.equal(output.recommendationCount, 3);
  assert.equal(output.recommendations[0].current.amount.cents, 1_000);
  assert.equal(output.recommendations[0].target.percentage.basisPoints, 2_500);
  assert.equal(output.recommendations[0].annualChange.cents, 3_600);
  assert.deepEqual(output.recommendations[1].current, metric("MONTHS", 2));
  assert.equal(output.recommendations[1].target, null);
  assert.equal(output.recommendations[2].current, null);
  assert.ok(output.recommendations.every((item) => item.requiresUserConfirmation && !Object.hasOwn(item, "rank") && !Object.hasOwn(item, "monthlyChangeEquivalent")));
  assert.deepEqual(calls[0].args, { workspaceId: "household", asOfDate: "2026-10-08" });
  await run("get_cio_strategy_recommendations");
  assert.equal(calls.at(-1).args.asOfDate, undefined);
});

test("retirement projections keep overrides temporary and sample long series without losing endpoints", async () => {
  const baseArgs = { as_of_date: null, annual_external_contribution_cents: null, target_retirement_age: null, target_retirement_date: null };
  let output = (await run("run_cio_retirement_projection", baseArgs)).output;
  assert.deepEqual(calls[0].args, { workspaceId: "household", input: {} });
  assert.equal(output.temporaryOverrides.annualExternalContribution, null);
  assert.equal(output.calculation.scenarios[0].sampledPoints.length, 3);
  assert.equal(output.calculation.scenarios[0].pointsSampled, false);
  assert.equal(output.calculation.assumptions.inflation.basisPoints, 200);
  state.projection.retirement = readyRetirement(30);
  output = (await run("run_cio_retirement_projection", { ...baseArgs, as_of_date: "2026-10-08", annual_external_contribution_cents: 0, target_retirement_age: 65 })).output;
  assert.deepEqual(calls.at(-1).args.input, { asOfDate: "2026-10-08", annualExternalContributionCents: 0, targetRetirementAge: 65 });
  const scenario = output.calculation.scenarios[0];
  assert.equal(scenario.sampledPoints.length, 12);
  assert.equal(scenario.totalPointCount, 30);
  assert.equal(scenario.pointsSampled, true);
  assert.equal(scenario.sampledPoints[0].date, "2026-10-08");
  assert.equal(scenario.sampledPoints.at(-1).date, "2055-10-08");
  assert.equal(new Set(scenario.sampledPoints.map(({ date }) => date)).size, 12);
  await run("run_cio_retirement_projection", { ...baseArgs, target_retirement_date: "2056-10-08" });
  assert.deepEqual(calls.at(-1).args.input, { targetRetirementDate: "2056-10-08T00:00:00.000Z" });
});

test("contribution comparisons change external contributions only and omit differences without matching base scenarios", async () => {
  const args = { as_of_date: null, additional_annual_contribution_cents: 500 };
  let output = (await run("compare_cio_contribution_scenarios", args)).output;
  assert.equal(output.baseScenarioDifference, null);
  assert.equal(output.assumptions.alternativeAnnualExternalContribution.cents, 4_500);
  assert.equal(output.assumptions.internalReallocationsExcluded.cents, 1_000);
  assert.deepEqual(calls.at(-1).args.input, { annualExternalContributionCents: 4_500 });
  state.snapshot.retirement = readyRetirement();
  state.projection.retirement = readyRetirement(3, 100);
  output = (await run("compare_cio_contribution_scenarios", { ...args, as_of_date: "2026-10-08" })).output;
  assert.equal(output.baseScenarioDifference.fundAtRetirementNominal.cents, 100);
  assert.equal(output.baseScenarioDifference.fundAtRetirementReal.cents, 100);
  assert.equal(output.baseScenarioDifference.sustainableMonthlyIncomeNominal.cents, 100);
  assert.equal(output.baseScenarioDifference.sustainableMonthlyIncomeReal.cents, 100);
  assert.equal(output.baseScenarioDifference.targetGapOrSurplusReal.cents, 100);
  assert.deepEqual(calls.at(-1).args.input, { asOfDate: "2026-10-08", annualExternalContributionCents: 4_500 });
  state.projection.retirement.projection.scenarios = [];
  assert.equal((await run("compare_cio_contribution_scenarios", args)).output.baseScenarioDifference, null);
  state.snapshot.annualContributions.usedExternalAnnualCents = CIO_MAX_CENTS;
  const previousProjectionCalls = calls.filter(({ key }) => key === "projection").length;
  await assert.rejects(run("compare_cio_contribution_scenarios", args));
  assert.equal(calls.filter(({ key }) => key === "projection").length, previousProjectionCalls);
});

test("advisor brief exposes exact monthly equivalents and optional progress and retirement levers", async () => {
  state.brief = {
    asOfDate: "2026-10-08", currency: "SGD", strategyStatus: "REVIEW", executiveStance: "Review household reserve", evidence: [], dataQuality: dataQuality(),
    recommendations: [recommendation(metric("CENTS", 1_000), null, 3_600), recommendation(null, null)],
    allocation: { policyConfirmed: true, totalCents: 50_000, unknown: { valueCents: 5_000, allocationBps: 1_000 }, newMoneyToReachAllMinimumsCents: 2_000, drift: [{ assetClass: "EQUITY", status: "ABOVE_BAND", currentCents: 30_000, currentBps: 6_000, minimumBps: 4_000, targetBps: 5_000, maximumBps: 5_500, driftFromTargetBps: 1_000, valueAtTargetCents: 25_000, differenceFromTargetCents: 5_000 }] },
    liquidity: { readilyAvailableCents: 30_000, immediateBankCashCents: 10_000, immediateBankCashFloorCents: 15_000, immediateBankCashShortfallCents: 5_000, essentialMonthlyExpenseCents: 5_000, emergencyRunwayMonths: 6, policyFloorCents: 35_000, policyShortfallCents: 5_000, monthsToRestoreAtNetContributions: 15 },
    contributions: { source: "DERIVED", usedAnnualCents: 4_000, usedMonthlyCents: 333, netExternalAnnualCents: 4_000, netExternalMonthlyCents: 333, internalReallocationAnnualCents: 1_000, progress: null },
    retirement: { status: "NOT_READY", missingFields: ["targetRetirementAge"], levers: null },
  };
  let output = (await run("get_cio_advisor_brief")).output;
  assert.equal(output.recommendations[0].monthlyChangeEquivalent.cents, 300);
  assert.equal(output.recommendations[1].monthlyChangeEquivalent, null);
  assert.equal(output.contributions.progress, null);
  assert.equal(output.retirement.levers, null);
  assert.equal(output.allocation.drift[0].differenceFromTarget.cents, 5_000);
  assert.equal(output.liquidity.immediateBankCashShortfall.cents, 5_000);
  state.brief.contributions.progress = { year: 2026, status: "ON_TRACK", actualYtdCents: 3_000, expectedToDateCents: 3_000, annualTargetCents: 4_000, paceGapCents: 0, remainingAnnualCents: 1_000, annualProgressBps: 7_500, calendarProgressBps: 7_500 };
  state.brief.retirement = { status: "READY", missingFields: [], levers: {
    retirementDate: "2056-10-08", currentAnnualContributionCents: 4_000, currentMonthlyContributionCents: 333,
    requiredAnnualContributionCents: 12_000, requiredMonthlyContributionCents: 1_000, additionalAnnualContributionCents: 8_000, additionalMonthlyContributionCents: 667,
    baseGapOrSurplusRealCents: -100_000, baseSustainableMonthlyIncomeRealCents: 5_000, targetMonthlySpendingTodayCents: 10_000,
    monthlySpendingGapOrSurplusTodayCents: -5_000, earliestFundedRetirementDate: "2060-10-08", earliestFundedDateSearch: "SOLVED",
    requiredBaseReturn: { status: "SOLVED", bps: 750 }, baseReturnBps: 500,
  } };
  output = (await run("get_cio_advisor_brief", { as_of_date: "2026-10-08" })).output;
  assert.equal(output.contributions.progress.annualProgress.basisPoints, 7_500);
  assert.equal(output.contributions.progress.remainingThisYear.cents, 1_000);
  assert.equal(output.retirement.levers.additionalMonthlyContributionNeeded.cents, 667);
  assert.equal(output.retirement.levers.requiredBaseReturn.basisPoints, 750);
  assert.equal(output.retirement.levers.requiredContributionUnavailable, false);
  state.brief.retirement.levers.requiredAnnualContributionCents = null;
  assert.equal((await run("get_cio_advisor_brief")).output.retirement.levers.requiredContributionUnavailable, true);
});

test("new money plans require policy and preserve the domain allocation without saving it", async () => {
  state.newMoney = { ...envelope(), plan: { status: "POLICY_REQUIRED", reason: "Confirm a household policy" } };
  const args = { as_of_date: null, amount_cents: 1_000 };
  let output = (await run("plan_cio_new_money", args)).output;
  assert.deepEqual(output.plan, state.newMoney.plan);
  state.newMoney.plan = { status: "PLANNED", method: "TARGET_SHORTFALLS", totalBeforeCents: 50_000, totalAfterCents: 51_000, unknown: { valueCents: 5_000, allocationBps: 980 }, stillOutsideBands: [], bands: [{ assetClass: "CASH", allocationCents: 1_000, allocationShareBps: 10_000, currentCents: 9_000, currentBps: 1_800, afterCents: 10_000, afterBps: 1_961, minimumBps: 1_000, targetBps: 2_000, maximumBps: 3_000, statusBefore: "BELOW_TARGET", statusAfter: "WITHIN_BAND" }] };
  output = (await run("plan_cio_new_money", { ...args, as_of_date: "2026-10-08" })).output;
  assert.deepEqual(calls.at(-1).args, { workspaceId: "household", amountCents: 1_000, asOfDate: "2026-10-08" });
  assert.equal(output.readOnly, true);
  assert.equal(output.proposedNewMoney.cents, 1_000);
  assert.equal(output.plan.totalAfter.cents, 51_000);
  assert.equal(output.plan.bands[0].allocate.cents, 1_000);
  assert.equal(output.plan.bands[0].shareOfNewMoney.basisPoints, 10_000);
});

test("domain failures are bounded and model-safe while unexpected failures remain visible to the caller", async () => {
  state.failure = new ApiRequestError(422, "Private workspace details");
  const result = await run("get_cio_overview");
  assert.equal(result.output.ok, false);
  assert.equal(result.output.unavailable, true);
  assert.equal(result.output.code, "CIO_REQUEST_UNAVAILABLE");
  assert.deepEqual(result.evidence, []);
  assert.doesNotMatch(JSON.stringify(result), /Private workspace/);
  state.failure = new Error("Unexpected provider failure");
  await assert.rejects(run("get_cio_overview"), /Unexpected provider failure/);
});
