export type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  defaultAccountId: string | null;
  defaultBudgetId: string | null;
  baseCurrency?: string | null;
  workspaces: Array<{ id: string; name: string }>;
};

export type DeductionAccount = {
  id: string;
  name: string;
  workspaceId: string;
  workspace: {
    id: string;
    name: string;
  };
};

export type Receivable = {
  id: string;
  updatedAt: string;
  title: string;
  amountCents: number;
  date: string;
  transactionDate?: string | null;
  remarkTogether?: string | null;
  notes?: string | null;
  status: "OPEN" | "PARTIAL" | "PAID" | "VOID";
  accountId?: string | null;
  budgetId?: string | null;
  account?: DeductionAccount | null;
  budget?: {
    id: string;
    name: string;
    availableCents: number;
  } | null;
  subaccount?: {
    id: string;
    name: string;
  } | null;
};

export type DeductionBudget = {
  id: string;
  name: string;
  icon?: string | null;
  accountId: string;
  isActive: boolean;
  availableCents: number;
};

export function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

export function toIsoFromDateInput(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

export function toDateInputFromIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayDateInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getMonthEndDateInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return todayDateInputValue();
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  const year = monthEnd.getUTCFullYear();
  const month = String(monthEnd.getUTCMonth() + 1).padStart(2, "0");
  const day = String(monthEnd.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

