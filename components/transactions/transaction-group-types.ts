export type TransactionGroup = {
  id: string;
  budgetId: string;
  name: string;
  icon?: string | null;
  transactionCount: number;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  firstTransactionDate?: string | null;
  lastTransactionDate?: string | null;
};
