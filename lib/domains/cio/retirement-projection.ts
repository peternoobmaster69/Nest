export const RETIREMENT_BASIS_POINTS_SCALE = 10_000;
export const MAX_RETIREMENT_PROJECTION_YEARS = 100;

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_TWO = BigInt(2);
const BIGINT_TWELVE = BigInt(12);

export type RetirementDateInput = string | Date;
export type RetirementScenarioKey = "bear" | "base" | "bull";
export type RetirementHorizonSource =
  | "TARGET_DATE"
  | "BIRTH_DATE_AND_TARGET_AGE"
  | "YEARS_TO_RETIREMENT"
  | "CURRENT_AND_TARGET_AGE";

export interface RetirementProjectionInput {
  asOfDate: RetirementDateInput;
  currentRetirementAssetsCents: number;
  annualExternalContributionCents: number;
  contributionGrowthBps?: number;
  bearReturnBps: number;
  baseReturnBps: number;
  bullReturnBps: number;
  inflationBps: number;
  targetMonthlyRetirementSpendingCents: number;
  sustainableWithdrawalRateBps: number;
  targetRetirementDate?: RetirementDateInput | null;
  primaryBirthDate?: RetirementDateInput | null;
  currentAge?: number | null;
  targetRetirementAge?: number | null;
  yearsToRetirement?: number | null;
}

export interface RetirementProjectionPoint {
  yearIndex: number;
  date: string;
  nominalValueCents: number;
  realValueCents: number;
  contributionCents: number;
}

export interface RetirementScenarioOutcome {
  nominalFundCents: number;
  realFundCents: number;
  nominalSustainableMonthlyIncomeCents: number;
  realSustainableMonthlyIncomeCents: number;
  nominalTargetGapCents: number;
  nominalTargetSurplusCents: number;
  realTargetGapCents: number;
  realTargetSurplusCents: number;
}

export interface RetirementScenarioProjection {
  scenario: RetirementScenarioKey;
  nominalReturnBps: number;
  points: RetirementProjectionPoint[];
  outcome: RetirementScenarioOutcome;
}

export interface RetirementProjectionTarget {
  monthlySpendingTodayCents: number;
  annualSpendingTodayCents: number;
  realFundCents: number;
  nominalMonthlySpendingAtRetirementCents: number;
  nominalFundAtRetirementCents: number;
}

export interface RetirementProjectionAssumptions {
  asOfDate: string;
  resolvedTargetRetirementDate: string;
  projectionYears: number;
  horizonSource: RetirementHorizonSource;
  currentRetirementAssetsCents: number;
  annualExternalContributionCents: number;
  contributionGrowthBps: number;
  bearReturnBps: number;
  baseReturnBps: number;
  bullReturnBps: number;
  inflationBps: number;
  targetMonthlyRetirementSpendingCents: number;
  sustainableWithdrawalRateBps: number;
  contributionTiming: "END_OF_YEAR";
  rateScaleBps: number;
  finalPeriodFractionBps: number;
  horizonRounding: "FULL_YEARS_PLUS_PRORATED_FINAL_PERIOD";
}

export interface RetirementProjectionResult {
  assumptions: RetirementProjectionAssumptions;
  target: RetirementProjectionTarget;
  scenarios: Record<RetirementScenarioKey, RetirementScenarioProjection>;
}

export type RetirementProjectionValidationCode =
  | "MISSING_INPUT"
  | "INVALID_AMOUNT"
  | "INVALID_RATE"
  | "INVALID_DATE"
  | "INVALID_HORIZON"
  | "HORIZON_TOO_LONG"
  | "RESULT_OUT_OF_RANGE";

export class RetirementProjectionValidationError extends Error {
  readonly code: RetirementProjectionValidationCode;
  readonly field?: string;

  constructor(code: RetirementProjectionValidationCode, message: string, field?: string) {
    super(message);
    this.name = "RetirementProjectionValidationError";
    this.code = code;
    this.field = field;
  }
}

export const CioProjectionValidationError = RetirementProjectionValidationError;

interface ResolvedHorizon {
  years: number;
  targetDate: Date;
  source: RetirementHorizonSource;
}

interface InflationFactor {
  scalePower: bigint;
  inflationIndex: bigint;
}

interface ProjectionPeriod {
  endDate: Date;
  annualFractionBps: number;
  contributionDue: boolean;
}

