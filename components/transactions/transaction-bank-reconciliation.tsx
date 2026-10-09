import { AlertTriangle, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MutationErrorSummary } from "@/components/ui/mutation-error-summary";

export function TransactionBankReconciliation({ bankBalanceCents, budgetBalanceCents, selected, pending, error, formatAmount, onEdit, onChoose, onSync, onReload }: Readonly<{
  bankBalanceCents: number;
  budgetBalanceCents: number;
  selected: boolean;
  pending: boolean;
  error: unknown;
  formatAmount: (value: number) => string;
  onEdit: () => void;
  onChoose: () => void;
  onSync: () => void;
  onReload: () => void | Promise<void>;
}>) {
  const discrepancy = bankBalanceCents - budgetBalanceCents;
  if (!discrepancy) return null;
  const amount = formatAmount(Math.abs(discrepancy));
  const label = discrepancy > 0 ? `${amount} unallocated` : `${amount} over-allocated`;
  const description = discrepancy > 0 ? "Bank balance is higher than the sub-account total." : "Sub-accounts exceed the bank balance.";
  return (
    <>
      <div className="tx-reconciliation" role="status" aria-live="polite">
        <div className="tx-reconciliation-status">
          <span className="tx-reconciliation-icon" aria-hidden="true"><AlertTriangle size={15} /></span>
          <div className="tx-reconciliation-copy"><strong>{label}</strong><span>{description}</span></div>
        </div>
        <dl className="tx-reconciliation-values">
          <div><dt>Bank</dt><dd>{formatAmount(bankBalanceCents)}</dd></div>
          <div><dt>Sub-accounts</dt><dd>{formatAmount(budgetBalanceCents)}</dd></div>
        </dl>
        <div className="tx-reconciliation-actions">
          {selected ? <>
            <Button type="button" className="btn btn-ghost btn-xs tx-reconciliation-action" onClick={onEdit} disabled={pending}><Pencil size={13} aria-hidden="true" /> Edit bank</Button>
            <Button type="button" className="btn btn-primary btn-xs tx-reconciliation-action" onClick={onSync} disabled={pending} title="Update bank balance to match the sub-account total"><RefreshCw size={13} aria-hidden="true" />{pending ? "Updating…" : "Use sub-account total"}</Button>
          </> : <Button type="button" className="btn btn-ghost btn-xs tx-reconciliation-action" onClick={onChoose}>Choose bank</Button>}
        </div>
      </div>
      <MutationErrorSummary error={error} onReload={onReload} />
    </>
  );
}
