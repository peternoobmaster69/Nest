"use client";

import { SubmitEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  CIO_ASSET_CLASSES,
  CIO_GEOGRAPHIES,
  type CioAssetClass,
  type CioGeography,
  type CioPolicy,
  type CioPolicyPayload,
} from "@/components/cio/types";
import { bpsFromPercentInput, centsFromMoneyInput, formatCioLabel, moneyInputFromCents, percentInputFromBps } from "@/components/cio/cio-format";
import { apiFetch, mutationFailureMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { SelectField, TextField } from "@/components/ui/form-field";
import { CioQueryContent } from "@/components/cio/cio-query-content";

type BandForm = { id: string; assetClass: CioAssetClass; minimum: string; target: string; maximum: string };
type GeographyForm = { id: string; geography: CioGeography; maximum: string };
type PolicyForm = {
  minimumReserve: string; minimumMonths: string; maximumAccount: string; maximumSecurity: string;
  maximumSatellite: string; staleDays: string; allowsOptions: string; allowsMargin: string;
  allowsLeverage: string; allowsIlp: string; confirmed: boolean; bands: BandForm[]; geographies: GeographyForm[];
};

const EMPTY_POLICY: PolicyForm = {
  minimumReserve: "", minimumMonths: "", maximumAccount: "", maximumSecurity: "", maximumSatellite: "",
  staleDays: "90", allowsOptions: "", allowsMargin: "", allowsLeverage: "", allowsIlp: "", confirmed: false,
  bands: [], geographies: [],
};

export function CioPolicyDialog({ open, workspaceId, onClose, onSaved }: Readonly<{
  open: boolean; workspaceId: string | null | undefined; onClose: () => void; onSaved: () => Promise<void> | void;
}>) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PolicyForm>(EMPTY_POLICY);
  const [formError, setFormError] = useState("");
  const policy = useQuery({
    queryKey: queryKeys.cioPolicy(workspaceId),
    queryFn: async () => (await apiFetch<{ policy: CioPolicy | null }>("/api/cio/policy", { cache: "no-store" })).policy,
    enabled: open && Boolean(workspaceId),
  });
  const mutation = useMutation({
    mutationFn: async (payload: CioPolicyPayload) => (await apiFetch<{ policy: CioPolicy }>("/api/cio/policy", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })).policy,
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.cioPolicy(workspaceId), saved);
      await onSaved();
      onClose();
    },
  });

  useEffect(() => {
    if (!open || policy.data === undefined) return;
    setForm(policy.data ? formFromPolicy(policy.data) : EMPTY_POLICY);
    setFormError("");
  }, [open, policy.data]);

  const set = <K extends keyof PolicyForm>(field: K, value: PolicyForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError("");
    if (mutation.isError) mutation.reset();
  };
  const updateBand = (index: number, patch: Partial<BandForm>) => set("bands", form.bands.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const updateGeography = (index: number, patch: Partial<GeographyForm>) => set("geographies", form.geographies.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const duplicateBand = findDuplicate(form.bands.map((band) => band.assetClass));
    if (duplicateBand) return setFormError(`${formatCioLabel(duplicateBand)} has been added more than once. Keep one target range for each asset class.`);
    const duplicateGeography = findDuplicate(form.geographies.map((limit) => limit.geography));
    if (duplicateGeography) return setFormError(`${formatCioLabel(duplicateGeography)} has been added more than once. Keep one limit for each geography.`);

    const fieldError = validateMoney(form.minimumReserve, "Minimum cash reserve")
      ?? validateWholeNumber(form.minimumMonths, "Months of essential spending", 0, 120, false)
      ?? validatePercent(form.maximumAccount, "Maximum in one account", false)
      ?? validatePercent(form.maximumSecurity, "Maximum in one security", false)
      ?? validatePercent(form.maximumSatellite, "Maximum in satellite holdings", false)
      ?? validateWholeNumber(form.staleDays, "Out-of-date valuation period", 1, 3_650, true);
    if (fieldError) return setFormError(fieldError);

    for (const band of form.bands) {
      const label = formatCioLabel(band.assetClass);
      const bandError = validatePercent(band.minimum, `${label} minimum`, true)
        ?? validatePercent(band.target, `${label} target`, true)
        ?? validatePercent(band.maximum, `${label} maximum`, true);
      if (bandError) return setFormError(bandError);
    }
    for (const limit of form.geographies) {
      const limitError = validatePercent(limit.maximum, `${formatCioLabel(limit.geography)} maximum`, true);
      if (limitError) return setFormError(limitError);
    }

    const assetClassBands = form.bands.map((band) => ({
      assetClass: band.assetClass,
      minimumBps: bpsFromPercentInput(band.minimum),
      targetBps: bpsFromPercentInput(band.target),
      maximumBps: bpsFromPercentInput(band.maximum),
    }));
    const unorderedBand = assetClassBands.find((band) => band.minimumBps > band.targetBps || band.targetBps > band.maximumBps);
    if (unorderedBand) return setFormError(`${formatCioLabel(unorderedBand.assetClass)} must run from lowest to highest: minimum, then target, then maximum. For example: 20%, 30%, 40%.`);

    setFormError("");
    mutation.mutate({
      minimumLiquidityReserveCents: centsFromMoneyInput(form.minimumReserve, true),
      minimumLiquidityMonths: numberOrNull(form.minimumMonths),
      maximumAccountConcentrationBps: bpsFromPercentInput(form.maximumAccount, true),
      maximumSingleSecurityConcentrationBps: bpsFromPercentInput(form.maximumSecurity, true),
      maximumSatelliteAllocationBps: bpsFromPercentInput(form.maximumSatellite, true),
      valuationStaleAfterDays: Math.round(Number(form.staleDays)),
      allowsOptions: triState(form.allowsOptions), allowsMargin: triState(form.allowsMargin),
      allowsLeverage: triState(form.allowsLeverage), allowsAdditionalIlpTopUps: triState(form.allowsIlp),
      confirmedAt: form.confirmed ? policy.data?.confirmedAt ?? new Date().toISOString() : null,
      assetClassBands,
      geographyLimits: form.geographies.map((limit) => ({ geography: limit.geography, maximumBps: bpsFromPercentInput(limit.maximum) })),
    });
  };

  const addBand = () => {
    // Disabled at the row limit, so at least one asset class is still unused.
    const next = CIO_ASSET_CLASSES.find((value) => !form.bands.some((band) => band.assetClass === value))!;
    set("bands", [...form.bands, { id: crypto.randomUUID(), assetClass: next, minimum: "0", target: "0", maximum: "100" }]);
  };
  const addGeography = () => {
    // The geography add button has the same bounded-row invariant.
    const next = CIO_GEOGRAPHIES.find((value) => !form.geographies.some((limit) => limit.geography === value))!;
    set("geographies", [...form.geographies, { id: crypto.randomUUID(), geography: next, maximum: "100" }]);
  };

  return (
    <Dialog open={open} onClose={onClose} closeDisabled={mutation.isPending} title="Investment policy" description="Choose the boundaries Nest should use when reviewing your portfolio. These settings only flag things to discuss; they never place trades." size="xl" contentClassName="cio-dialog" footer={
      <><Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button><Button variant="primary" type="submit" form="cio-policy-form" loading={mutation.isPending}>Save policy</Button></>
    }>
      <CioQueryContent state={policy} title="Policy could not be loaded" loadingText="Loading policy…" onRetry={() => void policy.refetch()}>
        <form id="cio-policy-form" className="cio-dialog-form" onSubmit={submit} noValidate>
          <fieldset className="cio-form-section"><legend>Cash buffer and concentration limits</legend>
            <p>Start with the cash you want available, then cap how much can sit in one place. Leave an optional field blank when you do not want Nest to check it.</p>
            <div className="form-grid form-grid-2">
              <TextField label="Minimum cash reserve" hint="Cash amount to keep readily available. For example, enter 30000 for a 30,000 reserve." inputMode="decimal" placeholder="e.g. 30000" value={form.minimumReserve} onChange={(e) => set("minimumReserve", e.target.value)} />
              <TextField label="Months of essential spending" hint="A second cash-buffer check based on the household's essential monthly spending, such as 6 months." type="number" min="0" max="120" step="1" placeholder="e.g. 6" value={form.minimumMonths} onChange={(e) => set("minimumMonths", e.target.value)} />
              <TextField label="Maximum in one account (%)" hint="Flags when one investment account holds more than this share of the portfolio." inputMode="decimal" placeholder="e.g. 40" value={form.maximumAccount} onChange={(e) => set("maximumAccount", e.target.value)} />
              <TextField label="Maximum in one security (%)" hint="Flags a single fund, stock, or other holding above this share." inputMode="decimal" placeholder="e.g. 10" value={form.maximumSecurity} onChange={(e) => set("maximumSecurity", e.target.value)} />
              <TextField label="Maximum in satellite holdings (%)" hint="Caps the combined share assigned to smaller, non-core investment ideas." inputMode="decimal" placeholder="e.g. 20" value={form.maximumSatellite} onChange={(e) => set("maximumSatellite", e.target.value)} />
              <TextField label="Consider valuations out of date after" hint="Number of days before Nest asks for a newer account value. 90 days is a common review interval." type="number" min="1" max="3650" step="1" value={form.staleDays} onChange={(e) => set("staleDays", e.target.value)} required />
            </div>
          </fieldset>

          <fieldset className="cio-form-section"><legend>Product guardrails</legend><p>Say whether these products fit the household plan. “Not decided yet” leaves the item without a rule.</p><div className="form-grid form-grid-2">
            <TriStateField label="Options trading" hint="Contracts whose value depends on another investment." value={form.allowsOptions} onChange={(value) => set("allowsOptions", value)} />
            <TriStateField label="Borrowing on margin" hint="Borrowing from a broker to invest." value={form.allowsMargin} onChange={(value) => set("allowsMargin", value)} />
            <TriStateField label="Leveraged investing" hint="Any strategy designed to magnify gains and losses." value={form.allowsLeverage} onChange={(value) => set("allowsLeverage", value)} />
            <TriStateField label="More ILP top-ups" hint="Additional contributions to investment-linked insurance policies." value={form.allowsIlp} onChange={(value) => set("allowsIlp", value)} />
          </div></fieldset>

          <fieldset className="cio-form-section"><div className="cio-form-section-heading"><div><legend>Target allocation ranges</legend><p>Add only the asset classes you want checked. Minimum is the lowest comfortable share, target is the aim, and maximum is the upper limit; for example 20%, 30%, and 40%.</p></div><Button variant="outline" size="sm" onClick={addBand} disabled={form.bands.length >= CIO_ASSET_CLASSES.length}><Plus size={15} /> Add asset class</Button></div>
            {form.bands.length ? <div className="cio-policy-rows">{form.bands.map((band, index) => (
              <div className="cio-policy-row cio-policy-band-row" key={band.id}>
                <SelectField label="Asset class" value={band.assetClass} onChange={(e) => updateBand(index, { assetClass: e.target.value as CioAssetClass })}>{CIO_ASSET_CLASSES.map((value) => <option key={value} value={value}>{formatCioLabel(value)}</option>)}</SelectField>
                <TextField label="Minimum %" hint="Lowest acceptable" inputMode="decimal" value={band.minimum} onChange={(e) => updateBand(index, { minimum: e.target.value })} required />
                <TextField label="Target %" hint="Preferred share" inputMode="decimal" value={band.target} onChange={(e) => updateBand(index, { target: e.target.value })} required />
                <TextField label="Maximum %" hint="Highest acceptable" inputMode="decimal" value={band.maximum} onChange={(e) => updateBand(index, { maximum: e.target.value })} required />
                <Button variant="ghost" iconOnly aria-label={`Remove ${formatCioLabel(band.assetClass)} band`} onClick={() => set("bands", form.bands.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={17} /></Button>
              </div>
            ))}</div> : <p className="cio-form-empty">No target ranges yet. Add an asset class only when you have a range you want Nest to monitor.</p>}
          </fieldset>

          <fieldset className="cio-form-section"><div className="cio-form-section-heading"><div><legend>Geography limits</legend><p>Optionally cap how much of the portfolio can be exposed to one region. For example, 50% means Nest flags anything above 50%.</p></div><Button variant="outline" size="sm" onClick={addGeography} disabled={form.geographies.length >= CIO_GEOGRAPHIES.length}><Plus size={15} /> Add region</Button></div>
            {form.geographies.length ? <div className="cio-policy-rows">{form.geographies.map((limit, index) => (
              <div className="cio-policy-row cio-policy-geography-row" key={limit.id}>
                <SelectField label="Geography" value={limit.geography} onChange={(e) => updateGeography(index, { geography: e.target.value as CioGeography })}>{CIO_GEOGRAPHIES.map((value) => <option key={value} value={value}>{formatCioLabel(value)}</option>)}</SelectField>
                <TextField label="Maximum %" hint="Highest acceptable share" inputMode="decimal" value={limit.maximum} onChange={(e) => updateGeography(index, { maximum: e.target.value })} required />
                <Button variant="ghost" iconOnly aria-label={`Remove ${formatCioLabel(limit.geography)} limit`} onClick={() => set("geographies", form.geographies.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={17} /></Button>
              </div>
            ))}</div> : <p className="cio-form-empty">No geography limits yet. Leave this empty if the household does not use regional caps.</p>}
          </fieldset>

          <fieldset className="cio-form-section"><legend>Review status</legend><p>You can save a draft and return later, or confirm that the household has reviewed these boundaries.</p>
            <label className="cio-check-row"><Input type="checkbox" checked={form.confirmed} onChange={(e) => set("confirmed", e.target.checked)} /><span><strong>Mark this policy as reviewed</strong><small>This records household confirmation. It does not approve or execute any trade.</small></span></label>
          </fieldset>
          {formError || mutation.isError ? <p className="form-error" role="alert">{formError || mutationFailureMessage(mutation.error)}</p> : null}
        </form>
      </CioQueryContent>
    </Dialog>
  );
}

function TriStateField({ label, hint, value, onChange }: Readonly<{ label: string; hint: string; value: string; onChange: (value: string) => void }>) {
  return <SelectField label={label} hint={hint} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Not decided yet</option><option value="true">Fits our policy</option><option value="false">Outside our policy</option></SelectField>;
}
function triState(value: string) {
  if (value === "true") return true;
  return value === "false" ? false : null;
}
function numberOrNull(value: string) { return value.trim() ? Math.round(Number(value)) : null; }
function formFromPolicy(policy: CioPolicy): PolicyForm {
  return {
    minimumReserve: moneyInputFromCents(policy.minimumLiquidityReserveCents), minimumMonths: policy.minimumLiquidityMonths == null ? "" : String(policy.minimumLiquidityMonths),
    maximumAccount: percentInputFromBps(policy.maximumAccountConcentrationBps), maximumSecurity: percentInputFromBps(policy.maximumSingleSecurityConcentrationBps), maximumSatellite: percentInputFromBps(policy.maximumSatelliteAllocationBps), staleDays: String(policy.valuationStaleAfterDays),
    allowsOptions: stringFromTriState(policy.allowsOptions), allowsMargin: stringFromTriState(policy.allowsMargin), allowsLeverage: stringFromTriState(policy.allowsLeverage), allowsIlp: stringFromTriState(policy.allowsAdditionalIlpTopUps), confirmed: Boolean(policy.confirmedAt),
    bands: policy.assetClassBands.map((band) => ({ id: band.id ?? crypto.randomUUID(), assetClass: band.assetClass, minimum: percentInputFromBps(band.minimumBps), target: percentInputFromBps(band.targetBps), maximum: percentInputFromBps(band.maximumBps) })),
    geographies: policy.geographyLimits.map((limit) => ({ id: limit.id ?? crypto.randomUUID(), geography: limit.geography, maximum: percentInputFromBps(limit.maximumBps) })),
  };
}
function stringFromTriState(value: boolean | null) { return value == null ? "" : String(value); }

function findDuplicate<T extends string>(values: readonly T[]) {
  return values.find((value, index) => values.indexOf(value) !== index);
}

function validateMoney(value: string, label: string) {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${label} must be a number without currency symbols or commas.`;
  if (amount < 0) return `${label} cannot be negative.`;
  if (amount > 21_474_836.47) return `${label} must be 21,474,836.47 or less.`;
  return null;
}

function validateWholeNumber(value: string, label: string, minimum: number, maximum: number, required: boolean) {
  if (!value.trim()) return required ? `Enter ${label.toLowerCase()}.` : null;
  const number = Number(value);
  if (!Number.isInteger(number)) return `${label} must be a whole number.`;
  if (number < minimum || number > maximum) return `${label} must be between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}.`;
  return null;
}

function validatePercent(value: string, label: string, required: boolean) {
  if (!value.trim()) return required ? `Enter a percentage for ${label.toLowerCase()}.` : null;
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) return `${label} must be a number.`;
  if (percentage < 0 || percentage > 100) return `${label} must be between 0% and 100%.`;
  return null;
}
