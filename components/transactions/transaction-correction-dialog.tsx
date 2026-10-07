"use client";

import type { SubmitEventHandler } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { LoadingDots } from "@/components/ui-skeleton";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { TransactionOperationControl } from "@/components/transactions/transaction-operation-control";
import {
  TransactionLineagePanel,
  type TransactionLineageResponse,
} from "@/components/transactions/transaction-lineage-panel";

type CorrectionBudget = { id: string; name: string };
type CorrectionGroup = { id: string; name: string; icon?: string | null };

export function TransactionCorrectionDialog({
  amount,
  budgets,
  budgetId,
  date,
  deletePending,
  deleting,
  error,
  formatAmount,
  groupId,
  groups,
  lineage,
  lineageError,
  lineageLoading,
  notes,
  operation,
  pending,
  reason,
  showLineage,
  subject,
  onAmountChange,
  onBudgetChange,
  onClose,
  onDateChange,
  onDelete,
  onGroupChange,
  onLineageRetry,
  onNotesChange,
  onOperationChange,
  onReasonChange,
  onSubjectChange,
  onSubmit,
}: Readonly<{
  amount: string;
  budgets: CorrectionBudget[];
  budgetId: string;
  date: string;
  deletePending: boolean;
  deleting: boolean;
  error: Error | null;
  formatAmount: (value: number) => string;
  groupId: string;
  groups: CorrectionGroup[];
  lineage: TransactionLineageResponse | null;
  lineageError: Error | null;
  lineageLoading: boolean;
  notes: string;
  operation: "DEDUCT" | "ADD";
  pending: boolean;
  reason: string;
  showLineage: boolean;
  subject: string;
  onAmountChange: (value: string) => void;
  onBudgetChange: (value: string) => void;
  onClose: () => void;
  onDateChange: (value: string) => void;
  onDelete: () => void;
  onGroupChange: (value: string) => void;
  onLineageRetry: () => void;
  onNotesChange: (value: string) => void;
  onOperationChange: (value: "DEDUCT" | "ADD") => void;
  onReasonChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onSubmit: SubmitEventHandler<HTMLFormElement>;
}>) {
  return (
    <Dialog open onClose={onClose} title="Correct transaction" surface="custom" overlayClassName="profile-modal-overlay">
      <div className="profile-modal txn-modal txn-entry-modal">
        <div className="profile-modal-head">
          <h3>Correct Transaction</h3>
          <ModalCloseButton onClick={onClose} label="Close Correct Transaction" />
        </div>
        <form className="modal-form-shell" onSubmit={onSubmit}>
          <div className="profile-modal-body txn-modal-body txn-modal-form">
            <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Amount
              <NumericCalculatorInput min="1" step="0.01" placeholder="Amount" value={amount} onValueChange={onAmountChange} />
            </label>
            <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Date
              <Input type="date" className="input" value={date} onChange={(event) => onDateChange(event.target.value)} required />
            </label>
            <TransactionOperationControl operation={operation} onChange={onOperationChange} />
            <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Sub Account
              <Select className="input" value={budgetId} onChange={(event) => onBudgetChange(event.target.value)} required>
                <option value="" disabled>Select sub account</option>
                {budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}
              </Select>
            </label>
            <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Group <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
              <Select className="input" value={groupId} onChange={(event) => onGroupChange(event.target.value)}>
                <option value="">No group</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.icon || "📌"} {group.name}</option>)}
              </Select>
            </label>
            <label className="modal-grid-span-2" style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Title
              <Input className="input" placeholder="Title" value={subject} onChange={(event) => onSubjectChange(event.target.value)} />
            </label>
            <MarkdownEditor className="modal-grid-span-2" label="Notes" value={notes} onChange={onNotesChange} placeholder="Write notes in Markdown" calculator />
            <label className="modal-grid-span-2" style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Correction reason <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
              <Input className="input" value={reason} onChange={(event) => onReasonChange(event.target.value)} maxLength={500} placeholder="For example: corrected receipt amount" />
            </label>
            {error ? <div className="modal-grid-span-2" style={{ color: "var(--danger)", fontSize: "12px" }} role="alert">{error.message || "Failed to correct transaction"}</div> : null}
            {showLineage ? (
              <TransactionLineagePanel
                error={lineageError}
                formatAmount={formatAmount}
                lineage={lineage}
                loading={lineageLoading}
                onRetry={onLineageRetry}
              />
            ) : null}
          </div>
          <div className="txn-modal-actions">
            <Button className="btn btn-ghost modal-action-destructive" type="button" onClick={onDelete} disabled={deletePending}>
              {deletePending && deleting ? "Deleting..." : "Delete"}
            </Button>
            <div className="modal-action-group">
              <Button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</Button>
              <Button className="btn btn-primary" type="submit" disabled={pending}>{pending ? <LoadingDots /> : "Create correction"}</Button>
            </div>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
