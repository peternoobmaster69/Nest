import { CIO_MAX_CENTS } from "./contracts";
import { projectRetirement, RetirementProjectionValidationError } from "./retirement-projection";
import type {
  CioPolicyException,
  CioRetirementProjectionAssumptions,
  CioSnapshot,
} from "./types";

export const CIO_STRATEGY_RECOMMENDATION_CODES = [
  "COMPLETE_CIO_SETUP",
  "CONFIRM_INVESTMENT_POLICY",
  "REBUILD_IMMEDIATE_CASH",
  "REBUILD_LIQUID_RESERVE",
  "DIRECT_NEW_CONTRIBUTIONS_TO_UNDERWEIGHT_ASSET",
  "PAUSE_NEW_CONTRIBUTIONS_TO_OVERWEIGHT_ASSET",
  "MAINTAIN_CONFIRMED_ALLOCATION",
  "LIMIT_CONCENTRATION_WITH_FUTURE_FLOWS",
  "INCREASE_RETIREMENT_CONTRIBUTIONS",
  "REVIEW_UNFUNDED_RETIREMENT_TARGET",
  "MAINTAIN_RETIREMENT_CONTRIBUTIONS",
  "COMPLETE_RETIREMENT_ASSUMPTIONS",
] as const;

export type CioStrategyRecommendationCode = (typeof CIO_STRATEGY_RECOMMENDATION_CODES)[number];
export type CioStrategyRecommendationCategory =
  | "DATA_QUALITY"
  | "LIQUIDITY"
  | "ALLOCATION"
  | "CONCENTRATION"
  | "RETIREMENT";
export type CioStrategyRecommendationSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type CioStrategyMetric = {
  unit: "CENTS" | "BPS" | "MONTHS" | "COUNT";
  value: number;
  label: string;
};

export type CioStrategyRecommendation = {
  id: string;
  code: CioStrategyRecommendationCode;
  category: CioStrategyRecommendationCategory;
  severity: CioStrategyRecommendationSeverity;
  priority: number;
  title: string;
  action: string;
  rationale: string;
  scopeKey: string | null;
  current: CioStrategyMetric | null;
  target: CioStrategyMetric | null;
  annualChangeCents: number | null;
  evidenceIds: string[];
  requiresUserConfirmation: true;
};

export type CioRecommendationPolicy = {
  confirmed: boolean;
  minimumLiquidityReserveCents: number | null;
  minimumLiquidityMonths: number | null;
  assetClassBands: readonly {
    assetClass: string;
    minimumBps: number;
    targetBps: number;
    maximumBps: number;
  }[];
};

export type CioRecommendationProfile = {
  minimumImmediateBankCashCents: number | null;
};

const severityOrder: Record<CioStrategyRecommendationSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function recommendationId(code: CioStrategyRecommendationCode, scopeKey?: string | null) {
  return `${code.toLowerCase()}${scopeKey ? `:${scopeKey.toLowerCase()}` : ""}`;
}

function evidenceIds(snapshot: CioSnapshot) {
  return snapshot.evidence.slice(0, 8).map((item) => item.id);
}

function metric(
  unit: CioStrategyMetric["unit"],
  value: number,
  label: string,
): CioStrategyMetric {
  return { unit, value, label };
}

export function projectionInput(
  assumptions: CioRetirementProjectionAssumptions,
  annualExternalContributionCents: number,
) {
  return {
    asOfDate: assumptions.asOfDate,
    currentRetirementAssetsCents: assumptions.currentRetirementAssetsCents,
    annualExternalContributionCents,
    contributionGrowthBps: assumptions.contributionGrowthRateBps,
    bearReturnBps: assumptions.bearReturnBps,
    baseReturnBps: assumptions.baseReturnBps,
    bullReturnBps: assumptions.bullReturnBps,
    inflationBps: assumptions.inflationRateBps,
    targetMonthlyRetirementSpendingCents: assumptions.targetMonthlySpendingTodayCents,
    sustainableWithdrawalRateBps: assumptions.sustainableWithdrawalRateBps,
    targetRetirementDate: assumptions.retirementDate,
  };
}

function contributionFundsBaseScenario(
  assumptions: CioRetirementProjectionAssumptions,
  annualExternalContributionCents: number,
) {
  try {
    return projectRetirement(projectionInput(assumptions, annualExternalContributionCents))
      .scenarios.base.outcome.realTargetGapCents === 0;
  } catch (error) {
    if (error instanceof RetirementProjectionValidationError && error.code === "RESULT_OUT_OF_RANGE") {
      return true;
    }
    throw error;
  }
}

