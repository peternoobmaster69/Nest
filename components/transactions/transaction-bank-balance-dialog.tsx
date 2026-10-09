import type { SubmitEvent } from "react";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { MutationErrorSummary } from "@/components/ui/mutation-error-summary";

export function TransactionBankBalanceDialog({ name, currency, balance, valid, pending, error, onChange, onClose, onSubmit, onReload }: Readonly<{
  name: string;
  currency: string;
  balance: string;
  valid: boolean;
  pending: boolean;
  error: unknown;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: SubmitEvent) => void;
  onReload: () => void | Promise<void>;
}>) {
  return (
    <Dialog open onClose={onClose} closeDisabled={pending} title="Edit bank balance" surface="custom" overlayClassName="profile-modal-overlay">
      <dialog open className="profile-modal txn-modal">
        <div className="profile-modal-head">
          <h3>Edit Bank Balance</h3>
          <ModalCloseButton onClick={onClose} disabled={pending} label="Close Edit Bank Balance" />
        </div>
        <form className="modal-form-shell" onSubmit={onSubmit}>
          <div className="profile-modal-body txn-modal-body txn-modal-form txn-bank-balance-form">
            <div className="form-group">
              <label htmlFor="transactions-editing-bank-account-name" className="label">Bank Account</label>
              <Input id="transactions-editing-bank-account-name" className="input" value={name} disabled />
            </div>
            <div className="form-group">
              <label htmlFor="transactions-editing-bank-balance" className="label">Balance ({currency})</label>
              <NumericCalculatorInput id="transactions-editing-bank-balance" step="0.01" min="0" value={balance} onValueChange={onChange} disabled={pending} required aria-invalid={!valid} />
            </div>
            {!valid && balance.trim() ? <div className="form-error">Enter a valid balance of zero or more.</div> : null}
            <MutationErrorSummary error={error} onReload={onReload} />
          </div>
          <div className="txn-modal-actions">
            <Button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" className="btn btn-primary" disabled={pending || !valid}>{pending ? "Saving..." : "Save Balance"}</Button>
          </div>
        </form>
      </dialog>
    </Dialog>
  );
}
