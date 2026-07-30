import type {
  CioAllocationSummary,
  CioDataQualitySummary,
  CioEvidenceRef,
  CioLiquiditySummary,
  CioPolicyException,
  CioRetirementProjection,
} from "./types";

export type CioPolicyDefinition = {
  minimumLiquidityReserveCents: number | null;
  minimumLiquidityMonths: number | null;
  maximumAccountConcentrationBps: number | null;
  maximumSingleSecurityConcentrationBps: number | null;
  maximumSatelliteAllocationBps: number | null;
  assetClassBands: readonly { assetClass: string; minimumBps: number; targetBps: number; maximumBps: number }[];
  geographyLimits: readonly { geography: string; maximumBps: number }[];
};

const CODE_ORDER = [
  "DATA_INCOMPLETE",
  "STALE_VALUATION",
  "LIQUIDITY_BELOW_FLOOR",
  "ASSET_CLASS_OUTSIDE_BAND",
  "ACCOUNT_CONCENTRATION",
  "SECURITY_CONCENTRATION",
  "GEOGRAPHY_CONCENTRATION",
  "SATELLITE_ALLOCATION_EXCEEDED",
  "RETIREMENT_TARGET_GAP",
] as const;

function bps(valueCents: number, totalCents: number) {
  if (valueCents <= 0 || totalCents <= 0) return 0;
  const numerator = BigInt(valueCents) * BigInt(10_000);
  const denominator = BigInt(totalCents);
  return Number((numerator + denominator / BigInt(2)) / denominator);
}