function toSafeNumber(value: bigint, field: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new RetirementProjectionValidationError(
      "RESULT_OUT_OF_RANGE",
      `${field} is outside JavaScript's safe integer range.`,
      field,
    );
  }
  return result;
}

function requireSafeInteger(value: unknown, field: string) {
  if (value === null || value === undefined) {
    throw new RetirementProjectionValidationError(
      "MISSING_INPUT",
      `${field} is required.`,
      field,
    );
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RetirementProjectionValidationError(
      "INVALID_AMOUNT",
      `${field} must be an integer within JavaScript's safe integer range.`,
      field,
    );
  }
  return value;
}

function validateNonnegativeCents(value: unknown, field: string) {
  const result = requireSafeInteger(value, field);
  if (result < 0) {
    throw new RetirementProjectionValidationError(
      "INVALID_AMOUNT",
      `${field} cannot be negative.`,
      field,
    );
  }
  return result;
}

function validateRate(
  value: unknown,
  field: string,
  options: { minimum: number; maximum: number; minimumExclusive?: boolean },
) {
  if (value === null || value === undefined) {
    throw new RetirementProjectionValidationError(
      "MISSING_INPUT",
      `${field} is required.`,
      field,
    );
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RetirementProjectionValidationError(
      "INVALID_RATE",
      `${field} must be an integer number of basis points.`,
      field,
    );
  }
  const belowMinimum = options.minimumExclusive
    ? value <= options.minimum
    : value < options.minimum;
  if (belowMinimum || value > options.maximum) {
    const comparison = options.minimumExclusive ? "greater than" : "at least";
    throw new RetirementProjectionValidationError(
      "INVALID_RATE",
      `${field} must be ${comparison} ${options.minimum} and at most ${options.maximum} basis points.`,
      field,
    );
  }
  return value;
}

