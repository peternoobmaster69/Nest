import assert from "node:assert/strict";
import test from "node:test";
import { assessCioDataQuality, differenceInUtcDays } from "../lib/domains/cio/data-quality.ts";
import { evaluateCioPolicy } from "../lib/domains/cio/policy-engine.ts";
import { calculateCioContributionProgress } from "../lib/domains/cio/contribution-progress.ts";

const asOfDate = new Date("2026-10-09T12:00:00Z");
const investment = (id, overrides = {}) => ({ id, latestValuationDate: asOfDate, currentValueCents: 1_000, hasConfirmedProfile: true, hasAssetClassExposure: true, hasGeographyExposure: true, ...overrides });
const quality = (overrides = {}) => assessCioDataQuality({ asOfDate, investments: [], hasHouseholdProfile: true, hasConfirmedPolicy: true, staleAfterDays: 1, ...overrides });
const policy = (overrides = {}) => ({ minimumLiquidityReserveCents: null, minimumLiquidityMonths: null, maximumAccountConcentrationBps: null, maximumSingleSecurityConcentrationBps: null, maximumSatelliteAllocationBps: null, assetClassBands: [], geographyLimits: [], ...overrides });
const allocation = (overrides = {}) => ({ totalCents: 10_000, assetClasses: [], geographies: [], securities: [], securityBucketCount: 0, ...overrides });
const liquidity = (overrides = {}) => ({ immediateCents: 1_000, liquidCents: 1_000, restrictedCents: 0, lockedCents: 0, readilyAvailableCents: 2_000, essentialMonthlyExpenseCents: 1_000, emergencyRunwayMonths: 2, ...overrides });
const evaluate = (overrides = {}) => evaluateCioPolicy({ policy: null, allocation: allocation(), liquidity: liquidity(), dataQuality: quality(), accounts: [], retirementProjection: null, evidence: [], ...overrides });
const bucket = (key, allocationBps) => ({ key, allocationBps, valueCents: allocationBps, sourceCount: 1, isUnknown: key === "UNKNOWN" });
const evidence = (id) => ({ id, kind: "INVESTMENT_VALUATION", label: id, href: `/investments?accountId=${id}`, asOfDate: "2026-10-09" });
const staleWarning = (overrides = {}) => ({ code: "STALE_VALUATION", severity: "WARNING", message: "Refresh the valuation", setupHref: "/investments", ...overrides });

test("CIO completeness includes household setup even for an empty portfolio and preserves valuation date order", () => {
  assert.deepEqual(quality(), { completenessBps: 10_000, completenessPercentage: 100, latestValuationDate: null, oldestValuationDate: null, warnings: [] });
  const missing = quality({ hasHouseholdProfile: false, hasConfirmedPolicy: false, missingHouseholdFields: [] });
  assert.equal(missing.completenessBps, 0);
  assert.deepEqual(missing.warnings.map(({ code }) => code), ["MISSING_PROFILE", "MISSING_POLICY"]);
  assert.equal(missing.warnings[0].message, "Household retirement and liquidity assumptions are incomplete.");
  const investments = [investment("new"), investment("old", { latestValuationDate: new Date("2026-10-07") }), investment("threshold", { latestValuationDate: new Date("2026-10-08") })];
  const result = quality({ investments });
  assert.equal(result.completenessBps, 10_000);
  assert.equal(result.latestValuationDate, "2026-10-09");
  assert.equal(result.oldestValuationDate, "2026-10-07");
  assert.deepEqual(result.warnings.map(({ code, entityId }) => [code, entityId]), [["STALE_VALUATION", "old"]]);
  assert.deepEqual(investments.map(({ id }) => id), ["new", "old", "threshold"]);
  assert.equal(differenceInUtcDays(new Date("2026-10-09T00:01Z"), new Date("2026-10-08T23:59Z")), 1);
  assert.equal(differenceInUtcDays(asOfDate, new Date("2026-10-10")), 0);
});

