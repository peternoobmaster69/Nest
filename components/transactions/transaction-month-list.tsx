import { Check } from "lucide-react";

type TransactionRow = {
  id: string;
  subject: string;
  date: string;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  group?: { name: string; icon?: string | null } | null;
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
}: {
  groups: MonthGroup<T>[];
  summaries: Map<string, MonthSummary>;
  useServerSummaries: boolean;
  deletingIds: string[];
  selectedIds: string[];
  targetId: string | null;
  grouping: boolean;
  formatAmount: (value: number) => string;
  onActivate: (transaction: T) => void;
}) {
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
          {group.transactions.map((transaction) => {
            const deleting = deletingIds.includes(transaction.id);
            const incomeTransaction = transaction.direction === "CREDIT";
            const selected = selectedIds.includes(transaction.id);
            const deepLinked = targetId === transaction.id;
            const signedAmount = incomeTransaction ? transaction.amountCents : -transaction.amountCents;
            return (
              <div
                key={transaction.id}
                id={`transaction-${transaction.id}`}
                className={`crud-row tx-recent-row${deleting ? " crud-row-deleting" : ""}${selected ? " is-selected" : ""}${deepLinked ? " is-deep-linked" : ""}`}
                onClick={() => { if (!deleting) onActivate(transaction); }}
                onKeyDown={(event) => {
                  if (!deleting && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onActivate(transaction);
                  }
                }}
                role="button"
                tabIndex={deleting ? -1 : 0}
                aria-label={grouping ? `${selected ? "Deselect" : "Select"} transaction ${transaction.subject}` : `Edit transaction ${transaction.subject}`}
                aria-pressed={grouping ? selected : undefined}
              >
                <div className={`tx-recent-arrow ${grouping ? "select" : incomeTransaction ? "income" : "expense"}${selected ? " is-selected" : ""}`}>
                  {grouping ? (selected ? <Check size={17} aria-hidden="true" /> : null) : incomeTransaction ? "→" : "←"}
                </div>
                <div className="tx-recent-main">
                  <span className="tx-recent-subject">{transaction.subject}</span>
                  <span className={`tx-recent-amount ${amountTone(signedAmount)}`}>
                    {incomeTransaction ? "+" : "−"}{formatAmount(transaction.amountCents)}
                  </span>
                  <span className="tx-recent-date">
                    {formatTransactionDate(transaction.date)}
                    {transaction.group ? <span className="tx-row-group-pill">{transaction.group.icon || "📌"} {transaction.group.name}</span> : null}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  });
}
