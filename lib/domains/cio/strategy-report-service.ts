import { ApiRequestError } from "@/lib/api/contracts";
import { prisma } from "@/lib/prisma";
import { CIO_MAX_LIST_ITEMS } from "./contracts";
import { getCioPolicy, getCioProfile } from "./repository";
import {
  CioStrategyReportModelSchema,
  type CioStrategyReportModel,
} from "./report-types";
import { buildCioSnapshot } from "./snapshot-service";
import {
  buildCioStrategyRecommendations,
  type CioRecommendationPolicy,
  type CioRecommendationProfile,
  type CioStrategyRecommendation,
} from "./strategy-recommendations";
import type { CioSnapshot } from "./types";

type PolicyRecord = {
  confirmedAt: Date | null;
  minimumLiquidityReserveCents: number | null;
  minimumLiquidityMonths: number | null;
  maximumAccountConcentrationBps: number | null;
  maximumSingleSecurityConcentrationBps: number | null;
  maximumSatelliteAllocationBps: number | null;
  assetClassBands: readonly {
    assetClass: string;
    minimumBps: number;
    targetBps: number;
    maximumBps: number;
  }[];
  geographyLimits: readonly { geography: string; maximumBps: number }[];
};

type ProfileRecord = {
  minimumImmediateBankCashCents: number | null;
};

type ReportInvestment = {
  id: string;
  displayName: string | null;
  institutionName: string;
  productName: string;
};

function recommendationPolicy(policy: PolicyRecord | null): CioRecommendationPolicy | null {
  if (!policy) return null;
  return {
    confirmed: policy.confirmedAt !== null,
    minimumLiquidityReserveCents: policy.minimumLiquidityReserveCents,
    minimumLiquidityMonths: policy.minimumLiquidityMonths,
    assetClassBands: policy.assetClassBands,
  };
}

function recommendationProfile(profile: ProfileRecord | null): CioRecommendationProfile | null {
  return profile ? { minimumImmediateBankCashCents: profile.minimumImmediateBankCashCents } : null;
}

function addUtcMonths(date: Date, months: number) {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function strategyStatus(
  snapshot: CioSnapshot,
  recommendations: readonly CioStrategyRecommendation[],
) {
  const setupRequired = snapshot.dataQuality.completenessBps < 10_000
    || recommendations.some((item) => item.code === "CONFIRM_INVESTMENT_POLICY" || item.code === "COMPLETE_RETIREMENT_ASSUMPTIONS");
  if (setupRequired) return "SETUP_REQUIRED" as const;
  if (recommendations.some((item) => item.severity === "CRITICAL" || item.severity === "HIGH")) {
    return "ACTION_REQUIRED" as const;
  }
  return "ON_TRACK" as const;
}

function executiveStance(
  status: CioStrategyReportModel["strategyStatus"],
  recommendations: readonly CioStrategyRecommendation[],
) {
  const liquidity = recommendations.find((item) => item.category === "LIQUIDITY" && item.severity === "CRITICAL");
  if (liquidity) {
    return "Protect liquidity before adding portfolio risk. Restore the configured cash reserve, then resume long-term contribution priorities through the confirmed policy.";
  }
  if (status === "SETUP_REQUIRED") {
    return "The household planning foundation is not complete enough for high-conviction optimization. Finish the missing inputs and confirm policy guardrails before changing contribution direction.";
  }
  const retirement = recommendations.find((item) => item.code === "INCREASE_RETIREMENT_CONTRIBUTIONS");
  if (retirement) {
    return "The portfolio structure can remain disciplined, but the current retirement funding rate is below the configured base-case requirement. Contributions, timing, or spending must change.";
  }
  const allocation = recommendations.find((item) => item.category === "ALLOCATION" && item.severity === "HIGH");
  if (allocation) {
    return "Use new cash flows to move the portfolio back toward its confirmed strategic bands. An immediate sale is not required by this report.";
  }
  return "The recorded plan is broadly aligned with its confirmed guardrails. Preserve liquidity, maintain contribution discipline, and review the assumptions when household circumstances change.";
}

function reportPolicy(policy: PolicyRecord | null): CioStrategyReportModel["policy"] {
  return {
    confirmed: policy?.confirmedAt !== null && policy?.confirmedAt !== undefined,
    minimumLiquidityReserveCents: policy?.minimumLiquidityReserveCents ?? null,
    minimumLiquidityMonths: policy?.minimumLiquidityMonths ?? null,
    maximumAccountConcentrationBps: policy?.maximumAccountConcentrationBps ?? null,
    maximumSingleSecurityConcentrationBps: policy?.maximumSingleSecurityConcentrationBps ?? null,
    maximumSatelliteAllocationBps: policy?.maximumSatelliteAllocationBps ?? null,
    assetClassBands: policy?.assetClassBands.map((band) => ({
      assetClass: band.assetClass,
      minimumBps: band.minimumBps,
      targetBps: band.targetBps,
      maximumBps: band.maximumBps,
    })) ?? [],
    geographyLimits: policy?.geographyLimits.map((limit) => ({
      geography: limit.geography,
      maximumBps: limit.maximumBps,
    })) ?? [],
  };
}

function reportRetirement(
  snapshot: CioSnapshot,
  recommendations: readonly CioStrategyRecommendation[],
): CioStrategyReportModel["retirement"] {
  if (snapshot.retirement.status === "NOT_READY") {
    return {
      status: "NOT_READY",
      missingFields: snapshot.retirement.missingFields,
      retirementDate: null,
      targetMonthlySpendingCents: null,
      currentAnnualContributionCents: null,
      requiredAnnualContributionCents: null,
      inflationRateBps: null,
      sustainableWithdrawalRateBps: null,
      scenarios: [],
    };
  }
  const projection = snapshot.retirement.projection;
  const retirementRecommendation = recommendations.find((item) => (
    item.code === "INCREASE_RETIREMENT_CONTRIBUTIONS" || item.code === "MAINTAIN_RETIREMENT_CONTRIBUTIONS"
  ));
  return {
    status: "READY",
    missingFields: [],
    retirementDate: projection.assumptions.retirementDate,
    targetMonthlySpendingCents: projection.assumptions.targetMonthlySpendingTodayCents,
    currentAnnualContributionCents: projection.assumptions.annualExternalContributionCents,
    requiredAnnualContributionCents: retirementRecommendation?.target?.unit === "CENTS"
      ? retirementRecommendation.target.value
      : null,
    inflationRateBps: projection.assumptions.inflationRateBps,
    sustainableWithdrawalRateBps: projection.assumptions.sustainableWithdrawalRateBps,
    scenarios: projection.scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      nominalReturnBps: scenario.nominalReturnBps,
      fundAtRetirementRealCents: scenario.fundAtRetirementRealCents,
      sustainableMonthlyIncomeRealCents: scenario.sustainableMonthlyIncomeRealCents,
      targetFundRealCents: scenario.targetFundRealCents,
      targetGapOrSurplusRealCents: scenario.targetGapOrSurplusRealCents,
    })),
  };
}

