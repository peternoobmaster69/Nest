import assert from "node:assert/strict";
import test from "node:test";
import { AllocationValidationError, allocateCentsByWeights, calculateAllocation, calculateDimensionAllocation, calculateLiquidityTotals } from "../lib/domains/cio/allocation-engine.ts";
import { CashflowValidationError, annualizeRecurringAmount, annualizeRecurringFlow, calculateEmergencyRunway, isRecurringFlowActiveAsOf, summarizeRecurringFlows } from "../lib/domains/cio/cashflow-engine.ts";
import { RetirementProjectionValidationError, applyRateBpsToCents, calculateRetirementTargetFundCents, calculateSustainableMonthlyIncomeCents, projectRetirement } from "../lib/domains/cio/retirement-projection.ts";

const max = Number.MAX_SAFE_INTEGER;
function rejectsCalculation(operation, ErrorType, code, field) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ErrorType);
    assert.equal(error.code, code);
    assert.equal(error.field, field);
    return true;
  });
}
const slice = (key, weightBps) => ({ key, weightBps });
const source = (id, valueCents = 100, overrides = {}) => ({ id, valueCents, ...overrides });
const flow = (overrides = {}) => ({ id: "saving", type: "EXTERNAL_CONTRIBUTION", amountCents: 100, cadence: "MONTHLY", includeInRetirementProjection: true, ...overrides });
const projection = (overrides = {}) => ({ asOfDate: "2026-01-01", currentRetirementAssetsCents: 100_000, annualExternalContributionCents: 10_000, bearReturnBps: 0, baseReturnBps: 0, bullReturnBps: 0, inflationBps: 0, targetMonthlyRetirementSpendingCents: 100, sustainableWithdrawalRateBps: 400, yearsToRetirement: 1, ...overrides });

test("exposure allocation conserves signed cents across permutations and uneven remainders", () => {
  const weights = [slice("C", 3_333), slice("A", 3_333), slice("B", 3_334)];
  for (const amount of [0, 1, 2, 3, 101, -101, max, -max]) {
    const result = allocateCentsByWeights(amount, weights);
    assert.deepEqual(result, allocateCentsByWeights(amount, weights.toReversed()));
    assert.equal(result.reduce((sum, row) => sum + BigInt(row.valueCents), 0n), BigInt(amount));
    assert.deepEqual(result.map(({ key }) => key), ["A", "B", "C"]);
    assert.ok(result.every(({ valueCents }) => Number.isSafeInteger(valueCents)));
  }
  assert.deepEqual(calculateAllocation([]).assetClass.buckets, []);
  const zero = calculateAllocation([source("zero", 0, { assetClassExposures: [], geographyExposures: [], securityExposures: [] })]);
  assert.deepEqual(zero.assetClass.buckets, [{ key: "UNKNOWN", valueCents: 0, allocationBps: 0 }]);
  const combined = calculateDimensionAllocation([source("z", 1, { geographyExposures: [slice("SG", 10_000)] }), source("a", 2, { geographyExposures: [slice("SG", 10_000)] })], "GEOGRAPHY");
  assert.deepEqual(combined.buckets, [{ key: "SG", valueCents: 3, allocationBps: 10_000 }]);
  assert.equal(combined.unknownValueCents, 0);
  assert.deepEqual(combined.sourceAllocations.map(({ sourceId }) => sourceId), ["a", "z"]);
});

test("exposure weights reject invalid identifiers, amounts, fractions, duplicates and nonconserving totals", () => {
  for (const key of ["", " padded ", 1]) rejectsCalculation(() => allocateCentsByWeights(100, [slice(key, 10_000)]), AllocationValidationError, "INVALID_WEIGHT", "slices[0].key");
  for (const weight of [0, -1, 10_001, 0.5, NaN]) rejectsCalculation(() => allocateCentsByWeights(100, [slice("fund", weight)]), AllocationValidationError, "INVALID_WEIGHT", "slices[0].weightBps");
  for (const amount of [0.1, NaN, max + 1]) rejectsCalculation(() => allocateCentsByWeights(amount, [slice("fund", 10_000)]), AllocationValidationError, "INVALID_CENTS", "totalValueCents");
  rejectsCalculation(() => allocateCentsByWeights(1, []), AllocationValidationError, "WEIGHTS_NOT_10000_BPS", "slices");
  rejectsCalculation(() => allocateCentsByWeights(1, [slice("fund", 5_000)]), AllocationValidationError, "WEIGHTS_NOT_10000_BPS", "slices");
  rejectsCalculation(() => allocateCentsByWeights(1, [slice("fund", 5_000), slice("fund", 5_000)]), AllocationValidationError, "DUPLICATE_KEY", "slices[1].key");
});

