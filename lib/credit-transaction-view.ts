import type { SmartReviewAction, SmartReviewSuggestion } from "@/lib/ai/smart-review-types";

export type CreditCard = {
  id: string;
  cardName: string;
  bankName: string | null;
  last4Digit: string;
};

export type CreditCardTransaction = {
  id: string;
  updatedAt: string;
  creditCardId: string;
  transactionDate: string;
  paymentDueDate: string | null;
  statementMonth: number;
  statementYear: number;
  amountCents: number;
  subject: string;
  isAllocated: boolean;
  creditCard: {
    cardName: string;
    bankName: string | null;
  };
};

export type CardCount = {
  creditCardId: string;
  _count: { id: number };
};

export type CreditTransactionSummary = {
  totalAmountCents: number;
  unaccountedAmountCents: number;
  earliestPaymentDueDate: string | null;
};

export type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  baseCurrency?: string | null;
  defaultAccountId?: string | null;
  defaultBudgetId?: string | null;
  workspaces?: Array<{ id: string; name: string }>;
};

export type Budget = {
  id: string;
  accountId: string;
  name: string;
  isActive: boolean;
  availableCents: number;
};

export type CreditTransactionsQueryData = {
  transactions: CreditCardTransaction[];
  cardCounts: CardCount[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  summary: CreditTransactionSummary;
};

export type CreditCardPaymentResponse = {
  ok: true;
  paidAmountCents: number;
  outstandingAmountCents: number;
  bankTransactionId: string;
  paymentTransaction: CreditCardTransaction;
};

export type PaymentDueMonthsResponse = {
  months: Array<{
    statementMonth: number;
    paymentDueDate: string;
  }>;
};

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const EMPTY_CREDIT_TRANSACTION_SUMMARY: CreditTransactionSummary = {
  totalAmountCents: 0,
  unaccountedAmountCents: 0,
  earliestPaymentDueDate: null,
};

export function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function getDateGroupDetails(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return { key: dateStr, label: dateStr, dateTime: "" };
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    key: `${year}-${month}-${day}`,
    label: `${WEEKDAYS[date.getDay()]}, ${formatDate(dateStr)}`,
    dateTime: `${year}-${month}-${day}`,
  };
}

export function toDateInputValue(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function toMonthEndDateInputValue(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return monthEnd.toISOString().slice(0, 10);
}

export function getDaysUntil(dateStr: string): number {
  const date = new Date(dateStr);
  const today = new Date();
  const dueDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const currentDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((dueDay - currentDay) / (1000 * 60 * 60 * 24));
}

export function getPaymentDueTone(paymentDueDate: string) {
  return getDaysUntil(paymentDueDate) <= 5 ? "is-due-soon" : "is-due-later";
}

export function getPaymentDueLabel(days: number | null) {
  if (days === null) return "No payment due date set";
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "Payment due today";
  if (days === 1) return "Payment due tomorrow";
  return `Payment due in ${days} days`;
}

export function parseCreditMonthFilter(queryMonth: string | null, savedMonth: string | null) {
  if (queryMonth === "all" || queryMonth === "-1") return -1;
  if (queryMonth !== null) {
    const month = Number.parseInt(queryMonth, 10);
    return month >= 1 && month <= 12 ? month - 1 : undefined;
  }
  if (savedMonth === null) return undefined;
  const month = Number.parseInt(savedMonth, 10);
  return month >= -1 && month <= 11 ? month : undefined;
}

export function getPaymentDuePresentation(sharedDate: string) {
  const date = sharedDate ? `${sharedDate}T00:00:00.000Z` : null;
  const days = date ? getDaysUntil(date) : null;
  let tone = "";
  let icon = "";
  if (days !== null && days < 0) {
    tone = "overdue";
    icon = "⚠️ ";
  } else if (days !== null && days <= 3) {
    tone = "urgent";
    icon = "⏰ ";
  }
  return { date, label: getPaymentDueLabel(days), tone, icon };
}

export function describeCreditCard(card: CreditCard | null, count: number) {
  if (card) return `${card.bankName || "Card"} ••${card.last4Digit}`;
  return `${count} ${count === 1 ? "card" : "cards"}`;
}

export function getPaymentDueUpdateMessage(count: number) {
  if (count <= 0) return "No transactions matched this statement month.";
  return `Payment due updated for ${count} transaction${count === 1 ? "" : "s"}.`;
}

export function getSmartReviewConfidenceLabel(confidence: SmartReviewSuggestion["confidence"]) {
  if (confidence === "STRONG_MATCH") return "Strong match";
  if (confidence === "NEEDS_REVIEW") return "Needs review";
  return "No reliable match";
}

export function getSmartReviewProposal(suggestion: SmartReviewSuggestion) {
  if (suggestion.state === "POSSIBLE_DUPLICATE") return "Check possible duplicate";
  if (suggestion.state === "POSSIBLE_REVERSAL") return "Check possible reversal";
  return describeSmartReviewAction(suggestion.action);
}

export function describeSmartReviewEffect(action: SmartReviewAction) {
  if (action.type === "RECEIVABLE") return "recorded as a receivable";
  const destination = action.destinationBudgetName ? ` and credited to ${action.destinationBudgetName}` : "";
  return `deducted from ${action.budgetName}${destination}`;
}

export function describeSmartReviewAction(action: SmartReviewAction | null) {
  if (!action) return "No accounting action suggested";
  if (action.type === "RECEIVABLE") {
    return action.budgetName
      ? `Create receivable · ${action.budgetName}`
      : "Create receivable";
  }
  return action.destinationBudgetName
    ? `${action.budgetName} → ${action.destinationBudgetName}`
    : `Deduct from ${action.accountName} · ${action.budgetName}`;
}
