import assert from "node:assert/strict";
import test from "node:test";

import {
  AllocationValidationError,
  allocateBigIntCentsByWeights,
  allocateCentsByWeights,
  calculateAllocation,
  calculateLiquidityTotals,
} from "../lib/domains/cio/allocation-engine.ts";
import {
  CashflowValidationError,
  annualizeRecurringAmount,
  calculateEmergencyRunway,
  summarizeRecurringFlows,
} from "../lib/domains/cio/cashflow-engine.ts";
import {
  RetirementProjectionValidationError,
  calculateRetirementTargetFundCents,
  projectRetirement,
} from "../lib/domains/cio/retirement-projection.ts";

test("largest-remainder exposure allocation preserves every cent with a stable key tie-break", () => {
  const forward = allocateCentsByWeights(101, [
    { key: "B", weightBps: 5_000 },
    { key: "A", weightBps: 5_000 },
  ]);
  const reverse = allocateCentsByWeights(101, [
    { key: "A", weightBps: 5_000 },
    { key: "B", weightBps: 5_000 },
  ]);

  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    forward.map(({ key, valueCents }) => [key, valueCents]),
    [
      ["A", 51],
      ["B", 50],
    ],
  );
  assert.equal(forward.reduce((sum, slice) => sum + slice.valueCents, 0), 101);

  const large = allocateBigIntCentsByWeights(9_007_199_254_740_993n, [
    { key: "A", weightBps: 3_333 },
    { key: "B", weightBps: 3_333 },
    { key: "C", weightBps: 3_334 },
  ]);
  assert.equal(large.reduce((sum, slice) => sum + slice.valueCents, 0n), 9_007_199_254_740_993n);
});

test("allocation includes every missing dimension under UNKNOWN and returns exact cents and bps", () => {
  const result = calculateAllocation([
    {
      id: "configured",
      valueCents: 101,
      assetClassExposures: [
        { key: "EQUITY", weightBps: 5_000 },
        { key: "FIXED_INCOME", weightBps: 5_000 },
      ],
    },
    { id: "unclassified", valueCents: 99 },
  ]);

  assert.equal(result.totalValueCents, 200);
  assert.equal(result.assetClass.totalValueCents, 200);
  assert.equal(result.assetClass.unknownValueCents, 99);
  assert.deepEqual(
    result.assetClass.buckets.map(({ key, valueCents, allocationBps }) => [
      key,
      valueCents,
      allocationBps,
    ]),
    [
      ["EQUITY", 51, 2_550],
      ["FIXED_INCOME", 50, 2_500],
      ["UNKNOWN", 99, 4_950],
    ],
  );
  assert.equal(
    result.assetClass.buckets.reduce((sum, bucket) => sum + bucket.valueCents, 0),
    result.totalValueCents,
  );
  assert.equal(
    result.assetClass.buckets.reduce((sum, bucket) => sum + bucket.allocationBps, 0),
    10_000,
  );
  assert.deepEqual(result.geography.buckets, [
    { key: "UNKNOWN", valueCents: 200, allocationBps: 10_000 },
  ]);
  assert.deepEqual(result.security.buckets, [
    { key: "UNKNOWN", valueCents: 200, allocationBps: 10_000 },
  ]);
});

test("exposure weights must be unique integers totaling exactly 10,000 bps", () => {
  assert.throws(
    () =>
      allocateCentsByWeights(100, [
        { key: "EQUITY", weightBps: 6_000 },
        { key: "CASH", weightBps: 3_999 },
      ]),
    (error) =>
      error instanceof AllocationValidationError && error.code === "WEIGHTS_NOT_10000_BPS",
  );
  assert.throws(
    () =>
      allocateCentsByWeights(100, [
        { key: "EQUITY", weightBps: 5_000 },
        { key: "EQUITY", weightBps: 5_000 },
      ]),
    (error) => error instanceof AllocationValidationError && error.code === "DUPLICATE_KEY",
  );
});

test("liquidity totals retain immediate, liquid, restricted, locked, and unknown values", () => {
  assert.deepEqual(
    calculateLiquidityTotals([
      { id: "bank", valueCents: 100, liquidityClass: "IMMEDIATE" },
      { id: "fund", valueCents: 200, liquidityClass: "LIQUID" },
      { id: "pension", valueCents: 300, liquidityClass: "RESTRICTED" },
      { id: "term", valueCents: 400, liquidityClass: "LOCKED" },
      { id: "unclassified", valueCents: 50 },
    ]),
    {
      totalValueCents: 1_050,
      immediateValueCents: 100,
      liquidValueCents: 200,
      restrictedValueCents: 300,
      lockedValueCents: 400,
      unknownValueCents: 50,
      accessibleValueCents: 300,
    },
  );
});

