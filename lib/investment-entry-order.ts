export type OrderableInvestmentEntry = {
  id: string;
  date: string | Date;
  createdAt?: string | Date | null;
};

export type InvestedAmountEntry = OrderableInvestmentEntry & {
  investedCents: number;
};

export type AnnualInvestmentContribution = {
  year: number;
  contributedCents: number;
};

export type InvestmentCashFlow = {
  date: Date;
  amountCents: number;
};

export type ValuedInvestmentEntry = InvestedAmountEntry & {
  currentValueCents: number;
};

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const MIN_ANNUALIZATION_SPAN_YEARS = 30 / 365.25;

export type InvestmentContributionAccount<T extends InvestedAmountEntry> = {
  inceptionDate?: string | Date | null;
  entries: readonly T[];
};

function timestamp(value: string | Date | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const result = new Date(value).getTime();
  return Number.isNaN(result) ? Number.NEGATIVE_INFINITY : result;
}

function compareTimestamps(a: string | Date | null | undefined, b: string | Date | null | undefined) {
  const aTimestamp = timestamp(a);
  const bTimestamp = timestamp(b);
  if (aTimestamp === bTimestamp) return 0;
  return aTimestamp < bTimestamp ? -1 : 1;
}

/**
 * Orders snapshots from oldest to newest. Creation time and id make same-day
 * entries deterministic, matching the ordering used by the investments API.
 */
export function compareInvestmentEntries<T extends OrderableInvestmentEntry>(a: T, b: T) {
  const dateDifference = compareTimestamps(a.date, b.date);
  if (dateDifference !== 0) return dateDifference;

  const creationDifference = compareTimestamps(a.createdAt, b.createdAt);
  if (creationDifference !== 0) return creationDifference;

  return a.id.localeCompare(b.id);
}

export function getLatestInvestmentEntry<T extends OrderableInvestmentEntry>(entries: readonly T[]) {
  return entries.reduce<T | null>(
    (latest, entry) => (!latest || compareInvestmentEntries(latest, entry) < 0 ? entry : latest),
    null,
  );
}

/**
 * Derives annual net contributions from cumulative invested snapshots.
 * Each account starts at zero in its first recorded year so the annual changes
 * reconcile to the portfolio's recorded invested total. Valuation changes
 * never affect this amount.
 */
export function calculateAnnualInvestmentContributions<T extends InvestedAmountEntry>(
  accounts: readonly InvestmentContributionAccount<T>[],
  through?: string | number | Date,
) {
  const contributionsByYear = new Map<number, number>();
  const throughTimestamp = through === undefined ? Number.POSITIVE_INFINITY : new Date(through).getTime();

  for (const account of accounts) {
    const entries = [...account.entries]
      .sort(compareInvestmentEntries)
      .filter((entry) => {
        const timestamp = new Date(entry.date).getTime();
        return !Number.isNaN(timestamp) && timestamp <= throughTimestamp;
      });
    const firstEntry = entries[0];
    if (!firstEntry) continue;

    const entriesByYear = new Map<number, T[]>();
    for (const entry of entries) {
      const year = new Date(entry.date).getFullYear();
      const yearEntries = entriesByYear.get(year) ?? [];
      yearEntries.push(entry);
      entriesByYear.set(year, yearEntries);
    }

    let previousInvestedCents = 0;

    for (const [year, yearEntries] of entriesByYear) {
      const endingInvestedCents = yearEntries[yearEntries.length - 1].investedCents;
      const contributedCents = endingInvestedCents - previousInvestedCents;
      contributionsByYear.set(year, (contributionsByYear.get(year) ?? 0) + contributedCents);
      previousInvestedCents = endingInvestedCents;
    }
  }

  return Array.from(contributionsByYear, ([year, contributedCents]) => ({ year, contributedCents }))
    .sort((a, b) => b.year - a.year);
}

/**
 * Turns cumulative invested/valuation snapshots into signed cash flows from
 * the investor's perspective: a rise in invested capital is money going out
 * (a contribution), a fall is money coming back (a withdrawal), and the
 * latest current value is added as a final inflow, as if liquidated today.
 * This is the input XIRR needs to weight a return by *when* money went in,
 * not just how much.
 */
export function buildInvestmentCashFlows<T extends ValuedInvestmentEntry>(
  entries: readonly T[],
): InvestmentCashFlow[] {
  const sorted = [...entries].sort(compareInvestmentEntries);
  if (!sorted.length) return [];

  const flows: InvestmentCashFlow[] = [];
  let previousInvestedCents = 0;
  for (const entry of sorted) {
    const contributedCents = entry.investedCents - previousInvestedCents;
    if (contributedCents !== 0) {
      flows.push({ date: new Date(entry.date), amountCents: -contributedCents });
    }
    previousInvestedCents = entry.investedCents;
  }

  const latest = sorted[sorted.length - 1];
  if (latest.currentValueCents !== 0) {
    flows.push({ date: new Date(latest.date), amountCents: latest.currentValueCents });
  }

  return flows;
}

/**
 * Solves for the annualized, money-weighted rate of return (XIRR) implied by
 * a set of dated cash flows, as a percentage. Returns null when the flows
 * don't bracket a solvable rate or span too little time to annualize
 * meaningfully (a short window turns small moves into extreme percentages).
 */
export function calculateAnnualizedReturn(cashFlows: readonly InvestmentCashFlow[]): number | null {
  const sorted = [...cashFlows].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (sorted.length < 2) return null;

  const startMs = sorted[0].date.getTime();
  const endMs = sorted[sorted.length - 1].date.getTime();
  const spanYears = (endMs - startMs) / MS_PER_YEAR;
  if (spanYears < MIN_ANNUALIZATION_SPAN_YEARS) return null;

  const hasOutflow = sorted.some((flow) => flow.amountCents < 0);
  const hasInflow = sorted.some((flow) => flow.amountCents > 0);
  if (!hasOutflow || !hasInflow) return null;

  const yearsFromStart = sorted.map((flow) => (flow.date.getTime() - startMs) / MS_PER_YEAR);
  const netPresentValue = (rate: number) => {
    if (rate <= -1) return Number.POSITIVE_INFINITY;
    return sorted.reduce(
      (sum, flow, index) => sum + flow.amountCents / Math.pow(1 + rate, yearsFromStart[index]),
      0,
    );
  };

  const low = -0.9999;
  let high = 10;
  const npvLow = netPresentValue(low);
  let npvHigh = netPresentValue(high);

  let widenAttempts = 0;
  while (npvLow * npvHigh > 0 && widenAttempts < 40) {
    high *= 2;
    npvHigh = netPresentValue(high);
    widenAttempts += 1;
  }
  if (npvLow * npvHigh > 0 || Number.isNaN(npvLow) || Number.isNaN(npvHigh)) return null;

  let rate = 0;
  let lowBound = low;
  let highBound = high;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    rate = (lowBound + highBound) / 2;
    const value = netPresentValue(rate);
    if (Math.abs(value) < 1) break;
    if ((value > 0) === (npvLow > 0)) {
      lowBound = rate;
    } else {
      highBound = rate;
    }
  }

  return rate * 100;
}