export function composeCioStrategyReportModel(params: {
  snapshot: CioSnapshot;
  workspaceName: string;
  investments: readonly ReportInvestment[];
  policy: PolicyRecord | null;
  profile: ProfileRecord | null;
  generatedAt?: Date;
}) {
  const generatedAt = params.generatedAt ?? new Date();
  const recommendations = buildCioStrategyRecommendations({
    snapshot: params.snapshot,
    policy: recommendationPolicy(params.policy),
    profile: recommendationProfile(params.profile),
  });
  const status = strategyStatus(params.snapshot, recommendations);
  const investmentById = new Map(params.investments.map((item) => [item.id, item]));
  const keyMessages = recommendations.slice(0, 3).map((item) => item.action);
  if (!keyMessages.length) keyMessages.push("Continue monitoring the confirmed household investment policy and refresh the report when material inputs change.");

  const report: CioStrategyReportModel = {
    schemaVersion: "1.0",
    rendererVersion: "1.0",
    generatedAt: generatedAt.toISOString(),
    asOfDate: params.snapshot.asOfDate,
    reviewByDate: addUtcMonths(generatedAt, 6).toISOString().slice(0, 10),
    title: /\bhousehold\b/i.test(params.workspaceName)
      ? `${params.workspaceName} CIO Strategy`
      : `${params.workspaceName} Household CIO Strategy`,
    workspaceName: params.workspaceName,
    baseCurrency: params.snapshot.baseCurrency.toUpperCase().slice(0, 3),
    strategyStatus: status,
    executiveStance: executiveStance(status, recommendations),
    keyMessages,
    totals: {
      financialAssetsCents: params.snapshot.totals.financialAssetsCents,
      planningAssetsCents: params.snapshot.totals.planningPositionAssetsCents,
      planningLiabilitiesCents: params.snapshot.totals.planningLiabilitiesCents,
      planningNetWorthCents: params.snapshot.totals.planningNetWorthCents,
      investableAssetsCents: params.snapshot.totals.investableAssetsCents,
      retirementIncludedAssetsCents: params.snapshot.totals.retirementIncludedAssetsCents,
    },
    allocation: {
      assetClasses: params.snapshot.allocation.assetClasses.map((item) => ({
        key: item.key,
        valueCents: item.valueCents,
        allocationBps: item.allocationBps,
        isUnknown: item.isUnknown,
      })),
      geographies: params.snapshot.allocation.geographies.map((item) => ({
        key: item.key,
        valueCents: item.valueCents,
        allocationBps: item.allocationBps,
        isUnknown: item.isUnknown,
      })),
    },
    liquidity: { ...params.snapshot.liquidity },
    contributions: {
      externalContributionAnnualCents: params.snapshot.recurringFlows.externalContributionAnnualCents,
      externalWithdrawalAnnualCents: params.snapshot.recurringFlows.externalWithdrawalAnnualCents,
      netExternalContributionAnnualCents: params.snapshot.recurringFlows.netExternalContributionAnnualCents,
      internalReallocationAnnualCents: params.snapshot.recurringFlows.internalReallocationAnnualCents,
      retirementContributionAnnualCents: params.snapshot.annualContributions.usedExternalAnnualCents,
      source: params.snapshot.annualContributions.source,
    },
    investments: params.snapshot.investments.map((investment) => {
      const source = investmentById.get(investment.id);
      return {
        id: investment.id,
        label: source?.displayName?.trim() || source?.productName || "Recorded investment",
        institutionName: source?.institutionName || "Unknown institution",
        productName: source?.productName || "Recorded investment",
        currentValueCents: investment.currentValueCents,
        portfolioRole: investment.portfolioRole,
        liquidityClass: investment.liquidityClass,
        classificationStatus: investment.classificationStatus,
      };
    }),
    policy: reportPolicy(params.policy),
    retirement: reportRetirement(params.snapshot, recommendations),
    recommendations,
    policyExceptions: params.snapshot.policyExceptions.slice(0, 30).map((item) => ({
      code: item.code,
      severity: item.severity,
      title: item.title,
      reviewAction: item.reviewAction,
    })),
    dataQuality: {
      completenessBps: params.snapshot.dataQuality.completenessBps,
      latestValuationDate: params.snapshot.dataQuality.latestValuationDate,
      oldestValuationDate: params.snapshot.dataQuality.oldestValuationDate,
      warnings: params.snapshot.dataQuality.warnings.slice(0, 50).map((item) => ({
        code: item.code,
        severity: item.severity,
        message: item.message,
      })),
    },
    evidence: params.snapshot.evidence.slice(0, 50),
    methodology: [
      "The report is generated from the canonical Nest CIO snapshot for the stated data date.",
      "All authoritative money calculations use integer cents and policy rates use integer basis points.",
      "Allocation recommendations compare recorded exposures with user-confirmed policy bands and favor contribution-led rebalancing.",
      "The retirement contribution requirement is solved deterministically against the configured base-return scenario.",
      "Internal reallocations are excluded from new household contributions.",
    ],
    limitations: [
      "This report provides household strategy planning and does not execute trades, transfers, purchases, or sales.",
      "It does not recommend individual securities or replace licensed financial, tax, legal, insurance, or mortgage advice.",
      "Unknown classifications, stale valuations, and missing assumptions remain visible and reduce recommendation confidence.",
      "Returns are deterministic scenarios, not forecasts or guarantees. Taxes, fees, and sequence-of-returns risk are not fully modeled.",
      "Planning net worth remains separate from the existing Nest dashboard and public net-worth calculation.",
    ],
  };
  return CioStrategyReportModelSchema.parse(report);
}

