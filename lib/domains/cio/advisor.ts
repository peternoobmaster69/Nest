import { CIO_MAX_CENTS } from "./contracts";
import { projectRetirement, RetirementProjectionValidationError } from "./retirement-projection";
import {
  projectionInput,
  solveRequiredAnnualRetirementContributionCents,
  type CioRecommendationPolicy,
  type CioRecommendationProfile,
  type CioStrategyRecommendation,
} from "./strategy-recommendations";
import type { CioRetirementProjectionAssumptions, CioSnapshot } from "./types";

// Every derived amount an advisory answer may quote is calculated here, in integer cents,
// so the model copies figures instead of dividing, subtracting, or annualizing them itself.

const BPS = 10_000;
const MAX_LEVER_YEARS = 60;

/** Annual cents to a monthly equivalent, rounded half away from zero to the cent. */
export function monthlyEquivalentCents(annualCents: number) {
  return Math.sign(annualCents) * Math.floor((Math.abs(annualCents) * 2 + 12) / 24);
}

/** Splits an amount across weights with the largest-remainder method so the parts always sum exactly. */
export function apportionCents(amountCents: number, weights: readonly number[]) {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (amountCents <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (amountCents * Math.max(0, weight)) / total);
  const parts = exact.map(Math.floor);
  let remainder = amountCents - parts.reduce((sum, part) => sum + part, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    parts[index] += 1;
    remainder -= 1;
  }
  return parts;
}

function allocationBps(valueCents: number, totalCents: number) {
  return totalCents > 0 ? Math.round((valueCents * BPS) / totalCents) : 0;
}

function bandStatus(valueBps: number, band: { minimumBps: number; maximumBps: number }) {
  if (valueBps < band.minimumBps) return "BELOW_BAND" as const;
  if (valueBps > band.maximumBps) return "ABOVE_BAND" as const;
  return "WITHIN_BAND" as const;
}

function assetClassValue(snapshot: CioSnapshot, assetClass: string) {
  return snapshot.allocation.assetClasses.find((item) => item.key === assetClass)?.valueCents ?? 0;
}

function unknownAllocation(snapshot: CioSnapshot) {
  const unknown = snapshot.allocation.assetClasses.find((item) => item.key === "UNKNOWN");
  return { valueCents: unknown?.valueCents ?? 0, allocationBps: unknown?.allocationBps ?? 0 };
}

function confirmedBands(policy: CioRecommendationPolicy | null) {
  return policy?.confirmed ? policy.assetClassBands.filter((band) => band.assetClass !== "UNKNOWN") : [];
}

/**
 * Smallest new-money amount that lifts every band to its minimum without any sale, or null when
 * holdings outside the bands make that impossible within the supported range.
 */
export function newMoneyToReachMinimumsCents(snapshot: CioSnapshot, policy: CioRecommendationPolicy | null) {
  const bands = confirmedBands(policy);
  if (!bands.length) return null;
  const total = snapshot.allocation.totalCents;
  const needed = (extra: number) => bands.reduce((sum, band) => (
    sum + Math.max(0, Math.ceil(((total + extra) * band.minimumBps) / BPS) - assetClassValue(snapshot, band.assetClass))
  ), 0);
  if (needed(0) === 0) return 0;
  if (needed(CIO_MAX_CENTS) > CIO_MAX_CENTS) return null;
  let lower = 0;
  let upper = CIO_MAX_CENTS;
  while (lower + 1 < upper) {
    const candidate = lower + Math.floor((upper - lower) / 2);
    if (needed(candidate) <= candidate) upper = candidate;
    else lower = candidate;
  }
  return upper;
}

