"use client";

import { SubmitEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { CIO_FLOW_CADENCES, CIO_FLOW_TYPES, type CioFlowCadence, type CioFlowPayload, type CioFlowType, type CioRecurringFlow, type InvestmentOption } from "@/components/cio/types";
import { centsFromMoneyInput, formatCioDate, formatCioLabel, formatCioMoney, moneyInputFromCents, toDateInput, toIsoDate } from "@/components/cio/cio-format";
import type { AppShellContext } from "@/components/app-shell-context";
import { apiFetch, mutationFailureMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { usePrivacyMode } from "@/lib/privacy-mode";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form-field";
import { CioQueryContent } from "@/components/cio/cio-query-content";

type FlowForm = {
  type: CioFlowType; label: string; amount: string; cadence: CioFlowCadence; startsOn: string; endsOn: string;
  sourceFinancialAccountId: string; sourceInvestmentAccountId: string; destinationInvestmentAccountId: string;
  retirement: boolean; notes: string;
};

const FLOW_TYPE_COPY: Record<CioFlowType, { option: string; hint: string; nameHint: string; retirementHint: string }> = {
  EXTERNAL_CONTRIBUTION: {
    nameHint: "Example: Monthly ETF contribution.",
    retirementHint: "Counts this contribution toward the annual savings used by the retirement projection.",
    option: "Contribution - new money coming in",
    hint: "New money from outside your tracked Nest holdings, such as $500 of salary invested each month. It increases projected savings.",
  },
  EXTERNAL_WITHDRAWAL: {
    nameHint: "Example: Annual retirement withdrawal.",
    retirementHint: "Subtracts this withdrawal from the annual savings used by the retirement projection.",
    option: "Withdrawal - money leaving the plan",
    hint: "Money taken out for spending outside the portfolio, such as a yearly tuition payment or retirement drawdown. It reduces projected savings.",
  },
  INTERNAL_REALLOCATION: {
    nameHint: "Example: Monthly cash-to-ETF transfer.",
    retirementHint: "Marks this move as retirement-related in reporting. It still adds no new savings to the retirement projection.",
    option: "Internal reallocation - money moved within Nest",
    hint: "Money moved from one tracked Nest holding to another, such as bank cash into an ETF. It is tracked but never counted as new savings.",
  },
};

const CADENCE_HINTS: Record<CioFlowCadence, string> = {
  WEEKLY: "The amount repeats every week (52 times a year).",
  MONTHLY: "The amount repeats every month (12 times a year). For example, 500 monthly becomes 6,000 a year.",
  QUARTERLY: "The amount repeats every three months (4 times a year).",
  ANNUAL: "The amount repeats once a year.",
};

function emptyFlow(): FlowForm {
  return { type: "EXTERNAL_CONTRIBUTION", label: "", amount: "", cadence: "MONTHLY", startsOn: new Date().toISOString().slice(0, 10), endsOn: "", sourceFinancialAccountId: "", sourceInvestmentAccountId: "", destinationInvestmentAccountId: "", retirement: true, notes: "" };
}

export function CioFlowsDialog({ open, workspaceId, currency, onClose, onSaved }: Readonly<{
  open: boolean; workspaceId: string | null | undefined; currency: string; onClose: () => void; onSaved: () => Promise<void> | void;
}>) {
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  usePrivacyMode();
  const [form, setForm] = useState<FlowForm>(emptyFlow);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const closeForm = () => { setFormOpen(false); setEditingId(null); setForm(emptyFlow()); setFormError(""); };
  const flows = useQuery({
    queryKey: queryKeys.cioFlows(workspaceId),
    queryFn: async () => (await apiFetch<{ items: CioRecurringFlow[] }>("/api/cio/recurring-flows", { cache: "no-store" })).items,
    enabled: open && Boolean(workspaceId),
  });
  const context = useQuery({ queryKey: queryKeys.context(workspaceId), queryFn: () => apiFetch<AppShellContext>("/api/context"), enabled: open });
  const investments = useQuery({
    queryKey: queryKeys.investments(workspaceId),
    queryFn: () => apiFetch<InvestmentOption[]>(`/api/investments?workspaceId=${encodeURIComponent(workspaceId!)}`, { cache: "no-store" }),
    enabled: open && Boolean(workspaceId),
  });
  const saveMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string | null; payload: CioFlowPayload }) => (await apiFetch<{ flow: CioRecurringFlow }>(id ? `/api/cio/recurring-flows/${encodeURIComponent(id)}` : "/api/cio/recurring-flows", {
      method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })).flow,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.cioFlows(workspaceId) }); await onSaved(); closeForm(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ deleted: { id: string } }>(`/api/cio/recurring-flows/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.cioFlows(workspaceId) }); await onSaved(); },
  });

  const clearErrors = () => {
    setFormError("");
    if (saveMutation.isError) saveMutation.reset();
  };
  const set = <K extends keyof FlowForm>(field: K, value: FlowForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    clearErrors();
  };
  const startNew = () => {
    setEditingId(null);
    setForm(emptyFlow());
    clearErrors();
    setFormOpen(true);
  };
  const changeType = (type: CioFlowType) => {
    setForm((current) => ({
      ...current,
      type,
      sourceFinancialAccountId: type === "EXTERNAL_CONTRIBUTION" ? "" : current.sourceFinancialAccountId,
      sourceInvestmentAccountId: type === "EXTERNAL_CONTRIBUTION" ? "" : current.sourceInvestmentAccountId,
      destinationInvestmentAccountId: type === "EXTERNAL_WITHDRAWAL" ? "" : current.destinationInvestmentAccountId,
    }));
    clearErrors();
  };
  const chooseSource = (field: "sourceFinancialAccountId" | "sourceInvestmentAccountId", value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(value ? { [field === "sourceFinancialAccountId" ? "sourceInvestmentAccountId" : "sourceFinancialAccountId"]: "" } : {}),
      ...(value && current.type === "EXTERNAL_WITHDRAWAL" ? { destinationInvestmentAccountId: "" } : {}),
    }));
    clearErrors();
  };
  const chooseDestination = (value: string) => {
    setForm((current) => ({
      ...current,
      destinationInvestmentAccountId: value,
    }));
    clearErrors();
  };
  const startEdit = (flow: CioRecurringFlow) => {
    setEditingId(flow.id);
    setForm({ type: flow.type, label: flow.label, amount: moneyInputFromCents(flow.amountCents), cadence: flow.cadence, startsOn: toDateInput(flow.startsOn), endsOn: toDateInput(flow.endsOn), sourceFinancialAccountId: flow.sourceFinancialAccountId ?? "", sourceInvestmentAccountId: flow.sourceInvestmentAccountId ?? "", destinationInvestmentAccountId: flow.destinationInvestmentAccountId ?? "", retirement: flow.includeInRetirementProjection, notes: flow.notes ?? "" });
    clearErrors();
    setFormOpen(true);
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const result = prepareFlow(form);
    if ("error" in result) { setFormError(result.error); return; }
    setFormError("");
    saveMutation.mutate({ id: editingId, payload: result.payload });
  };
  const remove = async (flow: CioRecurringFlow) => {
    const accepted = await confirm({ title: "Delete recurring flow?", message: `${flow.label} will no longer contribute to annual flow or retirement calculations.`, confirmLabel: "Delete", cancelLabel: "Cancel", destructive: true });
    if (accepted) deleteMutation.mutate(flow.id);
  };
  const bankAccounts = context.data?.accounts?.filter((account) => account.kind === "BANK") ?? [];

  const content = (
    <div className="cio-manager-layout">
      <p className="cio-readonly-note" role="note"><strong>What belongs here?</strong> Add a planned money movement that repeats, such as monthly investing, a yearly withdrawal, or a standing transfer between holdings. Do not add past or one-off transfers, and do not duplicate ordinary spending unless it is a planned portfolio withdrawal. This is a forecast only; Nest will not move money.</p>
      {formOpen ? (
        <FlowEditor form={form} editing={Boolean(editingId)} currency={currency} closeForm={closeForm} submit={submit} set={set} changeType={changeType} chooseSource={chooseSource} chooseDestination={chooseDestination} bankAccounts={bankAccounts} investments={investments.data ?? []} saving={saveMutation.isPending} error={formError || (saveMutation.isError ? mutationFailureMessage(saveMutation.error) : "")} />
      ) : null}
      <div className="cio-manager-list" aria-label="Recurring flows">
        {flows.data?.length ? flows.data.map((flow) => (
          <FlowRow key={flow.id} flow={flow} currency={currency} startEdit={startEdit} remove={remove} />
        )) : <div className="cio-form-empty"><strong>No recurring plans yet</strong><p>Add a repeating contribution, withdrawal, or movement between tracked holdings.</p></div>}
        {deleteMutation.isError ? <p className="form-error" role="alert">{mutationFailureMessage(deleteMutation.error)}</p> : null}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose} closeDisabled={saveMutation.isPending || deleteMutation.isPending} title="Recurring planning flows" description="Plan repeating contributions, withdrawals, and movements between your holdings." size="xl" contentClassName="cio-dialog" footer={
      <><Button variant="ghost" onClick={onClose} disabled={saveMutation.isPending || deleteMutation.isPending}>Close</Button>{!formOpen ? <Button variant="primary" onClick={startNew}><Plus size={16} /> Add recurring flow</Button> : null}</>
    }>
      <CioQueryContent state={flows} title="Recurring flows could not be loaded" loadingText="Loading flows…" onRetry={() => void flows.refetch()}>{content}</CioQueryContent>
    </Dialog>
  );
}

function prepareFlow(form: FlowForm): { error: string } | { payload: CioFlowPayload } {
  const amountCents = centsFromMoneyInput(form.amount);
  const sourceFinancialAccountId = form.type === "EXTERNAL_CONTRIBUTION" ? "" : form.sourceFinancialAccountId;
  const sourceInvestmentAccountId = form.type === "EXTERNAL_CONTRIBUTION" ? "" : form.sourceInvestmentAccountId;
  const destinationInvestmentAccountId = form.type === "EXTERNAL_WITHDRAWAL" ? "" : form.destinationInvestmentAccountId;
  const hasSource = Boolean(sourceFinancialAccountId || sourceInvestmentAccountId);
  const hasDestination = Boolean(destinationInvestmentAccountId);
  if (!form.label.trim()) {
    return { error: "Give this plan a short name, such as \"Monthly ETF contribution\" or \"Annual retirement withdrawal\"." };
  }
  if (amountCents <= 0 || !Number.isSafeInteger(amountCents)) {
    return { error: "Enter an amount greater than 0. Use the flow type, not a minus sign, to show whether money comes in or goes out." };
  }
  if (!form.startsOn) {
    return { error: "Choose when this recurring plan starts." };
  }
  if (form.endsOn && form.endsOn < form.startsOn) {
    return { error: "Choose an end date that is on or after the start date, or leave it blank for an ongoing plan." };
  }

  if (form.type === "INTERNAL_REALLOCATION" && (!hasSource || !hasDestination)) {
    return { error: "For an internal reallocation, choose where the money comes from (one bank account or investment) and which investment receives it." };
  }
  if (sourceInvestmentAccountId && sourceInvestmentAccountId === destinationInvestmentAccountId) {
    return { error: "Choose a different destination investment; moving money to the same investment is not a reallocation." };
  }

  return { payload: {
    type: form.type, label: form.label.trim(), amountCents, cadence: form.cadence,
    startsOn: toIsoDate(form.startsOn)!, endsOn: toIsoDate(form.endsOn), sourceFinancialAccountId: sourceFinancialAccountId || null,
    sourceInvestmentAccountId: sourceInvestmentAccountId || null, destinationInvestmentAccountId: destinationInvestmentAccountId || null,
    includeInRetirementProjection: form.retirement, notes: form.notes.trim() || null,
  } };
}

type FlowEditorProps = {
  form: FlowForm; editing: boolean; currency: string; closeForm: () => void; submit: (event: SubmitEvent) => void;
  set: <K extends keyof FlowForm>(field: K, value: FlowForm[K]) => void;
  changeType: (type: CioFlowType) => void;
  chooseSource: (field: "sourceFinancialAccountId" | "sourceInvestmentAccountId", value: string) => void;
  chooseDestination: (value: string) => void;
  bankAccounts: { id: string; name: string }[]; investments: InvestmentOption[]; saving: boolean; error: string;
};

function investmentLabel(investment: InvestmentOption) {
  return investment.displayName || `${investment.institutionName} · ${investment.productName}`;
}

function FlowEditor({ form, editing, currency, closeForm, submit, set, changeType, chooseSource, chooseDestination, bankAccounts, investments, saving, error }: Readonly<FlowEditorProps>) {
  const showSources = form.type !== "EXTERNAL_CONTRIBUTION";
  const showDestination = form.type !== "EXTERNAL_WITHDRAWAL";
  return (
    <form className="cio-manager-form" onSubmit={submit} noValidate>
      <div className="cio-manager-form-heading"><div><h3>{editing ? "Edit recurring flow" : "New recurring flow"}</h3><p>Enter a positive amount for each occurrence in {currency}; the flow type sets its direction.</p></div><Button variant="ghost" size="sm" onClick={closeForm} disabled={saving}>Cancel</Button></div>
      <p className="cio-readonly-note" role="note">{FLOW_TYPE_COPY[form.type].hint}</p>
      <div className="form-grid form-grid-2">
        <SelectField label="What happens to the money?" value={form.type} onChange={(e) => changeType(e.target.value as CioFlowType)}>{CIO_FLOW_TYPES.map((value) => <option key={value} value={value}>{FLOW_TYPE_COPY[value].option}</option>)}</SelectField>
        <TextField label="Name" value={form.label} onChange={(e) => set("label", e.target.value)} hint={FLOW_TYPE_COPY[form.type].nameHint} maxLength={160} required />
        <TextField label={`Amount each time (${currency})`} inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} hint="Use a positive amount. The selected flow type determines whether it adds, subtracts, or only moves money." required />
        <SelectField label="How often (cadence)?" value={form.cadence} hint={CADENCE_HINTS[form.cadence]} onChange={(e) => set("cadence", e.target.value as CioFlowCadence)}>{CIO_FLOW_CADENCES.map((value) => <option key={value} value={value}>{formatCioLabel(value)}</option>)}</SelectField>
        <TextField label="First occurrence" type="date" value={form.startsOn} onChange={(e) => set("startsOn", e.target.value)} hint="The first date this plan should count." required />
        <TextField label="Last occurrence (optional)" type="date" value={form.endsOn} onChange={(e) => set("endsOn", e.target.value)} hint="Leave blank if the plan continues indefinitely." />
        {showSources ? <FlowSourceFields form={form} chooseSource={chooseSource} bankAccounts={bankAccounts} investments={investments} /> : null}
        {showDestination ? <FlowDestinationField form={form} chooseDestination={chooseDestination} investments={investments} /> : null}
      </div>
      <label className="cio-check-row"><Input type="checkbox" checked={form.retirement} onChange={(e) => set("retirement", e.target.checked)} /><span><strong>Include in retirement projection</strong><small>{FLOW_TYPE_COPY[form.type].retirementHint}</small></span></label>
      <TextAreaField label="Notes (optional)" value={form.notes} onChange={(e) => set("notes", e.target.value)} hint="Add context that will help you recognise or review this plan later." maxLength={1000} rows={3} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="cio-manager-form-actions"><Button variant="primary" type="submit" loading={saving}>{editing ? "Save changes" : "Add flow"}</Button></div>
    </form>
  );
}

function flowRetirementLabel(flow: CioRecurringFlow) {
  if (!flow.includeInRetirementProjection) return "Excluded from retirement projection";
  return flow.type === "INTERNAL_REALLOCATION" ? "Retirement-related; not new savings" : "Included in retirement projection";
}

function FlowRow({ flow, currency, startEdit, remove }: Readonly<{
  flow: CioRecurringFlow; currency: string; startEdit: (flow: CioRecurringFlow) => void; remove: (flow: CioRecurringFlow) => Promise<void>;
}>) {
  return (
    <article className="cio-manager-row">
      <div className="cio-manager-row-main"><span className="cio-side-badge">{formatCioLabel(flow.cadence)}</span><div><strong>{flow.label}</strong><small>{formatCioLabel(flow.type)} · from {formatCioDate(flow.startsOn)}{flow.endsOn ? ` to ${formatCioDate(flow.endsOn)}` : " · ongoing"}</small></div></div>
      <div className="cio-manager-row-value"><strong>{formatCioMoney(flow.amountCents, currency)} each time</strong><small>{flowRetirementLabel(flow)}</small></div>
      <div className="cio-manager-row-actions"><Button variant="ghost" iconOnly aria-label={`Edit ${flow.label}`} onClick={() => startEdit(flow)}><Pencil size={16} /></Button><Button variant="ghost" iconOnly aria-label={`Delete ${flow.label}`} onClick={() => void remove(flow)}><Trash2 size={16} /></Button></div>
    </article>
  );
}

function FlowSourceFields({ form, chooseSource, bankAccounts, investments }: Readonly<Pick<FlowEditorProps, "form" | "chooseSource" | "bankAccounts" | "investments">>) {
  const isInternal = form.type === "INTERNAL_REALLOCATION";
  return (<>
      <SelectField label={`Source bank account${isInternal ? "" : " (optional)"}`} value={form.sourceFinancialAccountId} hint={isInternal ? "Choose this or a source investment, not both." : "Link the Nest bank account the withdrawal leaves, or leave blank if it is outside Nest."} onChange={(e) => chooseSource("sourceFinancialAccountId", e.target.value)}><option value="">{isInternal ? "None - use an investment source" : "None / outside Nest"}</option>{bankAccounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</SelectField>
      <SelectField label={`Source investment${isInternal ? "" : " (optional)"}`} value={form.sourceInvestmentAccountId} hint={isInternal ? "Choose this or a source bank account, not both." : "Link the Nest investment the withdrawal leaves, or leave blank if it is outside Nest."} onChange={(e) => chooseSource("sourceInvestmentAccountId", e.target.value)}><option value="">{isInternal ? "None - use a bank source" : "None / outside Nest"}</option>{investments.map((investment) => <option value={investment.id} key={investment.id}>{investmentLabel(investment)}</option>)}</SelectField>
  </>);
}

function FlowDestinationField({ form, chooseDestination, investments }: Readonly<Pick<FlowEditorProps, "form" | "chooseDestination" | "investments">>) {
  const isInternal = form.type === "INTERNAL_REALLOCATION";
  return (
    <SelectField label={`Destination investment${isInternal ? "" : " (optional)"}`} value={form.destinationInvestmentAccountId} hint={isInternal ? "Choose the tracked Nest investment that receives the money." : "Optionally link the tracked Nest investment receiving this new money."} onChange={(e) => chooseDestination(e.target.value)}><option value="">{isInternal ? "Choose an investment" : "None / destination not tracked"}</option>{investments.map((investment) => <option value={investment.id} key={investment.id}>{investmentLabel(investment)}</option>)}</SelectField>
  );
}
