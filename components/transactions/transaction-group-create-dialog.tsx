import { useState, type SubmitEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { MutationErrorSummary } from "@/components/ui/mutation-error-summary";
import { TransactionGroupFields } from "./transaction-group-fields";
import { invalidateTransactionGroupViews } from "./transaction-group-data";
import type { TransactionGroup } from "./transaction-group-types";

function saveLabel(creating: boolean, pending: boolean) {
  if (pending) return "Saving…";
  return creating ? "Create group" : "Add to group";
}

export function TransactionGroupCreateDialog({ workspaceId, budgetId, budgetName, transactionIds, groups, defaults, onClose, onSaved }: Readonly<{
  workspaceId: string;
  budgetId: string;
  budgetName: string;
  transactionIds: string[];
  groups: readonly TransactionGroup[];
  defaults: { suggestedName: string; icon: string; placeholder: string };
  onClose: () => void;
  onSaved: () => void;
}>) {
  const client = useQueryClient();
  const [destinationId, setDestinationId] = useState("NEW");
  const [name, setName] = useState(defaults.suggestedName);
  const [icon, setIcon] = useState(defaults.icon);
  const creating = destinationId === "NEW";
  const save = useMutation({
    mutationFn: () => {
      if (creating) {
        return apiFetch("/api/transaction-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, budgetId, name: name.trim(), icon, transactionIds }),
        });
      }
      return apiFetch(`/api/transaction-groups/${destinationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addTransactionIds: transactionIds }),
      });
    },
    onSuccess: () => {
      invalidateTransactionGroupViews(client, workspaceId);
      onSaved();
    },
  });
  const destinationValid = creating ? Boolean(name.trim()) : groups.some((group) => group.id === destinationId);
  const canSave = !save.isPending && transactionIds.length > 0 && destinationValid;
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (canSave) save.mutate();
  };

  return (
    <Dialog open onClose={onClose} closeDisabled={save.isPending} title="Create transaction group" surface="custom" overlayClassName="profile-modal-overlay">
      <dialog open className="profile-modal tx-group-modal">
        <div className="profile-modal-head">
          <h3>Group {transactionIds.length} transactions</h3>
          <ModalCloseButton onClick={onClose} disabled={save.isPending} label="Close Group Transactions" />
        </div>
        <form className="modal-form-shell" onSubmit={submit}>
          <div className="profile-modal-body">
            <p className="tx-group-modal-intro">What do these {budgetName} transactions belong to?</p>
            {groups.length ? (
              <label className="tx-group-field">
                Group
                <Select className="input" value={destinationId} disabled={save.isPending} onChange={(event) => { setDestinationId(event.target.value); save.reset(); }}>
                  <option value="NEW">Create a new group</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.icon || "📌"} {group.name}</option>)}
                </Select>
              </label>
            ) : null}
            {creating ? (
              <TransactionGroupFields name={name} icon={icon} placeholder={defaults.placeholder} disabled={save.isPending} onNameChange={setName} onIconChange={setIcon} />
            ) : <p className="tx-group-modal-hint">Selected transactions will be moved here if they already belong to another group.</p>}
            <MutationErrorSummary error={save.error} />
          </div>
          <div className="txn-modal-actions">
            <Button type="button" className="btn btn-ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" className="btn btn-primary" disabled={!canSave}>{saveLabel(creating, save.isPending)}</Button>
          </div>
        </form>
      </dialog>
    </Dialog>
  );
}
