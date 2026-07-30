"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  CIO_ASSET_CLASSES,
  CIO_EXPOSURE_DIMENSIONS,
  CIO_GEOGRAPHIES,
  CIO_LIQUIDITY_CLASSES,
  CIO_PORTFOLIO_ROLES,
  CIO_RISK_LEVELS,
  type CioExposure,
  type CioExposureDimension,
  type CioInvestmentProfile,
  type CioInvestmentProfilePayload,
  type CioLiquidityClass,
  type CioPortfolioRole,
  type CioRiskLevel,
  type CioSnapshot,
  type InvestmentOption,
} from "@/components/cio/types";
import { bpsFromPercentInput, formatCioLabel, percentInputFromBps, toDateInput, toIsoDate } from "@/components/cio/cio-format";
import { apiFetch, mutationFailureMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form-field";
import { QueryError } from "@/components/ui/query-state";

type ExposureForm = { dimension: CioExposureDimension; key: string; weight: string };
type InvestmentForm = {
  liquidityClass: CioLiquidityClass; portfolioRole: CioPortfolioRole; riskLevel: CioRiskLevel;
  includeInRetirementProjection: boolean; lockUntil: string; notes: string; exposures: ExposureForm[]; reviewed: boolean;
};

const LIQUIDITY_HINTS: Record<CioLiquidityClass, string> = {
  IMMEDIATE: "Available as cash now, without selling an investment.",
  LIQUID: "Can usually be sold and accessed within a short time.",
  RESTRICTED: "Access is possible, but subject to notice, penalties, or other conditions.",
  LOCKED: "Cannot be accessed until a date or condition is met.",
};
const ROLE_HINTS: Record<CioPortfolioRole, string> = {
  EMERGENCY: "Money set aside for unexpected expenses.",
  CORE: "A main long-term holding that anchors the portfolio.",
  STABILIZER: "Held mainly to reduce portfolio swings or provide stability.",
  SATELLITE: "A smaller, focused idea held around the core portfolio.",
  GOAL: "Dedicated to a specific planned expense or life goal.",
  OTHER: "Does not clearly fit one of the roles above.",
};
const RISK_HINTS: Record<CioRiskLevel, string> = {
  LOW: "Expected to move relatively little, though losses are still possible.",
  MODERATE: "Some ups and downs are expected in pursuit of growth.",
  HIGH: "Large changes in value are possible.",
  VERY_HIGH: "Very large changes or a substantial loss are possible.",
  UNKNOWN: "Choose this when there is not enough information yet.",
};
const DIMENSION_HINTS: Record<CioExposureDimension, string> = {
  ASSET_CLASS: "What it owns, such as cash, bonds, shares, or property.",
  GEOGRAPHY: "Where its underlying investments are exposed.",
  SECURITY: "The individual funds, stocks, or other securities inside it.",
};

export function CioInvestmentProfileDialog({ open, workspaceId, investments: snapshots, onClose, onSaved }: {
  open: boolean; workspaceId: string | null | undefined; investments: CioSnapshot["investments"];
  onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const initialId = snapshots.find((item) => item.classificationStatus !== "USER_CONFIRMED")?.id ?? snapshots[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(initialId);
  const [form, setForm] = useState<InvestmentForm>(() => emptyForm(snapshots.find((item) => item.id === initialId)));
  const [formError, setFormError] = useState("");
  const selectedSnapshot = snapshots.find((item) => item.id === selectedId);
  const accountOptions = useQuery({
    queryKey: queryKeys.investments(workspaceId),
    queryFn: () => apiFetch<InvestmentOption[]>(`/api/investments?workspaceId=${encodeURIComponent(workspaceId ?? "")}`, { cache: "no-store" }),
    enabled: open && Boolean(workspaceId),
  });
  const profile = useQuery({
    queryKey: queryKeys.cioInvestmentProfile(workspaceId, selectedId),
    queryFn: async () => (await apiFetch<{ profile: CioInvestmentProfile | null }>(`/api/cio/investments/${encodeURIComponent(selectedId)}/profile`, { cache: "no-store" })).profile,
    enabled: open && Boolean(workspaceId && selectedId),
  });
  const exposures = useQuery({
    queryKey: queryKeys.cioInvestmentExposures(workspaceId, selectedId),
    queryFn: async () => (await apiFetch<{ exposures: CioExposure[] }>(`/api/cio/investments/${encodeURIComponent(selectedId)}/exposures`, { cache: "no-store" })).exposures,
    enabled: open && Boolean(workspaceId && selectedId),
  });
  const mutation = useMutation({
    mutationFn: async ({ profilePayload, exposurePayload }: { profilePayload: CioInvestmentProfilePayload; exposurePayload: CioExposure[] }) => {
      const savedProfile = await apiFetch<{ profile: CioInvestmentProfile }>(`/api/cio/investments/${encodeURIComponent(selectedId)}/profile`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profilePayload),
      });
      const savedExposures = await apiFetch<{ exposures: CioExposure[] }>(`/api/cio/investments/${encodeURIComponent(selectedId)}/exposures`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exposures: exposurePayload }),
      });
      return { profile: savedProfile.profile, exposures: savedExposures.exposures };
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.cioInvestmentProfile(workspaceId, selectedId), saved.profile);
      queryClient.setQueryData(queryKeys.cioInvestmentExposures(workspaceId, selectedId), saved.exposures);
      await onSaved();
      onClose();
    },
  });

  useEffect(() => {
    if (!open) return;
    if (!selectedId && initialId) setSelectedId(initialId);
  }, [initialId, open, selectedId]);
  useEffect(() => {
    if (!open || !selectedId || profile.data === undefined || exposures.data === undefined) return;
    setForm(formFromData(selectedSnapshot, profile.data, exposures.data));
    setFormError("");
  }, [exposures.data, open, profile.data, selectedId, selectedSnapshot]);

  const set = <K extends keyof InvestmentForm>(field: K, value: InvestmentForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError("");
    if (mutation.isError) mutation.reset();
  };
  const updateExposure = (index: number, patch: Partial<ExposureForm>) => set("exposures", form.exposures.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const addExposure = () => set("exposures", [...form.exposures, nextExposure(form.exposures)]);
  const totals = useMemo(() => form.exposures.reduce<Record<string, number>>((result, row) => {
    result[row.dimension] = (result[row.dimension] ?? 0) + (bpsFromPercentInput(row.weight) ?? 0);
    return result;
  }, {}), [form.exposures]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.lockUntil && !isValidDateInput(form.lockUntil)) return setFormError("Choose a valid date for when this investment becomes available.");
    if (form.exposures.length > 100) return setFormError("Keep the breakdown to 100 rows or fewer.");

    for (const row of form.exposures) {
      const dimension = formatCioLabel(row.dimension).toLowerCase();
      const key = row.key.trim().toUpperCase();
      if (!key) return setFormError(`Choose what the ${dimension} row represents.`);
      if (row.dimension === "SECURITY" && !/^[A-Z0-9][A-Z0-9._:-]{0,31}$/.test(key)) {
        return setFormError("Use a short ticker-like security code, such as VWRA or CSPX. Use only letters, numbers, dots, underscores, colons, or hyphens.");
      }
      const weightError = validateWeight(row.weight, `${formatCioLabel(row.dimension)}: ${formatCioLabel(key)}`);
      if (weightError) return setFormError(weightError);
    }

    const publicExposures = form.exposures.map((row) => ({ dimension: row.dimension, key: row.key.trim().toUpperCase(), weightBps: bpsFromPercentInput(row.weight) ?? 0 }));
    const identities = new Set<string>();
    for (const row of publicExposures) {
      const identity = `${row.dimension}:${row.key}`;
      if (identities.has(identity)) return setFormError(`${formatCioLabel(row.dimension)} already includes ${formatCioLabel(row.key)}. Combine it into one row or choose a different item.`);
      identities.add(identity);
    }
    for (const [dimension, total] of Object.entries(totals)) {
      if (total !== 10_000) return setFormError(`${formatCioLabel(dimension)} adds up to ${percentInputFromBps(total)}%. Adjust those rows so that breakdown totals 100%.`);
    }
    if (!form.reviewed) return setFormError("Confirm that you have reviewed this account before saving its classification.");

    setFormError("");
    mutation.mutate({
      profilePayload: {
        liquidityClass: form.liquidityClass, portfolioRole: form.portfolioRole, riskLevel: form.riskLevel,
        includeInRetirementProjection: form.includeInRetirementProjection,
        lockUntil: form.liquidityClass === "LOCKED" ? toIsoDate(form.lockUntil) : null,
        classificationStatus: "USER_CONFIRMED",
        classificationSource: "USER",
        notes: form.notes.trim() || null,
      },
      exposurePayload: publicExposures,
    });
  };
  const optionLabel = (id: string) => {
    const account = accountOptions.data?.find((item) => item.id === id);
    return account ? account.displayName || `${account.institutionName} · ${account.productName}` : `Investment ${id.slice(0, 8)}`;
  };
  const loading = profile.isLoading || exposures.isLoading;
  const loadError = profile.error || exposures.error;
  const savedStatus = profile.data?.classificationStatus ?? selectedSnapshot?.classificationStatus ?? "UNCLASSIFIED";

  return (
    <Dialog open={open} onClose={onClose} closeDisabled={mutation.isPending} title="Describe an investment account" description="Tell Nest how this account fits the household plan, then add only the holding details you know. Nothing here buys, sells, or moves money." size="xl" contentClassName="cio-dialog" footer={
      <><Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button><Button variant="primary" type="submit" form="cio-investment-form" loading={mutation.isPending} disabled={!selectedId || loading}>Save classification</Button></>
    }>
      {!snapshots.length ? <div className="cio-form-empty"><strong>No investment accounts</strong><p>Add an investment account before describing it for CIO planning.</p></div> : (
        <>
          <SelectField label="Investment account" hint="Work through one account at a time. Accounts marked “Needs review” have not been confirmed yet." value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setFormError(""); }}>{snapshots.map((snapshot) => <option value={snapshot.id} key={snapshot.id}>{optionLabel(snapshot.id)}{snapshot.classificationStatus !== "USER_CONFIRMED" ? " · Needs review" : ""}</option>)}</SelectField>
          {loadError ? <QueryError title="Investment details could not be loaded" message={loadError instanceof Error ? loadError.message : undefined} onRetry={() => { void profile.refetch(); void exposures.refetch(); }} /> : loading ? <div className="cio-dialog-loading" aria-busy="true">Loading account details…</div> : (
            <form id="cio-investment-form" className="cio-dialog-form" onSubmit={submit} noValidate>
              <fieldset className="cio-form-section"><legend>1. Purpose, access, and risk</legend><p>Choose the best description for this account as a whole. “Unknown” is better than guessing when the risk is unclear.</p><div className="form-grid form-grid-2">
                <SelectField label="How quickly can you use the money?" hint={LIQUIDITY_HINTS[form.liquidityClass]} value={form.liquidityClass} onChange={(e) => set("liquidityClass", e.target.value as CioLiquidityClass)}>{CIO_LIQUIDITY_CLASSES.map((value) => <option key={value} value={value}>{formatCioLabel(value)}</option>)}</SelectField>
                <SelectField label="What job does it do in the portfolio?" hint={ROLE_HINTS[form.portfolioRole]} value={form.portfolioRole} onChange={(e) => set("portfolioRole", e.target.value as CioPortfolioRole)}>{CIO_PORTFOLIO_ROLES.map((value) => <option key={value} value={value}>{formatCioLabel(value)}</option>)}</SelectField>
                <SelectField label="How much can its value move?" hint={RISK_HINTS[form.riskLevel]} value={form.riskLevel} onChange={(e) => set("riskLevel", e.target.value as CioRiskLevel)}>{CIO_RISK_LEVELS.map((value) => <option key={value} value={value}>{formatCioLabel(value)}</option>)}</SelectField>
                {form.liquidityClass === "LOCKED" ? <TextField label="Locked until" hint="Optional: add the date if it is known." type="date" value={form.lockUntil} onChange={(e) => set("lockUntil", e.target.value)} /> : null}
              </div>
              <label className="cio-check-row"><Input type="checkbox" checked={form.includeInRetirementProjection} onChange={(e) => set("includeInRetirementProjection", e.target.checked)} /><span><strong>Count this toward retirement</strong><small>Include the account in retirement assets only if it is intended to help fund retirement.</small></span></label>
              <TextAreaField label="Notes (optional)" hint="Add context that will help someone review this later, such as a goal, restriction, or source statement." value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={1000} />
              </fieldset>

              <fieldset className="cio-form-section"><div className="cio-form-section-heading"><div><legend>2. What the account holds</legend><p>Break the same account down by asset class, geography, or individual security. Each type you add is a separate view and must total 100% on its own.</p></div><Button variant="outline" size="sm" onClick={addExposure} disabled={form.exposures.length >= 100}><Plus size={15} /> Add breakdown row</Button></div>
                {form.exposures.length ? <div className="cio-exposure-rows">{form.exposures.map((row, index) => (
                  <div className="cio-exposure-row" key={`${row.dimension}-${index}`}>
                    <SelectField label="Break down by" hint={DIMENSION_HINTS[row.dimension]} value={row.dimension} onChange={(e) => { const dimension = e.target.value as CioExposureDimension; updateExposure(index, { dimension, key: nextExposureKey(dimension, form.exposures) }); }}>{CIO_EXPOSURE_DIMENSIONS.map((value) => <option key={value} value={value}>{formatCioLabel(value)}</option>)}</SelectField>
                    <ExposureKeyField row={row} onChange={(key) => updateExposure(index, { key })} />
                    <TextField label="Share of account (%)" hint="Rows of this type must add to 100%." inputMode="decimal" placeholder="e.g. 60" value={row.weight} onChange={(e) => updateExposure(index, { weight: e.target.value })} required />
                    <Button variant="ghost" iconOnly aria-label={`Remove ${formatCioLabel(row.dimension)} exposure`} onClick={() => set("exposures", form.exposures.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={17} /></Button>
                  </div>
                ))}<div className="cio-exposure-totals">{Object.entries(totals).map(([dimension, total]) => <span className={total === 10_000 ? "is-good" : "is-warning"} key={dimension}>{formatCioLabel(dimension)}: {percentInputFromBps(total)}% {total === 10_000 ? "(complete)" : "(must total 100%)"}</span>)}</div></div> : <p className="cio-form-empty">Breakdown unknown. You can still confirm the account profile; Nest will keep its allocation marked as unknown until rows are added.</p>}
              </fieldset>

              <fieldset className="cio-form-section"><legend>3. Review and confirm</legend><p>{classificationMessage(savedStatus)}</p>
                <label className="cio-check-row"><Input type="checkbox" checked={form.reviewed} onChange={(e) => set("reviewed", e.target.checked)} /><span><strong>I have reviewed this account</strong><small>Saving records the classification as confirmed by you. Exact exposure rows are optional when the breakdown is genuinely unknown.</small></span></label>
              </fieldset>
              {formError || mutation.isError ? <p className="form-error" role="alert">{formError || mutationFailureMessage(mutation.error)}</p> : null}
            </form>
          )}
        </>
      )}
    </Dialog>
  );
}