test("CIO quality reports incomplete historical balances, investments, duplicates and bounded reads in a stable order", () => {
  const result = quality({
    hasHouseholdProfile: false, missingHouseholdFields: ["retirement age", "spending"],
    bankControlCount: 3, bankControlsAfterAsOfCount: 2, savingsSubAccountCount: 2, savingsSubAccountsAfterAsOfCount: 1,
    investments: [
      investment("negative & old", { currentValueCents: -20, latestValuationDate: new Date("2026-10-01"), hasConfirmedProfile: false, hasAssetClassExposure: false }),
      investment("missing", { latestValuationDate: null, currentValueCents: null, hasGeographyExposure: false }),
    ],
    duplicatePlanningPositionIds: ["same & position"], truncatedSections: ["investment", "planning-position"],
  });
  assert.equal(result.completenessBps, 3_529);
  assert.equal(result.completenessPercentage, 35.29);
  assert.deepEqual(result.warnings.map(({ code }) => code), ["BANK_BALANCE_AFTER_DATA_DATE", "SAVINGS_BALANCE_AFTER_DATA_DATE", "MISSING_PROFILE", "NEGATIVE_VALUATION", "STALE_VALUATION", "UNCLASSIFIED_INVESTMENT", "UNKNOWN_EXPOSURE", "MISSING_VALUATION", "UNKNOWN_EXPOSURE", "POSSIBLE_DUPLICATE", "DATA_TRUNCATED", "DATA_TRUNCATED"]);
  assert.match(result.warnings[0].message, /2 current bank control balances were/);
  assert.match(result.warnings[1].message, /1 current savings sub-account balance was/);
  assert.match(result.warnings[2].message, /Missing: retirement age, spending\./);
  assert.equal(result.warnings[3].setupHref, "/investments?accountId=negative%20%26%20old");
  assert.deepEqual(result.warnings[3].actual, { unit: "CENTS", value: -20 });
  assert.deepEqual(result.warnings[4].actual, { unit: "DAYS", value: 8 });
  assert.equal(result.warnings[9].setupHref, "/cio?setup=position&id=same%20%26%20position");
  assert.equal(result.warnings[10].severity, "CRITICAL");
  const otherCounts = quality({ bankControlCount: 1, bankControlsAfterAsOfCount: 1, savingsSubAccountCount: 2, savingsSubAccountsAfterAsOfCount: 2, investments: [investment("dated", { currentValueCents: null })] });
  assert.match(otherCounts.warnings[0].message, /1 current bank control balance was/);
  assert.match(otherCounts.warnings[1].message, /2 current savings sub-account balances were/);
});

test("CIO policy data alerts retain numeric thresholds, severity boundaries and at most eight evidence references", () => {
  const references = Array.from({ length: 10 }, (_, index) => evidence(`source-${index}`));
  for (const [completenessBps, severity] of [[4_999, "CRITICAL"], [5_000, "WARNING"], [9_999, "WARNING"]]) {
    const [result] = evaluate({ dataQuality: { ...quality(), completenessBps }, evidence: references });
    assert.equal(result.code, "DATA_INCOMPLETE");
    assert.equal(result.severity, severity);
    assert.deepEqual(result.actual, { unit: "BPS", value: completenessBps });
    assert.deepEqual(result.threshold, { unit: "BPS", value: 10_000 });
    assert.deepEqual(result.evidence, references.slice(0, 8));
  }
  const stale = evaluate({ dataQuality: { ...quality(), warnings: [
    staleWarning(), staleWarning({ actual: { unit: "COUNT", value: 100 } }),
    staleWarning({ actual: { unit: "DAYS", value: 10 }, threshold: { unit: "COUNT", value: 5 } }),
    staleWarning({ actual: { unit: "DAYS", value: 45 }, threshold: { unit: "DAYS", value: 30 } }),
  ] } });
  assert.deepEqual(stale[0].actual, { unit: "DAYS", value: 45 });
  assert.deepEqual(stale[0].threshold, { unit: "DAYS", value: 30 });
  const unmeasured = evaluate({ dataQuality: { ...quality(), warnings: [staleWarning()] } });
  assert.deepEqual(unmeasured[0].actual, { unit: "DAYS", value: 0 });
  assert.deepEqual(unmeasured[0].threshold, { unit: "DAYS", value: null });
  assert.deepEqual(evaluate(), []);
});

