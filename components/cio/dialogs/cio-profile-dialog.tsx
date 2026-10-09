"use client";

import { SubmitEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CioProfile, CioProfilePayload } from "@/components/cio/types";
import {
  bpsFromPercentInput,
  centsFromMoneyInput,
  toIsoDate,
} from "@/components/cio/cio-format";
import { apiFetch, mutationFailureMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { CioProfileScopeField } from "@/components/cio/dialogs/cio-profile-scope-field";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form-field";
import { CioQueryContent } from "@/components/cio/cio-query-content";
import { localDateInput } from "@/components/cio/cio-date-input";
import { EMPTY_FORM, MAX_MONEY_INPUT, ageFromBirthDate, formFromProfile, numberOrNull, validateProfileForm, type ProfileForm } from "./cio-profile-form";

export { ageFromBirthDate } from "./cio-profile-form";

export function CioProfileDialog({
  open,
  workspaceId,
  onClose,
  onSaved,
}: Readonly<{
  open: boolean;
  workspaceId: string | null | undefined;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}>) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [showValidation, setShowValidation] = useState(false);
  const today = localDateInput();
  const hasBirthDate = Boolean(form.primaryBirthDate);
  const calculatedAge = hasBirthDate ? ageFromBirthDate(form.primaryBirthDate, today) : null;
  const formErrors = showValidation ? validateProfileForm(form, today) : {};
  const profile = useQuery({
    queryKey: queryKeys.cioProfile(workspaceId),
    queryFn: async () => (await apiFetch<{ profile: CioProfile | null }>("/api/cio/profile", { cache: "no-store" })).profile,
    enabled: open && Boolean(workspaceId),
  });
  const mutation = useMutation({
    mutationFn: async (payload: CioProfilePayload) => (await apiFetch<{ profile: CioProfile }>("/api/cio/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })).profile,
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.cioProfile(workspaceId), saved);
      await onSaved();
      onClose();
    },
  });

  useEffect(() => {
    if (!open || profile.data === undefined) return;
    setForm(profile.data ? formFromProfile(profile.data) : EMPTY_FORM);
    setShowValidation(false);
  }, [open, profile.data]);

  const set = (field: keyof ProfileForm, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const setBirthDate = (value: string) => {
    setForm((current) => ({
      ...current,
      primaryBirthDate: value,
      ...(value ? { primaryCurrentAge: "", primaryAgeAsOfDate: "" } : {}),
    }));
  };
  const setCurrentAge = (value: string) => {
    setForm((current) => ({
      ...current,
      primaryCurrentAge: value,
      primaryAgeAsOfDate: value ? current.primaryAgeAsOfDate || today : "",
    }));
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const errors = validateProfileForm(form, today);
    if (Object.keys(errors).length > 0) {
      setShowValidation(true);
      return;
    }
    setShowValidation(false);
    const payload: CioProfilePayload = {
      planningScope: form.planningScope,
      primaryBirthDate: toIsoDate(form.primaryBirthDate),
      // Birth date is authoritative. The age fields are a fallback only when it is unknown.
      primaryCurrentAge: hasBirthDate ? null : numberOrNull(form.primaryCurrentAge),
      primaryAgeAsOfDate: hasBirthDate ? null : toIsoDate(form.primaryAgeAsOfDate),
      partnerBirthDate: form.planningScope === "HOUSEHOLD" ? toIsoDate(form.partnerBirthDate) : null,
      targetRetirementAge: numberOrNull(form.targetRetirementAge),
      targetRetirementDate: toIsoDate(form.targetRetirementDate),
      targetMonthlyRetirementSpendingCents: centsFromMoneyInput(form.retirementSpending, true),
      essentialMonthlySpendingCents: centsFromMoneyInput(form.essentialSpending, true),
      minimumImmediateBankCashCents: centsFromMoneyInput(form.minimumCash, true),
      inflationRateBps: bpsFromPercentInput(form.inflation, true),
      bearReturnBps: bpsFromPercentInput(form.bearReturn, true),
      baseReturnBps: bpsFromPercentInput(form.baseReturn, true),
      bullReturnBps: bpsFromPercentInput(form.bullReturn, true),
      sustainableWithdrawalRateBps: bpsFromPercentInput(form.withdrawalRate, true),
      annualExternalContributionOverrideCents: centsFromMoneyInput(form.contributionOverride, true),
      contributionGrowthRateBps: bpsFromPercentInput(form.contributionGrowth, true),
    };
    mutation.mutate(payload);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title="CIO planning profile"
      description="Choose whether this plan represents one person or a combined household, then add the facts and assumptions Nest CIO uses."
      size="xl"
      contentClassName="cio-dialog"
      footer={<><Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button><Button variant="primary" type="submit" form="cio-profile-form" loading={mutation.isPending}>Save profile</Button></>}
    >
      <CioQueryContent state={profile} title="Profile could not be loaded" loadingText="Loading profile…" onRetry={() => void profile.refetch()}>
        <form id="cio-profile-form" className="cio-dialog-form" onSubmit={submit}>
          <fieldset className="cio-form-section">
            <legend>Age and retirement timing</legend>
            <p>Nest uses your age and one retirement target to set the projection timeline. Choose Individual when the included assets, flows and spending belong to you alone.</p>
            <div className="form-grid form-grid-2">
              <CioProfileScopeField value={form.planningScope} onChange={(planningScope) => setForm((current) => ({ ...current, planningScope, partnerBirthDate: planningScope === "INDIVIDUAL" ? "" : current.partnerBirthDate }))} />
              <TextField
                label="Your date of birth"
                type="date"
                max={today}
                value={form.primaryBirthDate}
                onChange={(event) => setBirthDate(event.target.value)}
                hint="Recommended. This gives the most accurate retirement timeline."
                error={formErrors.primaryBirthDate}
              />
              <TextField
                label="Current age"
                type="number"
                min="0"
                max="120"
                step="1"
                value={hasBirthDate ? calculatedAge ?? "" : form.primaryCurrentAge}
                onChange={(event) => setCurrentAge(event.target.value)}
                readOnly={hasBirthDate}
                aria-live="polite"
                hint={hasBirthDate ? "Calculated from your date of birth as of today." : "Use this only if you do not know your date of birth."}
                error={formErrors.primaryCurrentAge}
              />
              {!hasBirthDate ? (
                <TextField
                  label="Age correct as of"
                  type="date"
                  max={today}
                  value={form.primaryAgeAsOfDate}
                  onChange={(event) => set("primaryAgeAsOfDate", event.target.value)}
                  required={Boolean(form.primaryCurrentAge)}
                  hint="Defaults to today when you enter an age. Change it if the age was confirmed earlier."
                  error={formErrors.primaryAgeAsOfDate}
                />
              ) : null}
              {form.planningScope === "HOUSEHOLD" ? (
                <TextField
                  label="Partner's date of birth"
                  type="date"
                  max={today}
                  value={form.partnerBirthDate}
                  onChange={(event) => set("partnerBirthDate", event.target.value)}
                  hint="Optional context. It does not currently change the projection timeline."
                  error={formErrors.partnerBirthDate}
                />
              ) : null}
              <TextField
                label="Target retirement age"
                type="number"
                min="18"
                max="120"
                step="1"
                value={form.targetRetirementAge}
                onChange={(event) => {
                  set("targetRetirementAge", event.target.value);
                  if (event.target.value) set("targetRetirementDate", "");
                }}
                hint="For example, 65. Entering an age clears the retirement date."
                error={formErrors.targetRetirementAge}
              />
              <TextField
                label="Target retirement date"
                type="date"
                value={form.targetRetirementDate}
                onChange={(event) => {
                  set("targetRetirementDate", event.target.value);
                  if (event.target.value) set("targetRetirementAge", "");
                }}
                hint="Use this instead if you have a specific date in mind."
                error={formErrors.targetRetirementDate}
              />
            </div>
          </fieldset>

          <fieldset className="cio-form-section">
            <legend>Spending and cash</legend>
            <p>Retirement spending sets the long-term fund target. Essential spending is a separate current-cost baseline used only for emergency runway and cash-policy checks.</p>
            <div className="form-grid form-grid-2">
              <TextField label="Target monthly retirement spending (today's money)" type="number" min="0" max={MAX_MONEY_INPUT} step="0.01" inputMode="decimal" value={form.retirementSpending} onChange={(event) => set("retirementSpending", event.target.value)} hint="Your desired total monthly budget after retirement. This drives the retirement fund target." error={formErrors.retirementSpending} />
              <TextField label="Essential monthly spending (current)" type="number" min="0" max={MAX_MONEY_INPUT} step="0.01" inputMode="decimal" value={form.essentialSpending} onChange={(event) => set("essentialSpending", event.target.value)} hint="Bare-minimum costs such as housing, food, utilities and insurance. Enter 0 when emergency-runway and months-of-spending checks do not apply." error={formErrors.essentialSpending} />
              <TextField label="Minimum immediate bank cash" type="number" min="0" max={MAX_MONEY_INPUT} step="0.01" inputMode="decimal" value={form.minimumCash} onChange={(event) => set("minimumCash", event.target.value)} hint="The minimum cash you want available in bank accounts." error={formErrors.minimumCash} />
              <TextField label="Annual contribution override" type="number" min="0" max={MAX_MONEY_INPUT} step="0.01" inputMode="decimal" value={form.contributionOverride} onChange={(event) => set("contributionOverride", event.target.value)} hint="Optional. Leave blank to calculate contributions from recurring flows." error={formErrors.contributionOverride} />
            </div>
          </fieldset>

          <fieldset className="cio-form-section">
            <legend>Planning assumptions</legend>
            <p>Enter annual percentages as ordinary numbers: 5 means 5%, not 0.05. Bear is cautious, base is expected and bull is optimistic.</p>
            <div className="form-grid form-grid-2">
              <TextField label="Inflation rate (%)" type="number" min="-99.99" max="1000" step="0.01" inputMode="decimal" value={form.inflation} onChange={(event) => set("inflation", event.target.value)} hint="For example, 2.5 means prices rise 2.5% a year." error={formErrors.inflation} />
              <TextField label="Contribution growth (%)" type="number" min="-100" max="1000" step="0.01" inputMode="decimal" value={form.contributionGrowth} onChange={(event) => set("contributionGrowth", event.target.value)} hint="How much annual contributions may rise or fall each year." error={formErrors.contributionGrowth} />
              <TextField label="Bear return (%)" type="number" min="-100" max="1000" step="0.01" inputMode="decimal" value={form.bearReturn} onChange={(event) => set("bearReturn", event.target.value)} hint="A cautious annual return; it cannot be above the base return." error={formErrors.bearReturn} />
              <TextField label="Base return (%)" type="number" min="-100" max="1000" step="0.01" inputMode="decimal" value={form.baseReturn} onChange={(event) => set("baseReturn", event.target.value)} hint="The annual return you reasonably expect." error={formErrors.baseReturn} />
              <TextField label="Bull return (%)" type="number" min="-100" max="1000" step="0.01" inputMode="decimal" value={form.bullReturn} onChange={(event) => set("bullReturn", event.target.value)} hint="An optimistic annual return; it cannot be below the base return." error={formErrors.bullReturn} />
              <TextField label="Sustainable withdrawal rate (%)" type="number" min="0.01" max="100" step="0.01" inputMode="decimal" value={form.withdrawalRate} onChange={(event) => set("withdrawalRate", event.target.value)} hint="The share of retirement savings withdrawn in the first year—for example, 4." error={formErrors.withdrawalRate} />
            </div>
          </fieldset>
          {showValidation && Object.keys(formErrors).length > 0 ? <p className="form-error" role="alert">Review the highlighted fields before saving.</p> : null}
          {mutation.isError ? <p className="form-error" role="alert">{mutationFailureMessage(mutation.error)}</p> : null}
        </form>
      </CioQueryContent>
    </Dialog>
  );
}