test("every recurring cadence annualizes with integer-cent multipliers", () => {
  assert.equal(annualizeRecurringAmount(123, "WEEKLY"), 6_396);
  assert.equal(annualizeRecurringAmount(123, "MONTHLY"), 1_476);
  assert.equal(annualizeRecurringAmount(123, "QUARTERLY"), 492);
  assert.equal(annualizeRecurringAmount(123, "ANNUAL"), 123);
});

test("cashflow summary counts active external wealth, subtracts withdrawals, and separates reallocations", () => {
  const result = summarizeRecurringFlows(
    [
      {
        id: "salary-saving",
        label: "Weekly saving",
        type: "EXTERNAL_CONTRIBUTION",
        amountCents: 100,
        cadence: "WEEKLY",
        startDate: "2026-01-01",
        includeInRetirementProjection: true,
      },
      {
        id: "portfolio-transfer",
        type: "INTERNAL_REALLOCATION",
        sourceInvestmentId: "broker-source",
        destinationInvestmentId: "broker-destination",
        amountCents: 200,
        cadence: "MONTHLY",
        includeInRetirementProjection: true,
      },
      {
        id: "planned-withdrawal",
        type: "EXTERNAL_WITHDRAWAL",
        amountCents: 300,
        cadence: "QUARTERLY",
        endDate: "2026-07-30",
        includeInRetirementProjection: false,
      },
      {
        id: "future-contribution",
        type: "EXTERNAL_CONTRIBUTION",
        amountCents: 999,
        cadence: "ANNUAL",
        startDate: "2026-07-31",
        includeInRetirementProjection: true,
      },
    ],
    { asOfDate: "2026-07-30" },
  );

  assert.deepEqual(result.active, {
    flowCount: 3,
    externalContributionCents: 5_200,
    externalWithdrawalCents: 1_200,
    netExternalContributionCents: 4_000,
    internalReallocationCents: 2_400,
  });
  assert.deepEqual(result.retirementEligible, {
    flowCount: 2,
    externalContributionCents: 5_200,
    externalWithdrawalCents: 0,
    netExternalContributionCents: 5_200,
    internalReallocationCents: 2_400,
  });
  assert.equal(result.annualExternalContributionCents, 4_000);
  assert.equal(result.annualInternalReallocationCents, 2_400);
  assert.equal(
    result.sourceBreakdown.find((flow) => flow.id === "portfolio-transfer").newWealthImpactCents,
    0,
  );
  assert.equal(
    result.sourceBreakdown.find((flow) => flow.id === "future-contribution").active,
    false,
  );
});

test("cashflow validation rejects invalid ranges and emergency runway stays absent without expenses", () => {
  assert.throws(
    () =>
      summarizeRecurringFlows(
        [
          {
            id: "bad-range",
            type: "EXTERNAL_CONTRIBUTION",
            amountCents: 1,
            cadence: "ANNUAL",
            startDate: "2027-01-01",
            endDate: "2026-01-01",
            includeInRetirementProjection: true,
          },
        ],
        "2026-07-30",
      ),
    (error) => error instanceof CashflowValidationError && error.code === "INVALID_DATE_RANGE",
  );
  for (const invalidReferences of [
    {
      sourceAccountId: "bank-1",
      sourceInvestmentId: "investment-1",
      destinationInvestmentId: "investment-2",
    },
    {
      sourceInvestmentId: "investment-1",
      destinationInvestmentId: "investment-1",
    },
  ]) {
    assert.throws(
      () => summarizeRecurringFlows([{
        id: "invalid-transfer",
        type: "INTERNAL_REALLOCATION",
        amountCents: 1,
        cadence: "ANNUAL",
        includeInRetirementProjection: false,
        ...invalidReferences,
      }], "2026-07-30"),
      (error) => error instanceof CashflowValidationError && error.code === "INVALID_FLOW",
    );
  }

  assert.deepEqual(calculateEmergencyRunway(25_000, null), {
    availableLiquidityCents: 25_000,
    essentialMonthlyExpenseCents: null,
    configured: false,
    wholeMonths: null,
    remainderCents: null,
    runwayMonthsBps: null,
  });
  assert.deepEqual(calculateEmergencyRunway(25_000, 0), {
    availableLiquidityCents: 25_000,
    essentialMonthlyExpenseCents: 0,
    configured: true,
    wholeMonths: null,
    remainderCents: null,
    runwayMonthsBps: null,
  });
  assert.deepEqual(calculateEmergencyRunway(25_000, 4_000), {
    availableLiquidityCents: 25_000,
    essentialMonthlyExpenseCents: 4_000,
    configured: true,
    wholeMonths: 6,
    remainderCents: 1_000,
    runwayMonthsBps: 62_500,
  });
});

function projectionInput(overrides = {}) {
  return {
    asOfDate: "2026-07-30",
    currentRetirementAssetsCents: 100_000,
    annualExternalContributionCents: 10_000,
    contributionGrowthBps: 0,
    bearReturnBps: 0,
    baseReturnBps: 0,
    bullReturnBps: 0,
    inflationBps: 0,
    targetMonthlyRetirementSpendingCents: 1_000,
    sustainableWithdrawalRateBps: 400,
    yearsToRetirement: 2,
    ...overrides,
  };
}