test("cash floors distinguish immediately accessible bank cash from emergency reserves and honor exact thresholds", () => {
  const configured = policy({ minimumLiquidityMonths: 3, minimumLiquidityReserveCents: 2_500 });
  const alerts = evaluate({ policy: configured, minimumImmediateBankCashCents: 1_000, immediateBankCashCents: 999 });
  assert.deepEqual(alerts.map(({ code, actual, threshold }) => [code, actual.value, threshold.value]), [["LIQUIDITY_BELOW_FLOOR", 999, 1_000], ["LIQUIDITY_BELOW_FLOOR", 2_000, 3_000]]);
  assert.match(alerts[0].title, /Immediate bank/);
  assert.match(alerts[1].title, /Emergency liquidity/);
  assert.deepEqual(evaluate({ policy: configured, minimumImmediateBankCashCents: 1_000, liquidity: liquidity({ readilyAvailableCents: 3_000 }) }), []);
  const fixedFloor = evaluate({ policy: configured, liquidity: liquidity({ essentialMonthlyExpenseCents: null }) });
  assert.equal(fixedFloor[0].threshold.value, 2_500);
  assert.deepEqual(evaluate({ policy: policy({ minimumLiquidityMonths: 3 }), liquidity: liquidity({ essentialMonthlyExpenseCents: null }) }), []);
});

test("asset bands report missing, underweight and overweight classes while preserving inclusive boundaries", () => {
  const configured = policy({ assetClassBands: ["MISSING", "EQUITY", "CASH", "LOW_EDGE", "HIGH_EDGE"].map((assetClass) => ({ assetClass, minimumBps: 1_000, targetBps: 2_000, maximumBps: 3_000 })) });
  const result = evaluate({ policy: configured, allocation: allocation({ assetClasses: [bucket("EQUITY", 999), bucket("CASH", 3_001), bucket("LOW_EDGE", 1_000), bucket("HIGH_EDGE", 3_000)] }) });
  assert.deepEqual(result.map(({ title, actual, threshold }) => [title, actual.value, threshold.value]), [
    ["MISSING is outside its policy band", 0, 1_000], ["EQUITY is outside its policy band", 999, 1_000], ["CASH is outside its policy band", 3_001, 3_000],
  ]);
});

test("account concentrations round exact cents and prioritize matching investment evidence without duplicates", () => {
  const references = [evidence("investment-first"), ...Array.from({ length: 8 }, (_, index) => evidence(`other-${index}`)), evidence("investment-last")];
  const accounts = ["first", "last", "no-evidence"].map((id) => ({ id, currentValueCents: 6_000, portfolioRole: "CORE" }));
  accounts.push({ id: "zero", currentValueCents: 0, portfolioRole: null }, { id: "negative", currentValueCents: -1, portfolioRole: null }, { id: "equal", currentValueCents: 5_000, portfolioRole: "CORE" });
  const configured = policy({ maximumAccountConcentrationBps: 5_000 });
  const result = evaluate({ policy: configured, accounts, evidence: references });
  assert.equal(result.length, 3);
  assert.deepEqual(result[0].evidence, references.slice(0, 8));
  assert.deepEqual(result[1].evidence, [references[9], ...references.slice(0, 7)]);
  assert.deepEqual(result[2].evidence, references.slice(0, 8));
  assert.deepEqual(evaluate({ policy: configured, accounts, allocation: allocation({ totalCents: 0 }) }), []);
  const rounded = evaluate({ policy: policy({ maximumAccountConcentrationBps: 3_332 }), accounts: [{ id: "third", currentValueCents: 1, portfolioRole: null }], allocation: allocation({ totalCents: 3 }) });
  assert.equal(rounded[0].actual.value, 3_333);
});

test("security and geography limits ignore unknown securities and absent regions and accept equal limits", () => {
  const result = evaluate({
    policy: policy({ maximumSingleSecurityConcentrationBps: 5_000, geographyLimits: [{ geography: "US", maximumBps: 5_000 }, { geography: "SG", maximumBps: 4_000 }, { geography: "ABSENT", maximumBps: 1_000 }] }),
    allocation: allocation({ securities: [bucket("UNKNOWN", 9_000), bucket("ABC", 5_001), bucket("XYZ", 5_000)], geographies: [bucket("US", 5_001), bucket("SG", 4_000)] }),
  });
  assert.deepEqual(result.map(({ code, actual, threshold }) => [code, actual.value, threshold.value]), [["SECURITY_CONCENTRATION", 5_001, 5_000], ["GEOGRAPHY_CONCENTRATION", 5_001, 5_000]]);
});