test("allocation and liquidity reject duplicate or invalid sources and aggregate overflow before returning money", () => {
  for (const id of ["", " padded ", 5]) rejectsCalculation(() => calculateAllocation([source(id)]), AllocationValidationError, "INVALID_SOURCE", "sources[0].id");
  for (const amount of [-1, 1.5]) rejectsCalculation(() => calculateAllocation([source("bad", amount)]), AllocationValidationError, "INVALID_CENTS", "sources[0].valueCents");
  rejectsCalculation(() => calculateAllocation([source("same"), source("same")]), AllocationValidationError, "DUPLICATE_SOURCE", "sources[1].id");
  rejectsCalculation(() => calculateAllocation([source("large", max), source("one", 1)]), AllocationValidationError, "RESULT_OUT_OF_RANGE", "totalValueCents");
  for (const id of ["", 5]) rejectsCalculation(() => calculateLiquidityTotals([source(id)]), AllocationValidationError, "INVALID_SOURCE", "sources[0].id");
  rejectsCalculation(() => calculateLiquidityTotals([source("same"), source("same")]), AllocationValidationError, "DUPLICATE_SOURCE", "sources[1].id");
  rejectsCalculation(() => calculateLiquidityTotals([source("negative", -1)]), AllocationValidationError, "INVALID_CENTS", "sources[0].valueCents");
  rejectsCalculation(() => calculateLiquidityTotals([source("unsupported", 1, { liquidityClass: "INSTANT" })]), AllocationValidationError, "INVALID_SOURCE", "sources[0].liquidityClass");
  rejectsCalculation(() => calculateLiquidityTotals([source("large", max), source("one", 1)]), AllocationValidationError, "RESULT_OUT_OF_RANGE", "totalValueCents");
});

test("cashflow annualization accepts zero but rejects unsafe, negative and unsupported amounts or cadences", () => {
  assert.equal(annualizeRecurringAmount(0, "ANNUAL"), 0);
  for (const amount of [-1, 1.5, NaN, max + 1]) rejectsCalculation(() => annualizeRecurringAmount(amount, "ANNUAL"), CashflowValidationError, "INVALID_AMOUNT", "amountCents");
  rejectsCalculation(() => annualizeRecurringAmount(1, "DAILY"), CashflowValidationError, "INVALID_CADENCE", "cadence");
  rejectsCalculation(() => annualizeRecurringAmount(max, "MONTHLY"), CashflowValidationError, "RESULT_OUT_OF_RANGE", "annualizedCents");
  assert.equal(annualizeRecurringFlow(flow()), 1_200);
});

