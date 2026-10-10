import { Input } from "@/components/ui/controls";
import { QueryError } from "@/components/ui/query-state";
import { LoadingDots } from "@/components/ui-skeleton";
import { formatTransactionDate, getAmountToneClass } from "@/lib/transaction-presentation";
import type { GroupTransactionOption } from "./transaction-group-types";

function GroupMemberRow({ transaction, groupId, selected, disabled, formatAmount, onToggle }: Readonly<{
  transaction: GroupTransactionOption;
  groupId: string;
  selected: boolean;
  disabled: boolean;
  formatAmount: (value: number) => string;
  onToggle: (id: string) => void;
}>) {
  const credit = transaction.direction === "CREDIT";
  const signedAmount = credit ? transaction.amountCents : -transaction.amountCents;
  const otherGroup = transaction.group && transaction.group.id !== groupId;
  return (
    <label className={`tx-group-member-row${selected ? " is-selected" : ""}`}>
      <Input type="checkbox" checked={selected} disabled={disabled} onChange={() => onToggle(transaction.id)} />
      <span className="tx-group-member-copy">
        <strong>{transaction.subject}</strong>
        <small>
          {formatTransactionDate(transaction.date)}
          {otherGroup ? <span className="tx-group-member-current">{transaction.group!.icon || "📌"} {transaction.group!.name}</span> : null}
        </small>
      </span>
      <span className={`tx-group-member-amount ${getAmountToneClass(signedAmount)}`}>
        {credit ? "+" : "−"}{formatAmount(transaction.amountCents)}
      </span>
    </label>
  );
}

export function TransactionGroupMembers({ transactions, groupId, selectedIds, loading, error, disabled, formatAmount, onToggle, onRetry }: Readonly<{
  transactions: readonly GroupTransactionOption[];
  groupId: string;
  selectedIds: ReadonlySet<string>;
  loading: boolean;
  error: Error | null;
  disabled: boolean;
  formatAmount: (value: number) => string;
  onToggle: (id: string) => void;
  onRetry: () => void;
}>) {
  if (loading) return <div className="tx-group-members-state"><LoadingDots /> Loading transactions</div>;
  if (error) return <QueryError title="Failed to load transactions" message={error.message} onRetry={onRetry} />;
  if (!transactions.length) return <div className="tx-group-members-state">No matching transactions.</div>;
  return transactions.map((transaction) => <GroupMemberRow key={transaction.id} transaction={transaction} groupId={groupId} selected={selectedIds.has(transaction.id)} disabled={disabled} formatAmount={formatAmount} onToggle={onToggle} />);
}
