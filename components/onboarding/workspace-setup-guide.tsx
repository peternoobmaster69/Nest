"use client";

import { SubmitEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, Landmark, Layers3, Sparkles } from "lucide-react";

import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { SINGAPORE_BANKS } from "@/lib/singapore-banks";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import {
  countCompletedWorkspaceSetupSteps,
  getRequiredWorkspaceSetupStep,
  getWorkspaceSetupStep,
  type WorkspaceSetupPreference,
  type WorkspaceSetupProgress,
  type WorkspaceSetupStep,
} from "@/lib/workspace-setup";

type SetupAccount = { id: string; name: string; kind: string };

const SETUP_VERSION = "v1";

const STEP_COPY = {
  welcome: { title: "Welcome to Nest", description: "Build your money map in three short steps." },
  bank: { title: "Add your bank account", description: "Start with the cash you actually have." },
  subaccount: { title: "Create a sub-account", description: "Set aside bank money for a purpose." },
  card: { title: "Add a credit card (optional)", description: "Track statement spending and payment dates, or do this later." },
};

function SetupFooter({ step, pending, formId, onPause, onStart, onComplete }: Readonly<{
  step: WorkspaceSetupStep;
  pending: boolean;
  formId: string;
  onPause: () => void;
  onStart: () => void;
  onComplete: () => void;
}>) {
  if (step === "welcome") {
    return <><Button className="btn btn-ghost" onClick={onPause}>Not now</Button><Button className="btn btn-primary" onClick={onStart}>Start setup</Button></>;
  }
  if (step === "card") {
    return <><Button className="btn btn-ghost" onClick={onComplete} disabled={pending}>Skip for now</Button><Button className="btn btn-primary" type="submit" form={formId} disabled={pending}>{pending ? "Adding…" : "Add card"}</Button></>;
  }
  return <><Button className="btn btn-ghost" onClick={onPause} disabled={pending}>Not now</Button><Button className="btn btn-primary" type="submit" form={formId} disabled={pending}>{pending ? "Saving…" : "Continue"}</Button></>;
}