function ExposureKeyField({ row, onChange }: { row: ExposureForm; onChange: (value: string) => void }) {
  if (row.dimension === "ASSET_CLASS") return <SelectField label="What does it own?" hint="Choose the broad type of investment." value={row.key} onChange={(event) => onChange(event.target.value)}>{CIO_ASSET_CLASSES.map((value) => <option key={value} value={value}>{formatCioLabel(value)}</option>)}</SelectField>;
  if (row.dimension === "GEOGRAPHY") return <SelectField label="Where is it exposed?" hint="Choose the region represented by this share." value={row.key} onChange={(event) => onChange(event.target.value)}>{CIO_GEOGRAPHIES.map((value) => <option key={value} value={value}>{formatCioLabel(value)}</option>)}</SelectField>;
  return <TextField label="Ticker or security code" hint="Use the code shown on the statement, such as VWRA." value={row.key} onChange={(event) => onChange(event.target.value.toUpperCase())} placeholder="e.g. VWRA" maxLength={32} required />;
}
function nextExposureKey(dimension: CioExposureDimension, rows: ExposureForm[]) {
  if (dimension === "SECURITY") return "";
  const options = dimension === "ASSET_CLASS" ? CIO_ASSET_CLASSES : CIO_GEOGRAPHIES;
  return options.find((value) => !rows.some((row) => row.dimension === dimension && row.key === value)) ?? options[0];
}
function nextExposure(rows: ExposureForm[]): ExposureForm {
  const assetClass = CIO_ASSET_CLASSES.find((value) => !rows.some((row) => row.dimension === "ASSET_CLASS" && row.key === value));
  if (assetClass) return { dimension: "ASSET_CLASS", key: assetClass, weight: "100" };
  const geography = CIO_GEOGRAPHIES.find((value) => !rows.some((row) => row.dimension === "GEOGRAPHY" && row.key === value));
  if (geography) return { dimension: "GEOGRAPHY", key: geography, weight: "100" };
  return { dimension: "SECURITY", key: "", weight: "100" };
}
function emptyForm(snapshot?: CioSnapshot["investments"][number]): InvestmentForm {
  return { liquidityClass: snapshot?.liquidityClass ?? "LIQUID", portfolioRole: snapshot?.portfolioRole ?? "OTHER", riskLevel: "UNKNOWN", includeInRetirementProjection: snapshot?.includeInRetirementProjection ?? false, lockUntil: "", notes: "", exposures: [], reviewed: snapshot?.classificationStatus === "USER_CONFIRMED" };
}
function formFromData(snapshot: CioSnapshot["investments"][number] | undefined, profile: CioInvestmentProfile | null, exposures: CioExposure[]): InvestmentForm {
  if (!profile) return { ...emptyForm(snapshot), exposures: exposures.map((row) => ({ dimension: row.dimension, key: row.key, weight: percentInputFromBps(row.weightBps) })) };
  return { liquidityClass: profile.liquidityClass, portfolioRole: profile.portfolioRole, riskLevel: profile.riskLevel, includeInRetirementProjection: profile.includeInRetirementProjection, lockUntil: toDateInput(profile.lockUntil), notes: profile.notes ?? "", exposures: exposures.map((row) => ({ dimension: row.dimension, key: row.key, weight: percentInputFromBps(row.weightBps) })), reviewed: profile.classificationStatus === "USER_CONFIRMED" };
}
function validateWeight(value: string, label: string) {
  if (!value.trim()) return `Enter the percentage for ${label}.`;
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) return `${label} must use a number for its percentage.`;
  const weightBps = bpsFromPercentInput(value) ?? 0;
  if (weightBps <= 0 || percentage > 100) return `${label} must be more than 0% and no more than 100%.`;
  return null;
}
function isValidDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function classificationMessage(status: string) {
  if (status === "SUGGESTED") return "Nest has a suggested description for this account. Check the choices above before confirming it.";
  if (status === "USER_CONFIRMED") return "This account was confirmed before. Review any changes above, then keep the confirmation checked to save them.";
  return "This account has not been confirmed yet. Review the choices above before saving.";
}
