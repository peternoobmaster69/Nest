export const TRANSACTION_ALL_PERIOD = "all" as const;
export const TRANSACTION_CUSTOM_PERIOD = "custom" as const;

export type TransactionQuickPeriod = "thisMonth" | "lastMonth" | "thisYear";
export type TransactionPeriod =
  | TransactionQuickPeriod
  | typeof TRANSACTION_ALL_PERIOD
  | typeof TRANSACTION_CUSTOM_PERIOD;

const TRANSACTION_QUICK_PERIODS = new Set<TransactionQuickPeriod>([
  "thisMonth",
  "lastMonth",
  "thisYear",
]);

export function isTransactionQuickPeriod(value: string | null): value is TransactionQuickPeriod {
  return Boolean(value && TRANSACTION_QUICK_PERIODS.has(value as TransactionQuickPeriod));
}

function formatLocalCalendarDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTransactionQuickPeriodDateRange(
  period: TransactionQuickPeriod,
  now = new Date(),
) {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (period) {
    case "thisMonth":
      return {
        from: formatLocalCalendarDate(new Date(year, month, 1)),
        to: formatLocalCalendarDate(new Date(year, month + 1, 0)),
      };
    case "lastMonth":
      return {
        from: formatLocalCalendarDate(new Date(year, month - 1, 1)),
        to: formatLocalCalendarDate(new Date(year, month, 0)),
      };
    case "thisYear":
      return {
        from: `${year}-01-01`,
        to: `${year}-12-31`,
      };
  }
}

export function getTransactionPeriodParam(activeQuickSelect: string | null): TransactionPeriod {
  if (activeQuickSelect === null) return TRANSACTION_ALL_PERIOD;
  if (isTransactionQuickPeriod(activeQuickSelect)) return activeQuickSelect;
  return TRANSACTION_CUSTOM_PERIOD;
}
