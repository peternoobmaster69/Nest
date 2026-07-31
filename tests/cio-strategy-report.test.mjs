import assert from "node:assert/strict";
import test from "node:test";
import { projectRetirement } from "../lib/domains/cio/retirement-projection.ts";
import {
  buildCioStrategyRecommendations,
  solveRequiredAnnualRetirementContributionCents,
} from "../lib/domains/cio/strategy-recommendations.ts";
import { composeCioStrategyReportModel } from "../lib/domains/cio/strategy-report-service.ts";
import { renderCioStrategyReportPdf } from "../lib/domains/cio/strategy-report-pdf.tsx";

function retirementStatus() {
  const result = projectRetirement({
    asOfDate: "2026-07-30",
    targetRetirementDate: "2046-07-30",
    currentRetirementAssetsCents: 37_151_300,
    annualExternalContributionCents: 4_052_000,
    contributionGrowthBps: 0,
    bearReturnBps: 400,
    baseReturnBps: 600,
    bullReturnBps: 800,
    inflationBps: 250,
    targetMonthlyRetirementSpendingCents: 700_000,
    sustainableWithdrawalRateBps: 300,
  });
  return {
    status: "READY",
    missingFields: [],
    projection: {
      assumptions: {
        asOfDate: result.assumptions.asOfDate,
        retirementDate: result.assumptions.resolvedTargetRetirementDate,
        horizonYears: result.assumptions.projectionYears,
        currentRetirementAssetsCents: result.assumptions.currentRetirementAssetsCents,
        annualExternalContributionCents: result.assumptions.annualExternalContributionCents,
        contributionGrowthRateBps: result.assumptions.contributionGrowthBps,
        inflationRateBps: result.assumptions.inflationBps,
        bearReturnBps: result.assumptions.bearReturnBps,
        baseReturnBps: result.assumptions.baseReturnBps,
        bullReturnBps: result.assumptions.bullReturnBps,
        targetMonthlySpendingTodayCents: result.assumptions.targetMonthlyRetirementSpendingCents,
        sustainableWithdrawalRateBps: result.assumptions.sustainableWithdrawalRateBps,
        contributionTiming: "END_OF_YEAR",
        finalPeriodFractionBps: result.assumptions.finalPeriodFractionBps,
        horizonRounding: result.assumptions.horizonRounding,
      },
      scenarios: ["bear", "base", "bull"].map((key) => {
        const scenario = result.scenarios[key];
        return {
          scenario: key.toUpperCase(),
          nominalReturnBps: scenario.nominalReturnBps,
          points: [],
          fundAtRetirementNominalCents: scenario.outcome.nominalFundCents,
          fundAtRetirementRealCents: scenario.outcome.realFundCents,
          sustainableMonthlyIncomeNominalCents: scenario.outcome.nominalSustainableMonthlyIncomeCents,
          sustainableMonthlyIncomeRealCents: scenario.outcome.realSustainableMonthlyIncomeCents,
          targetFundNominalCents: result.target.nominalFundAtRetirementCents,
          targetFundRealCents: result.target.realFundCents,
          targetGapOrSurplusNominalCents: scenario.outcome.nominalTargetSurplusCents - scenario.outcome.nominalTargetGapCents,
          targetGapOrSurplusRealCents: scenario.outcome.realTargetSurplusCents - scenario.outcome.realTargetGapCents,
        };
      }),
    },
  };
}