export function solveRequiredAnnualRetirementContributionCents(
  assumptions: CioRetirementProjectionAssumptions,
) {
  if (contributionFundsBaseScenario(assumptions, 0)) return 0;
  if (!contributionFundsBaseScenario(assumptions, CIO_MAX_CENTS)) return null;

  let lower = 0;
  let upper = CIO_MAX_CENTS;
  while (lower + 1 < upper) {
    const candidate = lower + Math.floor((upper - lower) / 2);
    if (contributionFundsBaseScenario(assumptions, candidate)) upper = candidate;
    else lower = candidate;
  }

  try {
    projectRetirement(projectionInput(assumptions, upper));
    return upper;
  } catch (error) {
    if (error instanceof RetirementProjectionValidationError && error.code === "RESULT_OUT_OF_RANGE") {
      return null;
    }
    throw error;
  }
}

function concentrationRecommendations(
  snapshot: CioSnapshot,
  exceptions: readonly CioPolicyException[],
) {
  const supportedCodes = new Set([
    "ACCOUNT_CONCENTRATION",
    "SECURITY_CONCENTRATION",
    "GEOGRAPHY_CONCENTRATION",
    "SATELLITE_ALLOCATION_EXCEEDED",
  ]);
  return exceptions
    .filter((exception) => supportedCodes.has(exception.code))
    .slice(0, 4)
    .map((exception, index): CioStrategyRecommendation => ({
      id: recommendationId("LIMIT_CONCENTRATION_WITH_FUTURE_FLOWS", `${exception.code}-${index + 1}`),
      code: "LIMIT_CONCENTRATION_WITH_FUTURE_FLOWS",
      category: "CONCENTRATION",
      severity: "MEDIUM",
      priority: 60 + index,
      title: exception.title,
      action: "Direct new contributions away from the concentrated exposure until it returns within the confirmed limit.",
      rationale: "Using future cash flows can reduce concentration without forcing an immediate sale or creating a trade instruction.",
      scopeKey: exception.code,
      current: exception.actual.value === null
        ? null
        : metric(exception.actual.unit === "CENTS" ? "CENTS" : exception.actual.unit === "BPS" ? "BPS" : "COUNT", exception.actual.value, "Current"),
      target: exception.threshold?.value === null || exception.threshold?.value === undefined
        ? null
        : metric(exception.threshold.unit === "CENTS" ? "CENTS" : exception.threshold.unit === "BPS" ? "BPS" : "COUNT", exception.threshold.value, "Policy limit"),
      annualChangeCents: null,
      evidenceIds: exception.evidence.map((item) => item.id).slice(0, 8),
      requiresUserConfirmation: true,
    }));
}

