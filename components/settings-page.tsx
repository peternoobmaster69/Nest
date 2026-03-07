"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SINGAPORE_BANKS, getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { FormEvent, useState } from "react";

type Context = {
  workspaceId: string | null;
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

function formatCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    try {
      const payload = await res.json();
      const detail = payload?.message || payload?.error || `Request failed (${res.status})`;
      throw new Error(detail);
    } catch {
      throw new Error(`Request failed (${res.status})`);
    }
  }
  return res.json();
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});

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

  const accounts = useQuery({
    queryKey: ["bank-accounts", workspaceId],
    queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
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
      {/* Header with Add Button */}
      <div className="st-header">
        <h2 className="st-title">Bank Accounts</h2>
        <button className="btn btn-primary" onClick={openAddModal}>
          + Add Account
        </button>
      </div>

      {/* Accounts Grid */}
      <div className="st-grid">
        {accounts.data?.map((account) => {
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
                    {formatCents(account.currentBalanceCents)}
                  </span>
                </div>
                <div className="st-stat">
                  <span className="st-stat-label">In Budgets</span>
                  <span className="st-stat-value">{formatCents(account.linkedBudgetTotalCents)}</span>
                </div>
              </div>

              {hasDiscrepancy && (
                <div className="st-discrepancy">
                  <span className="st-discrepancy-icon">⚠️</span>
                  <span className="st-discrepancy-text">
                    Discrepancy: {account.discrepancyCents > 0 ? "+" : ""}
                    {formatCents(account.discrepancyCents)}
                  </span>
                </div>
              )}

              {!account.isActive && (
                <div className="st-inactive-badge">Inactive</div>
              )}
            </div>
          );
        })}

        {/* Add New Card Placeholder */}
        <button className="st-add-card" onClick={openAddModal}>
          <div className="st-add-icon">+</div>
          <span>Add Bank Account</span>
          <p className="st-add-hint">Connect a new bank to track your finances</p>
        </button>

        {!accounts.data?.length && (
          <div className="st-empty">
            <div className="st-empty-icon">🏦</div>
            <p>No bank accounts yet</p>
            <button className="btn btn-primary" onClick={openAddModal}>
              Add your first account
            </button>
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