export function WorkspaceSetupGuide({
  workspaceId,
  baseCurrency,
  accounts,
  progress,
}: Readonly<{
  workspaceId: string;
  baseCurrency: string;
  accounts: SetupAccount[];
  progress: WorkspaceSetupProgress;
}>) {
  const queryClient = useQueryClient();
  const saving = useRef(false);
  const releaseSave = () => { saving.current = false; };
  const submitOnce = (mutation: { mutate: () => void }) => {
    if (saving.current) return;
    saving.current = true;
    mutation.mutate();
  };
  const preferenceKey = `nest:workspace-setup:${SETUP_VERSION}:${workspaceId}`;
  const snoozeKey = `${preferenceKey}:snoozed`;
  const [preference, setPreference] = useState<WorkspaceSetupPreference>("loading");
  const [snoozed, setSnoozed] = useState(false);
  const [open, setOpen] = useState(false);
  const [createdAccount, setCreatedAccount] = useState<SetupAccount & { bankName: string } | null>(null);
  const [createdSubAccount, setCreatedSubAccount] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const [bankName, setBankName] = useState(SINGAPORE_BANKS[0].name);
  const [accountName, setAccountName] = useState("");
  const [startingBalance, setStartingBalance] = useState("");
  const [subAccountName, setSubAccountName] = useState("");
  const [subAccountBankId, setSubAccountBankId] = useState("");
  const [monthlyTarget, setMonthlyTarget] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardBankName, setCardBankName] = useState(SINGAPORE_BANKS[0].name);
  const [last4, setLast4] = useState("");
  const [statementDay, setStatementDay] = useState("25");
  const [paymentDueDay, setPaymentDueDay] = useState("10");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(preferenceKey);
      setPreference(stored === "started" || stored === "complete" ? stored : "unseen");
      setSnoozed(window.sessionStorage.getItem(snoozeKey) === "1");
    } catch {
      setPreference("unseen");
    }
  }, [preferenceKey, snoozeKey]);

  const bankAccounts = useMemo(() => {
    const existing = accounts.filter((account) => account.kind === "BANK");
    return createdAccount && !existing.some((account) => account.id === createdAccount.id)
      ? [...existing, createdAccount]
      : existing;
  }, [accounts, createdAccount]);
  const bankAccountCount = Math.max(progress.bankAccountCount, bankAccounts.length);
  const subAccountCount = Math.max(progress.subAccountCount, createdSubAccount ? 1 : 0);
  const creditCardCount = progress.creditCardCount;
  const effectiveProgress = { bankAccountCount, subAccountCount, creditCardCount };
  const requiredStep = getRequiredWorkspaceSetupStep(effectiveProgress);
  const step: WorkspaceSetupStep = getWorkspaceSetupStep(effectiveProgress, preference);
  const shouldOfferSetup = step !== "complete";
  const completedSteps = countCompletedWorkspaceSetupSteps(effectiveProgress);
  const effectiveSubAccountBankId = bankAccounts.some((account) => account.id === subAccountBankId)
    ? subAccountBankId
    : bankAccounts[0]?.id ?? "";

  useEffect(() => {
    if (preference === "loading") return;
    if (preference === "started" && !requiredStep && creditCardCount > 0) {
      try { window.localStorage.setItem(preferenceKey, "complete"); } catch { /* storage is optional */ }
      setPreference("complete");
      setOpen(false);
      return;
    }
    if (shouldOfferSetup && !snoozed) setOpen(true);
  }, [creditCardCount, preference, preferenceKey, requiredStep, shouldOfferSetup, snoozed]);

  const refreshWorkspace = (...roots: Array<"bank-accounts" | "budgets" | "credit-cards" | "dashboard-summary">) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.context(workspaceId) });
    for (const root of roots) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scoped(root, workspaceId), refetchType: "active" });
    }
  };

  const createBank = useMutation({
    onSettled: releaseSave,
    mutationFn: () => apiFetch<{
      account: { id: string; name: string; bankName: string | null };
    }>("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        name: accountName.trim(),
        bankName,
        startingCents: Math.round(Number(startingBalance || "0") * 100),
      }),
    }),
    onSuccess: ({ account }) => {
      const created = { id: account.id, name: account.name, kind: "BANK", bankName: account.bankName || bankName };
      setCreatedAccount(created);
      setSubAccountBankId(account.id);
      setCardBankName(created.bankName);
      setValidationError("");
      setAnnouncement("Bank account added. Next, give some of that money a purpose.");
      refreshWorkspace("bank-accounts", "budgets", "dashboard-summary");
    },
  });

  const createSubAccount = useMutation({
    onSettled: releaseSave,
    mutationFn: () => apiFetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        accountId: effectiveSubAccountBankId,
        name: subAccountName.trim(),
        icon: "💰",
        targetCents: Math.round(Number(monthlyTarget || "0") * 100),
      }),
    }),
    onSuccess: () => {
      setCreatedSubAccount(true);
      setValidationError("");
      setAnnouncement("Sub-account created. A credit card is optional.");
      refreshWorkspace("budgets", "dashboard-summary");
    },
  });

  const completeSetup = () => {
    try {
      window.localStorage.setItem(preferenceKey, "complete");
      window.sessionStorage.removeItem(snoozeKey);
    } catch { /* storage is optional */ }
    setPreference("complete");
    setSnoozed(false);
    setOpen(false);
  };

  const createCard = useMutation({
    onSettled: releaseSave,
    mutationFn: () => apiFetch("/api/credit-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        cardName: cardName.trim(),
        bankName: cardBankName,
        last4Digit: last4,
        themeKey: "bank-default",
        statementDay: Number(statementDay),
        paymentDueDay: Number(paymentDueDay),
      }),
    }),
    onSuccess: () => {
      refreshWorkspace("credit-cards", "dashboard-summary");
      completeSetup();
    },
  });

  const startSetup = () => {
    try {
      window.localStorage.setItem(preferenceKey, "started");
      window.sessionStorage.removeItem(snoozeKey);
    } catch { /* storage is optional */ }
    setPreference("started");
    setSnoozed(false);
    setValidationError("");
  };

  const pauseSetup = () => {
    try { window.sessionStorage.setItem(snoozeKey, "1"); } catch { /* storage is optional */ }
    setSnoozed(true);
    setOpen(false);
  };

  const resumeSetup = () => {
    try { window.sessionStorage.removeItem(snoozeKey); } catch { /* storage is optional */ }
    setSnoozed(false);
    setOpen(true);
  };

  const submitBank = (event: SubmitEvent) => {
    event.preventDefault();
    const amount = Number(startingBalance || "0");
    if (!Number.isFinite(amount) || amount < 0) return setValidationError("Enter a valid starting balance.");
    setValidationError("");
    submitOnce(createBank);
  };

  const submitSubAccount = (event: SubmitEvent) => {
    event.preventDefault();
    const target = Number(monthlyTarget || "0");
    if (!subAccountName.trim()) return setValidationError("Give the sub-account a name.");
    if (!effectiveSubAccountBankId) return setValidationError("Select a bank account.");
    if (!Number.isFinite(target) || target < 0) return setValidationError("Enter a valid monthly limit.");
    setValidationError("");
    submitOnce(createSubAccount);
  };

  const submitCard = (event: SubmitEvent) => {
    event.preventDefault();
    const statement = Number(statementDay);
    const due = Number(paymentDueDay);
    if (!cardName.trim()) return setValidationError("Give the card a name.");
    if (!/^\d{4}$/.test(last4)) return setValidationError("Enter exactly the last 4 digits.");
    if (!Number.isInteger(statement) || !Number.isInteger(due) || statement < 1 || statement > 31 || due < 1 || due > 31) {
      return setValidationError("Statement and due days must be between 1 and 31.");
    }
    setValidationError("");
    submitOnce(createCard);
  };

  const activeMutation = { welcome: createCard, bank: createBank, subaccount: createSubAccount, card: createCard, complete: createCard }[step];
  const errorMessage = validationError || (activeMutation.error instanceof Error ? activeMutation.error.message : "");
  const pending = createBank.isPending || createSubAccount.isPending || createCard.isPending;
  const { title, description } = STEP_COPY[step === "complete" ? "card" : step];
  const formId = `workspace-setup-${step}-form`;

  const footer = <SetupFooter step={step} pending={pending} formId={formId} onPause={pauseSetup} onStart={startSetup} onComplete={completeSetup} />;

  if (!shouldOfferSetup && !open) return null;

  return (
    <>
      {!open ? <Button className="setup-guide-launcher" onClick={resumeSetup}><Sparkles size={16} aria-hidden="true" /><span>{step === "welcome" ? "Set up Nest" : "Finish setup"}</span><small>{completedSteps}/3</small></Button> : null}
      <Dialog open={open} onClose={pauseSetup} title={title} description={description} size="md" contentClassName="setup-guide-modal" closeDisabled={pending} footer={footer}>
        <div className="setup-guide-progress" aria-label={`${completedSteps} of 3 setup steps completed`}>
          {[
            { key: "bank", label: "Bank", icon: Landmark, done: bankAccountCount > 0 },
            { key: "subaccount", label: "Sub-account", icon: Layers3, done: subAccountCount > 0 },
            { key: "card", label: "Card", icon: CreditCard, done: creditCardCount > 0, optional: true },
          ].map((item) => {
            const Icon = item.icon;
            const active = step === item.key;
            return <div key={item.key} className={`setup-guide-progress-step${item.done ? " is-done" : ""}${active ? " is-active" : ""}`}><span>{item.done ? <Check size={15} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}</span><strong>{item.label}</strong>{item.optional ? <small>Optional</small> : null}</div>;
          })}
        </div>

        {step === "welcome" ? (
          <div className="setup-guide-welcome"><span className="setup-guide-welcome-icon"><Sparkles size={24} aria-hidden="true" /></span><h3>Let’s make Nest useful from day one.</h3><p>Add where your money lives, create a purpose for it, then optionally add a card. You can pause and resume at any time.</p></div>
        ) : null}

        {step === "bank" ? (
          <form id={formId} className="setup-guide-form" onSubmit={submitBank}>
            <div className="setup-guide-form-grid">
              <label className="form-group"><span className="label">Bank</span><Select disabled={pending} className="input" value={bankName} onChange={(event) => setBankName(event.target.value)} autoFocus>{SINGAPORE_BANKS.map((bank) => <option key={bank.code} value={bank.name}>{bank.name}</option>)}</Select></label>
              <label className="form-group"><span className="label">Account name</span><Input disabled={pending} className="input" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="e.g. Everyday savings" /></label>
              <label className="form-group setup-guide-span"><span className="label">Current balance ({baseCurrency})</span><NumericCalculatorInput disabled={pending} min="0" step="0.01" value={startingBalance} onValueChange={setStartingBalance} placeholder="0.00" /></label>
            </div>
            <p className="setup-guide-tip">Use today’s available balance. You can reconcile it later.</p>
          </form>
        ) : null}

        {step === "subaccount" ? (
          <form id={formId} className="setup-guide-form" onSubmit={submitSubAccount}>
            <div className="setup-guide-form-grid">
              <label className="form-group setup-guide-span"><span className="label">Bank account</span><Select disabled={pending} className="input" value={effectiveSubAccountBankId} onChange={(event) => setSubAccountBankId(event.target.value)} autoFocus>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></label>
              <label className="form-group"><span className="label">Sub-account name</span><Input disabled={pending} className="input" value={subAccountName} onChange={(event) => setSubAccountName(event.target.value)} placeholder="e.g. Everyday spending" required /></label>
              <label className="form-group"><span className="label">Monthly limit (optional)</span><NumericCalculatorInput disabled={pending} min="0" step="0.01" value={monthlyTarget} onValueChange={setMonthlyTarget} placeholder="0.00" /></label>
            </div>
            <p className="setup-guide-tip">A sub-account gives existing bank money a purpose; it does not create another bank account.</p>
          </form>
        ) : null}

        {step === "card" ? (
          <form id={formId} className="setup-guide-form" onSubmit={submitCard}>
            <div className="setup-guide-form-grid">
              <label className="form-group"><span className="label">Card name</span><Input disabled={pending} className="input" value={cardName} onChange={(event) => setCardName(event.target.value)} placeholder="e.g. DBS Altitude" autoFocus required /></label>
              <label className="form-group"><span className="label">Bank</span><Select disabled={pending} className="input" value={cardBankName} onChange={(event) => setCardBankName(event.target.value)}>{SINGAPORE_BANKS.map((bank) => <option key={bank.code} value={bank.name}>{bank.name}</option>)}</Select></label>
              <label className="form-group setup-guide-span"><span className="label">Last 4 digits</span><Input disabled={pending} className="input" value={last4} onChange={(event) => setLast4(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="off" maxLength={4} placeholder="1234" required /></label>
              <label className="form-group"><span className="label">Statement day</span><NumericCalculatorInput disabled={pending} min="1" max="31" value={statementDay} onValueChange={setStatementDay} allowDecimal={false} required /></label>
              <label className="form-group"><span className="label">Payment due day</span><NumericCalculatorInput disabled={pending} min="1" max="31" value={paymentDueDay} onValueChange={setPaymentDueDay} allowDecimal={false} required /></label>
            </div>
            <p className="setup-guide-tip">Nest stores only the last 4 digits—never your full card number or CVV.</p>
          </form>
        ) : null}

        {errorMessage ? <div className="setup-guide-error" role="alert">{errorMessage}</div> : null}
        <div className="sr-only" aria-live="polite">{announcement}</div>
      </Dialog>
    </>
  );
}
