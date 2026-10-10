import { useEffect, useRef, useState } from "react";
import { Check, Layers3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { formatTransactionGroupDateRange, normalizeTransactionGroupSearchValue } from "@/lib/transaction-presentation";
import type { TransactionGroup } from "./transaction-group-types";

function GroupOption({ group, active, formatAmount, onSelect }: Readonly<{
  group: TransactionGroup;
  active: boolean;
  formatAmount: (value: number) => string;
  onSelect: (id: string) => void;
}>) {
  const transactionDateRange = formatTransactionGroupDateRange(group.firstTransactionDate, group.lastTransactionDate);
  return (
    <Button type="button" className={`tx-group-picker-option${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => onSelect(group.id)}>
      <span className="tx-group-picker-option-icon" aria-hidden="true">{group.icon || "📌"}</span>
      <span className="tx-group-picker-option-copy">
        <strong>{group.name}</strong>
        <small className="tx-group-picker-option-amount">{formatAmount(group.expenseCents - group.incomeCents)}</small>
        <small className="tx-group-picker-option-range" title={transactionDateRange}>{transactionDateRange}</small>
      </span>
      {active ? <Check size={15} aria-hidden="true" /> : null}
    </Button>
  );
}

export function TransactionGroupPicker({ groups, activeId, formatAmount, onSelect }: Readonly<{
  groups: readonly TransactionGroup[];
  activeId: string;
  formatAmount: (value: number) => string;
  onSelect: (id: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = normalizeTransactionGroupSearchValue(query);
  const filteredGroups = normalizedQuery ? groups.filter((group) => {
    const dateRange = formatTransactionGroupDateRange(group.firstTransactionDate, group.lastTransactionDate);
    const searchableValue = normalizeTransactionGroupSearchValue(`${group.name} ${dateRange}`);
    return searchableValue.includes(normalizedQuery);
  }) : groups;
  const countLabel = `${groups.length} ${groups.length === 1 ? "group" : "groups"}`;
  const closePicker = () => { setOpen(false); setQuery(""); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!containerRef.current!.contains(event.target as Node)) closePicker(); };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closePicker();
      triggerRef.current!.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);
  const select = (id: string) => { onSelect(id); closePicker(); };
  return (
    <div className="tx-group-panel-heading" ref={containerRef}>
      <Button ref={triggerRef} type="button" className={`tx-group-panel-symbol tx-group-picker-trigger${open ? " is-open" : ""}`} aria-label={`Browse ${groups.length} transaction ${groups.length === 1 ? "group" : "groups"}`} aria-expanded={open} aria-haspopup="dialog" aria-controls="transaction-group-picker" title="Browse and search groups" onClick={() => { setQuery(""); setOpen((value) => !value); }}>
        <Layers3 size={15} aria-hidden="true" /><span className="tx-group-count" aria-hidden="true">×{groups.length}</span>
      </Button>
      {open ? (
        <dialog open id="transaction-group-picker" className="tx-group-picker-popover" aria-label="Find a transaction group">
          <label className="tx-group-picker-search">
            <Search size={15} aria-hidden="true" />
            <Input type="search" value={query} aria-label="Search transaction groups" placeholder="Search groups…" autoFocus onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="tx-group-picker-options">
            {!normalizedQuery ? (
              <Button type="button" className={`tx-group-picker-option${activeId === "ALL" ? " is-active" : ""}`} aria-pressed={activeId === "ALL"} onClick={() => select("ALL")}>
                <span className="tx-group-picker-option-icon" aria-hidden="true"><Layers3 size={15} /></span>
                <span className="tx-group-picker-option-copy"><strong>All groups</strong><small>{countLabel}</small></span>
                {activeId === "ALL" ? <Check size={15} aria-hidden="true" /> : null}
              </Button>
            ) : null}
            {filteredGroups.map((group) => <GroupOption key={group.id} group={group} active={activeId === group.id} formatAmount={formatAmount} onSelect={select} />)}
            {!filteredGroups.length ? <p className="tx-group-picker-empty">No groups match “{query.trim()}”.</p> : null}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