export function evaluateCioPolicy(params: {
  policy: CioPolicyDefinition | null;
  minimumImmediateBankCashCents?: number | null;
  immediateBankCashCents?: number;
  allocation: CioAllocationSummary;
  liquidity: CioLiquiditySummary;
  dataQuality: CioDataQualitySummary;
  accounts: readonly { id: string; currentValueCents: number; portfolioRole: string | null }[];
  retirementProjection: CioRetirementProjection | null;
  evidence: readonly CioEvidenceRef[];
}): CioPolicyException[] {
  const exceptions: CioPolicyException[] = [];
  const sharedEvidence = [...params.evidence].slice(0, 8);
  const evidenceForInvestment = (investmentId: string) => {
    const exact = params.evidence.find((item) => item.id === `investment-${investmentId}`);
    return exact
      ? [exact, ...sharedEvidence.filter((item) => item.id !== exact.id)].slice(0, 8)
      : sharedEvidence;
  };
  if (params.dataQuality.completenessBps < 10_000) {
    exceptions.push({
      code: "DATA_INCOMPLETE",
      severity: params.dataQuality.completenessBps < 5_000 ? "CRITICAL" : "WARNING",
      title: "CIO data is incomplete",
      actual: { unit: "BPS", value: params.dataQuality.completenessBps },
      threshold: { unit: "BPS", value: 10_000 },
      evidence: sharedEvidence,
      reviewAction: "Complete missing valuations, classifications, exposures, assumptions, and policy settings before optimizing allocation.",
    });
  }
  const staleWarnings = params.dataQuality.warnings.filter((warning) => warning.code === "STALE_VALUATION");
  if (staleWarnings.length) {
    const maximumAge = Math.max(...staleWarnings.map((warning) => warning.actual?.unit === "DAYS" ? warning.actual.value : 0));
    const staleThreshold = staleWarnings.find((warning) => warning.threshold?.unit === "DAYS")?.threshold?.value ?? null;
    exceptions.push({
      code: "STALE_VALUATION",
      severity: "WARNING",
      title: "Investment valuations need review",
      actual: { unit: "DAYS", value: maximumAge },
      threshold: { unit: "DAYS", value: staleThreshold },
      evidence: sharedEvidence,
      reviewAction: "Refresh stale investment valuations before relying on allocation or retirement results.",
    });
  }

  const policy = params.policy;
  const immediateFloor = params.minimumImmediateBankCashCents ?? 0;
  const immediateBankCash = params.immediateBankCashCents ?? params.liquidity.immediateCents;
  if (immediateFloor > 0 && immediateBankCash < immediateFloor) {
    exceptions.push({
      code: "LIQUIDITY_BELOW_FLOOR",
      severity: "CRITICAL",
      title: "Immediate bank cash is below the household floor",
      actual: { unit: "CENTS", value: immediateBankCash },
      threshold: { unit: "CENTS", value: immediateFloor },
      evidence: sharedEvidence,
      reviewAction: "Review the configured immediate-cash floor before allocating additional money to less-liquid assets.",
    });
  }
  if (policy) {
    const monthsFloor = policy.minimumLiquidityMonths !== null && params.liquidity.essentialMonthlyExpenseCents !== null
      ? policy.minimumLiquidityMonths * params.liquidity.essentialMonthlyExpenseCents
      : 0;
    const liquidityFloor = Math.max(policy.minimumLiquidityReserveCents ?? 0, monthsFloor);
    if (liquidityFloor > 0 && params.liquidity.readilyAvailableCents < liquidityFloor) {
      exceptions.push({
        code: "LIQUIDITY_BELOW_FLOOR",
        severity: "CRITICAL",
        title: "Emergency liquidity is below policy",
        actual: { unit: "CENTS", value: params.liquidity.readilyAvailableCents },
        threshold: { unit: "CENTS", value: liquidityFloor },
        evidence: sharedEvidence,
        reviewAction: "Review immediate and liquid reserves before increasing long-term or locked allocations.",
      });
    }
    for (const band of policy.assetClassBands) {
      const actual = params.allocation.assetClasses.find((bucket) => bucket.key === band.assetClass)?.allocationBps ?? 0;
      if (actual < band.minimumBps || actual > band.maximumBps) {
        exceptions.push({
          code: "ASSET_CLASS_OUTSIDE_BAND",
          severity: "WARNING",
          title: `${band.assetClass} is outside its policy band`,
          actual: { unit: "BPS", value: actual },
          threshold: { unit: "BPS", value: actual < band.minimumBps ? band.minimumBps : band.maximumBps },
          evidence: sharedEvidence,
          reviewAction: "Review contributions and future reallocation against the confirmed asset-class band; no trade is executed.",
        });
      }
    }
    if (policy.maximumAccountConcentrationBps !== null) {
      for (const account of params.accounts) {
        const actual = bps(account.currentValueCents, params.allocation.totalCents);
        if (actual > policy.maximumAccountConcentrationBps) exceptions.push({
          code: "ACCOUNT_CONCENTRATION",
          severity: "WARNING",
          title: "An investment account exceeds the concentration limit",
          actual: { unit: "BPS", value: actual },
          threshold: { unit: "BPS", value: policy.maximumAccountConcentrationBps },
          evidence: evidenceForInvestment(account.id),
          reviewAction: "Review product concentration, liquidity needs, and future contribution direction.",
        });
      }
    }
    if (policy.maximumSingleSecurityConcentrationBps !== null) {
      for (const security of params.allocation.securities.filter((bucket) => bucket.key !== "UNKNOWN")) {
        if (security.allocationBps > policy.maximumSingleSecurityConcentrationBps) exceptions.push({
          code: "SECURITY_CONCENTRATION",
          severity: "WARNING",
          title: `${security.key} exceeds the single-security limit`,
          actual: { unit: "BPS", value: security.allocationBps },
          threshold: { unit: "BPS", value: policy.maximumSingleSecurityConcentrationBps },
          evidence: sharedEvidence,
          reviewAction: "Review explicitly configured look-through security concentration; no buy or sell instruction is generated.",
        });
      }
    }
    for (const limit of policy.geographyLimits) {
      const actual = params.allocation.geographies.find((bucket) => bucket.key === limit.geography)?.allocationBps ?? 0;
      if (actual > limit.maximumBps) exceptions.push({
        code: "GEOGRAPHY_CONCENTRATION",
        severity: "WARNING",
        title: `${limit.geography} exceeds the geography limit`,
        actual: { unit: "BPS", value: actual },
        threshold: { unit: "BPS", value: limit.maximumBps },
        evidence: sharedEvidence,
        reviewAction: "Review geographic exposure against the confirmed policy limit.",
      });
    }
    if (policy.maximumSatelliteAllocationBps !== null) {
      const satelliteCents = params.accounts
        .filter((account) => account.portfolioRole === "SATELLITE" && account.currentValueCents > 0)
        .reduce((sum, account) => sum + account.currentValueCents, 0);
      const actual = bps(satelliteCents, params.allocation.totalCents);
      if (actual > policy.maximumSatelliteAllocationBps) exceptions.push({
        code: "SATELLITE_ALLOCATION_EXCEEDED",
        severity: "WARNING",
        title: "Satellite allocation exceeds policy",
        actual: { unit: "BPS", value: actual },
        threshold: { unit: "BPS", value: policy.maximumSatelliteAllocationBps },
        evidence: sharedEvidence,
        reviewAction: "Review the role of satellite holdings before directing additional contributions.",
      });
    }
  }

  const baseScenario = params.retirementProjection?.scenarios.find((scenario) => scenario.scenario === "BASE");
  if (baseScenario && baseScenario.targetGapOrSurplusRealCents < 0) {
    exceptions.push({
      code: "RETIREMENT_TARGET_GAP",
      severity: "WARNING",
      title: "Base retirement projection is below target",
      actual: { unit: "CENTS", value: baseScenario.fundAtRetirementRealCents },
      threshold: { unit: "CENTS", value: baseScenario.targetFundRealCents },
      evidence: sharedEvidence,
      reviewAction: "Review contribution, retirement-date, spending, and return assumptions; this is decision support, not a trade instruction.",
    });
  }

  return exceptions.sort((left, right) => CODE_ORDER.indexOf(left.code) - CODE_ORDER.indexOf(right.code));
}
