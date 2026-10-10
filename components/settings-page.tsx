"use client";

import { apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeCurrency, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { useMoneyFormat } from "@/lib/use-money-format";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { SINGAPORE_BANKS, getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { SubmitEvent, useEffect, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  Copy,
  Plus,
  RotateCcw,
} from "lucide-react";
import { EmptyState } from "@/components/ui-skeleton";
import { SettingsBankAccountsSkeleton } from "@/components/skeletons/SettingsSkeleton";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import type { SettingsTab } from "@/lib/settings-tabs";
import { ActionableAuthenticationMessage } from "@/components/reauthentication-message";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { AutoAccountingSettings } from "@/components/settings/auto-accounting-settings";
import { useAutoRuleSettings } from "@/hooks/use-auto-rule-settings";
import { useGmailSettings } from "@/hooks/use-gmail-settings";
import { GmailSettingsCard } from "@/components/settings/gmail-settings-card";
import { bankAccountsQueryOptions, type BankAccount } from "@/lib/accounts";
import { SettingsPrivacyControls } from "@/components/settings-privacy-controls";
import { MutationErrorSummary } from "@/components/ui/mutation-error-summary";
import { useConfirmDialog } from "@/components/confirm-dialog";

const DataImportSection = dynamic(
  () => import("@/components/data-import-section").then((module) => module.DataImportSection),
  { ssr: false, loading: () => <div className="settings-lazy-placeholder" aria-busy="true">Loading import tools…</div> },
);

const SettingsAppAccess = dynamic(
  () => import("@/components/settings-app-access").then((module) => module.SettingsAppAccess),
  { ssr: false, loading: () => <div className="settings-lazy-placeholder" aria-busy="true">Loading app access…</div> },
);

type Context = {
  workspaceId: string | null;
  workspaceName?: string | null;
  defaultAccountId: string | null;
  defaultBudgetId: string | null;
  baseCurrency?: string | null;
  publicNetWorthEnabled?: boolean | null;
  publicNetWorthToken?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  workspaces?: Array<{ id: string; name: string }>;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  isActive: boolean;
  receivableReservedCents?: number;
};

export function SettingsPage({ section }: Readonly<{ section: SettingsTab }>) {
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});
  const [currencyMessage, setCurrencyMessage] = useState("");
  const [receivableAccountMessage, setReceivableAccountMessage] = useState("");
  const [publicNetWorthMessage, setPublicNetWorthMessage] = useState("");
  const [optimisticPublicNetWorthEnabled, setOptimisticPublicNetWorthEnabled] = useState<boolean | null>(null);

  // Add modal state
  const [name, setName] = useState("");
  const [selectedBankName, setSelectedBankName] = useState(SINGAPORE_BANKS[0].name);
  const [balance, setBalance] = useState("");
  const [description, setDescription] = useState("");

  // Edit modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingBankName, setEditingBankName] = useState(SINGAPORE_BANKS[0].name);
  const [editingBalance, setEditingBalance] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingIsActive, setEditingIsActive] = useState(true);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState("");
  const [publicOrigin, setPublicOrigin] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPublicOrigin(window.location.origin);
  }, []);

  const context = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: () => fetchJson<Context>("/api/context"),
  });

  const workspaceId = context.data?.workspaceId ?? null;
  const gmail = useGmailSettings({ workspaceId, workspaceName: context.data?.workspaceName, role: context.data?.role });
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const { format: formatMoney } = useMoneyFormat(baseCurrency);
  const defaultReceivableAccountId = context.data?.defaultAccountId ?? null;
  const defaultReceivableBudgetId = context.data?.defaultBudgetId ?? null;
  const savedPublicNetWorthEnabled = Boolean(context.data?.publicNetWorthEnabled);
  const publicNetWorthEnabled = optimisticPublicNetWorthEnabled ?? savedPublicNetWorthEnabled;
  const publicNetWorthToken = context.data?.publicNetWorthToken ?? null;
  const publicNetWorthUrl =
    publicNetWorthEnabled && publicNetWorthToken && publicOrigin
      ? `${publicOrigin}/api/public/net-worth/${publicNetWorthToken}`
      : "";
  const publicCardsDueUrl =
    publicNetWorthEnabled && publicNetWorthToken && publicOrigin
      ? `${publicOrigin}/api/public/cards-due/${publicNetWorthToken}`
      : "";

  const accounts = useQuery(bankAccountsQueryOptions(workspaceId));

  const budgets = useQuery({
    queryKey: queryKeys.key(["budgets", workspaceId]),
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const workspaces = context.data?.workspaces ?? [];
  const autoRuleSettings = useAutoRuleSettings({ workspaceId, defaultReceivableBudgetId, accounts: accounts.data, budgets: budgets.data, workspaces });
  const updateCurrency = useMutation({
    mutationFn: (nextCurrency: string) =>
      fetchJson<{ workspaceId: string; baseCurrency: string }>("/api/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          baseCurrency: nextCurrency,
        }),
      }),
    onSuccess: (data) => {
      setCurrencyMessage(`Currency updated to ${data.baseCurrency}.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["app-context"]) });
    },
    onError: (error) => setCurrencyMessage(error instanceof Error ? error.message : "Failed to update currency."),
  });

  const updateReceivableDefaults = useMutation({
    mutationFn: (payload: { accountId?: string | null; budgetId?: string | null }) =>
      fetchJson<{ defaultAccountId: string | null }>("/api/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          receivableDefaultAccountId: payload.accountId,
          receivableDefaultBudgetId: payload.budgetId,
        }),
      }),
    onSuccess: () => {
      setReceivableAccountMessage("Default receivable account updated.");
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["app-context"]) });
    },
    onError: (error) =>
      setReceivableAccountMessage(error instanceof Error ? error.message : "Failed to update default receivable account."),
  });

  const updatePublicNetWorth = useMutation({
    mutationFn: (action: "enable" | "revoke" | "rotate") => {
      if (!workspaceId) throw new Error("No active workspace selected.");
      return fetchJson<{ publicNetWorthEnabled: boolean; publicNetWorthToken: string | null }>("/api/public-links/net-worth", {
        method: action === "revoke" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          rotate: action === "rotate",
        }),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Context>(["app-context", routeWorkspaceId], (current) =>
        current
          ? {
              ...current,
              publicNetWorthEnabled: data.publicNetWorthEnabled,
              publicNetWorthToken: data.publicNetWorthToken,
            }
          : current,
      );
      setOptimisticPublicNetWorthEnabled(null);
      setPublicNetWorthMessage(data.publicNetWorthEnabled ? "Public API URLs enabled." : "Public API URLs disabled.");
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["app-context"]) });
    },
    onError: (error) => {
      setOptimisticPublicNetWorthEnabled(null);
      setPublicNetWorthMessage(error instanceof Error ? error.message : "Failed to update public net worth URL.");
    },
  });

  const onTogglePublicNetWorth = async (enabled: boolean) => {
    if (!enabled) {
      const approved = await confirm({
        title: "Revoke public share links?",
        message: "Anyone using the current net worth or cards-due URLs will lose access immediately.",
        confirmLabel: "Revoke links",
        destructive: true,
        workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "OWNER" },
        details: [
          { label: "Access removed", value: "Net worth and cards due links" },
          { label: "When", value: "Immediately" },
        ],
        reversal: "You can enable sharing again, but Nest will issue new URLs.",
      });
      if (!approved) return;
    }
    setPublicNetWorthMessage("");
    setOptimisticPublicNetWorthEnabled(enabled);
    updatePublicNetWorth.mutate(enabled ? "enable" : "revoke");
  };

  const rotatePublicNetWorth = async () => {
    const approved = await confirm({
      title: "Rotate public share links?",
      message: "The current URLs will stop working and be replaced with new ones.",
      confirmLabel: "Rotate links",
      destructive: true,
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "OWNER" },
      details: [
        { label: "Affected links", value: "Net worth and cards due" },
        { label: "Old URLs", value: "Revoked immediately" },
      ],
      reversal: "Rotation cannot restore an old URL; you can copy and distribute the new URLs.",
    });
    if (!approved) return;
    setPublicNetWorthMessage("");
    updatePublicNetWorth.mutate("rotate");
  };

  const copyPublicNetWorthUrl = async () => {
    if (!publicNetWorthUrl) return;
    try {
      await navigator.clipboard.writeText(publicNetWorthUrl);
      setPublicNetWorthMessage("Public net worth URL copied.");
    } catch {
      setPublicNetWorthMessage("Copy failed. Select the URL and copy it manually.");
    }
  };

  const copyPublicCardsDueUrl = async () => {
    if (!publicCardsDueUrl) return;
    try {
      await navigator.clipboard.writeText(publicCardsDueUrl);
      setPublicNetWorthMessage("Public cards-due URL copied.");
    } catch {
      setPublicNetWorthMessage("Copy failed. Select the URL and copy it manually.");
    }
  };

  const createAccount = useMutation({
    mutationFn: () =>
      fetchJson<{ workspaceId: string }>("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspaceId || undefined,
          name,
          bankName: selectedBankName,
          startingCents: Math.round(Number(balance || "0") * 100),
          description: description || undefined,
        }),
      }),
    onSuccess: () => {
      closeAddModal();
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["app-context"]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts"]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets"]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]) });
    },
  });

  const updateAccount = useMutation({
    mutationFn: (payload: {
      id: string;
      name: string;
      bankName: string;
      description?: string | null;
      startingCents: number;
      isActive: boolean;
      expectedUpdatedAt: string;
    }) =>
      fetchJson(`/api/accounts/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          bankName: payload.bankName,
          description: payload.description,
          startingCents: payload.startingCents,
          isActive: payload.isActive,
          expectedUpdatedAt: payload.expectedUpdatedAt,
        }),
      }),
    onSuccess: () => {
      closeEditModal();
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts"]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets"]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]) });
    },
  });

  const openAddModal = () => {
    setName("");
    setSelectedBankName(SINGAPORE_BANKS[0].name);
    setBalance("");
    setDescription("");
    setIsAddModalOpen(true);
  };

  const closeAddModal = () => {
    setIsAddModalOpen(false);
    setName("");
    setSelectedBankName(SINGAPORE_BANKS[0].name);
    setBalance("");
    setDescription("");
  };

  const openEditModal = (account: BankAccount) => {
    setEditingAccountId(account.id);
    setEditingName(account.name);
    setEditingBankName(account.bankName || SINGAPORE_BANKS[0].name);
    setEditingBalance((account.startingCents / 100).toFixed(2));
    setEditingDescription(account.description || "");
    setEditingIsActive(account.isActive);
    setEditingUpdatedAt(account.updatedAt);
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingAccountId(null);
    setEditingName("");
    setEditingBankName(SINGAPORE_BANKS[0].name);
    setEditingBalance("");
    setEditingDescription("");
    setEditingIsActive(true);
    setEditingUpdatedAt("");
  };

  const onSubmitAdd = (event: SubmitEvent) => {
    event.preventDefault();
    if (!name.trim() && !selectedBankName) return;
    createAccount.mutate();
  };

  const onSubmitEdit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!editingAccountId) return;
    updateAccount.mutate({
      id: editingAccountId,
      name: editingName.trim(),
      bankName: editingBankName,
      description: editingDescription.trim() || null,
      startingCents: Math.round(Number(editingBalance || "0") * 100),
      isActive: editingIsActive,
      expectedUpdatedAt: editingUpdatedAt,
    });
  };

  const publicShareSettings = context.data?.role === "OWNER" ? (
    <div className="card settings-card-block">
      <div className="settings-row settings-row-toggle">
        <div>
          <div className="settings-section-title">Public share links</div>
          <div className="settings-section-copy">
            Revocable, read-only links for the current workspace. Anyone with a link can read its limited response.
          </div>
        </div>
        <label className="auto-rule-switch" aria-label="Public share links enabled">
          <Input
            type="checkbox"
            checked={publicNetWorthEnabled}
            onChange={(event) => void onTogglePublicNetWorth(event.target.checked)}
            disabled={!workspaceId || updatePublicNetWorth.isPending}
          />
          <span />
        </label>
      </div>
      {publicNetWorthEnabled ? (
        <div className="settings-row settings-row-spaced">
          <div>
            <div className="settings-section-title">Net worth link</div>
            <div className="settings-section-copy">Returns amount, base, and currency only.</div>
          </div>
          <div className="settings-public-url-row">
            <Input className="input" value={publicNetWorthUrl || "Generating URL..."} readOnly aria-label="Public net worth URL" />
            <Button className="btn btn-ghost btn-xs" type="button" onClick={copyPublicNetWorthUrl} disabled={!publicNetWorthUrl}>
              <Copy size={14} aria-hidden="true" /> Copy
            </Button>
            <Button className="btn btn-ghost btn-xs" type="button" onClick={() => void rotatePublicNetWorth()} disabled={updatePublicNetWorth.isPending}>
              <RotateCcw size={14} aria-hidden="true" /> Rotate links
            </Button>
          </div>
        </div>
      ) : null}
      {publicNetWorthEnabled ? (
        <div className="settings-row settings-row-spaced">
          <div>
            <div className="settings-section-title">Cards due link</div>
            <div className="settings-section-copy">Returns bank, last four digits, and amount for cards due within seven days.</div>
          </div>
          <div className="settings-public-url-row">
            <Input className="input" value={publicCardsDueUrl || "Generating URL..."} readOnly aria-label="Public cards due URL" />
            <Button className="btn btn-ghost btn-xs" type="button" onClick={copyPublicCardsDueUrl} disabled={!publicCardsDueUrl}>
              <Copy size={14} aria-hidden="true" /> Copy
            </Button>
          </div>
        </div>
      ) : null}
      <ActionableAuthenticationMessage message={publicNetWorthMessage} className="settings-message" />
    </div>
  ) : (
    <div className="card settings-card-block settings-permission-note" role="note">
      <div className="settings-section-title">Public share links</div>
      <div className="settings-section-copy">Only a workspace owner can create, rotate, or revoke public share links.</div>
    </div>
  );

  return (
    <div className="st-container">
      {section === "settings" ? (
        <>
          <SettingsAppAccess />
          <SettingsPrivacyControls />
        </>
      ) : null}

      {section === "automation" && context.data?.role === "OWNER" ? <GmailSettingsCard controller={gmail} routeWorkspaceId={routeWorkspaceId} /> : null}

      {section === "workspaces" ? (
        <>
          {context.data?.role === "OWNER" ? <><div className="card settings-card-block">
        <div className="settings-row">
          <div>
            <div className="settings-section-title">Currency Display</div>
            <div className="settings-section-copy">
              Set currency display across your workspace. Default is SGD.
            </div>
          </div>
          <Select
            className="input settings-select-sm"
            value={baseCurrency}
            onChange={(event) => updateCurrency.mutate(event.target.value)}
            disabled={!workspaceId || updateCurrency.isPending}
          >
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </div>
        <ActionableAuthenticationMessage message={currencyMessage} className="settings-message" />
      </div>

      </> : null}

      <div className="card settings-card-block">
        <div className="settings-row">
          <div>
            <div className="settings-section-title">Receivable Default Account</div>
            <div className="settings-section-copy">
              Closed receivables are credited into this account automatically.
            </div>
          </div>
          <Select
            className="input settings-select-md"
            value={defaultReceivableAccountId ?? ""}
            onChange={(event) =>
              updateReceivableDefaults.mutate({
                accountId: event.target.value || null,
                budgetId: null,
              })
            }
            disabled={!workspaceId || accounts.isLoading || updateReceivableDefaults.isPending}
          >
            <option value="">Not configured</option>
            {(accounts.data ?? []).filter((a) => a.isActive).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="settings-row settings-row-spaced">
          <div>
            <div className="settings-section-title">Receivable Default Subaccount</div>
            <div className="settings-section-copy">
              Closed receivables are posted into this subaccount under the default account.
            </div>
          </div>
          <Select
            className="input settings-select-md"
            value={defaultReceivableBudgetId ?? ""}
            onChange={(event) =>
              updateReceivableDefaults.mutate({
                accountId: undefined,
                budgetId: event.target.value || null,
              })
            }
            disabled={!workspaceId || !defaultReceivableAccountId || budgets.isLoading || updateReceivableDefaults.isPending}
          >
            <option value="">Not configured</option>
            {(budgets.data ?? [])
              .filter((b) => b.isActive && b.accountId === defaultReceivableAccountId)
              .map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
          </Select>
        </div>
        <ActionableAuthenticationMessage message={receivableAccountMessage} className="settings-message" />
          </div>
        </>
      ) : null}

      {section === "automation" ? <AutoAccountingSettings controller={autoRuleSettings} baseCurrency={baseCurrency} /> : null}

      {section === "data" ? (
        <>
          <SettingsPrivacyControls view="data" />
          {publicShareSettings}
          <DataImportSection workspaceId={workspaceId} baseCurrency={baseCurrency} />
        </>
      ) : null}

      {section === "workspaces" ? (
        <>
          <div className="st-header settings-accounts-header" id="bank-accounts">
        <div className="settings-accounts-heading">
          <h2>Bank accounts</h2>
          <p>Manage balances, account visibility, and reconciliation.</p>
        </div>
        <Button className="btn btn-primary" onClick={openAddModal}>
          <Plus size={16} aria-hidden="true" />
          Add Account
        </Button>
      </div>

      {/* Accounts Grid */}
      <div className="st-grid">
        {accounts.isLoading && <SettingsBankAccountsSkeleton />}

        {accounts.isError && (
          <div className="st-empty">
            <div className="st-empty-icon">⚠️</div>
            <p>Failed to load accounts</p>
            <Button className="btn btn-primary" onClick={() => accounts.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {!accounts.isLoading && !accounts.isError && accounts.data?.map((account) => {
          const bank = getSingaporeBankByName(account.bankName);
          const logo = getBankLogoUrl(bank);
          const hasDiscrepancy = account.discrepancyCents !== 0;

          return (
            <div key={account.id} className={`st-card ${!account.isActive ? 'inactive' : ''}`}>
              <div className="st-card-header">
                <div className="st-card-bank">
                  {logo && !failedLogos[account.id] ? (
                    <Image
                      src={logo}
                      alt={bank?.name || "Bank"}
                      width={40}
                      height={24}
                      sizes="40px"
                      className="st-bank-logo"
                      loading="lazy"
                      onError={() => setFailedLogos((prev) => ({ ...prev, [account.id]: true }))}
                    />
                  ) : bank ? (
                    <span className={`st-bank-fallback st-bank-fallback-${bank.code.toLowerCase()}`}>
                      {bank.short}
                    </span>
                  ) : (
                    <span className="st-bank-fallback st-bank-fallback-default">
                      BNK
                    </span>
                  )}
                </div>
                <div className="st-card-actions">
                  <Button className="btn btn-ghost btn-xs" onClick={() => openEditModal(account)}>
                    Edit
                  </Button>
                </div>
              </div>

              <div className="st-card-body">
                <h3 className="st-card-name">{account.name}</h3>
                <p className="st-card-bankname">{account.bankName || "Bank"}</p>
                {account.description && (
                  <p className="st-card-desc">{account.description}</p>
                )}
              </div>

              <div className="st-card-stats">
                <div className="st-stat">
                  <span className="st-stat-label">Balance</span>
                  <span className={`st-stat-value ${hasDiscrepancy ? 'warning' : ''}`}>
                    {formatMoney(account.currentBalanceCents, baseCurrency)}
                  </span>
                </div>
                <div className="st-stat">
                  <span className="st-stat-label">In Budgets</span>
                  <span className="st-stat-value">{formatMoney(account.linkedBudgetTotalCents, baseCurrency)}</span>
                </div>
              </div>

              {hasDiscrepancy && (
                <div className="st-discrepancy">
                  <span className="st-discrepancy-icon">⚠️</span>
                  <span className="st-discrepancy-text">
                    Discrepancy: {account.discrepancyCents > 0 ? "+" : ""}
                    {formatMoney(account.discrepancyCents, baseCurrency)}
                  </span>
                </div>
              )}

              {!account.isActive && (
                <div className="st-inactive-badge">Inactive</div>
              )}
            </div>
          );
        })}

        {/* Add New Card Placeholder - only show when data loaded and has accounts */}
        {!accounts.isLoading && !accounts.isError && accounts.data && accounts.data.length > 0 && (
          <Button className="st-add-card" onClick={openAddModal}>
            <div className="st-add-icon">+</div>
            <span>Add Bank Account</span>
            <p className="st-add-hint">Connect a new bank to track your finances</p>
          </Button>
        )}

        {/* Empty State */}
        {!accounts.isLoading && !accounts.isError && accounts.data?.length === 0 && (
          <div className="st-grid-empty">
            <EmptyState
              icon="🏦"
              title="No bank accounts yet"
              description="Connect your first bank account to start tracking your finances and managing budgets."
              action={
                <Button className="btn btn-primary" onClick={openAddModal}>
                  <Plus size={16} aria-hidden="true" />
                  Add your first account
                </Button>
              }
            />
          </div>
        )}
      </div>

      {/* Add Account Modal */}
      {isAddModalOpen && (
        <Dialog open onClose={closeAddModal} title="Add bank account" surface="custom" overlayClassName="st-modal-overlay">
          <dialog open className="st-modal">
            <div className="st-modal-header">
              <h3>Add Bank Account</h3>
              <ModalCloseButton onClick={closeAddModal} label="Close Add Bank Account" />
            </div>
            <form className="st-modal-form" onSubmit={onSubmitAdd}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label htmlFor="settings-selected-bank-name" className="label">Bank</label>
                  <Select id="settings-selected-bank-name"
                    className="input"
                    value={selectedBankName}
                    onChange={(e) => setSelectedBankName(e.target.value)}
                  >
                    {SINGAPORE_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.name}>
                        {bank.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="form-group st-span-2">
                  <label htmlFor="settings-name" className="label">Account Name</label>
                  <Input id="settings-name"
                    className="input"
                    placeholder="e.g., DBS Savings"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <span className="st-hint">If left empty, the bank name will be used</span>
                </div>
                <div className="form-group">
                  <label htmlFor="settings-balance" className="label">Starting Balance</label>
                  <NumericCalculatorInput id="settings-balance"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={balance}
                    onValueChange={setBalance}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="settings-description" className="label">Description</label>
                  <Input id="settings-description"
                    className="input"
                    placeholder="Optional"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
              {createAccount.isError && (
                <div className="st-error">
                  Failed to save: {(createAccount.error as Error)?.message || "Unknown error"}
                </div>
              )}
              <div className="st-modal-actions">
                <Button type="button" className="btn btn-ghost" onClick={closeAddModal}>
                  Cancel
                </Button>
                <Button type="submit" className="btn btn-primary" disabled={createAccount.isPending}>
                  {createAccount.isPending ? "Adding..." : "Add Account"}
                </Button>
              </div>
            </form>
          </dialog>
        </Dialog>
      )}

      {/* Edit Account Modal */}
      {isEditModalOpen && editingAccountId && (
        <Dialog open onClose={closeEditModal} title="Edit bank account" surface="custom" overlayClassName="st-modal-overlay">
          <dialog open className="st-modal">
            <div className="st-modal-header">
              <h3>Edit Bank Account</h3>
              <ModalCloseButton onClick={closeEditModal} label="Close Edit Bank Account" />
            </div>
            <form className="st-modal-form" onSubmit={onSubmitEdit}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label htmlFor="settings-editing-bank-name" className="label">Bank</label>
                  <Select id="settings-editing-bank-name"
                    className="input"
                    value={editingBankName}
                    onChange={(e) => setEditingBankName(e.target.value)}
                  >
                    {SINGAPORE_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.name}>
                        {bank.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="form-group st-span-2">
                  <label htmlFor="settings-editing-name" className="label">Account Name</label>
                  <Input id="settings-editing-name"
                    className="input"
                    placeholder="Account name"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="settings-editing-balance" className="label">Balance</label>
                  <NumericCalculatorInput id="settings-editing-balance"
                    min="0"
                    step="0.01"
                    value={editingBalance}
                    onValueChange={setEditingBalance}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="settings-editing-is-active-active-inactive" className="label">Status</label>
                  <Select id="settings-editing-is-active-active-inactive"
                    className="input"
                    value={editingIsActive ? "ACTIVE" : "INACTIVE"}
                    onChange={(e) => setEditingIsActive(e.target.value === "ACTIVE")}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </Select>
                </div>
                <div className="form-group st-span-2">
                  <label htmlFor="settings-editing-description" className="label">Description</label>
                  <Input id="settings-editing-description"
                    className="input"
                    placeholder="Optional"
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                  />
                </div>
              </div>
              <MutationErrorSummary
                error={updateAccount.error}
                onReload={async () => {
                  closeEditModal();
                  await accounts.refetch();
                }}
              />
              <div className="st-modal-actions">
                <Button type="button" className="btn btn-ghost" onClick={closeEditModal}>
                  Cancel
                </Button>
                <Button type="submit" className="btn btn-primary" disabled={updateAccount.isPending}>
                  {updateAccount.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </dialog>
        </Dialog>
          )}
        </>
      ) : null}
    </div>
  );
}