function snapshot() {
  return {
    asOfDate: "2026-07-30",
    baseCurrency: "SGD",
    totals: {
      bankControlCents: 1_000_000,
      savingsSubAccountCents: 1_000_000,
      investmentCurrentValueCents: 37_151_300,
      financialAssetsCents: 38_151_300,
      planningPositionAssetsCents: 61_200_000,
      planningLiabilitiesCents: 25_000_000,
      planningNetWorthCents: 74_351_300,
      investableAssetsCents: 37_151_300,
      retirementIncludedAssetsCents: 37_151_300,
    },
    liquidity: {
      immediateCents: 1_000_000,
      liquidCents: 2_000_000,
      restrictedCents: 12_000_000,
      lockedCents: 0,
      readilyAvailableCents: 3_000_000,
      essentialMonthlyExpenseCents: 800_000,
      emergencyRunwayMonths: 3.75,
    },
    allocation: {
      totalCents: 37_151_300,
      assetClasses: [
        { key: "EQUITY", valueCents: 29_721_040, allocationBps: 8_000, sourceCount: 1, isUnknown: false },
        { key: "FIXED_INCOME", valueCents: 3_715_130, allocationBps: 1_000, sourceCount: 1, isUnknown: false },
        { key: "CASH", valueCents: 3_715_130, allocationBps: 1_000, sourceCount: 1, isUnknown: false },
      ],
      geographies: [{ key: "GLOBAL", valueCents: 37_151_300, allocationBps: 10_000, sourceCount: 1, isUnknown: false }],
      securities: [{ key: "UNKNOWN", valueCents: 37_151_300, allocationBps: 10_000, sourceCount: 1, isUnknown: true }],
      securityBucketCount: 1,
      securitiesTruncated: false,
      omittedSecurityValueCents: 0,
      omittedSecurityAllocationBps: 0,
    },
    investments: [{
      id: "investment-1",
      latestValuationDate: "2026-07-29",
      investedCents: 30_000_000,
      currentValueCents: 37_151_300,
      valuationAgeDays: 1,
      isStale: false,
      liquidityClass: "LIQUID",
      liquiditySource: "CIO_PROFILE",
      portfolioRole: "CORE",
      includeInRetirementProjection: true,
      classificationStatus: "USER_CONFIRMED",
    }],
    recurringFlows: {
      externalContributionAnnualCents: 4_052_000,
      externalWithdrawalAnnualCents: 0,
      netExternalContributionAnnualCents: 4_052_000,
      internalReallocationAnnualCents: 2_600_000,
      retirementEligibleNetExternalAnnualCents: 4_052_000,
      breakdown: [],
    },
    annualContributions: {
      derivedExternalAnnualCents: 4_052_000,
      overrideExternalAnnualCents: null,
      usedExternalAnnualCents: 4_052_000,
      source: "DERIVED",
      internalReallocationAnnualCents: 2_600_000,
    },
    dataQuality: {
      completenessBps: 10_000,
      completenessPercentage: 100,
      latestValuationDate: "2026-07-29",
      oldestValuationDate: "2026-07-29",
      warnings: [],
    },
    policyExceptions: [],
    retirement: retirementStatus(),
    evidence: [{ id: "workspace-financial-assets", kind: "WORKSPACE", label: "Workspace financial assets", href: "/cio", asOfDate: "2026-07-30" }],
  };
}

const policy = {
  confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
  minimumLiquidityReserveCents: 4_000_000,
  minimumLiquidityMonths: 4,
  maximumAccountConcentrationBps: 5_000,
  maximumSingleSecurityConcentrationBps: 500,
  maximumSatelliteAllocationBps: 1_000,
  assetClassBands: [
    { assetClass: "EQUITY", minimumBps: 6_500, targetBps: 6_750, maximumBps: 7_000 },
    { assetClass: "FIXED_INCOME", minimumBps: 1_500, targetBps: 1_750, maximumBps: 2_000 },
    { assetClass: "CASH", minimumBps: 800, targetBps: 1_000, maximumBps: 1_200 },
  ],
  geographyLimits: [],
};

