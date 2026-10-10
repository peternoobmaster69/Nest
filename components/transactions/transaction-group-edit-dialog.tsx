import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { MutationErrorSummary } from "@/components/ui/mutation-error-summary";
import { TransactionGroupFields } from "./transaction-group-fields";
import { TransactionGroupMembers } from "./transaction-group-members";
import { useTransactionGroupEditor } from "./use-transaction-group-editor";
import type { TransactionGroup } from "./transaction-group-types";

export function TransactionGroupEditDialog({ group, workspaceId, workspace, formatAmount, onClose, onDeleted }: Readonly<{
  group: TransactionGroup;
  workspaceId: string;
  workspace: { name: string; role: string };
  formatAmount: (value: number) => string;
  onClose: () => void;
  onDeleted: () => void;
}>) {
  const editor = useTransactionGroupEditor({ group, workspaceId, workspace, onClose, onDeleted });
  return (
    <Dialog open onClose={onClose} closeDisabled={editor.busy} title="Edit transaction group" surface="custom" overlayClassName="profile-modal-overlay">
      <dialog open className="profile-modal tx-group-modal">
        <div className="profile-modal-head">
          <h3>Edit group</h3>
          <ModalCloseButton onClick={onClose} disabled={editor.busy} label="Close Edit Group" />
        </div>
        <form onSubmit={editor.submit} className="modal-form-shell tx-group-edit-form">
          <div className="profile-modal-body">
            <TransactionGroupFields name={editor.name} icon={editor.icon} disabled={editor.busy} onNameChange={editor.setName} onIconChange={editor.setIcon} />
            <div className="tx-group-members-head">
              <div><strong>Transactions</strong><span>{editor.membership.selectedIds.size} selected</span></div>
              <Input className="input tx-group-members-search" type="search" value={editor.search} onChange={(event) => editor.setSearch(event.target.value)} placeholder="Search this sub-account…" aria-label="Search transactions in this sub-account" maxLength={100} disabled={editor.busy} />
            </div>
            <p className="tx-group-modal-hint">Select or clear transactions to change what belongs in this group. Selecting one from another group will move it here.</p>
            <section className="tx-group-members-list" aria-label="Transactions available for this group">
              <TransactionGroupMembers transactions={editor.detail.data?.transactions ?? []} groupId={group.id} selectedIds={editor.membership.selectedIds} loading={editor.detail.isLoading} error={editor.detail.error} disabled={editor.busy || editor.detail.isPlaceholderData} formatAmount={formatAmount} onToggle={editor.toggle} onRetry={() => { void editor.detail.refetch(); }} />
            </section>
            <MutationErrorSummary error={editor.save.error ?? editor.remove.error} />
          </div>
          <div className="txn-modal-actions tx-group-edit-actions">
            <Button type="button" className="btn btn-danger modal-action-destructive" onClick={editor.confirmDelete} disabled={editor.busy}>{editor.remove.isPending ? "Deleting…" : "Delete group"}</Button>
            <div className="modal-action-group">
              <Button type="button" className="btn btn-ghost" onClick={onClose} disabled={editor.busy}>Cancel</Button>
              <Button type="submit" className="btn btn-primary" disabled={!editor.canSave}>{editor.save.isPending ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </form>
      </dialog>
    </Dialog>
  );
}
