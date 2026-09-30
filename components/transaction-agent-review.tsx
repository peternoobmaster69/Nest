"use client";

import { useState, type FormEvent } from "react";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import type { AgentEditField, TransactionAgentView } from "@/lib/ai/transaction-agent-contracts";

export function agentMoney(cents: number, currency: string) {
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

/** The human-in-the-loop checkpoint. Every value shown here is exactly what Confirm will save. */
export function TransactionAgentReview({ draft, locked, typing, onEdit, onConfirm }: Props) {
  const review = draft.review!;
  const [editing, setEditing] = useState<TextField | null>(null);
  const [value, setValue] = useState("");
  const editable = draft.status === "REVIEW" && !locked;
  const after = review.after;
  const budget = review.balances.find((b) => b.id === after.budgetId);
  const current: Record<TextField, string> = { subject: after.subject, amount: (after.amountCents / 100).toFixed(2), date: after.date.slice(0, 10) };

  const start = (field: TextField) => { setEditing(field); setValue(current[field]); };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const field = editing;
    setEditing(null);
    if (value.trim() && value.trim() !== current[field]) onEdit(field, value.trim());
  };

  const row = (field: TextField, display: string) => <div>
    <dt>{LABELS[field]}</dt>
    {editing === field ? <dd>
      <form className="transaction-agent-edit" onSubmit={save}>
        <label className="sr-only" htmlFor={`transaction-agent-edit-${field}`}>New {LABELS[field].toLowerCase()}</label>
        <Input id={`transaction-agent-edit-${field}`} autoFocus value={value} maxLength={120} inputMode={field === "amount" ? "decimal" : undefined}
          type={field === "date" ? "date" : "text"} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} />
        <Button type="submit" variant="primary" size="sm">Apply</Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
      </form>
    </dd> : <dd>
      <span>{display}</span>
      {editable ? <Button variant="ghost" size="sm" iconOnly aria-label={`Edit ${LABELS[field].toLowerCase()}`} onClick={() => start(field)}><Pencil size={14} aria-hidden="true" /></Button> : null}
    </dd>}
  </div>;

  return <section className="transaction-agent-review" aria-label="Transaction review">
    <h3>{draft.status === "SAVED" ? <><Check size={16} aria-hidden="true" /> Saved</> : review.operation === "UPDATE" ? "Review correction" : "Review new transaction"}</h3>
    <dl>
      {row("subject", after.subject)}
      {row("amount", agentMoney(after.amountCents, review.currency))}
      <div>
        <dt>Type</dt>
        <dd>{editable ? <span className="transaction-agent-toggle" role="group" aria-label="Deduct or add">
          <Button size="sm" variant={after.direction === "DEBIT" ? "primary" : "ghost"} aria-pressed={after.direction === "DEBIT"} onClick={() => after.direction !== "DEBIT" && onEdit("direction", "DEBIT")}>Deduct</Button>
          <Button size="sm" variant={after.direction === "CREDIT" ? "primary" : "ghost"} aria-pressed={after.direction === "CREDIT"} onClick={() => after.direction !== "CREDIT" && onEdit("direction", "CREDIT")}>Add</Button>
        </span> : <span>{after.direction === "DEBIT" ? "Deduct" : "Add"}</span>}</dd>
      </div>
      <div>
        <dt>Sub-account</dt>
        <dd><span>{budget?.name}<small> · {budget?.accountName}</small></span>
          {editable ? <Button variant="ghost" size="sm" onClick={() => onEdit("budget")}>Change</Button> : null}</dd>
      </div>
      {row("date", after.date.slice(0, 10))}
    </dl>
    {review.before ? <div className="transaction-agent-before"><strong>Before correction</strong><p>{review.before.subject} · {review.before.direction === "DEBIT" ? "Deduct" : "Add"} {agentMoney(review.before.amountCents, review.currency)} · {review.before.date.slice(0, 10)} · {review.balances.find((b) => b.id === review.before?.budgetId)?.name ?? "Unassigned"}</p></div> : null}
    <div className="transaction-agent-balances"><strong>Balance impact{draft.status === "SAVED" ? " at the time of saving" : ""}</strong>{review.balances.map((b) => <p key={b.id}><span>{b.name}</span><span>{agentMoney(b.availableCents, review.currency)} → {agentMoney(b.afterCents, review.currency)}</span></p>)}</div>
    {draft.status !== "SAVED" && review.warnings.length ? <ul className="transaction-agent-warnings">{review.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    {draft.status === "REVIEW" ? <>
      <p className="transaction-agent-hint">Check these details. Edit any field, type a change below, or cancel.</p>
      <Button variant="primary" disabled={locked || typing || editing !== null} onClick={onConfirm}>Confirm {review.operation === "UPDATE" ? "correction" : "transaction"}</Button>
      {typing ? <p className="transaction-agent-hint">Send your message first. It may change the review.</p> : null}
    </> : null}
  </section>;
}