test("strategy recommendations prioritize liquidity, contribution-led allocation, and retirement sufficiency", () => {
  const current = snapshot();
  const recommendations = buildCioStrategyRecommendations({
    snapshot: current,
    policy: {
      confirmed: true,
      minimumLiquidityReserveCents: policy.minimumLiquidityReserveCents,
      minimumLiquidityMonths: policy.minimumLiquidityMonths,
      assetClassBands: policy.assetClassBands,
    },
    profile: { minimumImmediateBankCashCents: 1_500_000 },
  });
  const codes = recommendations.map((item) => item.code);

  assert.equal(codes[0], "REBUILD_IMMEDIATE_CASH");
  assert.ok(codes.includes("REBUILD_LIQUID_RESERVE"));
  assert.ok(codes.includes("PAUSE_NEW_CONTRIBUTIONS_TO_OVERWEIGHT_ASSET"));
  assert.ok(codes.includes("DIRECT_NEW_CONTRIBUTIONS_TO_UNDERWEIGHT_ASSET"));
  assert.ok(codes.includes("INCREASE_RETIREMENT_CONTRIBUTIONS"));
  assert.ok(recommendations.every((item) => item.requiresUserConfirmation));
  assert.ok(recommendations.every((item) => !/\b(?:buy|sell|order)\b/i.test(item.action)));
});

test("retirement contribution solver finds the minimum funded base-case contribution", () => {
  const assumptions = snapshot().retirement.projection.assumptions;
  const required = solveRequiredAnnualRetirementContributionCents(assumptions);
  assert.ok(required > assumptions.annualExternalContributionCents);

  const funded = projectRetirement({
    asOfDate: assumptions.asOfDate,
    targetRetirementDate: assumptions.retirementDate,
    currentRetirementAssetsCents: assumptions.currentRetirementAssetsCents,
    annualExternalContributionCents: required,
    contributionGrowthBps: assumptions.contributionGrowthRateBps,
    bearReturnBps: assumptions.bearReturnBps,
    baseReturnBps: assumptions.baseReturnBps,
    bullReturnBps: assumptions.bullReturnBps,
    inflationBps: assumptions.inflationRateBps,
    targetMonthlyRetirementSpendingCents: assumptions.targetMonthlySpendingTodayCents,
    sustainableWithdrawalRateBps: assumptions.sustainableWithdrawalRateBps,
  });
  assert.equal(funded.scenarios.base.outcome.realTargetGapCents, 0);
});

test("an unfunded retirement target is surfaced for review instead of appearing on track", () => {
  const current = snapshot();
  current.retirement.projection.assumptions = {
    ...current.retirement.projection.assumptions,
    retirementDate: "2027-07-30",
    horizonYears: 1,
    targetMonthlySpendingTodayCents: 2_147_483_647,
  };
  const recommendations = buildCioStrategyRecommendations({
    snapshot: current,
    policy: {
      confirmed: true,
      minimumLiquidityReserveCents: policy.minimumLiquidityReserveCents,
      minimumLiquidityMonths: policy.minimumLiquidityMonths,
      assetClassBands: policy.assetClassBands,
    },
    profile: { minimumImmediateBankCashCents: 1_500_000 },
  });

  assert.ok(recommendations.some((item) => item.code === "REVIEW_UNFUNDED_RETIREMENT_TARGET"));
});

test("report composition is deterministic, validated, and renders a PDF", async () => {
  const report = composeCioStrategyReportModel({
    snapshot: snapshot(),
    workspaceName: "Example Household",
    investments: [{ id: "investment-1", displayName: "Global Core", institutionName: "Example", productName: "Core Portfolio" }],
    policy,
    profile: { minimumImmediateBankCashCents: 1_500_000 },
    generatedAt: new Date("2026-07-30T10:00:00.000Z"),
  });

  assert.equal(report.title, "Example Household CIO Strategy");
  assert.equal(report.strategyStatus, "ACTION_REQUIRED");
  assert.equal(report.reviewByDate, "2027-01-30");
  assert.equal(report.investments[0].label, "Global Core");
  assert.ok(report.recommendations.length >= 5);

  const pdf = await renderCioStrategyReportPdf(report);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(pdf.byteLength > 10_000);
});