test("satellite limits count only positive satellite holdings and tolerate equality or an empty allocation", () => {
  const accounts = [{ id: "satellite", currentValueCents: 2_000, portfolioRole: "SATELLITE" }, { id: "negative", currentValueCents: -50, portfolioRole: "SATELLITE" }, { id: "core", currentValueCents: 8_000, portfolioRole: "CORE" }];
  const result = evaluate({ policy: policy({ maximumSatelliteAllocationBps: 1_999 }), accounts });
  assert.equal(result[0].code, "SATELLITE_ALLOCATION_EXCEEDED");
  assert.equal(result[0].actual.value, 2_000);
  assert.deepEqual(evaluate({ policy: policy({ maximumSatelliteAllocationBps: 2_000 }), accounts }), []);
  assert.deepEqual(evaluate({ policy: policy({ maximumSatelliteAllocationBps: 0 }) }), []);
});

test("retirement alerts use only the base scenario and remain after data, liquidity and allocation alerts", () => {
  const scenario = { scenario: "BASE", targetGapOrSurplusRealCents: -1, fundAtRetirementRealCents: 999, targetFundRealCents: 1_000 };
  const retirementProjection = { scenarios: [{ ...scenario, scenario: "BEAR" }, scenario] };
  const result = evaluate({ retirementProjection, dataQuality: { ...quality(), completenessBps: 2_000 } });
  assert.deepEqual(result.map(({ code }) => code), ["DATA_INCOMPLETE", "RETIREMENT_TARGET_GAP"]);
  assert.deepEqual(result[1].actual, { unit: "CENTS", value: 999 });
  assert.deepEqual(result[1].threshold, { unit: "CENTS", value: 1_000 });
  assert.deepEqual(evaluate({ retirementProjection: { scenarios: [] } }), []);
  assert.deepEqual(evaluate({ retirementProjection: { scenarios: [{ ...scenario, targetGapOrSurplusRealCents: 0 }] } }), []);
});

test("contribution pace handles year boundaries, completed targets, zero targets and net withdrawals", () => {
  const calculate = (overrides = {}) => calculateCioContributionProgress({ asOfDate: new Date("2026-01-01"), actualYtdCents: 0, annualTargetCents: 36_500, contributionGrowthRateBps: 0, targetSource: "DERIVED", ...overrides });
  const firstDay = calculate();
  assert.equal(firstDay.expectedToDateCents, 100);
  assert.equal(firstDay.remainingAnnualCents, 36_500);
  assert.equal(firstDay.calendarProgressBps, 27);
  const complete = calculate({ asOfDate: new Date("2026-12-31T23:59:59Z"), actualYtdCents: 36_600 });
  assert.equal(complete.expectedToDateCents, 36_500);
  assert.equal(complete.remainingAnnualCents, 0);
  assert.equal(complete.annualProgressBps, 10_027);
  assert.equal(complete.calendarProgressBps, 10_000);
  assert.equal(complete.status, "ON_TRACK");
  assert.equal(calculate({ annualTargetCents: 0, actualYtdCents: 0 }).annualProgressBps, 10_000);
  assert.equal(calculate({ annualTargetCents: 0, actualYtdCents: -100 }).annualProgressBps, 0);
  assert.equal(calculate({ actualYtdCents: -100 }).annualProgressBps, 0);
  assert.throws(() => calculate({ asOfDate: new Date("2026-12-31"), annualTargetCents: Number.MAX_SAFE_INTEGER + 1 }), /expected contribution exceeds/);
  assert.throws(() => calculate({ asOfDate: new Date("2026-12-31"), annualTargetCents: Number.MAX_SAFE_INTEGER, actualYtdCents: -Number.MAX_SAFE_INTEGER }), /contribution pace gap exceeds/);
});
