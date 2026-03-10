"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { SkeletonMiniCard, SkeletonList, EmptyState, LoadingDots } from "@/components/ui-skeleton";

type AppContext = {
  workspaceId: string | null;
  baseCurrency?: string | null;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  icon?: string | null;
  availableCents: number;
  targetCents: number;
};

type Transaction = {
  id: string;
  accountId: string;
  budgetId?: string | null;
  subject: string;
  details?: string | null;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  kind: string;
  date: string;
};

type BankAccount = {
  id: string;
  name: string;
  bankName?: string | null;
  currentBalanceCents: number;
};

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

function getBudgetIcon(name: string, icon?: string | null) {
  if (icon) return icon;
  const key = name.toLowerCase();
  if (key.includes("save")) return "🛡️";
  if (key.includes("loan")) return "🏠";
  if (key.includes("insurance")) return "🧾";
  if (key.includes("phone")) return "📱";
  if (key.includes("credit")) return "💳";
  return "💰";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export function TransactionsPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [amount, setAmount] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [operation, setOperation] = useState<"DEDUCT" | "ADD">("DEDUCT");
  const [selectedBankId, setSelectedBankId] = useState("");
  const [bankFilterHydrated, setBankFilterHydrated] = useState(false);
  const [activeBudgetFilterId, setActiveBudgetFilterId] = useState<string>("ALL");
  const [urlFilterHydrated, setUrlFilterHydrated] = useState(false);
  const [failedBankLogos, setFailedBankLogos] = useState<Record<string, boolean>>({});
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editOperation, setEditOperation] = useState<"DEDUCT" | "ADD">("DEDUCT");

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  const workspaceId = context.data?.workspaceId;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const formatCents = (value: number) => formatMoney(value, baseCurrency);
  const txBankStorageKey = workspaceId ? `nest:selectedBank:${workspaceId}` : null;

  const budgets = useQuery({
    queryKey: ["budgets", workspaceId],
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const bankAccounts = useQuery({
    queryKey: ["bank-accounts", workspaceId],
    queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const transactions = useQuery({
    queryKey: ["transactions", workspaceId],
    queryFn: () => fetchJson<Transaction[]>(`/api/transactions?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    if (!txBankStorageKey || typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(txBankStorageKey);
    if (saved) {
      setSelectedBankId(saved);
    }
    setBankFilterHydrated(true);
  }, [txBankStorageKey]);

  useEffect(() => {
    const firstBankId = bankAccounts.data?.[0]?.id;
    if (!selectedBankId && firstBankId) {
      setSelectedBankId(firstBankId);
    }
  }, [bankAccounts.data, selectedBankId]);

  useEffect(() => {
    if (!selectedBankId || !bankAccounts.data?.length) return;
    if (!bankAccounts.data.some((b) => b.id === selectedBankId)) {
      setSelectedBankId(bankAccounts.data[0].id);
    }
  }, [bankAccounts.data, selectedBankId]);

  useEffect(() => {
    if (!txBankStorageKey || typeof window === "undefined" || !selectedBankId || !bankFilterHydrated) return;
    window.sessionStorage.setItem(txBankStorageKey, selectedBankId);
  }, [txBankStorageKey, selectedBankId, bankFilterHydrated]);

  useEffect(() => {
    if (activeBudgetFilterId === "ALL") return;
    const activeBudget = budgets.data?.find((b) => b.id === activeBudgetFilterId);
    if (!activeBudget) {
      setActiveBudgetFilterId("ALL");
      return;
    }
    if (selectedBankId && activeBudget.accountId !== selectedBankId) {
      setActiveBudgetFilterId("ALL");
    }
  }, [activeBudgetFilterId, selectedBankId, budgets.data]);

  useEffect(() => {
    if (urlFilterHydrated) return;
    if (!bankAccounts.data || !budgets.data) return;

    const requestedAccountId = searchParams.get("accountId");
    const requestedBudgetId = searchParams.get("budgetId");

    if (!requestedAccountId && !requestedBudgetId) {
      setUrlFilterHydrated(true);
      return;
    }

    const validAccountId =
      requestedAccountId && bankAccounts.data.some((bank) => bank.id === requestedAccountId) ? requestedAccountId : "";
    const validBudget = requestedBudgetId ? budgets.data.find((b) => b.id === requestedBudgetId) : undefined;
    const targetAccountId = validAccountId || validBudget?.accountId || "";

    if (targetAccountId) {
      setSelectedBankId(targetAccountId);
    }

    if (validBudget && (!targetAccountId || validBudget.accountId === targetAccountId)) {
      setActiveBudgetFilterId(validBudget.id);
    } else {
      setActiveBudgetFilterId("ALL");
    }

    setUrlFilterHydrated(true);
  }, [urlFilterHydrated, bankAccounts.data, budgets.data, searchParams]);

  const createTx = useMutation({
    mutationFn: (payload: {
      subject: string;
      amountCents: number;
      accountId: string;
      operation: "DEDUCT" | "ADD";
      budgetId?: string;
      budgetOperation?: "DEDUCT" | "ADD";
    }) =>
      fetchJson("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          accountId: payload.accountId,
          subject: payload.subject,
          amountCents: payload.amountCents,
          direction: payload.operation === "ADD" ? "CREDIT" : "DEBIT",
          kind: payload.operation === "ADD" ? "ADJUSTMENT" : "EXPENSE",
          date: new Date().toISOString(),
          budgetId: payload.budgetId,
          budgetOperation: payload.budgetOperation,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] });
      setSubject("");
      setAmount("");
      setBudgetId("");
      setOperation("DEDUCT");
      setIsCreateModalOpen(false);
    },
  });

  const updateTx = useMutation({
    mutationFn: (payload: { id: string; subject: string; details?: string | null; amountCents: number; operation: "DEDUCT" | "ADD" }) =>
      fetchJson(`/api/transactions/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: payload.subject,
          details: payload.details ?? null,
          amountCents: payload.amountCents,
          direction: payload.operation === "ADD" ? "CREDIT" : "DEBIT",
          kind: payload.operation === "ADD" ? "ADJUSTMENT" : "EXPENSE",
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] });
      setEditingTxId(null);
      setEditSubject("");
      setEditDetails("");
      setEditAmount("");
      setEditOperation("DEDUCT");
    },
  });

  const deleteTx = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const selectedBudget = budgets.data?.find((b) => b.id === budgetId);
    const accountId = selectedBudget?.accountId || selectedBankId;
    if (!workspaceId || !accountId || !subject || !amount) return;
    createTx.mutate({
      subject,
      amountCents: Math.round(Number(amount) * 100),
      accountId,
      operation,
      budgetId: budgetId || undefined,
      budgetOperation: budgetId ? operation : undefined,
    });
  };

  const visibleBudgets = useMemo(() => {
    if (!budgets.data?.length) return [];
    if (!selectedBankId) return budgets.data;
    return budgets.data.filter((b) => b.accountId === selectedBankId);
  }, [budgets.data, selectedBankId]);

  const filteredTransactions = useMemo(() => {
    const all = transactions.data ?? [];
    return all.filter((tx) => {
      if (selectedBankId && tx.accountId !== selectedBankId) return false;
      if (activeBudgetFilterId !== "ALL" && tx.budgetId !== activeBudgetFilterId) return false;
      return true;
    });
  }, [transactions.data, selectedBankId, activeBudgetFilterId]);

  const bankScopedTransactions = useMemo(() => {
    const all = transactions.data ?? [];
    return all.filter((tx) => (selectedBankId ? tx.accountId === selectedBankId : true));
  }, [transactions.data, selectedBankId]);

  const totalBankBalanceCents = useMemo(
    () => (bankAccounts.data ?? []).reduce((sum, b) => sum + b.currentBalanceCents, 0),
    [bankAccounts.data],
  );

  const beginEdit = (tx: Transaction) => {
    setEditingTxId(tx.id);
    setEditSubject(tx.subject);
    setEditDetails(tx.details || "");
    setEditAmount((tx.amountCents / 100).toFixed(2));
    setEditOperation(tx.direction === "CREDIT" ? "ADD" : "DEDUCT");
  };

  const closeEditModal = () => {
    setEditingTxId(null);
    setEditSubject("");
    setEditDetails("");
    setEditAmount("");
    setEditOperation("DEDUCT");
  };

  const onSubmitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingTxId || !editSubject || !editAmount) return;
    updateTx.mutate({
      id: editingTxId,
      subject: editSubject,
      details: editDetails || null,
      amountCents: Math.round(Number(editAmount) * 100),
      operation: editOperation,
    });
  };

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600 }}>Bank Accounts</div>
          <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
            Add Transaction
          </button>
        </div>
        <div className="account-cards-grid">
          {bankAccounts.isLoading && (
            <>
              <SkeletonMiniCard />
              <SkeletonMiniCard />
              <SkeletonMiniCard />
              <SkeletonMiniCard />
            </>
          )}

          {!bankAccounts.isLoading && (
            <>
              <div
                className="budget-mini budget-mini-compact"
                onClick={() => setSelectedBankId("")}
                style={{
                  borderColor: !selectedBankId ? "var(--brand-500)" : undefined,
                  boxShadow: !selectedBankId ? "var(--shadow-sm)" : undefined,
                }}
              >
                <div className="bm-name">All banks</div>
                <div className={`bm-amount ${getAmountToneClass(totalBankBalanceCents)}`}>{formatCents(totalBankBalanceCents)}</div>
              </div>
              {(bankAccounts.data ?? []).map((bank) => (
            <div
              key={bank.id}
              className="budget-mini budget-mini-compact"
              onClick={() => setSelectedBankId(bank.id)}
              style={{
                borderColor: selectedBankId === bank.id ? "var(--brand-500)" : undefined,
                boxShadow: selectedBankId === bank.id ? "var(--shadow-sm)" : undefined,
              }}
            >
              <div className="bm-name" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {(() => {
                  const bankMeta = getSingaporeBankByName(bank.bankName || bank.name);
                  const logo = getBankLogoUrl(bankMeta);
                  return logo && !failedBankLogos[bank.id] ? (
                    <img
                      src={logo}
                      alt={bankMeta?.name || "Bank"}
                      className="bank-logo-img"
                      loading="lazy"
                      onError={() => setFailedBankLogos((prev) => ({ ...prev, [bank.id]: true }))}
                    />
                  ) : bankMeta ? (
                    <span className="bank-icon" style={{ backgroundColor: bankMeta.color }}>
                      {bankMeta.short}
                    </span>
                  ) : (
                    <span className="bank-icon bank-icon-default">BNK</span>
                  );
                })()}
                <span>{bank.name}</span>
              </div>
              <div className={`bm-amount ${getAmountToneClass(bank.currentBalanceCents)}`}>{formatCents(bank.currentBalanceCents)}</div>
            </div>
          ))}
            </>
          )}
        </div>
      </section>

      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
          <span aria-hidden="true">📁</span>
          <span>Sub-Accounts</span>
        </div>
        <div className="account-cards-grid tx-account-grid">
          {/*
            Transactions page: compact account chips with only name + amount.
          */}
          <div
            className="budget-mini budget-mini-compact tx-account-card"
            onClick={() => setActiveBudgetFilterId("ALL")}
            style={{
              borderColor: activeBudgetFilterId === "ALL" ? "var(--brand-500)" : undefined,
              boxShadow: activeBudgetFilterId === "ALL" ? "var(--shadow-sm)" : undefined,
            }}
          >
            <div className="bm-name" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span aria-hidden="true">📁</span>
              <span>All accounts</span>
            </div>
            <div className={`bm-amount ${getAmountToneClass(visibleBudgets.reduce((sum, budget) => sum + budget.availableCents, 0))}`}>
              {formatCents(visibleBudgets.reduce((sum, budget) => sum + budget.availableCents, 0))}
            </div>
          </div>
          {visibleBudgets.map((b) => (
            <div
              key={b.id}
              className="budget-mini budget-mini-compact tx-account-card"
              onClick={() => setActiveBudgetFilterId(b.id)}
              style={{
                borderColor: activeBudgetFilterId === b.id ? "var(--brand-500)" : undefined,
                boxShadow: activeBudgetFilterId === b.id ? "var(--shadow-sm)" : undefined,
              }}
            >
              <div className="bm-name" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span aria-hidden="true">{getBudgetIcon(b.name, b.icon)}</span>
                <span>{b.name}</span>
              </div>
              <div className={`bm-amount ${getAmountToneClass(b.availableCents)}`}>{formatCents(b.availableCents)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Recent Transactions</div>
        <div className="simple-list">
          {transactions.isLoading && <SkeletonList count={5} type="transaction" />}

          {transactions.isError && (
            <div className="empty-state" style={{ padding: "40px 20px" }}>
              <div className="empty-state-icon">⚠️</div>
              <h3 className="empty-state-title">Failed to load transactions</h3>
              <button className="btn btn-primary" onClick={() => transactions.refetch()}>
                Retry
              </button>
            </div>
          )}

          {!transactions.isLoading && !transactions.isError && filteredTransactions.map((tx) => (
            <div key={tx.id} className="crud-row">
              <div style={{ display: "grid", gap: "3px" }}>
                <span className={getAmountToneClass(tx.direction === "DEBIT" ? -tx.amountCents : tx.amountCents)}>
                  {tx.subject} {formatCents(tx.amountCents)}
                </span>
                <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{new Date(tx.date).toLocaleString()}</span>
                {tx.details ? (
                  <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{tx.details}</span>
                ) : null}
              </div>
              <div className="crud-actions">
                <button className="btn btn-ghost btn-xs" onClick={() => beginEdit(tx)}>
                  Edit
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => deleteTx.mutate(tx.id)} disabled={deleteTx.isPending}>
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!transactions.isLoading && !transactions.isError && filteredTransactions.length === 0 && (
            <EmptyState
              icon="📑"
              title="No transactions yet"
              description={selectedBankId ? "Add your first transaction for this bank account." : "Add your first transaction to start tracking your spending."}
              action={
                <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
                  + Add Transaction
                </button>
              }
            />
          )}
        </div>
      </section>

      {isCreateModalOpen && (
        <div className="profile-modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
          <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Add Transaction</h3>
              <button className="profile-modal-close" onClick={() => setIsCreateModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="profile-modal-body" style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "grid", gap: "8px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Bank account</div>
                {bankAccounts.data && bankAccounts.data.length === 1 ? (
                  <div className="crud-row" style={{ marginBottom: 0 }}>
                    <span>{bankAccounts.data[0].name}</span>
                  </div>
                ) : (
                  <select className="input" value={selectedBankId} onChange={(e) => setSelectedBankId(e.target.value)}>
                    <option value="" disabled>
                      Select bank account
                    </option>
                    {bankAccounts.data?.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <form style={{ display: "grid", gap: "10px" }} onSubmit={onSubmit}>
                <input className="input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="Amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <select className="input" value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
                  <option value="">No account</option>
                  {visibleBudgets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={operation}
                  onChange={(e) => setOperation(e.target.value as "DEDUCT" | "ADD")}
                  style={{ color: operation === "DEDUCT" ? "var(--amount-negative)" : "var(--amount-positive)" }}
                >
                  <option value="DEDUCT">Deduct</option>
                  <option value="ADD">Add</option>
                </select>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <button className="btn btn-ghost" type="button" onClick={() => setIsCreateModalOpen(false)}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" type="submit" disabled={createTx.isPending}>
                    {createTx.isPending ? "Adding..." : "Add"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {editingTxId && (
        <div className="profile-modal-overlay" onClick={closeEditModal}>
          <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Edit Transaction</h3>
              <button className="profile-modal-close" onClick={closeEditModal}>
                Close
              </button>
            </div>
            <form className="profile-modal-body" style={{ display: "grid", gap: "12px" }} onSubmit={onSubmitEdit}>
              <input className="input" placeholder="Subject" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
              <textarea
                className="input"
                rows={3}
                placeholder="Details"
                value={editDetails}
                onChange={(e) => setEditDetails(e.target.value)}
              />
              <input
                className="input"
                type="number"
                min="1"
                step="0.01"
                placeholder="Amount"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
              />
              <select
                className="input"
                value={editOperation}
                onChange={(e) => setEditOperation(e.target.value as "DEDUCT" | "ADD")}
                style={{ color: editOperation === "DEDUCT" ? "var(--amount-negative)" : "var(--amount-positive)" }}
              >
                <option value="DEDUCT">Deduct</option>
                <option value="ADD">Add</option>
              </select>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button className="btn btn-ghost" type="button" onClick={closeEditModal}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={updateTx.isPending}>
                  {updateTx.isPending ? <LoadingDots /> : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
