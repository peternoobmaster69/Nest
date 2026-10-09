import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type TransactionRow = {
  id: string;
  subject: string;
  date: string;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  group?: { name: string; icon?: string | null } | null;
  hasCorrectionHistory?: boolean;
};

type MonthGroup<T extends TransactionRow> = {
  monthKey: string;
  monthLabel: string;
  totalIncome: number;
  totalExpense: number;
  transactions: T[];
};

type MonthSummary = { incomeCents: number; expenseCents: number };

function formatTransactionDate(dateString: string): string {
  const date = new Date(dateString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const datePart = date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  return hours === 0 && minutes === 0 && seconds === 0
    ? datePart
    : `${datePart}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function amountTone(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

function transactionActionLabel(transaction: TransactionRow, grouping: boolean, selected: boolean) {
  if (grouping) {
    const action = selected ? "Deselect" : "Select";
    return `${action} transaction ${transaction.subject}`;
  }
  const history = transaction.hasCorrectionHistory ? "; correction history available" : "";
  return `Correct transaction ${transaction.subject}${history}`;
}

function TransactionDirection({ grouping, selected, income }: Readonly<{ grouping: boolean; selected: boolean; income: boolean }>) {
  let tone = income ? "income" : "expense";
  let content: ReactNode = income ? "→" : "←";
  if (grouping) {
    tone = "select";
    content = selected ? <Check size={17} aria-hidden="true" /> : null;
  }
  return <span className={`tx-recent-arrow ${tone}${selected ? " is-selected" : ""}`}>{content}</span>;
}

function TransactionListRow<T extends TransactionRow>({ transaction, deleting, selected, deepLinked, grouping, formatAmount, onActivate }: Readonly<{
  transaction: T;
  deleting: boolean;
  selected: boolean;
  deepLinked: boolean;
  grouping: boolean;
  formatAmount: (value: number) => string;
  onActivate: (transaction: T) => void;
}>) {
  const income = transaction.direction === "CREDIT";
  const signedAmount = income ? transaction.amountCents : -transaction.amountCents;
  return (
    <Button
      type="button"
      id={`transaction-${transaction.id}`}
      className={`crud-row tx-recent-row${deleting ? " crud-row-deleting" : ""}${selected ? " is-selected" : ""}${deepLinked ? " is-deep-linked" : ""}`}
      onClick={() => onActivate(transaction)}
      disabled={deleting}
      aria-label={transactionActionLabel(transaction, grouping, selected)}
      aria-pressed={grouping ? selected : undefined}
    >
      <TransactionDirection grouping={grouping} selected={selected} income={income} />
      <span className="tx-recent-main">
        <span className="tx-recent-subject">{transaction.subject}</span>
        <span className={`tx-recent-amount ${amountTone(signedAmount)}`}>
          {income ? "+" : "−"}{formatAmount(transaction.amountCents)}
        </span>
        <span className="tx-recent-date">
          {formatTransactionDate(transaction.date)}
          {transaction.group ? <span className="tx-row-group-pill">{transaction.group.icon || "📌"} {transaction.group.name}</span> : null}
          {transaction.hasCorrectionHistory ? <span className="tx-row-correction-pill">Corrected</span> : null}
        </span>
      </span>
    </Button>
  );
}

export function TransactionMonthList<T extends TransactionRow>({
  groups,
  summaries,
  useServerSummaries,
  deletingIds,
  selectedIds,
  targetId,
  grouping,
  formatAmount,
  onActivate,
}: Readonly<{
  groups: MonthGroup<T>[];
  summaries: Map<string, MonthSummary>;
  useServerSummaries: boolean;
  deletingIds: string[];
  selectedIds: string[];
  targetId: string | null;
  grouping: boolean;
  formatAmount: (value: number) => string;
  onActivate: (transaction: T) => void;
}>) {
  return groups.map((group) => {
    const summary = useServerSummaries ? summaries.get(group.monthKey) : undefined;
    const income = summary?.incomeCents ?? group.totalIncome;
    const expense = summary?.expenseCents ?? group.totalExpense;

    return (
      <div key={group.monthKey} className="tx-month-group">
        <div className="tx-month-header">
          <span className="tx-month-label">{group.monthLabel}</span>
          <div className="tx-month-summary">
            {income > 0 ? <span className="tx-month-income">+{formatAmount(income)}</span> : null}
            {expense > 0 ? <span className="tx-month-expense">−{formatAmount(expense)}</span> : null}
          </div>
        </div>
        <div className="tx-month-list">
          {group.transactions.map((transaction) => (
            <TransactionListRow key={transaction.id} transaction={transaction} deleting={deletingIds.includes(transaction.id)} selected={selectedIds.includes(transaction.id)} deepLinked={targetId === transaction.id} grouping={grouping} formatAmount={formatAmount} onActivate={onActivate} />
          ))}
        </div>
      </div>
    );
  });
}
