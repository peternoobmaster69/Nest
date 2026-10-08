"use client";

import { useState, type SubmitEvent } from "react";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { isPrivacyModeOn, MASKED_AMOUNT, usePrivacyMode } from "@/lib/privacy-mode";
import type { AgentEditField, TransactionAgentView } from "@/lib/ai/transaction-agent-contracts";

export function agentMoney(cents: number, currency: string) {
  if (isPrivacyModeOn()) return MASKED_AMOUNT;
  return new Intl.NumberFormat("en-SG", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
}

type Props = {
  draft: TransactionAgentView;
  locked: boolean;
  typing: boolean;
  onEdit: (field: AgentEditField, value?: string) => void;
  onConfirm: () => void;
};

type TextField = Extract<AgentEditField, "amount" | "subject" | "date">;
const LABELS: Record<TextField, string> = { subject: "Description", amount: "Amount", date: "Date" };

function ReviewTextField({ field, display, editing, value, editable, onStart, onChange, onCancel, onSave }: Readonly<{
  field: TextField;
  display: string;
  editing: boolean;
  value: string;
  editable: boolean;
  onStart: (field: TextField) => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: (field: TextField, event: SubmitEvent) => void;
}>) {
  return <div>
    <dt>{LABELS[field]}</dt>
    {editing ? <dd>
      <form className="transaction-agent-edit" onSubmit={(event) => onSave(field, event)}>
        <label className="sr-only" htmlFor={`transaction-agent-edit-${field}`}>New {LABELS[field].toLowerCase()}</label>
        <Input id={`transaction-agent-edit-${field}`} autoFocus value={value} maxLength={120} inputMode={field === "amount" ? "decimal" : undefined}
          type={field === "date" ? "date" : "text"} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onCancel();
            }
          }} />
        <Button type="submit" variant="primary" size="sm">Apply</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </form>
    </dd> : <dd>
      <span>{display}</span>
      {editable ? <Button variant="ghost" size="sm" iconOnly aria-label={`Edit ${LABELS[field].toLowerCase()}`} onClick={() => onStart(field)}><Pencil size={14} aria-hidden="true" /></Button> : null}
    </dd>}
  </div>;
}

function ReviewHeading({ saved, operation }: Readonly<{ saved: boolean; operation: "CREATE" | "UPDATE" }>) {
  if (saved) return <h3><Check size={16} aria-hidden="true" /> Saved</h3>;
  return <h3>{operation === "UPDATE" ? "Review correction" : "Review new transaction"}</h3>;
}

function PreviousTransaction({ review }: Readonly<{ review: NonNullable<TransactionAgentView["review"]> }>) {
  const before = review.before;
  if (!before) return null;
  const budgetName = review.balances.find((balance) => balance.id === before.budgetId)?.name ?? "Unassigned";
  return <div className="transaction-agent-before"><strong>Before correction</strong><p>{before.subject} · {before.direction === "DEBIT" ? "Deduct" : "Add"} {agentMoney(before.amountCents, review.currency)} · {before.date.slice(0, 10)} · {budgetName}</p></div>;
}

function ReviewDirection({ direction, editable, onEdit }: Readonly<{
  direction: "DEBIT" | "CREDIT";
  editable: boolean;
  onEdit: Props["onEdit"];
}>) {
  if (!editable) return <span>{direction === "DEBIT" ? "Deduct" : "Add"}</span>;
  return <fieldset className="transaction-agent-toggle" aria-label="Deduct or add">
    <Button size="sm" variant={direction === "DEBIT" ? "primary" : "ghost"} aria-pressed={direction === "DEBIT"} onClick={() => direction !== "DEBIT" && onEdit("direction", "DEBIT")}>Deduct</Button>
    <Button size="sm" variant={direction === "CREDIT" ? "primary" : "ghost"} aria-pressed={direction === "CREDIT"} onClick={() => direction !== "CREDIT" && onEdit("direction", "CREDIT")}>Add</Button>
  </fieldset>;
}

/** The human-in-the-loop checkpoint. Every value shown here is exactly what Confirm will save. */
export function TransactionAgentReview({ draft, locked, typing, onEdit, onConfirm }: Readonly<Props>) {
  const review = draft.review!;
  usePrivacyMode();
  const [editing, setEditing] = useState<TextField | null>(null);
  const [value, setValue] = useState("");
  const editable = draft.status === "REVIEW" && !locked;
  const after = review.after;
  const budget = review.balances.find((b) => b.id === after.budgetId);
  const current: Record<TextField, string> = { subject: after.subject, amount: (after.amountCents / 100).toFixed(2), date: after.date.slice(0, 10) };

  const start = (field: TextField) => { setEditing(field); setValue(current[field]); };
  const save = (field: TextField, event: SubmitEvent) => {
    event.preventDefault();
    setEditing(null);
    if (value.trim() && value.trim() !== current[field]) onEdit(field, value.trim());
  };

  const row = (field: TextField, display: string) => <ReviewTextField
    field={field} display={display} editing={editing === field} value={value} editable={editable}
    onStart={start} onChange={setValue} onCancel={() => setEditing(null)} onSave={save}
  />;

  return <section className="transaction-agent-review" aria-label="Transaction review">
    <ReviewHeading saved={draft.status === "SAVED"} operation={review.operation} />
    <dl>
      {row("subject", after.subject)}
      {row("amount", agentMoney(after.amountCents, review.currency))}
      <div>
        <dt>Type</dt>
        <dd><ReviewDirection direction={after.direction} editable={editable} onEdit={onEdit} /></dd>
      </div>
      <div>
        <dt>Sub-account</dt>
        <dd><span>{budget?.name}<small> · {budget?.accountName}</small></span>
          {editable ? <Button variant="ghost" size="sm" onClick={() => onEdit("budget")}>Change</Button> : null}</dd>
      </div>
      {row("date", after.date.slice(0, 10))}
    </dl>
    <PreviousTransaction review={review} />
    <div className="transaction-agent-balances"><strong>Balance impact{draft.status === "SAVED" ? " at the time of saving" : ""}</strong>{review.balances.map((b) => <p key={b.id}><span>{b.name}</span><span>{agentMoney(b.availableCents, review.currency)} → {agentMoney(b.afterCents, review.currency)}</span></p>)}</div>
    {draft.status !== "SAVED" && review.warnings.length ? <ul className="transaction-agent-warnings">{review.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    {draft.status === "REVIEW" ? <>
      <p className="transaction-agent-hint">Check these details. Edit any field, type a change below, or cancel.</p>
      <Button variant="primary" disabled={locked || typing || editing !== null} onClick={onConfirm}>Confirm {review.operation === "UPDATE" ? "correction" : "transaction"}</Button>
      {typing ? <p className="transaction-agent-hint">Send your message first. It may change the review.</p> : null}
    </> : null}
  </section>;
}
