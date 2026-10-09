import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { SavingsSubAccountCheckbox } from "@/components/savings-sub-account-checkbox";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import type { BankAccount } from "@/lib/accounts";

const BUDGET_ICONS = [
  "💰", "🏠", "🛡️", "✈️", "🍔", "🥬", "🚌", "🛍️", "💪", "💊", "🎬", "💡", "📚", "📈", "🚗", "📱", "🎯",
  "🧾", "🏦", "💳", "🧮", "👶", "🎓", "🐶", "🎁", "🛠️", "💼", "🏥", "🚴", "🍜", "☕",
  "👴", "👵", "👪", "👨‍👩‍👧‍👦", "⛪", "🧹", "🧽", "🧼", "🪣", "🧺", "🛋️", "🛏️", "🚿", "🚽", "🪟", "🪴",
  "🍃", "🌿", "🌱", "🌍", "🗺️", "🧭",
] as const;

function failureMessage(error: unknown) {
  if (!error) return null;
  if (error instanceof Error && error.message) return error.message;
  return "The sub-account could not be changed.";
}

function saveButtonLabel(editing: boolean, saving: boolean) {
  if (saving) return editing ? "Saving..." : "Creating...";
  return editing ? "Save" : "Create";
}

export function TransactionBudgetDialog({
  editing, name, target, isSavings, icon, accountId, accounts, saving, deleting, error,
  onClose, onNameChange, onTargetChange, onSavingsChange, onIconChange, onAccountChange, onSave, onDelete,
}: Readonly<{
  editing: boolean;
  name: string;
  target: string;
  isSavings: boolean;
  icon: string;
  accountId: string;
  accounts: BankAccount[];
  saving: boolean;
  deleting: boolean;
  error: unknown;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onSavingsChange: (value: boolean) => void;
  onIconChange: (value: string) => void;
  onAccountChange: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
}>) {
  const busy = saving || deleting;
  const accountAvailable = accounts.some((account) => account.id === accountId);
  const title = editing ? "Edit Sub-Account" : "New Sub-Account";
  const message = failureMessage(error);

  return (
    <Dialog open onClose={onClose} closeDisabled={busy} title="Sub-account" surface="custom" overlayClassName="profile-modal-overlay">
      <dialog open className="profile-modal txn-modal">
        <div className="profile-modal-head">
          <h3>{title}</h3>
          <ModalCloseButton onClick={onClose} disabled={busy} label={`Close ${title}`} />
        </div>
        <fieldset disabled={busy} aria-label="Sub-account details" className="profile-modal-body txn-modal-body" style={{ display: "grid", gap: "12px", border: 0, margin: 0, minWidth: 0 }}>
          <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
            Name
            <Input className="input" placeholder="Sub-account name" value={name} onChange={(event) => onNameChange(event.target.value)} />
          </label>
          {!editing && (accounts.length > 1 || !accountAvailable) ? (
            <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Bank Account
              <Select className="input" value={accountAvailable ? accountId : ""} onChange={(event) => onAccountChange(event.target.value)}>
                <option value="" disabled>Select bank account</option>
                {accounts.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
              </Select>
            </label>
          ) : null}
          <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
            Monthly Limit (optional)
            <NumericCalculatorInput min="0" step="0.01" placeholder="0.00" value={target} onValueChange={onTargetChange} />
          </label>
          <SavingsSubAccountCheckbox checked={isSavings} onCheckedChange={onSavingsChange} />
          {editing && !isSavings ? (
            <div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>Icon</div>
              <div className="icon-picker">
                {BUDGET_ICONS.map((option) => (
                  <Button key={option} type="button" className={`icon-chip${icon === option ? " on" : ""}`} onClick={() => onIconChange(option)} aria-label={`Select icon ${option}`}>
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {message ? <div role="alert" style={{ color: "var(--danger)", fontSize: "12px" }}>{message}</div> : null}
        </fieldset>
        <div className="txn-modal-actions">
          {editing ? <Button type="button" className="btn btn-ghost modal-action-destructive" onClick={onDelete} disabled={busy}>{deleting ? "Deleting..." : "Delete"}</Button> : <span />}
          <div className="modal-action-group">
            <Button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="button" className="btn btn-primary" onClick={onSave} disabled={busy || !name.trim() || (!editing && !accountAvailable)}>{saveButtonLabel(editing, saving)}</Button>
          </div>
        </div>
      </dialog>
    </Dialog>
  );
}