test("retirement projection uses end-of-year contributions and echoes fixed-point assumptions", () => {
  const result = projectRetirement(projectionInput());
  assert.deepEqual(
    result.scenarios.base.points.map((point) => point.nominalValueCents),
    [100_000, 110_000, 120_000],
  );
  assert.deepEqual(
    result.scenarios.base.points.map((point) => point.realValueCents),
    [100_000, 110_000, 120_000],
  );
  assert.deepEqual(
    result.scenarios.base.points.map((point) => point.contributionCents),
    [0, 10_000, 10_000],
  );
  assert.equal(result.assumptions.contributionTiming, "END_OF_YEAR");
  assert.equal(result.assumptions.projectionYears, 2);
  assert.equal(result.assumptions.horizonSource, "YEARS_TO_RETIREMENT");
  assert.equal(result.target.realFundCents, 300_000);
  assert.deepEqual(result.scenarios.base.outcome, {
    nominalFundCents: 120_000,
    realFundCents: 120_000,
    nominalSustainableMonthlyIncomeCents: 400,
    realSustainableMonthlyIncomeCents: 400,
    nominalTargetGapCents: 180_000,
    nominalTargetSurplusCents: 0,
    realTargetGapCents: 180_000,
    realTargetSurplusCents: 0,
  });
});

test("bear, base, and bull projections compound with BigInt and expose nominal versus real values", () => {
  const result = projectRetirement(
    projectionInput({
      annualExternalContributionCents: 0,
      bearReturnBps: 0,
      baseReturnBps: 1_000,
      bullReturnBps: 2_000,
      inflationBps: 1_000,
    }),
  );

  assert.equal(result.scenarios.bear.outcome.nominalFundCents, 100_000);
  assert.equal(result.scenarios.base.outcome.nominalFundCents, 121_000);
  assert.equal(result.scenarios.bull.outcome.nominalFundCents, 144_000);
  assert.equal(result.scenarios.base.outcome.realFundCents, 100_000);
  assert.equal(result.target.realFundCents, 300_000);
  assert.equal(result.target.nominalFundAtRetirementCents, 363_000);
});

test("extra and growing contributions change the projection without floating-point money arithmetic", () => {
  const noContribution = projectRetirement(
    projectionInput({ annualExternalContributionCents: 0 }),
  );
  const extraContribution = projectRetirement(
    projectionInput({ contributionGrowthBps: 1_000 }),
  );

  assert.equal(noContribution.scenarios.base.outcome.nominalFundCents, 100_000);
  assert.equal(extraContribution.scenarios.base.outcome.nominalFundCents, 121_000);
  assert.deepEqual(
    extraContribution.scenarios.base.points.map((point) => point.contributionCents),
    [0, 10_000, 11_000],
  );
  assert.equal(calculateRetirementTargetFundCents(1_000, 400), 300_000);
});

test("a fractional final retirement period prorates rates and does not add a full annual contribution", () => {
  const result = projectRetirement(projectionInput({
    yearsToRetirement: null,
    targetRetirementDate: "2027-01-30",
    bearReturnBps: 1_000,
    baseReturnBps: 1_000,
    bullReturnBps: 1_000,
    inflationBps: 1_000,
  }));

  assert.equal(result.assumptions.finalPeriodFractionBps, 5_041);
  assert.equal(result.assumptions.horizonRounding, "FULL_YEARS_PLUS_PRORATED_FINAL_PERIOD");
  assert.deepEqual(
    result.scenarios.base.points.map((point) => point.contributionCents),
    [0, 0],
  );
  assert.equal(result.scenarios.base.outcome.nominalFundCents, 105_040);
  assert.equal(result.scenarios.base.outcome.realFundCents, 100_000);
});

test("retirement projection rejects missing assumptions and horizons beyond 100 years with typed errors", () => {
  assert.throws(
    () => projectRetirement(projectionInput({ bearReturnBps: undefined })),
    (error) =>
      error instanceof RetirementProjectionValidationError && error.code === "MISSING_INPUT",
  );
  assert.throws(
    () => projectRetirement(projectionInput({ yearsToRetirement: 101 })),
    (error) =>
      error instanceof RetirementProjectionValidationError && error.code === "HORIZON_TOO_LONG",
  );
  assert.throws(
    () =>
      projectRetirement(
        projectionInput({
          yearsToRetirement: null,
          targetRetirementDate: "2026-07-29",
        }),
      ),
    (error) =>
      error instanceof RetirementProjectionValidationError && error.code === "INVALID_HORIZON",
  );
  assert.throws(
    () => projectRetirement(projectionInput({
      yearsToRetirement: null,
      primaryBirthDate: "2027-01-01",
      targetRetirementAge: 65,
    })),
    (error) =>
      error instanceof RetirementProjectionValidationError && error.field === "primaryBirthDate",
  );
});