function parseDate(value: RetirementDateInput | null | undefined, field: string) {
  if (value === null || value === undefined) {
    throw new RetirementProjectionValidationError(
      "MISSING_INPUT",
      `${field} is required.`,
      field,
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RetirementProjectionValidationError(
      "INVALID_DATE",
      `${field} must be a valid date.`,
      field,
    );
  }
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new RetirementProjectionValidationError(
      "INVALID_DATE",
      `${field} must be a valid calendar date.`,
      field,
    );
  }
  return date;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addUtcYears(value: Date, years: number) {
  const targetYear = value.getUTCFullYear() + years;
  const month = value.getUTCMonth();
  const day = Math.min(value.getUTCDate(), daysInUtcMonth(targetYear, month));
  return new Date(
    Date.UTC(
      targetYear,
      month,
      day,
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    ),
  );
}

function ceilingWholeYears(asOfDate: Date, targetDate: Date) {
  if (targetDate.getTime() <= asOfDate.getTime()) {
    throw new RetirementProjectionValidationError(
      "INVALID_HORIZON",
      "The target retirement date must be after asOfDate.",
      "targetRetirementDate",
    );
  }
  let years = targetDate.getUTCFullYear() - asOfDate.getUTCFullYear();
  if (addUtcYears(asOfDate, years).getTime() < targetDate.getTime()) years += 1;
  return years;
}

function validateProjectionYears(value: unknown, field: string) {
  const years = requireSafeInteger(value, field);
  if (years <= 0) {
    throw new RetirementProjectionValidationError(
      "INVALID_HORIZON",
      `${field} must be greater than zero.`,
      field,
    );
  }
  if (years > MAX_RETIREMENT_PROJECTION_YEARS) {
    throw new RetirementProjectionValidationError(
      "HORIZON_TOO_LONG",
      `${field} cannot exceed ${MAX_RETIREMENT_PROJECTION_YEARS} years.`,
      field,
    );
  }
  return years;
}

function validateAge(value: unknown, field: string) {
  const age = requireSafeInteger(value, field);
  if (age < 0 || age > 150) {
    throw new RetirementProjectionValidationError(
      "INVALID_HORIZON",
      `${field} must be between 0 and 150.`,
      field,
    );
  }
  return age;
}

function resolveHorizon(input: RetirementProjectionInput, asOfDate: Date): ResolvedHorizon {
  if (input.targetRetirementDate != null) {
    const targetDate = parseDate(input.targetRetirementDate, "targetRetirementDate");
    return {
      years: validateProjectionYears(
        ceilingWholeYears(asOfDate, targetDate),
        "projectionYears",
      ),
      targetDate,
      source: "TARGET_DATE",
    };
  }

  if (input.primaryBirthDate != null || (input.targetRetirementAge != null && input.currentAge == null)) {
    const birthDate = parseDate(input.primaryBirthDate, "primaryBirthDate");
    const targetAge = validateAge(input.targetRetirementAge, "targetRetirementAge");
    const targetDate = addUtcYears(birthDate, targetAge);
    return {
      years: validateProjectionYears(
        ceilingWholeYears(asOfDate, targetDate),
        "projectionYears",
      ),
      targetDate,
      source: "BIRTH_DATE_AND_TARGET_AGE",
    };
  }

  if (input.yearsToRetirement != null) {
    const years = validateProjectionYears(input.yearsToRetirement, "yearsToRetirement");
    return {
      years,
      targetDate: addUtcYears(asOfDate, years),
      source: "YEARS_TO_RETIREMENT",
    };
  }

  if (input.currentAge != null || input.targetRetirementAge != null) {
    const currentAge = validateAge(input.currentAge, "currentAge");
    const targetAge = validateAge(input.targetRetirementAge, "targetRetirementAge");
    const years = validateProjectionYears(targetAge - currentAge, "projectionYears");
    return {
      years,
      targetDate: addUtcYears(asOfDate, years),
      source: "CURRENT_AND_TARGET_AGE",
    };
  }

  throw new RetirementProjectionValidationError(
    "MISSING_INPUT",
    "Provide targetRetirementDate, birth date and target age, yearsToRetirement, or current and target ages.",
    "targetRetirementDate",
  );
}

function roundDivide(numerator: bigint, denominator: bigint) {
  // Public validation keeps inflation above -100% and periods strictly positive;
  // every divisor here is a fixed scale or one of those positive factors.
  const negative = numerator < BIGINT_ZERO;
  const absoluteNumerator = negative ? -numerator : numerator;
  const rounded = (absoluteNumerator + denominator / BIGINT_TWO) / denominator;
  return negative ? -rounded : rounded;
}

function divideRoundUp(numerator: bigint, denominator: bigint) {
  // Both callers validate nonnegative spending and a positive withdrawal rate.
  return (numerator + denominator - BIGINT_ONE) / denominator;
}

function applyRateBigInt(valueCents: bigint, rateBps: number) {
  return roundDivide(
    valueCents * BigInt(RETIREMENT_BASIS_POINTS_SCALE + rateBps),
    BigInt(RETIREMENT_BASIS_POINTS_SCALE),
  );
}

export function applyRateBpsToCents(valueCents: number, rateBps: number) {
  const amount = requireSafeInteger(valueCents, "valueCents");
  const rate = validateRate(rateBps, "rateBps", {
    minimum: -RETIREMENT_BASIS_POINTS_SCALE,
    maximum: 100_000,
  });
  return toSafeNumber(applyRateBigInt(BigInt(amount), rate), "resultCents");
}

export function calculateRetirementTargetFundCents(
  targetMonthlySpendingCents: number,
  sustainableWithdrawalRateBps: number,
) {
  const monthlySpending = validateNonnegativeCents(
    targetMonthlySpendingCents,
    "targetMonthlySpendingCents",
  );
  const withdrawalRate = validateRate(
    sustainableWithdrawalRateBps,
    "sustainableWithdrawalRateBps",
    { minimum: 0, maximum: RETIREMENT_BASIS_POINTS_SCALE, minimumExclusive: true },
  );
  const annualSpending = BigInt(monthlySpending) * BIGINT_TWELVE;
  return toSafeNumber(
    divideRoundUp(
      annualSpending * BigInt(RETIREMENT_BASIS_POINTS_SCALE),
      BigInt(withdrawalRate),
    ),
    "targetFundCents",
  );
}

export function calculateSustainableMonthlyIncomeCents(
  fundCents: number,
  sustainableWithdrawalRateBps: number,
) {
  const fund = validateNonnegativeCents(fundCents, "fundCents");
  const withdrawalRate = validateRate(
    sustainableWithdrawalRateBps,
    "sustainableWithdrawalRateBps",
    { minimum: 0, maximum: RETIREMENT_BASIS_POINTS_SCALE, minimumExclusive: true },
  );
  return toSafeNumber(
    roundDivide(
      BigInt(fund) * BigInt(withdrawalRate),
      BigInt(RETIREMENT_BASIS_POINTS_SCALE) * BIGINT_TWELVE,
    ),
    "sustainableMonthlyIncomeCents",
  );
}

function prorateAnnualRateBps(annualRateBps: number, annualFractionBps: number) {
  return Number(roundDivide(
    BigInt(annualRateBps) * BigInt(annualFractionBps),
    BigInt(RETIREMENT_BASIS_POINTS_SCALE),
  ));
}

function buildInflationFactors(periods: readonly ProjectionPeriod[], inflationBps: number) {
  const factors: InflationFactor[] = [{ scalePower: BIGINT_ONE, inflationIndex: BIGINT_ONE }];
  const scale = BigInt(RETIREMENT_BASIS_POINTS_SCALE);
  for (const period of periods) {
    const previous = factors.at(-1)!;
    const periodInflationBps = prorateAnnualRateBps(inflationBps, period.annualFractionBps);
    factors.push({
      scalePower: previous.scalePower * scale,
      inflationIndex: previous.inflationIndex * BigInt(RETIREMENT_BASIS_POINTS_SCALE + periodInflationBps),
    });
  }
  return factors;
}

function valueInTodaysCents(nominalValueCents: bigint, factor: InflationFactor) {
  return roundDivide(
    nominalValueCents * factor.scalePower,
    factor.inflationIndex,
  );
}

function valueAtFuturePrices(realValueCents: bigint, factor: InflationFactor) {
  return roundDivide(
    realValueCents * factor.inflationIndex,
    factor.scalePower,
  );
}

function buildProjectionPeriods(asOfDate: Date, targetDate: Date, years: number) {
  const periods: ProjectionPeriod[] = [];
  let startDate = asOfDate;
  for (let year = 1; year <= years; year += 1) {
    const fullYearEnd = addUtcYears(asOfDate, year);
    const endDate = year === years ? targetDate : fullYearEnd;
    const elapsedMs = BigInt(endDate.getTime() - startDate.getTime());
    const fullYearMs = BigInt(fullYearEnd.getTime() - startDate.getTime());
    const annualFractionBps = Number(roundDivide(
      elapsedMs * BigInt(RETIREMENT_BASIS_POINTS_SCALE),
      fullYearMs,
    ));
    periods.push({
      endDate,
      annualFractionBps,
      contributionDue: endDate.getTime() === fullYearEnd.getTime(),
    });
    startDate = endDate;
  }
  return periods;
}

function calculateIncomeBigInt(fundCents: bigint, withdrawalRateBps: number) {
  return roundDivide(
    fundCents * BigInt(withdrawalRateBps),
    BigInt(RETIREMENT_BASIS_POINTS_SCALE) * BIGINT_TWELVE,
  );
}

function buildOutcome(
  nominalFund: bigint,
  realFund: bigint,
  nominalTargetFund: bigint,
  realTargetFund: bigint,
  withdrawalRateBps: number,
): RetirementScenarioOutcome {
  const nominalDifference = nominalFund - nominalTargetFund;
  const realDifference = realFund - realTargetFund;
  return {
    nominalFundCents: toSafeNumber(nominalFund, "outcome.nominalFundCents"),
    realFundCents: toSafeNumber(realFund, "outcome.realFundCents"),
    nominalSustainableMonthlyIncomeCents: toSafeNumber(
      calculateIncomeBigInt(nominalFund, withdrawalRateBps),
      "outcome.nominalSustainableMonthlyIncomeCents",
    ),
    realSustainableMonthlyIncomeCents: toSafeNumber(
      calculateIncomeBigInt(realFund, withdrawalRateBps),
      "outcome.realSustainableMonthlyIncomeCents",
    ),
    nominalTargetGapCents: toSafeNumber(
      nominalDifference < BIGINT_ZERO ? -nominalDifference : BIGINT_ZERO,
      "outcome.nominalTargetGapCents",
    ),
    nominalTargetSurplusCents: toSafeNumber(
      nominalDifference > BIGINT_ZERO ? nominalDifference : BIGINT_ZERO,
      "outcome.nominalTargetSurplusCents",
    ),
    realTargetGapCents: toSafeNumber(
      realDifference < BIGINT_ZERO ? -realDifference : BIGINT_ZERO,
      "outcome.realTargetGapCents",
    ),
    realTargetSurplusCents: toSafeNumber(
      realDifference > BIGINT_ZERO ? realDifference : BIGINT_ZERO,
      "outcome.realTargetSurplusCents",
    ),
  };
}

function projectScenario(options: {
  scenario: RetirementScenarioKey;
  returnBps: number;
  currentAssetsCents: number;
  annualContributionCents: number;
  contributionGrowthBps: number;
  asOfDate: Date;
  periods: readonly ProjectionPeriod[];
  inflationFactors: readonly InflationFactor[];
  nominalTargetFund: bigint;
  realTargetFund: bigint;
  withdrawalRateBps: number;
}): RetirementScenarioProjection {
  let nominalValue = BigInt(options.currentAssetsCents);
  let contribution = BigInt(options.annualContributionCents);
  const points: RetirementProjectionPoint[] = [
    {
      yearIndex: 0,
      date: toIsoDate(options.asOfDate),
      nominalValueCents: options.currentAssetsCents,
      realValueCents: options.currentAssetsCents,
      contributionCents: 0,
    },
  ];

  for (let year = 1; year <= options.periods.length; year += 1) {
    const period = options.periods[year - 1];
    const periodReturnBps = prorateAnnualRateBps(options.returnBps, period.annualFractionBps);
    const appliedContribution = period.contributionDue ? contribution : BIGINT_ZERO;
    nominalValue = applyRateBigInt(nominalValue, periodReturnBps) + appliedContribution;
    if (nominalValue < BIGINT_ZERO) nominalValue = BIGINT_ZERO;
    const realValue = valueInTodaysCents(nominalValue, options.inflationFactors[year]);
    points.push({
      yearIndex: year,
      date: toIsoDate(period.endDate),
      nominalValueCents: toSafeNumber(nominalValue, `points[${year}].nominalValueCents`),
      realValueCents: toSafeNumber(realValue, `points[${year}].realValueCents`),
      contributionCents: toSafeNumber(appliedContribution, `points[${year}].contributionCents`),
    });
    if (period.contributionDue) {
      contribution = applyRateBigInt(contribution, options.contributionGrowthBps);
    }
  }

  const finalRealValue = valueInTodaysCents(
    nominalValue,
    options.inflationFactors.at(-1)!,
  );
  return {
    scenario: options.scenario,
    nominalReturnBps: options.returnBps,
    points,
    outcome: buildOutcome(
      nominalValue,
      finalRealValue,
      options.nominalTargetFund,
      options.realTargetFund,
      options.withdrawalRateBps,
    ),
  };
}

export function projectRetirement(input: RetirementProjectionInput): RetirementProjectionResult {
  const asOfDate = parseDate(input.asOfDate, "asOfDate");
  if (input.primaryBirthDate != null) {
    const primaryBirthDate = parseDate(input.primaryBirthDate, "primaryBirthDate");
    if (primaryBirthDate.getTime() > asOfDate.getTime()) {
      throw new RetirementProjectionValidationError(
        "INVALID_HORIZON",
        "primaryBirthDate cannot be after asOfDate.",
        "primaryBirthDate",
      );
    }
  }
  const currentAssets = validateNonnegativeCents(
    input.currentRetirementAssetsCents,
    "currentRetirementAssetsCents",
  );
  const annualContribution = requireSafeInteger(
    input.annualExternalContributionCents,
    "annualExternalContributionCents",
  );
  const contributionGrowthBps = validateRate(
    input.contributionGrowthBps ?? 0,
    "contributionGrowthBps",
    { minimum: -RETIREMENT_BASIS_POINTS_SCALE, maximum: 100_000 },
  );
  const bearReturnBps = validateRate(input.bearReturnBps, "bearReturnBps", {
    minimum: -RETIREMENT_BASIS_POINTS_SCALE,
    maximum: 100_000,
  });
  const baseReturnBps = validateRate(input.baseReturnBps, "baseReturnBps", {
    minimum: -RETIREMENT_BASIS_POINTS_SCALE,
    maximum: 100_000,
  });
  const bullReturnBps = validateRate(input.bullReturnBps, "bullReturnBps", {
    minimum: -RETIREMENT_BASIS_POINTS_SCALE,
    maximum: 100_000,
  });
  if (bearReturnBps > baseReturnBps || baseReturnBps > bullReturnBps) {
    throw new RetirementProjectionValidationError(
      "INVALID_RATE",
      "Return assumptions must be ordered bear <= base <= bull.",
      "bearReturnBps",
    );
  }
  const inflationBps = validateRate(input.inflationBps, "inflationBps", {
    minimum: -RETIREMENT_BASIS_POINTS_SCALE,
    maximum: 100_000,
    minimumExclusive: true,
  });
  const targetMonthlySpending = validateNonnegativeCents(
    input.targetMonthlyRetirementSpendingCents,
    "targetMonthlyRetirementSpendingCents",
  );
  const withdrawalRateBps = validateRate(
    input.sustainableWithdrawalRateBps,
    "sustainableWithdrawalRateBps",
    { minimum: 0, maximum: RETIREMENT_BASIS_POINTS_SCALE, minimumExclusive: true },
  );
  const horizon = resolveHorizon(input, asOfDate);
  const periods = buildProjectionPeriods(asOfDate, horizon.targetDate, horizon.years);
  const inflationFactors = buildInflationFactors(periods, inflationBps);

  const annualSpending = BigInt(targetMonthlySpending) * BIGINT_TWELVE;
  const realTargetFund = divideRoundUp(
    annualSpending * BigInt(RETIREMENT_BASIS_POINTS_SCALE),
    BigInt(withdrawalRateBps),
  );
  const finalInflationFactor = inflationFactors.at(-1)!;
  const nominalTargetFund = valueAtFuturePrices(realTargetFund, finalInflationFactor);
  const nominalMonthlySpending = valueAtFuturePrices(
    BigInt(targetMonthlySpending),
    finalInflationFactor,
  );

  const sharedScenarioOptions = {
    currentAssetsCents: currentAssets,
    annualContributionCents: annualContribution,
    contributionGrowthBps,
    asOfDate,
    periods,
    inflationFactors,
    nominalTargetFund,
    realTargetFund,
    withdrawalRateBps,
  };
  const scenarios = {
    bear: projectScenario({
      ...sharedScenarioOptions,
      scenario: "bear",
      returnBps: bearReturnBps,
    }),
    base: projectScenario({
      ...sharedScenarioOptions,
      scenario: "base",
      returnBps: baseReturnBps,
    }),
    bull: projectScenario({
      ...sharedScenarioOptions,
      scenario: "bull",
      returnBps: bullReturnBps,
    }),
  } satisfies Record<RetirementScenarioKey, RetirementScenarioProjection>;

  return {
    assumptions: {
      asOfDate: toIsoDate(asOfDate),
      resolvedTargetRetirementDate: toIsoDate(horizon.targetDate),
      projectionYears: horizon.years,
      horizonSource: horizon.source,
      currentRetirementAssetsCents: currentAssets,
      annualExternalContributionCents: annualContribution,
      contributionGrowthBps,
      bearReturnBps,
      baseReturnBps,
      bullReturnBps,
      inflationBps,
      targetMonthlyRetirementSpendingCents: targetMonthlySpending,
      sustainableWithdrawalRateBps: withdrawalRateBps,
      contributionTiming: "END_OF_YEAR",
      rateScaleBps: RETIREMENT_BASIS_POINTS_SCALE,
      // A validated horizon contains at least one projection period.
      finalPeriodFractionBps: periods.at(-1)!.annualFractionBps,
      horizonRounding: "FULL_YEARS_PLUS_PRORATED_FINAL_PERIOD",
    },
    target: {
      monthlySpendingTodayCents: targetMonthlySpending,
      annualSpendingTodayCents: toSafeNumber(annualSpending, "target.annualSpendingTodayCents"),
      realFundCents: toSafeNumber(realTargetFund, "target.realFundCents"),
      nominalMonthlySpendingAtRetirementCents: toSafeNumber(
        nominalMonthlySpending,
        "target.nominalMonthlySpendingAtRetirementCents",
      ),
      nominalFundAtRetirementCents: toSafeNumber(
        nominalTargetFund,
        "target.nominalFundAtRetirementCents",
      ),
    },
    scenarios,
  };
}

export const runRetirementProjection = projectRetirement;