export type CioNewMoneyPlan =
  | { status: "POLICY_REQUIRED"; reason: string }
  | {
      status: "PLANNED";
      amountCents: number;
      totalBeforeCents: number;
      totalAfterCents: number;
      unknown: { valueCents: number; allocationBps: number };
      method: "FILL_TARGET_SHORTFALLS_THEN_TARGET_WEIGHTS";
      bands: Array<{
        assetClass: string;
        currentCents: number;
        currentBps: number;
        minimumBps: number;
        targetBps: number;
        maximumBps: number;
        allocationCents: number;
        allocationShareBps: number;
        afterCents: number;
        afterBps: number;
        statusBefore: ReturnType<typeof bandStatus>;
        statusAfter: ReturnType<typeof bandStatus>;
      }>;
      stillOutsideBands: string[];
    };

/** Routes a hypothetical amount of new money across confirmed asset-class bands. Never selects a security or sells. */
export function planCioNewMoneyAllocation(
  snapshot: CioSnapshot,
  policy: CioRecommendationPolicy | null,
  amountCents: number,
): CioNewMoneyPlan {
  const bands = confirmedBands(policy);
  if (!bands.length) {
    return {
      status: "POLICY_REQUIRED",
      reason: "Nest routes new money only against confirmed asset-class bands. Confirm the investment policy with at least one band first.",
    };
  }
  const totalBefore = snapshot.allocation.totalCents;
  const totalAfter = totalBefore + amountCents;
  const current = bands.map((band) => assetClassValue(snapshot, band.assetClass));
  const shortfalls = bands.map((band, index) => Math.max(0, Math.round((totalAfter * band.targetBps) / BPS) - current[index]));
  const shortfallTotal = shortfalls.reduce((sum, value) => sum + value, 0);
  const allocations = shortfallTotal >= amountCents
    ? apportionCents(amountCents, shortfalls)
    : apportionCents(amountCents - shortfallTotal, bands.map((band) => band.targetBps))
      .map((extra, index) => extra + shortfalls[index]);
  const rows = bands.map((band, index) => {
    const afterCents = current[index] + allocations[index];
    const currentBps = allocationBps(current[index], totalBefore);
    const afterBps = allocationBps(afterCents, totalAfter);
    return {
      assetClass: band.assetClass,
      currentCents: current[index],
      currentBps,
      minimumBps: band.minimumBps,
      targetBps: band.targetBps,
      maximumBps: band.maximumBps,
      allocationCents: allocations[index],
      allocationShareBps: allocationBps(allocations[index], amountCents),
      afterCents,
      afterBps,
      statusBefore: bandStatus(currentBps, band),
      statusAfter: bandStatus(afterBps, band),
    };
  });
  return {
    status: "PLANNED",
    amountCents,
    totalBeforeCents: totalBefore,
    totalAfterCents: totalAfter,
    unknown: unknownAllocation(snapshot),
    method: "FILL_TARGET_SHORTFALLS_THEN_TARGET_WEIGHTS",
    bands: rows,
    stillOutsideBands: rows.filter((row) => row.statusAfter !== "WITHIN_BAND").map((row) => row.assetClass),
  };
}

function baseOutcome(assumptions: CioRetirementProjectionAssumptions, overrides: Record<string, unknown> = {}) {
  try {
    return projectRetirement({ ...projectionInput(assumptions, assumptions.annualExternalContributionCents), ...overrides })
      .scenarios.base.outcome;
  } catch (error) {
    if (error instanceof RetirementProjectionValidationError) return null;
    throw error;
  }
}

