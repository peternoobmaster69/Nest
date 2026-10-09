import { getTransactionQuickPeriodDateRange, isTransactionQuickPeriod, TRANSACTION_ALL_PERIOD, type TransactionQuickPeriod } from "@/lib/transaction-date-filters";

type QueryParameters = Pick<URLSearchParams, "get">;
type FilterAccount = { id: string; name: string; bankName?: string | null };
type FilterBudget = { id: string; accountId: string; name: string };
type DateSelection = {
  activeQuickSelect: TransactionQuickPeriod | "custom" | null;
  customMonths: string[];
  dateFilter: { from?: string; to?: string };
};

function requestedAccountId(parameters: QueryParameters, accounts: readonly FilterAccount[]) {
  const id = parameters.get("accountId");
  if (id && accounts.some((account) => account.id === id)) return id;
  const name = parameters.get("accountName")?.trim().toLocaleLowerCase();
  if (!name) return "";
  return accounts.find((account) => account.name.toLocaleLowerCase().includes(name) || account.bankName?.toLocaleLowerCase().includes(name))?.id ?? "";
}

function requestedBudget(parameters: QueryParameters, budgets: readonly FilterBudget[]) {
  const id = parameters.get("budgetId");
  if (id) return budgets.find((budget) => budget.id === id);
  const name = parameters.get("budgetName")?.trim().toLocaleLowerCase();
  return name ? budgets.find((budget) => budget.name.toLocaleLowerCase().includes(name)) : undefined;
}

function requestedDates(parameters: QueryParameters, askNestView: boolean, now: Date): DateSelection | null {
  const period = parameters.get("period");
  if (period === TRANSACTION_ALL_PERIOD) return { activeQuickSelect: null, customMonths: [], dateFilter: {} };
  if (isTransactionQuickPeriod(period)) return { activeQuickSelect: period, customMonths: [], dateFilter: getTransactionQuickPeriodDateRange(period, now) };
  const requestedMonths = parameters.get("months");
  const months = requestedMonths
    ? [...new Set(requestedMonths.split(",").filter((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)))].slice(0, 24)
    : [];
  if (months.length) {
    const sorted = months.toSorted((left, right) => left.localeCompare(right));
    const [firstYear, firstMonth] = sorted[0].split("-").map(Number);
    const [lastYear, lastMonth] = sorted.at(-1)!.split("-").map(Number);
    return {
      activeQuickSelect: "custom",
      customMonths: sorted,
      dateFilter: {
        from: new Date(Date.UTC(firstYear, firstMonth - 1, 1)).toISOString().split("T")[0],
        to: new Date(Date.UTC(lastYear, lastMonth, 0)).toISOString().split("T")[0],
      },
    };
  }
  const from = parameters.get("from");
  const to = parameters.get("to");
  if (from || to) return { activeQuickSelect: "custom", customMonths: [], dateFilter: { from: from || undefined, to: to || undefined } };
  return askNestView ? { activeQuickSelect: null, customMonths: [], dateFilter: {} } : null;
}

/** Resolve shareable filters against the records the current workspace can access. */
export function resolveTransactionUrlFilters(parameters: QueryParameters, accounts: readonly FilterAccount[], budgets: readonly FilterBudget[], now = new Date()) {
  const askNestView = parameters.get("view") === "ask-nest";
  const search = parameters.get("search")?.trim().slice(0, 120) ?? "";
  const period = parameters.get("period");
  const hasFilters = ["accountId", "budgetId", "groupId", "transactionId", "from", "to", "months"].some((key) => Boolean(parameters.get(key)));
  if (!askNestView && !hasFilters && !search && period !== TRANSACTION_ALL_PERIOD && !isTransactionQuickPeriod(period)) return null;

  const budget = requestedBudget(parameters, budgets);
  const accountId = requestedAccountId(parameters, accounts) || budget?.accountId || "";
  const compatibleBudget = budget && (!accountId || budget.accountId === accountId);
  return {
    accountId,
    budgetId: compatibleBudget ? budget.id : "ALL",
    groupId: compatibleBudget ? parameters.get("groupId") || "ALL" : "ALL",
    search,
    dates: requestedDates(parameters, askNestView, now),
  };
}

export function transactionMonthSummaryUrl(workspaceId: string, accountId: string, budgetId: string) {
  const query = new URLSearchParams({ workspaceId });
  if (accountId) query.set("accountId", accountId);
  if (budgetId !== "ALL") query.set("budgetId", budgetId);
  return `/api/transactions/months?${query}`;
}
