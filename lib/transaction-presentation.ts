export function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

export function formatTransactionDate(dateString: string): string {
  const date = new Date(dateString);
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  // Hide time if time is midnight (00:00:00) or top of any hour (XX:00:00)
  if (minutes === 0 && seconds === 0) {
    return date.toLocaleDateString();
  }
  return date.toLocaleString();
}

const transactionGroupMonthYearFormatter = new Intl.DateTimeFormat("en-SG", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatTransactionGroupDateRange(firstDateString?: string | null, lastDateString?: string | null): string {
  if (!firstDateString || !lastDateString) return "No transaction dates";

  const firstDate = new Date(firstDateString);
  const lastDate = new Date(lastDateString);
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(lastDate.getTime())) return "No transaction dates";

  const firstLabel = transactionGroupMonthYearFormatter.format(firstDate);
  const lastLabel = transactionGroupMonthYearFormatter.format(lastDate);
  const isSameMonth =
    firstDate.getUTCFullYear() === lastDate.getUTCFullYear() && firstDate.getUTCMonth() === lastDate.getUTCMonth();

  return isSameMonth ? firstLabel : `${firstLabel} – ${lastLabel}`;
}

export function normalizeTransactionGroupSearchValue(value: string): string {
  return value.toLocaleLowerCase().replace(/[–—-]/g, " ").replace(/\s+/g, " ").trim();
}
