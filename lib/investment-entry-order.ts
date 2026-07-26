export type OrderableInvestmentEntry = {
  id: string;
  date: string | Date;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
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
 * Orders snapshots from oldest to newest. Snapshot date remains the primary
 * ordering signal, while update time lets edited same-day entries refresh
 * account cards immediately. Creation time and id keep ties deterministic.
 */
export function compareInvestmentEntries<T extends OrderableInvestmentEntry>(a: T, b: T) {
  const dateDifference = compareTimestamps(a.date, b.date);
  if (dateDifference !== 0) return dateDifference;

  const updateDifference = compareTimestamps(a.updatedAt, b.updatedAt);
  if (updateDifference !== 0) return updateDifference;

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
