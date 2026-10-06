"use client";

import { SubmitEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { CIO_LIQUIDITY_CLASSES, CIO_POSITION_SIDES, type CioLiquidityClass, type CioPlanningPosition, type CioPositionPayload, type CioPositionSide } from "@/components/cio/types";
import { centsFromMoneyInput, formatCioDate, formatCioLabel, formatCioMoney, moneyInputFromCents, toDateInput, toIsoDate } from "@/components/cio/cio-format";
import { apiFetch, mutationFailureMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { usePrivacyMode } from "@/lib/privacy-mode";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form-field";
import { QueryError } from "@/components/ui/query-state";

type PositionForm = {
  side: CioPositionSide; category: string; label: string; amount: string; asOfDate: string;
  liquidityClass: CioLiquidityClass; investable: boolean; retirement: boolean; notes: string;
};

const LIQUIDITY_COPY: Record<CioLiquidityClass, { option: string; hint: string }> = {
  IMMEDIATE: { option: "Immediate - usable now", hint: "Usable as cash now or within a day, without selling an investment." },
  LIQUID: { option: "Liquid - usually available soon", hint: "Usually sellable or withdrawable within days, without a major penalty." },
  RESTRICTED: { option: "Restricted - rules or penalties apply", hint: "Available only for certain purposes or after meeting rules, such as a CPF balance." },
  LOCKED: { option: "Locked - unavailable until later", hint: "Not available until a maturity date or future event." },
};

function emptyPosition(): PositionForm {
  return { side: "ASSET", category: "OTHER", label: "", amount: "", asOfDate: new Date().toISOString().slice(0, 10), liquidityClass: "RESTRICTED", investable: false, retirement: false, notes: "" };
}

export function CioPositionsDialog({ open, workspaceId, currency, onClose, onSaved }: Readonly<{
  open: boolean; workspaceId: string | null | undefined; currency: string; onClose: () => void; onSaved: () => Promise<void> | void;
}>) {
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  usePrivacyMode();
  const [form, setForm] = useState<PositionForm>(emptyPosition);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const closeForm = () => { setFormOpen(false); setEditingId(null); setForm(emptyPosition()); setFormError(""); };
  const positions = useQuery({
    queryKey: queryKeys.cioPositions(workspaceId),
    queryFn: async () => (await apiFetch<{ items: CioPlanningPosition[] }>("/api/cio/planning-positions", { cache: "no-store" })).items,
    enabled: open && Boolean(workspaceId),
  });
  const saveMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string | null; payload: CioPositionPayload }) => {
      const response = await apiFetch<{ position: CioPlanningPosition }>(id ? `/api/cio/planning-positions/${encodeURIComponent(id)}` : "/api/cio/planning-positions", {
        method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      return response.position;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.cioPositions(workspaceId) });
      await onSaved();
      closeForm();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ deleted: { id: string } }>(`/api/cio/planning-positions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.cioPositions(workspaceId) });
      await onSaved();
    },
  });

  useEffect(() => {
    if (!open) closeForm();
  }, [open]);

  const clearErrors = () => {
    setFormError("");
    if (saveMutation.isError) saveMutation.reset();
  };
  const set = <K extends keyof PositionForm>(field: K, value: PositionForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    clearErrors();
  };
  const startNew = () => {
    setEditingId(null);
    setForm(emptyPosition());
    clearErrors();
    setFormOpen(true);
  };
  const startEdit = (position: CioPlanningPosition) => {
    setEditingId(position.id);
    setForm({ side: position.side, category: position.category, label: position.label, amount: moneyInputFromCents(position.currentValueCents), asOfDate: toDateInput(position.asOfDate), liquidityClass: position.liquidityClass, investable: position.includeInInvestableAllocation, retirement: position.includeInRetirementProjection, notes: position.notes ?? "" });
    clearErrors();
    setFormOpen(true);
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const category = form.category.trim().toUpperCase().replaceAll(/[^A-Z0-9_-]/g, "_").replaceAll(/^_+|_+$/g, "");
    const amount = Number(form.amount);
    const currentValueCents = centsFromMoneyInput(form.amount) ?? 0;
    if (!form.label.trim()) {
      setFormError(`Give this ${form.side === "ASSET" ? "asset" : "debt"} a short name, such as "CPF balance" or "Home mortgage".`);
      return;
    }
    if (!category) {
      setFormError(`Enter a simple category, such as ${form.side === "ASSET" ? "CPF, PROPERTY, or PENSION" : "MORTGAGE, LOAN, or OTHER"}.`);
      return;
    }
    if (!form.amount.trim() || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(currentValueCents)) {
      setFormError("Enter a valid current value of 0 or more. Use Asset or Liability to show the direction, not a minus sign.");
      return;
    }
    if (!form.asOfDate) {
      setFormError("Choose the date when you last checked this balance.");
      return;
    }
    setFormError("");
    saveMutation.mutate({ id: editingId, payload: {
      side: form.side, category, label: form.label.trim(),
      currentValueCents, asOfDate: toIsoDate(form.asOfDate)!, liquidityClass: form.liquidityClass,
      includeInInvestableAllocation: form.side === "ASSET" && form.investable,
      includeInRetirementProjection: form.side === "ASSET" && form.retirement,
      notes: form.notes.trim() || null,
    } });
  };
  const remove = async (position: CioPlanningPosition) => {
    const accepted = await confirm({ title: "Delete planning position?", message: `${position.label} will be removed from CIO planning totals. Dashboard net worth is not affected.`, confirmLabel: "Delete", cancelLabel: "Cancel", destructive: true });
    if (accepted) deleteMutation.mutate(position.id);
  };
  const positionUseLabel = (position: CioPlanningPosition) => {
    if (position.side === "LIABILITY") return "Reduces CIO planning net worth";
    const uses = [
      position.includeInInvestableAllocation ? "Investable allocation" : null,
      position.includeInRetirementProjection ? "Retirement projection" : null,
    ].filter(Boolean);
    return uses.length ? uses.join(" · ") : "CIO planning net worth only";
  };

  return (
    <Dialog open={open} onClose={onClose} closeDisabled={saveMutation.isPending || deleteMutation.isPending} title="Planning assets and debts" description="Add balances that matter to your CIO plan but are not already tracked in Nest." size="xl" contentClassName="cio-dialog" footer={
      <><Button variant="ghost" onClick={onClose}>Close</Button>{!formOpen ? <Button variant="primary" onClick={startNew}><Plus size={16} /> Add asset or debt</Button> : null}</>
    }>
      {positions.isError ? <QueryError title="Planning assets and debts could not be loaded" message={positions.error instanceof Error ? positions.error.message : undefined} onRetry={() => void positions.refetch()} /> : positions.isLoading ? <div className="cio-dialog-loading" aria-busy="true">Loading planning balances…</div> : (
        <div className="cio-manager-layout">
          <p className="cio-readonly-note" role="note"><strong>What belongs here?</strong> Add an asset or debt that Nest does not already track, such as a home, mortgage, or CPF balance held elsewhere. Do not re-enter a Nest bank or investment account, and use recurring flows for regular deposits or withdrawals. These entries change CIO planning only, not dashboard balances or real accounts.</p>
          {formOpen ? (
            <form className="cio-manager-form" onSubmit={submit} noValidate>
              <div className="cio-manager-form-heading"><div><h3>{editingId ? "Edit planning balance" : "New planning balance"}</h3><p>Enter the current balance as a positive amount in {currency}.</p></div><Button variant="ghost" size="sm" onClick={closeForm}>Cancel</Button></div>
              <div className="form-grid form-grid-2">
                <SelectField label="Asset or liability?" value={form.side} hint={form.side === "ASSET" ? "Asset means something you own, such as property or an outside pension balance." : "Liability means money you owe, such as a mortgage or personal loan."} onChange={(e) => { const side = e.target.value as CioPositionSide; setForm((current) => ({ ...current, side, investable: side === "ASSET" ? current.investable : false, retirement: side === "ASSET" ? current.retirement : false })); clearErrors(); }}>{CIO_POSITION_SIDES.map((value) => <option key={value} value={value}>{value === "ASSET" ? "Asset - something you own" : "Liability - money you owe"}</option>)}</SelectField>
                <TextField label="Category" value={form.category} onChange={(e) => set("category", e.target.value.toUpperCase())} hint={form.side === "ASSET" ? "Examples: CPF, PROPERTY, PENSION, or OTHER." : "Examples: MORTGAGE, LOAN, or OTHER."} maxLength={48} required />
                <TextField label="Name" value={form.label} onChange={(e) => set("label", e.target.value)} hint={form.side === "ASSET" ? "Example: CPF Special Account or Family home." : "Example: Home mortgage or Education loan."} maxLength={160} required />
                <TextField label={`${form.side === "ASSET" ? "Current value" : "Amount still owed"} (${currency})`} inputMode="decimal" min="0" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} hint="Enter a positive amount; Nest applies the asset or debt direction." required />
                <TextField label="Balance checked on" type="date" value={form.asOfDate} onChange={(e) => set("asOfDate", e.target.value)} hint="The date this value was last accurate." required />
                <SelectField label="Liquidity (how accessible is it?)" value={form.liquidityClass} hint={form.side === "ASSET" ? `${LIQUIDITY_COPY[form.liquidityClass].hint} This affects CIO's liquidity view.` : "A debt never counts as available cash, so this choice does not change available-money calculations."} onChange={(e) => set("liquidityClass", e.target.value as CioLiquidityClass)}>{CIO_LIQUIDITY_CLASSES.map((value) => <option key={value} value={value}>{LIQUIDITY_COPY[value].option}</option>)}</SelectField>
              </div>
              {form.side === "ASSET" ? (
                <div className="cio-check-grid">
                  <label className="cio-check-row"><Input type="checkbox" checked={form.investable} onChange={(e) => set("investable", e.target.checked)} /><span><strong>Include in investable allocation</strong><small>Turn on if this belongs in the portfolio mix you can allocate or rebalance. Usually off for a home, car, or emergency-only cash.</small></span></label>
                  <label className="cio-check-row"><Input type="checkbox" checked={form.retirement} onChange={(e) => set("retirement", e.target.checked)} /><span><strong>Include in retirement projection</strong><small>Turn on if you expect to use this asset to fund retirement, such as CPF or a pension. Leave off if it will not be available for retirement spending.</small></span></label>
                </div>
              ) : <p className="cio-readonly-note" role="note">Debts reduce CIO planning net worth. They cannot be counted as investable assets or retirement savings.</p>}
              <TextAreaField label="Notes (optional)" value={form.notes} onChange={(e) => set("notes", e.target.value)} hint="Add a useful assumption, restriction, or valuation source." maxLength={1000} rows={3} />
              {formError || saveMutation.isError ? <p className="form-error" role="alert">{formError || mutationFailureMessage(saveMutation.error)}</p> : null}
              <div className="cio-manager-form-actions"><Button variant="primary" type="submit" loading={saveMutation.isPending}>{editingId ? "Save changes" : "Add position"}</Button></div>
            </form>
          ) : null}
          <div className="cio-manager-list" aria-label="Planning positions">
            {positions.data?.length ? positions.data.map((position) => (
              <article className="cio-manager-row" key={position.id}>
                <div className="cio-manager-row-main"><span className={`cio-side-badge is-${position.side.toLowerCase()}`}>{formatCioLabel(position.side)}</span><div><strong>{position.label}</strong><small>{formatCioLabel(position.category)} · checked {formatCioDate(position.asOfDate)} · {formatCioLabel(position.liquidityClass)}</small></div></div>
                <div className="cio-manager-row-value"><strong>{formatCioMoney(position.currentValueCents, currency)}</strong><small>{positionUseLabel(position)}</small></div>
                <div className="cio-manager-row-actions"><Button variant="ghost" iconOnly aria-label={`Edit ${position.label}`} onClick={() => startEdit(position)}><Pencil size={16} /></Button><Button variant="ghost" iconOnly aria-label={`Delete ${position.label}`} onClick={() => void remove(position)}><Trash2 size={16} /></Button></div>
              </article>
            )) : <div className="cio-form-empty"><strong>No extra planning balances yet</strong><p>Add only assets or debts that are not already represented by a Nest account or investment.</p></div>}
            {deleteMutation.isError ? <p className="form-error" role="alert">{mutationFailureMessage(deleteMutation.error)}</p> : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}
