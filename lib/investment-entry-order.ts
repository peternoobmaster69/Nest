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