test("recurring flows reject invalid identities, source relationships and calendar ranges", () => {
  const invalid = [
    [{ id: "" }, "INVALID_FLOW", "id"], [{ id: " padded " }, "INVALID_FLOW", "id"], [{ id: 1 }, "INVALID_FLOW", "id"],
    [{ type: "UNKNOWN" }, "INVALID_FLOW", "type"], [{ amountCents: 0 }, "INVALID_AMOUNT", "amountCents"], [{ amountCents: 1.5 }, "INVALID_AMOUNT", "amountCents"],
    [{ cadence: "DAILY" }, "INVALID_CADENCE", "cadence"], [{ includeInRetirementProjection: null }, "INVALID_FLOW", "includeInRetirementProjection"],
    [{ sourceAccountId: "bank", sourceInvestmentId: "fund" }, "INVALID_FLOW", "sourceInvestmentId"],
    [{ type: "INTERNAL_REALLOCATION", sourceInvestmentId: "fund", destinationInvestmentId: "fund" }, "INVALID_FLOW", "destinationInvestmentId"],
    [{ sourceAccountId: "bank" }, "INVALID_FLOW", "type"],
    [{ type: "INTERNAL_REALLOCATION", destinationInvestmentId: "fund" }, "INVALID_FLOW", "type"],
    [{ type: "INTERNAL_REALLOCATION", sourceInvestmentId: "fund" }, "INVALID_FLOW", "type"],
    [{ type: "EXTERNAL_WITHDRAWAL", sourceInvestmentId: "fund", destinationInvestmentId: "second" }, "INVALID_FLOW", "type"],
    [{ startDate: "invalid" }, "INVALID_DATE", "startDate"], [{ startDate: "2026-02-30" }, "INVALID_DATE", "startDate"],
  ];
  for (const [input, code, field] of invalid) rejectsCalculation(() => annualizeRecurringFlow(flow(input)), CashflowValidationError, code, `flow.${field}`);
  rejectsCalculation(() => annualizeRecurringFlow(flow({ startDate: "2026-02-02", endDate: "2026-02-01" })), CashflowValidationError, "INVALID_DATE_RANGE", "flow");
  rejectsCalculation(() => summarizeRecurringFlows([flow(), flow()], "2026-10-09"), CashflowValidationError, "INVALID_FLOW", "flows[1].id");
});

test("recurring activity includes boundary dates, omits ended flows, and does not count internal transfers as new wealth", () => {
  const dated = flow({ startDate: new Date("2026-01-01"), endDate: "2026-10-09T00:00:00Z" });
  assert.equal(isRecurringFlowActiveAsOf(dated, "2026-01-01"), true);
  assert.equal(isRecurringFlowActiveAsOf(dated, "2026-10-09"), true);
  assert.equal(isRecurringFlowActiveAsOf(dated, "2025-12-31"), false);
  assert.equal(isRecurringFlowActiveAsOf(dated, "2026-10-10"), false);
  const entries = [
    flow({ id: "withdrawal", type: "EXTERNAL_WITHDRAWAL", sourceInvestmentId: "fund", includeInRetirementProjection: false }),
    flow({ id: "transfer", type: "INTERNAL_REALLOCATION", sourceAccountId: "bank", destinationInvestmentId: "fund", label: "Move cash" }),
    flow({ id: "ended", endDate: "2026-01-01" }), flow({ id: "contribution" }),
  ];
  const result = summarizeRecurringFlows(entries, new Date("2026-10-09"));
  assert.deepEqual(result, summarizeRecurringFlows(entries.toReversed(), { asOfDate: "2026-10-09" }));
  assert.equal(result.annualExternalContributionCents, 0);
  assert.equal(result.annualInternalReallocationCents, 1_200);
  assert.equal(result.retirementAnnualExternalContributionCents, 1_200);
  assert.deepEqual(result.sourceBreakdown.map(({ id, active, newWealthImpactCents }) => [id, active, newWealthImpactCents]), [["contribution", true, 1_200], ["ended", false, 1_200], ["transfer", true, 0], ["withdrawal", true, -1_200]]);
  assert.equal(result.sourceBreakdown[2].sourceAccountId, "bank");
  assert.equal(result.sourceBreakdown[2].label, "Move cash");
  assert.equal(result.sourceBreakdown[3].sourceInvestmentId, "fund");
  for (const input of [null, undefined, {}, "2026-02-30", new Date(NaN)]) rejectsCalculation(() => summarizeRecurringFlows([], input), CashflowValidationError, "INVALID_DATE", "asOfDate");
  rejectsCalculation(() => summarizeRecurringFlows([flow({ amountCents: max, cadence: "ANNUAL" }), flow({ id: "second", amountCents: max, cadence: "ANNUAL" })], "2026-01-01"), CashflowValidationError, "RESULT_OUT_OF_RANGE", "active.externalContributionCents");
});

