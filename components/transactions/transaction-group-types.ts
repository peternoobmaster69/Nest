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

export type GroupTransactionOption = {
  id: string;
  subject: string;
  date: string;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  groupId?: string | null;
  group?: Pick<TransactionGroup, "id" | "name" | "icon"> | null;
};

export type TransactionGroupDetail = {
  group: Pick<TransactionGroup, "id" | "budgetId" | "name" | "icon">;
  memberIds: string[];
  transactions: GroupTransactionOption[];
  candidateLimit: number;
};
