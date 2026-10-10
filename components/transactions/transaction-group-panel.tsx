import { useEffect, useRef } from "react";
import { Layers3, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/ui/query-state";
import { LoadingDots } from "@/components/ui-skeleton";
import { getMotionSafeScrollBehavior } from "@/lib/motion";
import { TransactionGroupPicker } from "./transaction-group-picker";
import type { TransactionGroup } from "./transaction-group-types";

function panelState(loading: boolean, hasGroups: boolean) {
  if (loading) return "is-loading";
  return hasGroups ? "has-groups" : "is-empty";
}

function GroupLoadingState({ loading, error, onRetry }: Readonly<{ loading: boolean; error: unknown; onRetry: () => void }>) {
  if (loading) return <p><LoadingDots /> Loading groups</p>;
  if (error) return <QueryError title="Failed to load groups" onRetry={onRetry} />;
  return <p>No groups yet. Create one to organise related transactions.</p>;
}

function GroupCard({ group, active, formatAmount, onToggle, onEdit }: Readonly<{
  group: TransactionGroup;
  active: boolean;
  formatAmount: (value: number) => string;
  onToggle: (id: string) => void;
  onEdit: (group: TransactionGroup) => void;
}>) {
  return (
    <div data-group-id={group.id} className={`tx-group-card${active ? " is-active" : ""}`}>
      <Button type="button" className="tx-group-card-select" aria-pressed={active} aria-label={active ? `Clear ${group.name} filter and show all transactions` : `Show ${group.name} transactions`} title={active ? "Select again to show all transactions" : `Show ${group.name} transactions`} onClick={() => onToggle(group.id)} />
      <span className="tx-group-card-icon" aria-hidden="true">{group.icon || "📌"}</span>
      <span className="tx-group-card-copy"><strong>{group.name}</strong></span>
      <span className="tx-group-card-total"><strong>{formatAmount(group.expenseCents - group.incomeCents)}</strong></span>
      <Button type="button" className="tx-group-card-edit" aria-label={`Edit ${group.name}`} onClick={() => onEdit(group)}><Pencil size={12} aria-hidden="true" /></Button>
    </div>
  );
}

export function TransactionGroupPanel({ budgetName, groups, activeId, loading, error, canGroup, formatAmount, onSelect, onToggle, onEdit, onGroup, onRetry }: Readonly<{
  budgetName: string;
  groups: readonly TransactionGroup[];
  activeId: string;
  loading: boolean;
  error: unknown;
  canGroup: boolean;
  formatAmount: (value: number) => string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onEdit: (group: TransactionGroup) => void;
  onGroup: () => void;
  onRetry: () => void;
}>) {
  const cardsRef = useRef<HTMLDivElement>(null);
  const hasGroups = groups.length > 0;
  useEffect(() => {
    if (activeId === "ALL" || !hasGroups) return;
    const frame = window.requestAnimationFrame(() => {
      const cards = cardsRef.current!;
      const card = Array.from(cards.querySelectorAll<HTMLElement>("[data-group-id]")).find((item) => item.dataset.groupId === activeId);
      if (!card) return;
      const cardsRect = cards.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const centeredLeft = cards.scrollLeft + cardRect.left - cardsRect.left - Math.max(0, (cards.clientWidth - cardRect.width) / 2);
      cards.scrollTo({ left: Math.max(0, centeredLeft), behavior: getMotionSafeScrollBehavior() });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, groups, hasGroups]);
  return (
    <section className={`card tx-group-panel ${panelState(loading, hasGroups)}`} aria-label={`Groups in ${budgetName}`}>
      <div className="tx-group-panel-head">
        {hasGroups ? <TransactionGroupPicker groups={groups} activeId={activeId} formatAmount={formatAmount} onSelect={onSelect} /> : (
          <div className="tx-group-panel-heading">
            <span className="tx-group-panel-symbol" aria-hidden="true"><Layers3 size={15} /></span>
            <GroupLoadingState loading={loading} error={error} onRetry={onRetry} />
          </div>
        )}
        {hasGroups ? <div className="tx-group-cards" ref={cardsRef}>{groups.map((group) => <GroupCard key={group.id} group={group} active={activeId === group.id} formatAmount={formatAmount} onToggle={onToggle} onEdit={onEdit} />)}</div> : null}
        <Button type="button" className="btn btn-ghost btn-sm" onClick={onGroup} disabled={!canGroup}>Group</Button>
      </div>
    </section>
  );
}