test("emergency runway rejects impossible inputs and overflow without confusing zero expenses with missing setup", () => {
  for (const available of [-1, 0.1]) rejectsCalculation(() => calculateEmergencyRunway(available, 1), CashflowValidationError, "INVALID_AMOUNT", "availableLiquidityCents");
  for (const expense of [-1, 0.1]) rejectsCalculation(() => calculateEmergencyRunway(1, expense), CashflowValidationError, "INVALID_AMOUNT", "essentialMonthlyExpenseCents");
  rejectsCalculation(() => calculateEmergencyRunway(max, 1), CashflowValidationError, "RESULT_OUT_OF_RANGE", "runwayMonthsBps");
  assert.equal(calculateEmergencyRunway(0, undefined).configured, false);
  assert.equal(calculateEmergencyRunway(0, 0).configured, true);
  assert.equal(calculateEmergencyRunway(0, 1).runwayMonthsBps, 0);
});

test("retirement arithmetic rounds half cents symmetrically and rounds required funds upward", () => {
  assert.equal(applyRateBpsToCents(1, 5_000), 2);
  assert.equal(applyRateBpsToCents(-1, 5_000), -2);
  assert.equal(applyRateBpsToCents(100, -10_000), 0);
  assert.equal(calculateRetirementTargetFundCents(1, 3_333), 37);
  assert.equal(calculateSustainableMonthlyIncomeCents(150, 400), 1);
  assert.equal(calculateSustainableMonthlyIncomeCents(0, 400), 0);
  for (const amount of [max, -max]) rejectsCalculation(() => applyRateBpsToCents(amount, 100_000), RetirementProjectionValidationError, "RESULT_OUT_OF_RANGE", "resultCents");
  rejectsCalculation(() => calculateRetirementTargetFundCents(max, 1), RetirementProjectionValidationError, "RESULT_OUT_OF_RANGE", "targetFundCents");
});

test("retirement calculations reject missing, malformed and out-of-range assumptions with field-specific errors", () => {
  const invalid = [
    [{ asOfDate: undefined }, "MISSING_INPUT", "asOfDate"], [{ asOfDate: null }, "MISSING_INPUT", "asOfDate"],
    [{ asOfDate: "invalid" }, "INVALID_DATE", "asOfDate"], [{ asOfDate: "2026-02-30" }, "INVALID_DATE", "asOfDate"],
    [{ currentRetirementAssetsCents: null }, "MISSING_INPUT", "currentRetirementAssetsCents"],
    [{ currentRetirementAssetsCents: "100" }, "INVALID_AMOUNT", "currentRetirementAssetsCents"],
    [{ currentRetirementAssetsCents: 1.5 }, "INVALID_AMOUNT", "currentRetirementAssetsCents"],
    [{ currentRetirementAssetsCents: -1 }, "INVALID_AMOUNT", "currentRetirementAssetsCents"],
    [{ annualExternalContributionCents: undefined }, "MISSING_INPUT", "annualExternalContributionCents"],
    [{ bearReturnBps: undefined }, "MISSING_INPUT", "bearReturnBps"], [{ bearReturnBps: null }, "MISSING_INPUT", "bearReturnBps"],
    [{ bearReturnBps: "1" }, "INVALID_RATE", "bearReturnBps"], [{ bearReturnBps: 1.5 }, "INVALID_RATE", "bearReturnBps"],
    [{ bearReturnBps: -10_001 }, "INVALID_RATE", "bearReturnBps"], [{ bearReturnBps: 100_001 }, "INVALID_RATE", "bearReturnBps"],
    [{ bearReturnBps: 1 }, "INVALID_RATE", "bearReturnBps"], [{ bullReturnBps: -1 }, "INVALID_RATE", "bearReturnBps"],
    [{ inflationBps: -10_000 }, "INVALID_RATE", "inflationBps"], [{ sustainableWithdrawalRateBps: 0 }, "INVALID_RATE", "sustainableWithdrawalRateBps"],
  ];
  for (const [input, code, field] of invalid) rejectsCalculation(() => projectRetirement(projection(input)), RetirementProjectionValidationError, code, field);
  assert.throws(() => applyRateBpsToCents(100, -10_001), /at least -10000/);
  assert.throws(() => calculateRetirementTargetFundCents(100, 0), /greater than 0/);
});