function addUtcYears(isoDate: string, years: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

export type CioRetirementLevers = ReturnType<typeof solveCioRetirementLevers>;

function solveRequiredBaseReturn(assumptions: CioRetirementProjectionAssumptions) {
  // Base return is solved inside the configured bear..bull range so the scenario ordering stays valid.
  const funded = (baseReturnBps: number) => baseOutcome(assumptions, { baseReturnBps })?.realTargetGapCents === 0;
  let requiredBaseReturn: { status: "SOLVED" | "FUNDED_AT_BEAR_RETURN" | "ABOVE_BULL_RETURN"; bps: number | null };
  if (funded(assumptions.bearReturnBps)) requiredBaseReturn = { status: "FUNDED_AT_BEAR_RETURN", bps: assumptions.bearReturnBps };
  else if (!funded(assumptions.bullReturnBps)) requiredBaseReturn = { status: "ABOVE_BULL_RETURN", bps: null };
  else {
    let lower = assumptions.bearReturnBps;
    let upper = assumptions.bullReturnBps;
    while (lower + 1 < upper) {
      const candidate = lower + Math.floor((upper - lower) / 2);
      if (funded(candidate)) upper = candidate;
      else lower = candidate;
    }
    requiredBaseReturn = { status: "SOLVED", bps: upper };
  }

  return requiredBaseReturn;
}

/** The deterministic levers that close or widen the base-case retirement gap. */
export function solveCioRetirementLevers(assumptions: CioRetirementProjectionAssumptions) {
  const currentAnnual = assumptions.annualExternalContributionCents;
  const current = baseOutcome(assumptions);
  const requiredAnnual = solveRequiredAnnualRetirementContributionCents(assumptions);
  const additionalAnnual = requiredAnnual === null ? null : Math.max(0, requiredAnnual - currentAnnual);

  // Earliest whole-year retirement date from the data date that the base case funds at today's contribution.
  let earliestFundedDate: string | null = null;
  for (let years = 1; years <= MAX_LEVER_YEARS; years += 1) {
    const date = addUtcYears(assumptions.asOfDate, years);
    const outcome = baseOutcome(assumptions, { targetRetirementDate: date });
    if (outcome?.realTargetGapCents === 0) {
      earliestFundedDate = date;
      break;
    }
  }

  const requiredBaseReturn = solveRequiredBaseReturn(assumptions);

  const gapOrSurplusReal = current ? current.realTargetSurplusCents - current.realTargetGapCents : null;
  return {
    asOfDate: assumptions.asOfDate,
    retirementDate: assumptions.retirementDate,
    currentAnnualContributionCents: currentAnnual,
    currentMonthlyContributionCents: monthlyEquivalentCents(currentAnnual),
    requiredAnnualContributionCents: requiredAnnual,
    requiredMonthlyContributionCents: requiredAnnual === null ? null : monthlyEquivalentCents(requiredAnnual),
    additionalAnnualContributionCents: additionalAnnual,
    additionalMonthlyContributionCents: additionalAnnual === null ? null : monthlyEquivalentCents(additionalAnnual),
    baseGapOrSurplusRealCents: gapOrSurplusReal,
    baseSustainableMonthlyIncomeRealCents: current?.realSustainableMonthlyIncomeCents ?? null,
    targetMonthlySpendingTodayCents: assumptions.targetMonthlySpendingTodayCents,
    monthlySpendingGapOrSurplusTodayCents: current
      ? current.realSustainableMonthlyIncomeCents - assumptions.targetMonthlySpendingTodayCents
      : null,
    earliestFundedRetirementDate: earliestFundedDate,
    earliestFundedDateSearch: `Whole years from the data date, up to ${MAX_LEVER_YEARS} years, at the current contribution.`,
    requiredBaseReturn,
    baseReturnBps: assumptions.baseReturnBps,
  };
}

function liquidityFloorCents(snapshot: CioSnapshot, policy: CioRecommendationPolicy | null) {
  if (!policy?.confirmed) return null;
  const monthsFloor = policy.minimumLiquidityMonths !== null && snapshot.liquidity.essentialMonthlyExpenseCents !== null
    ? policy.minimumLiquidityMonths * snapshot.liquidity.essentialMonthlyExpenseCents
    : 0;
  const floor = Math.max(policy.minimumLiquidityReserveCents ?? 0, monthsFloor);
  return floor > 0 ? floor : null;
}

function monthsToRestoreReserve(shortfall: number | null, netMonthly: number) {
  if (shortfall === null) return null;
  if (shortfall === 0) return 0;
  return netMonthly > 0 ? Math.ceil(shortfall / netMonthly) : null;
}

/** One deterministic advisory brief: posture, drift, liquidity, contribution pace, and retirement levers. */
export function buildCioAdvisorBrief(params: {
  snapshot: CioSnapshot;
  policy: CioRecommendationPolicy | null;
  profile: CioRecommendationProfile | null;
  recommendations: readonly CioStrategyRecommendation[];
}) {
  const { snapshot, policy, profile, recommendations } = params;
  const total = snapshot.allocation.totalCents;
  const drift = confirmedBands(policy).map((band) => {
    const currentCents = assetClassValue(snapshot, band.assetClass);
    const currentBps = allocationBps(currentCents, total);
    return {
      assetClass: band.assetClass,
      currentCents,
      currentBps,
      minimumBps: band.minimumBps,
      targetBps: band.targetBps,
      maximumBps: band.maximumBps,
      driftFromTargetBps: currentBps - band.targetBps,
      valueAtTargetCents: Math.round((total * band.targetBps) / BPS),
      differenceFromTargetCents: currentCents - Math.round((total * band.targetBps) / BPS),
      status: bandStatus(currentBps, band),
    };
  });

  const floor = liquidityFloorCents(snapshot, policy);
  const shortfall = floor === null ? null : Math.max(0, floor - snapshot.liquidity.readilyAvailableCents);
  const netAnnual = snapshot.recurringFlows.netExternalContributionAnnualCents;
  const netMonthly = monthlyEquivalentCents(netAnnual);
  const immediateFloor = profile?.minimumImmediateBankCashCents ?? null;
  const progress = snapshot.contributionProgress;

  return {
    asOfDate: snapshot.asOfDate,
    currency: snapshot.baseCurrency,
    recommendations,
    allocation: {
      totalCents: total,
      policyConfirmed: policy?.confirmed ?? false,
      unknown: unknownAllocation(snapshot),
      drift,
      newMoneyToReachAllMinimumsCents: newMoneyToReachMinimumsCents(snapshot, policy),
    },
    liquidity: {
      readilyAvailableCents: snapshot.liquidity.readilyAvailableCents,
      immediateBankCashCents: snapshot.totals.bankControlCents,
      immediateBankCashFloorCents: immediateFloor,
      immediateBankCashShortfallCents: immediateFloor === null ? null : Math.max(0, immediateFloor - snapshot.totals.bankControlCents),
      essentialMonthlyExpenseCents: snapshot.liquidity.essentialMonthlyExpenseCents,
      emergencyRunwayMonths: snapshot.liquidity.emergencyRunwayMonths,
      policyFloorCents: floor,
      policyShortfallCents: shortfall,
      // Assumes all recorded net external contributions were redirected to the reserve.
      monthsToRestoreAtNetContributions: monthsToRestoreReserve(shortfall, netMonthly),
    },
    contributions: {
      usedAnnualCents: snapshot.annualContributions.usedExternalAnnualCents,
      usedMonthlyCents: monthlyEquivalentCents(snapshot.annualContributions.usedExternalAnnualCents),
      source: snapshot.annualContributions.source,
      netExternalAnnualCents: netAnnual,
      netExternalMonthlyCents: netMonthly,
      internalReallocationAnnualCents: snapshot.annualContributions.internalReallocationAnnualCents,
      progress: progress ? {
        year: progress.year,
        status: progress.status,
        actualYtdCents: progress.actualYtdCents,
        expectedToDateCents: progress.expectedToDateCents,
        annualTargetCents: progress.annualTargetCents,
        paceGapCents: progress.paceGapCents,
        remainingAnnualCents: progress.remainingAnnualCents,
        annualProgressBps: progress.annualProgressBps,
        calendarProgressBps: progress.calendarProgressBps,
      } : null,
    },
    retirement: snapshot.retirement.status === "READY"
      ? { status: "READY" as const, missingFields: [], levers: solveCioRetirementLevers(snapshot.retirement.projection.assumptions) }
      : { status: "NOT_READY" as const, missingFields: snapshot.retirement.missingFields, levers: null },
    dataQuality: snapshot.dataQuality,
    evidence: snapshot.evidence,
  };
}
