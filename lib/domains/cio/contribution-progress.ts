export type CioContributionProgress = {
  year: number;
  status: "ON_TRACK" | "BEHIND";
  actualYtdCents: number;
  expectedToDateCents: number;
  annualTargetCents: number;
  paceGapCents: number;
  remainingAnnualCents: number;
  annualProgressBps: number;
  calendarProgressBps: number;
  contributionGrowthRateBps: number;
  targetSource: "DERIVED" | "OVERRIDE";
};

function roundedRatio(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / BigInt(2)) / denominator;
}

function safeNumber(value: bigint, field: string) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds the supported calculation range`);
  }
  return Number(value);
}

export function calculateCioContributionProgress(params: {
  asOfDate: Date;
  actualYtdCents: number;
  annualTargetCents: number;
  contributionGrowthRateBps: number;
  targetSource: CioContributionProgress["targetSource"];
}): CioContributionProgress {
  const year = params.asOfDate.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const nextYearStart = Date.UTC(year + 1, 0, 1);
  const dayMs = 24 * 60 * 60 * 1_000;
  const daysInYear = Math.round((nextYearStart - yearStart) / dayMs);
  const elapsedDays = Math.min(
    daysInYear,
    Math.max(1, Math.floor((params.asOfDate.getTime() - yearStart) / dayMs) + 1),
  );
  const target = BigInt(params.annualTargetCents);
  const actual = BigInt(params.actualYtdCents);
  const expected = roundedRatio(target * BigInt(elapsedDays), BigInt(daysInYear));
  const paceGap = actual - expected;
  const remaining = target > actual ? target - actual : BigInt(0);
  const annualProgressBps = target > BigInt(0)
    ? Number(roundedRatio(actual * BigInt(10_000), target))
    : actual >= BigInt(0) ? 10_000 : 0;
  const calendarProgressBps = Number(roundedRatio(
    BigInt(elapsedDays) * BigInt(10_000),
    BigInt(daysInYear),
  ));

  return {
    year,
    status: paceGap >= BigInt(0) ? "ON_TRACK" : "BEHIND",
    actualYtdCents: params.actualYtdCents,
    expectedToDateCents: safeNumber(expected, "expected contribution"),
    annualTargetCents: params.annualTargetCents,
    paceGapCents: safeNumber(paceGap, "contribution pace gap"),
    remainingAnnualCents: safeNumber(remaining, "remaining annual contribution"),
    annualProgressBps: Math.max(0, annualProgressBps),
    calendarProgressBps,
    contributionGrowthRateBps: params.contributionGrowthRateBps,
    targetSource: params.targetSource,
  };
}