test("retirement horizon selection handles birth dates, current ages, leap anniversaries and explicit target priority", () => {
  const birth = projectRetirement(projection({ asOfDate: new Date("2024-02-29"), primaryBirthDate: new Date("2000-02-29"), targetRetirementAge: 25, yearsToRetirement: null }));
  assert.equal(birth.assumptions.horizonSource, "BIRTH_DATE_AND_TARGET_AGE");
  assert.equal(birth.assumptions.resolvedTargetRetirementDate, "2025-02-28");
  const aged = projectRetirement(projection({ yearsToRetirement: undefined, currentAge: 64, targetRetirementAge: 65 }));
  assert.equal(aged.assumptions.horizonSource, "CURRENT_AND_TARGET_AGE");
  assert.equal(aged.assumptions.projectionYears, 1);
  const explicit = projectRetirement(projection({ targetRetirementDate: "2028-07-01", yearsToRetirement: 20 }));
  assert.equal(explicit.assumptions.horizonSource, "TARGET_DATE");
  assert.equal(explicit.assumptions.projectionYears, 3);
  assert.equal(explicit.scenarios.base.points.at(-1).date, "2028-07-01");
  assert.equal(explicit.scenarios.base.points.at(-1).contributionCents, 0);
});

test("retirement horizons reject future birth dates, expired targets, invalid ages and unsupported lengths", () => {
  const invalid = [
    [{ primaryBirthDate: "2027-01-01" }, "INVALID_HORIZON", "primaryBirthDate"],
    [{ targetRetirementDate: "2026-01-01" }, "INVALID_HORIZON", "targetRetirementDate"],
    [{ targetRetirementDate: "invalid" }, "INVALID_DATE", "targetRetirementDate"],
    [{ yearsToRetirement: 0 }, "INVALID_HORIZON", "yearsToRetirement"], [{ yearsToRetirement: 101 }, "HORIZON_TOO_LONG", "yearsToRetirement"],
    [{ yearsToRetirement: null }, "MISSING_INPUT", "targetRetirementDate"],
    [{ yearsToRetirement: null, targetRetirementAge: 65 }, "MISSING_INPUT", "primaryBirthDate"],
    [{ yearsToRetirement: null, currentAge: 50 }, "MISSING_INPUT", "targetRetirementAge"],
    [{ yearsToRetirement: null, currentAge: -1, targetRetirementAge: 65 }, "INVALID_HORIZON", "currentAge"],
    [{ yearsToRetirement: null, currentAge: 151, targetRetirementAge: 65 }, "INVALID_HORIZON", "currentAge"],
    [{ primaryBirthDate: "2000-01-01", targetRetirementAge: null }, "MISSING_INPUT", "targetRetirementAge"],
  ];
  for (const [input, code, field] of invalid) rejectsCalculation(() => projectRetirement(projection(input)), RetirementProjectionValidationError, code, field);
});

test("retirement projections clamp depleted funds to zero, separate surplus from shortfall and reject compounding overflow", () => {
  const depleted = projectRetirement(projection({ annualExternalContributionCents: -110_000, contributionGrowthBps: 100, yearsToRetirement: 2 }));
  assert.deepEqual(depleted.scenarios.base.points.map(({ nominalValueCents }) => nominalValueCents), [100_000, 0, 0]);
  assert.equal(depleted.scenarios.base.outcome.nominalTargetGapCents, 30_000);
  assert.equal(depleted.scenarios.base.outcome.nominalTargetSurplusCents, 0);
  const surplus = projectRetirement(projection({ annualExternalContributionCents: 0 }));
  assert.equal(surplus.scenarios.base.outcome.nominalTargetGapCents, 0);
  assert.equal(surplus.scenarios.base.outcome.nominalTargetSurplusCents, 70_000);
  assert.equal(surplus.scenarios.base.outcome.realTargetGapCents, 0);
  assert.equal(surplus.scenarios.base.outcome.realTargetSurplusCents, 70_000);
  rejectsCalculation(() => projectRetirement(projection({ currentRetirementAssetsCents: max, annualExternalContributionCents: 1 })), RetirementProjectionValidationError, "RESULT_OUT_OF_RANGE", "points[1].nominalValueCents");
});
