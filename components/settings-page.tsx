"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GMAIL_SYNC_INTERVAL_MS } from "@/lib/gmail-alert-query";
import { formatMoney, normalizeCurrency, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { SINGAPORE_BANKS, getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { FormEvent, useEffect, useState } from "react";
import { SkeletonBankCard, SkeletonGrid, EmptyState, PageLoadingState } from "@/components/ui-skeleton";

type Context = {
  workspaceId: string | null;
  defaultAccountId: string | null;
  defaultBudgetId: string | null;
  baseCurrency?: string | null;
};

type GmailStatus = {
  connected: boolean;
  integration: {
    id: string;
    email: string;
    scope: string | null;
    lastSyncedAt: string | null;
    createdAt: string;
  } | null;
};

type BankAccount = {
  id: string;
  name: string;
  bankName: string | null;
  startingCents: number;
  description: string | null;
  isActive: boolean;
  currentBalanceCents: number;
  linkedBudgetTotalCents: number;
  discrepancyCents: number;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  isActive: boolean;
};

type GmailSyncProgress = {
  phase: "idle" | "reading" | "writing" | "complete" | "error";
  progress: number;
  message: string;
  total: number;
  current: number;
  updatedAt: number;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      detail = payload?.message || payload?.error || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});
  const [gmailMessage, setGmailMessage] = useState("");
  const [gmailSyncProgress, setGmailSyncProgress] = useState<GmailSyncProgress | null>(null);
  const [currencyMessage, setCurrencyMessage] = useState("");
  const [receivableAccountMessage, setReceivableAccountMessage] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get("gmail");
    if (!status) return;
    if (status === "connected") setGmailMessage("Gmail connected successfully.");
    else if (status === "denied") setGmailMessage("Gmail permission was denied.");
    else if (status === "forbidden") setGmailMessage("Gmail callback failed authorization.");
    else setGmailMessage("Gmail connection failed.");
    url.searchParams.delete("gmail");
    window.history.replaceState({}, "", url.toString());
  }, []);

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

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<Context>("/api/context"),
  });

  const workspaceId = context.data?.workspaceId ?? null;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const defaultReceivableAccountId = context.data?.defaultAccountId ?? null;
  const defaultReceivableBudgetId = context.data?.defaultBudgetId ?? null;

  const accounts = useQuery({
    queryKey: ["bank-accounts", workspaceId],
    queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const gmailStatus = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () => fetchJson<GmailStatus>("/api/gmail/status"),
  });

  const budgets = useQuery({
    queryKey: ["budgets", workspaceId],
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const connectGmail = useMutation({
    mutationFn: () =>
      fetchJson<{ url: string }>("/api/gmail/connect", {
        method: "POST",
      }),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => setGmailMessage(error instanceof Error ? error.message : "Failed to start Gmail connect."),
  });

  const syncGmail = useMutation({
    mutationFn: () =>
      fetchJson<{ scannedMessages: number; processed: number; duplicates: number; failed: number; skipped?: boolean; reason?: string }>("/api/gmail/sync", {
        method: "POST",
      }),
    onSuccess: (data) => {
      const message = data.skipped && data.reason
        ? data.reason
        : `Synced ${data.scannedMessages} emails: ${data.processed} processed, ${data.duplicates} duplicates, ${data.failed} failed.`;
      setGmailMessage(message);
      setGmailSyncProgress((current) =>
        current
          ? {
              ...current,
              phase: "complete",
              progress: 100,
              message,
              total: data.scannedMessages,
              current: data.scannedMessages,
            }
          : current,
      );
      queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
      queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Gmail sync failed.";
      setGmailMessage(message);
      setGmailSyncProgress((current) =>
        current
          ? {
              ...current,
              phase: "error",
              progress: 100,
              message,
            }
          : null,
      );
    },
  });

  useEffect(() => {
    if (!syncGmail.isPending) {
      if (gmailSyncProgress?.phase === "complete" || gmailSyncProgress?.phase === "error") {
        const timeout = window.setTimeout(() => setGmailSyncProgress(null), 1200);
        return () => window.clearTimeout(timeout);
      }
      return;
    }

    let cancelled = false;
    setGmailMessage("Syncing Gmail inbox...");
    setGmailSyncProgress({
      phase: "reading",
      progress: 0,
      message: "Starting sync...",
      total: 0,
      current: 0,
      updatedAt: Date.now(),
    });

    const poll = async () => {
      try {
        const progress = await fetchJson<GmailSyncProgress>("/api/gmail/sync");
        if (!cancelled) {
          setGmailSyncProgress(progress);
        }
      } catch {}
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [syncGmail.isPending]);

  useEffect(() => {
    if (!gmailStatus.data?.connected || syncGmail.isPending) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible" || syncGmail.isPending) return;
      syncGmail.mutate();
    }, GMAIL_SYNC_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [gmailStatus.data?.connected, syncGmail]);

  const disconnectGmail = useMutation({
    mutationFn: () =>
      fetchJson<{ ok: true }>("/api/gmail/disconnect", {
        method: "POST",
      }),
    onSuccess: () => {
      setGmailMessage("Gmail disconnected.");
      queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
    },
    onError: (error) => setGmailMessage(error instanceof Error ? error.message : "Failed to disconnect Gmail."),
  });

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
      queryClient.invalidateQueries({ queryKey: ["app-context"] });
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
      queryClient.invalidateQueries({ queryKey: ["app-context"] });
    },
    onError: (error) =>
      setReceivableAccountMessage(error instanceof Error ? error.message : "Failed to update default receivable account."),
  });

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
      queryClient.invalidateQueries({ queryKey: ["app-context"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
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
        }),
      }),
    onSuccess: () => {
      closeEditModal();
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
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
  };

  const onSubmitAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() && !selectedBankName) return;
    createAccount.mutate();
  };

  const onSubmitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingAccountId) return;
    updateAccount.mutate({
      id: editingAccountId,
      name: editingName.trim(),
      bankName: editingBankName,
      description: editingDescription.trim() || null,
      startingCents: Math.round(Number(editingBalance || "0") * 100),
      isActive: editingIsActive,
    });
  };

  return (
    <div className="st-container">
      <div className="card" style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ fontSize: "13px", fontWeight: 600 }}>Gmail Card Alerts</div>
              <a
                href="/credit-alerts"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: "12px", color: "var(--brand-500)", textDecoration: "none", fontWeight: 500 }}
              >
                Open Staging Table
              </a>
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              Authorize once for read-only Gmail access. Nest only scans card transaction alert emails, extracts transaction details,
              and auto-adds them to Credit Card Transactions for tracking. Nest does not send, delete, or modify your emails.
            </div>
          </div>
          {gmailStatus.data?.connected ? (
            <div style={{ display: "inline-flex", gap: "8px" }}>
              <button className="btn btn-ghost btn-xs" onClick={() => syncGmail.mutate()} disabled={syncGmail.isPending}>
                {syncGmail.isPending ? "Syncing..." : "Sync Inbox"}
              </button>
              <button className="btn btn-ghost btn-xs" onClick={() => disconnectGmail.mutate()} disabled={disconnectGmail.isPending}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-xs" onClick={() => connectGmail.mutate()} disabled={connectGmail.isPending}>
              {connectGmail.isPending ? "Redirecting..." : "Connect Gmail"}
            </button>
          )}
        </div>
        {gmailStatus.data?.connected && gmailStatus.data.integration ? (
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            Connected: <strong>{gmailStatus.data.integration.email}</strong>
            {gmailStatus.data.integration.lastSyncedAt
              ? ` · Last sync: ${new Date(gmailStatus.data.integration.lastSyncedAt).toLocaleString()}`
              : " · Never synced"}
          </div>
        ) : (
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Not connected.</div>
        )}
        {gmailSyncProgress ? (
          <div className="gmail-sync-progress-wrap" aria-label="Gmail inbox sync progress" aria-live="polite">
            <div className="gmail-sync-progress">
              <div className="gmail-sync-progress-bar" style={{ width: `${Math.min(gmailSyncProgress.progress, 100)}%` }} />
            </div>
            <div className="gmail-sync-progress-text">
              {gmailSyncProgress.message || `Syncing inbox ${Math.round(gmailSyncProgress.progress)}%`}
            </div>
          </div>
        ) : null}
        {gmailMessage ? <div style={{ marginTop: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>{gmailMessage}</div> : null}
      </div>

      <div className="card" style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600 }}>Currency Display</div>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              Set currency display across your workspace. Default is SGD.
            </div>
          </div>
          <select
            className="input"
            style={{ maxWidth: "140px" }}
            value={baseCurrency}
            onChange={(event) => updateCurrency.mutate(event.target.value)}
            disabled={!workspaceId || updateCurrency.isPending}
          >
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
        {currencyMessage ? <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{currencyMessage}</div> : null}
      </div>

      <div className="card" style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600 }}>Receivable Default Account</div>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              Closed receivables are credited into this account automatically.
            </div>
          </div>
          <select
            className="input"
            style={{ maxWidth: "260px" }}
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
          </select>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginTop: "10px" }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600 }}>Receivable Default Subaccount</div>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              Closed receivables are posted into this subaccount under the default account.
            </div>
          </div>
          <select
            className="input"
            style={{ maxWidth: "260px" }}
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
          </select>
        </div>
        {receivableAccountMessage ? <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{receivableAccountMessage}</div> : null}
      </div>

      {/* Header with Add Button */}
      <div className="st-header">
        <h2 className="st-title">Bank Accounts</h2>
        <button className="btn btn-primary" onClick={openAddModal}>
          + Add Account
        </button>
      </div>

      {/* Accounts Grid */}
      <div className="st-grid">
        {accounts.isLoading && (
          <SkeletonGrid count={4} type="bank" />
        )}

        {accounts.isError && (
          <div className="st-empty">
            <div className="st-empty-icon">⚠️</div>
            <p>Failed to load accounts</p>
            <button className="btn btn-primary" onClick={() => accounts.refetch()}>
              Retry
            </button>
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
                    <img
                      src={logo}
                      alt={bank?.name || "Bank"}
                      className="st-bank-logo"
                      loading="lazy"
                      onError={() => setFailedLogos((prev) => ({ ...prev, [account.id]: true }))}
                    />
                  ) : bank ? (
                    <span className="st-bank-fallback" style={{ backgroundColor: bank.color }}>
                      {bank.short}
                    </span>
                  ) : (
                    <span className="st-bank-fallback" style={{ backgroundColor: '#64748b' }}>
                      BNK
                    </span>
                  )}
                </div>
                <div className="st-card-actions">
                  <button className="btn btn-ghost btn-xs" onClick={() => openEditModal(account)}>
                    Edit
                  </button>
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
          <button className="st-add-card" onClick={openAddModal}>
            <div className="st-add-icon">+</div>
            <span>Add Bank Account</span>
            <p className="st-add-hint">Connect a new bank to track your finances</p>
          </button>
        )}

        {/* Empty State */}
        {!accounts.isLoading && !accounts.isError && accounts.data?.length === 0 && (
          <div className="st-grid-empty">
            <EmptyState
              icon="🏦"
              title="No bank accounts yet"
              description="Connect your first bank account to start tracking your finances and managing budgets."
              action={
                <button className="btn btn-primary" onClick={openAddModal}>
                  + Add Your First Account
                </button>
              }
            />
          </div>
        )}
      </div>

      {/* Add Account Modal */}
      {isAddModalOpen && (
        <div className="st-modal-overlay" onClick={closeAddModal}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Add Bank Account</h3>
              <button className="st-close-btn" onClick={closeAddModal}>✕</button>
            </div>
            <form className="st-modal-form" onSubmit={onSubmitAdd}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Bank</label>
                  <select
                    className="input"
                    value={selectedBankName}
                    onChange={(e) => setSelectedBankName(e.target.value)}
                  >
                    {SINGAPORE_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.name}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Account Name</label>
                  <input
                    className="input"
                    placeholder="e.g., DBS Savings"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <span className="st-hint">If left empty, the bank name will be used</span>
                </div>
                <div className="form-group">
                  <label className="label">Starting Balance</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={balance}
                    onChange={(e) => setBalance(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Description</label>
                  <input
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
                <button type="button" className="btn btn-ghost" onClick={closeAddModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createAccount.isPending}>
                  {createAccount.isPending ? "Adding..." : "Add Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {isEditModalOpen && editingAccountId && (
        <div className="st-modal-overlay" onClick={closeEditModal}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Edit Bank Account</h3>
              <button className="st-close-btn" onClick={closeEditModal}>✕</button>
            </div>
            <form className="st-modal-form" onSubmit={onSubmitEdit}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Bank</label>
                  <select
                    className="input"
                    value={editingBankName}
                    onChange={(e) => setEditingBankName(e.target.value)}
                  >
                    {SINGAPORE_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.name}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Account Name</label>
                  <input
                    className="input"
                    placeholder="Account name"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Balance</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={editingBalance}
                    onChange={(e) => setEditingBalance(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Status</label>
                  <select
                    className="input"
                    value={editingIsActive ? "ACTIVE" : "INACTIVE"}
                    onChange={(e) => setEditingIsActive(e.target.value === "ACTIVE")}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Description</label>
                  <input
                    className="input"
                    placeholder="Optional"
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                  />
                </div>
              </div>
              {updateAccount.isError && (
                <div className="st-error">
                  Failed to update: {(updateAccount.error as Error)?.message || "Unknown error"}
                </div>
              )}
              <div className="st-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeEditModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={updateAccount.isPending}>
                  {updateAccount.isPending ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
