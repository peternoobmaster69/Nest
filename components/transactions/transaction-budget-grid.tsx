import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAmountToneClass, getBudgetIcon } from "@/lib/transaction-presentation";
import { useSessionState } from "@/lib/use-session-state";

type BudgetSummary = {
  id: string;
  name: string;
  icon?: string | null;
  availableCents: number;
  receivableReservedCents?: number;
};

function BudgetCardFrame({ active, label, onSelect, children }: Readonly<{
  active: boolean;
  label: string;
  onSelect: () => void;
  children: ReactNode;
}>) {
  return (
    <div className="budget-mini budget-mini-compact tx-account-card" style={{
      borderColor: active ? "var(--brand-500)" : undefined,
      boxShadow: active ? "var(--shadow-sm)" : undefined,
    }}>
      <Button type="button" className="tx-account-card-select" aria-pressed={active} aria-label={label} onClick={onSelect} />
      {children}
    </div>
  );
}

function TransactionBudgetCard<T extends BudgetSummary>({ budget, active, formatAmount, onSelect, onEdit, onReceivables }: Readonly<{
  budget: T;
  active: boolean;
  formatAmount: (value: number) => string;
  onSelect: (id: string) => void;
  onEdit: (budget: T) => void;
  onReceivables: (id: string) => void;
}>) {
  return (
    <BudgetCardFrame active={active} label={`Show transactions from ${budget.name}`} onSelect={() => onSelect(budget.id)}>
      <div className="tx-account-card-body">
        <div className="tx-account-card-head">
          <div className="bm-name">{budget.name}</div>
          <Button type="button" className="bm-edit-btn tx-subaccount-edit-btn" onClick={() => onEdit(budget)} aria-label={`Edit ${budget.name}`} title="Edit sub-account">✎</Button>
        </div>
        <div className={`bm-amount ${getAmountToneClass(budget.availableCents)}`}>{formatAmount(budget.availableCents)}</div>
        {budget.receivableReservedCents && budget.availableCents > 0 ? (
          <div className="bm-target tx-account-card-footer tx-account-card-receivable">
            <span>({formatAmount(budget.receivableReservedCents)})</span>
            <Button type="button" className="tx-account-receivable-btn" aria-label={`Show receivable breakdown for ${budget.name}`} title="Show receivable breakdown" onClick={() => onReceivables(budget.id)}>i</Button>
          </div>
        ) : <div className="bm-target tx-account-card-footer tx-account-card-footer-empty" aria-hidden="true">—</div>}
      </div>
      <span aria-hidden="true" className="tx-account-card-icon">{getBudgetIcon(budget.name, budget.icon)}</span>
    </BudgetCardFrame>
  );
}

export function TransactionBudgetGrid<T extends BudgetSummary>({ budgets, activeId, totalCents, formatAmount, onSelect, onEdit, onReceivables }: Readonly<{
  budgets: readonly T[];
  activeId: string;
  totalCents: number;
  formatAmount: (value: number) => string;
  onSelect: (id: string) => void;
  onEdit: (budget: T) => void;
  onReceivables: (id: string) => void;
}>) {
  const [expanded, setExpanded] = useSessionState("nest:view:transactions:subaccounts-expanded", false);
  const [columns, setColumns] = useState(8);
  const gridRef = useRef<HTMLDivElement>(null);
  const heightBeforeToggle = useRef<number | null>(null);
  const collapsedCount = columns * 2 - 1;
  const hasHidden = budgets.length > collapsedCount;
  const displayed = useMemo(() => {
    if (expanded || !hasHidden) return budgets;
    const visible = budgets.slice(0, collapsedCount);
    const activeIndex = budgets.findIndex((budget) => budget.id === activeId);
    if (activeIndex >= collapsedCount) visible[visible.length - 1] = budgets[activeIndex];
    return visible;
  }, [budgets, expanded, hasHidden, collapsedCount, activeId]);

  useEffect(() => {
    // Keep these counts in sync with .tx-account-grid in app/styles/features.css.
    const updateColumns = () => {
      if (window.matchMedia("(max-width: 768px)").matches) setColumns(3);
      else if (window.matchMedia("(max-width: 1024px)").matches) setColumns(6);
      else setColumns(8);
    };
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  const toggleExpanded = () => {
    heightBeforeToggle.current = gridRef.current!.getBoundingClientRect().height;
    setExpanded((value) => !value);
  };

  useLayoutEffect(() => {
    const fromHeight = heightBeforeToggle.current;
    heightBeforeToggle.current = null;
    if (fromHeight === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const grid = gridRef.current!;
    const toHeight = grid.getBoundingClientRect().height;
    if (fromHeight === toHeight) return;
    grid.style.overflow = "hidden";
    const animation = grid.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], { duration: 240, easing: "ease-in-out" });
    const clearClip = () => { grid.style.overflow = ""; };
    animation.onfinish = clearClip;
    animation.oncancel = clearClip;
    return () => animation.cancel();
  }, [expanded]);

  return (
    <>
      <div ref={gridRef} id="tx-account-grid-wrap">
        <div id="tx-account-grid" className="account-cards-grid tx-account-grid">
          <BudgetCardFrame active={activeId === "ALL"} label="Show transactions from all sub-accounts" onSelect={() => onSelect("ALL")}>
            <div className="tx-account-card-body">
              <div className="bm-name" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><span aria-hidden="true">📁</span><span>All accounts</span></div>
              <div className={`bm-amount ${getAmountToneClass(totalCents)}`}>{formatAmount(totalCents)}</div>
              <div className="bm-target tx-account-card-footer tx-account-card-footer-empty" aria-hidden="true">—</div>
            </div>
          </BudgetCardFrame>
          {displayed.map((budget) => <TransactionBudgetCard key={budget.id} budget={budget} active={activeId === budget.id} formatAmount={formatAmount} onSelect={onSelect} onEdit={onEdit} onReceivables={onReceivables} />)}
        </div>
      </div>
      {hasHidden ? (
        <Button type="button" className="btn btn-ghost btn-sm tx-account-grid-more" aria-expanded={expanded} aria-controls="tx-account-grid-wrap" onClick={toggleExpanded}>
          {expanded ? <>Show fewer <ChevronUp size={14} aria-hidden="true" /></> : <>Show all {budgets.length} sub-accounts <ChevronDown size={14} aria-hidden="true" /></>}
        </Button>
      ) : null}
    </>
  );
}