async function loadStrategyInputs(workspaceId: string, asOfDate?: string | Date) {
  const [snapshot, workspace, policy, profile, investments] = await Promise.all([
    buildCioSnapshot({ workspaceId, asOfDate }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    getCioPolicy(workspaceId),
    getCioProfile(workspaceId),
    prisma.investmentAccount.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: CIO_MAX_LIST_ITEMS,
      select: { id: true, displayName: true, institutionName: true, productName: true },
    }),
  ]);
  if (!workspace) throw new ApiRequestError(404, "Workspace not found");
  return { snapshot, workspace, policy, profile, investments };
}

export async function buildWorkspaceCioStrategyRecommendations(params: {
  workspaceId: string;
  asOfDate?: string | Date;
}) {
  const { snapshot, policy, profile } = await loadStrategyInputs(params.workspaceId, params.asOfDate);
  return {
    asOfDate: snapshot.asOfDate,
    baseCurrency: snapshot.baseCurrency,
    recommendations: buildCioStrategyRecommendations({
      snapshot,
      policy: recommendationPolicy(policy),
      profile: recommendationProfile(profile),
    }),
    dataQuality: snapshot.dataQuality,
    evidence: snapshot.evidence,
  };
}

export async function buildWorkspaceCioStrategyReport(params: {
  workspaceId: string;
  asOfDate?: string | Date;
  generatedAt?: Date;
}) {
  const data = await loadStrategyInputs(params.workspaceId, params.asOfDate);
  return composeCioStrategyReportModel({
    snapshot: data.snapshot,
    workspaceName: data.workspace.name,
    investments: data.investments,
    policy: data.policy,
    profile: data.profile,
    generatedAt: params.generatedAt,
  });
}