export function buildCioStrategyRecommendations(params: {
  snapshot: CioSnapshot;
  policy: CioRecommendationPolicy | null;
  profile: CioRecommendationProfile | null;
}) {
  const { snapshot, policy, profile } = params;
  const recommendations: CioStrategyRecommendation[] = [];
  const sharedEvidence = evidenceIds(snapshot);

  if (snapshot.dataQuality.completenessBps < 10_000) {
    recommendations.push({
      id: recommendationId("COMPLETE_CIO_SETUP"),
      code: "COMPLETE_CIO_SETUP",
      category: "DATA_QUALITY",
      severity: snapshot.dataQuality.completenessBps < 5_000 ? "CRITICAL" : "HIGH",
      priority: 10,
      title: "Complete the CIO data foundation",
      action: "Resolve missing or stale valuations, classifications, exposure weights, and planning assumptions before making higher-conviction allocation changes.",
      rationale: "Incomplete inputs reduce the reliability of allocation, concentration, liquidity, and retirement conclusions.",
      scopeKey: null,
      current: metric("BPS", snapshot.dataQuality.completenessBps, "Data completeness"),
      target: metric("BPS", 10_000, "Required completeness"),
      annualChangeCents: null,
      evidenceIds: sharedEvidence,
      requiresUserConfirmation: true,
    });
  }

  if (!policy?.confirmed) {
    recommendations.push({
      id: recommendationId("CONFIRM_INVESTMENT_POLICY"),
      code: "CONFIRM_INVESTMENT_POLICY",
      category: "ALLOCATION",
      severity: "HIGH",
      priority: 15,
      title: "Confirm household investment guardrails",
      action: "Set and confirm asset-class bands, liquidity floors, and concentration limits before Nest recommends contribution routing.",
      rationale: "Nest does not invent a risk budget or allocation target and present it as household policy.",
      scopeKey: null,
      current: null,
      target: null,
      annualChangeCents: null,
      evidenceIds: sharedEvidence,
      requiresUserConfirmation: true,
    });
  }

  const immediateFloor = profile?.minimumImmediateBankCashCents ?? 0;
  if (immediateFloor > 0 && snapshot.totals.bankControlCents < immediateFloor) {
    const shortfall = immediateFloor - snapshot.totals.bankControlCents;
    recommendations.push({
      id: recommendationId("REBUILD_IMMEDIATE_CASH"),
      code: "REBUILD_IMMEDIATE_CASH",
      category: "LIQUIDITY",
      severity: "CRITICAL",
      priority: 20,
      title: "Rebuild same-day bank cash first",
      action: "Direct the next available external savings to immediate bank cash until the configured floor is restored.",
      rationale: "Same-day cash protects the investment plan from forced withdrawals or sales during an emergency.",
      scopeKey: "IMMEDIATE_CASH",
      current: metric("CENTS", snapshot.totals.bankControlCents, "Immediate bank cash"),
      target: metric("CENTS", immediateFloor, "Configured floor"),
      annualChangeCents: shortfall,
      evidenceIds: sharedEvidence,
      requiresUserConfirmation: true,
    });
  }

  if (policy?.confirmed) {
    const monthsFloor = policy.minimumLiquidityMonths !== null && snapshot.liquidity.essentialMonthlyExpenseCents !== null
      ? policy.minimumLiquidityMonths * snapshot.liquidity.essentialMonthlyExpenseCents
      : 0;
    const liquidityFloor = Math.max(policy.minimumLiquidityReserveCents ?? 0, monthsFloor);
    if (liquidityFloor > 0 && snapshot.liquidity.readilyAvailableCents < liquidityFloor) {
      recommendations.push({
        id: recommendationId("REBUILD_LIQUID_RESERVE"),
        code: "REBUILD_LIQUID_RESERVE",
        category: "LIQUIDITY",
        severity: "CRITICAL",
        priority: 25,
        title: "Restore the emergency-liquidity reserve",
        action: "Prioritize immediate and liquid reserves over additional long-term or locked investments until the policy floor is met.",
        rationale: "A funded liquidity layer reduces the chance that long-term assets must be disturbed at an unfavorable time.",
        scopeKey: "READILY_AVAILABLE",
        current: metric("CENTS", snapshot.liquidity.readilyAvailableCents, "Readily available"),
        target: metric("CENTS", liquidityFloor, "Policy floor"),
        annualChangeCents: liquidityFloor - snapshot.liquidity.readilyAvailableCents,
        evidenceIds: sharedEvidence,
        requiresUserConfirmation: true,
      });
    }

    const allocationActions: CioStrategyRecommendation[] = [];
    for (const band of policy.assetClassBands) {
      const actual = snapshot.allocation.assetClasses.find((item) => item.key === band.assetClass)?.allocationBps ?? 0;
      if (actual < band.minimumBps) {
        allocationActions.push({
          id: recommendationId("DIRECT_NEW_CONTRIBUTIONS_TO_UNDERWEIGHT_ASSET", band.assetClass),
          code: "DIRECT_NEW_CONTRIBUTIONS_TO_UNDERWEIGHT_ASSET",
          category: "ALLOCATION",
          severity: "HIGH",
          priority: 50,
          title: `${band.assetClass} is below its confirmed band`,
          action: `Direct a larger share of new investable contributions toward ${band.assetClass} until it returns to its confirmed target band.`,
          rationale: "Contribution-led rebalancing moves the portfolio toward policy without requiring an immediate sale.",
          scopeKey: band.assetClass,
          current: metric("BPS", actual, "Current allocation"),
          target: metric("BPS", band.targetBps, "Confirmed target"),
          annualChangeCents: null,
          evidenceIds: sharedEvidence,
          requiresUserConfirmation: true,
        });
      } else if (actual > band.maximumBps) {
        allocationActions.push({
          id: recommendationId("PAUSE_NEW_CONTRIBUTIONS_TO_OVERWEIGHT_ASSET", band.assetClass),
          code: "PAUSE_NEW_CONTRIBUTIONS_TO_OVERWEIGHT_ASSET",
          category: "ALLOCATION",
          severity: "HIGH",
          priority: 51,
          title: `${band.assetClass} is above its confirmed band`,
          action: `Do not prioritize additional contributions to ${band.assetClass}; route new investable cash toward underweight policy assets instead.`,
          rationale: "Pausing additions can reduce the overweight through cash flows while avoiding an automatic sell instruction.",
          scopeKey: band.assetClass,
          current: metric("BPS", actual, "Current allocation"),
          target: metric("BPS", band.targetBps, "Confirmed target"),
          annualChangeCents: null,
          evidenceIds: sharedEvidence,
          requiresUserConfirmation: true,
        });
      }
    }
    recommendations.push(...allocationActions);
    if (policy.assetClassBands.length > 0 && allocationActions.length === 0) {
      recommendations.push({
        id: recommendationId("MAINTAIN_CONFIRMED_ALLOCATION"),
        code: "MAINTAIN_CONFIRMED_ALLOCATION",
        category: "ALLOCATION",
        severity: "LOW",
        priority: 80,
        title: "Maintain the confirmed strategic allocation",
        action: "Continue current contribution discipline and review allocation quarterly; rebalance with new money before considering sales.",
        rationale: "Every configured asset class is currently inside its confirmed policy band.",
        scopeKey: null,
        current: null,
        target: null,
        annualChangeCents: null,
        evidenceIds: sharedEvidence,
        requiresUserConfirmation: true,
      });
    }
  }

  recommendations.push(...concentrationRecommendations(snapshot, snapshot.policyExceptions));

  if (snapshot.retirement.status === "READY") {
    const assumptions = snapshot.retirement.projection.assumptions;
    const requiredAnnual = solveRequiredAnnualRetirementContributionCents(assumptions);
    const currentAnnual = assumptions.annualExternalContributionCents;
    if (requiredAnnual === null) {
      recommendations.push({
        id: recommendationId("REVIEW_UNFUNDED_RETIREMENT_TARGET"),
        code: "REVIEW_UNFUNDED_RETIREMENT_TARGET",
        category: "RETIREMENT",
        severity: "HIGH",
        priority: 40,
        title: "Review the unfunded retirement target",
        action: "The base-case contribution requirement is outside Nest's supported range. Revisit the retirement date, target spending, and return assumptions before committing to a revised plan.",
        rationale: "Even the maximum supported annual contribution did not produce a valid funded base scenario, so Nest cannot provide a reliable contribution target.",
        scopeKey: "RETIREMENT_TARGET",
        current: metric("CENTS", currentAnnual, "Current annual contribution"),
        target: null,
        annualChangeCents: null,
        evidenceIds: sharedEvidence,
        requiresUserConfirmation: true,
      });
    } else if (requiredAnnual > currentAnnual) {
      recommendations.push({
        id: recommendationId("INCREASE_RETIREMENT_CONTRIBUTIONS"),
        code: "INCREASE_RETIREMENT_CONTRIBUTIONS",
        category: "RETIREMENT",
        severity: "HIGH",
        priority: 40,
        title: "Increase annual retirement contributions",
        action: "Raise external retirement contributions to the calculated base-case requirement, or revisit the retirement date or spending target.",
        rationale: "At the current contribution rate, the deterministic base scenario finishes below the configured retirement target.",
        scopeKey: "RETIREMENT_TARGET",
        current: metric("CENTS", currentAnnual, "Current annual contribution"),
        target: metric("CENTS", requiredAnnual, "Required annual contribution"),
        annualChangeCents: requiredAnnual - currentAnnual,
        evidenceIds: sharedEvidence,
        requiresUserConfirmation: true,
      });
    } else {
      recommendations.push({
        id: recommendationId("MAINTAIN_RETIREMENT_CONTRIBUTIONS"),
        code: "MAINTAIN_RETIREMENT_CONTRIBUTIONS",
        category: "RETIREMENT",
        severity: "LOW",
        priority: 75,
        title: "Maintain the retirement funding plan",
        action: "Continue external retirement contributions at or above the calculated base-case requirement and review the assumptions annually.",
        rationale: "The current deterministic base scenario meets or exceeds the configured retirement target.",
        scopeKey: "RETIREMENT_TARGET",
        current: metric("CENTS", currentAnnual, "Current annual contribution"),
        target: metric("CENTS", requiredAnnual, "Minimum modeled requirement"),
        annualChangeCents: 0,
        evidenceIds: sharedEvidence,
        requiresUserConfirmation: true,
      });
    }
  } else {
    recommendations.push({
      id: recommendationId("COMPLETE_RETIREMENT_ASSUMPTIONS"),
      code: "COMPLETE_RETIREMENT_ASSUMPTIONS",
      category: "RETIREMENT",
      severity: "HIGH",
      priority: 35,
      title: "Complete the retirement assumptions",
      action: "Add the missing age, target date, spending, contribution, return, inflation, and withdrawal assumptions before relying on retirement guidance.",
      rationale: "Nest will not invent missing retirement inputs or present a fabricated target as personalized advice.",
      scopeKey: "RETIREMENT_TARGET",
      current: metric("COUNT", snapshot.retirement.missingFields.length, "Missing assumptions"),
      target: metric("COUNT", 0, "Required missing assumptions"),
      annualChangeCents: null,
      evidenceIds: sharedEvidence,
      requiresUserConfirmation: true,
    });
  }

  return recommendations
    .toSorted((left, right) => left.priority - right.priority || severityOrder[left.severity] - severityOrder[right.severity] || left.id.localeCompare(right.id))
    .slice(0, 12);
}
