"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";

type AppContext = {
  workspaceId: string | null;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  availableCents: number;
  targetCents: number;
};

type Transaction = {
  id: string;
  accountId: string;
  budgetId?: string | null;
  subject: string;
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

function formatCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export function TransactionsPage() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [amount, setAmount] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [operation, setOperation] = useState<"DEDUCT" | "ADD">("DEDUCT");
  const [selectedBankId, setSelectedBankId] = useState("");
  const [bankFilterHydrated, setBankFilterHydrated] = useState(false);
  const [activeBudgetFilterId, setActiveBudgetFilterId] = useState<string>("ALL");
  const [failedBankLogos, setFailedBankLogos] = useState<Record<string, boolean>>({});
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editOperation, setEditOperation] = useState<"DEDUCT" | "ADD">("DEDUCT");

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  const workspaceId = context.data?.workspaceId;
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
    setActiveBudgetFilterId("ALL");
  }, [selectedBankId]);

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
    },
  });

  const updateTx = useMutation({
    mutationFn: (payload: { id: string; subject: string; amountCents: number; operation: "DEDUCT" | "ADD" }) =>
      fetchJson(`/api/transactions/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: payload.subject,
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

  const totalFilteredCents = useMemo(
    () =>
      bankScopedTransactions.reduce(
        (sum, tx) => sum + (tx.direction === "CREDIT" ? tx.amountCents : -tx.amountCents),
        0,
      ),
    [bankScopedTransactions],
  );
  const totalIncomingCents = useMemo(
    () => bankScopedTransactions.filter((tx) => tx.direction === "CREDIT").reduce((sum, tx) => sum + tx.amountCents, 0),
    [bankScopedTransactions],
  );
  const totalOutgoingCents = useMemo(
    () => bankScopedTransactions.filter((tx) => tx.direction === "DEBIT").reduce((sum, tx) => sum + tx.amountCents, 0),
    [bankScopedTransactions],
  );
  const totalBankBalanceCents = useMemo(
    () => (bankAccounts.data ?? []).reduce((sum, b) => sum + b.currentBalanceCents, 0),
    [bankAccounts.data],
  );

  const beginEdit = (tx: Transaction) => {
    setEditingTxId(tx.id);
    setEditSubject(tx.subject);
    setEditAmount((tx.amountCents / 100).toFixed(2));
    setEditOperation(tx.direction === "CREDIT" ? "ADD" : "DEDUCT");
  };

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Bank Accounts</div>
        <div className="account-cards-grid">
          <div
            className="budget-mini budget-mini-compact"
            onClick={() => setSelectedBankId("")}
            style={{
              borderColor: !selectedBankId ? "var(--brand-500)" : undefined,
              boxShadow: !selectedBankId ? "var(--shadow-sm)" : undefined,
            }}
          >
            <div className="bm-name">All banks</div>
            <div className="bm-amount">{formatCents(totalBankBalanceCents)}</div>
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
              <div className="bm-amount">{formatCents(bank.currentBalanceCents)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="hero-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 2 }}>
          <div>
            <div className="hero-label">Total Transactions</div>
            <div className="hero-amount">{formatCents(totalFilteredCents)}</div>
            <div className="hero-sub">
              {selectedBankId ? bankAccounts.data?.find((b) => b.id === selectedBankId)?.name || "Selected bank" : "All banks"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "11px", marginBottom: "4px", color: "var(--success)" }}>In {formatCents(totalIncomingCents)}</div>
            <div style={{ fontSize: "11px", color: "var(--danger)" }}>Out {formatCents(totalOutgoingCents)}</div>
          </div>
        </div>
      </section>

      <section className="card" style={{ display: "grid", gap: "12px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Add Transaction</div>
        <div style={{ display: "grid", gap: "10px" }}>
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
        <form className="crud-form" style={{ gridTemplateColumns: "1fr 120px 1fr 120px auto" }} onSubmit={onSubmit}>
          <input className="input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <input className="input" type="number" min="1" step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
            style={{ color: operation === "DEDUCT" ? "var(--danger)" : "var(--success)" }}
          >
            <option value="DEDUCT">Deduct</option>
            <option value="ADD">Add</option>
          </select>
          <button className="btn btn-primary" type="submit" disabled={createTx.isPending}>
            Add
          </button>
        </form>
      </section>

      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Accounts</div>
        <div className="account-cards-grid">
          <div
            className="budget-mini budget-mini-compact"
            onClick={() => setActiveBudgetFilterId("ALL")}
            style={{
              borderColor: activeBudgetFilterId === "ALL" ? "var(--brand-500)" : undefined,
              boxShadow: activeBudgetFilterId === "ALL" ? "var(--shadow-sm)" : undefined,
            }}
          >
            <div className="bm-name">All accounts</div>
            <div className="bm-target">{filteredTransactions.length} transactions</div>
          </div>
          {visibleBudgets.map((b) => (
            <div
              key={b.id}
              className="budget-mini budget-mini-compact"
              onClick={() => setActiveBudgetFilterId(b.id)}
              style={{
                borderColor: activeBudgetFilterId === b.id ? "var(--brand-500)" : undefined,
                boxShadow: activeBudgetFilterId === b.id ? "var(--shadow-sm)" : undefined,
              }}
            >
              <div className="bm-name">{b.name}</div>
              <div className="bm-amount">{formatCents(b.availableCents)}</div>
              <div className="bm-target">
                {b.targetCents > 0 ? `${formatCents(b.availableCents)} / ${formatCents(b.targetCents)}` : "No target"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Recent Transactions</div>
        <div className="simple-list">
          {filteredTransactions.map((tx) =>
            editingTxId === tx.id ? (
              <div key={tx.id} className="crud-row">
                <div className="crud-edit" style={{ gridTemplateColumns: "1fr 120px 120px auto auto" }}>
                  <input className="input" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
                  <input
                    className="input"
                    type="number"
                    min="1"
                    step="0.01"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                  />
                  <select
                    className="input"
                    value={editOperation}
                    onChange={(e) => setEditOperation(e.target.value as "DEDUCT" | "ADD")}
                    style={{ color: editOperation === "DEDUCT" ? "var(--danger)" : "var(--success)" }}
                  >
                    <option value="DEDUCT">Deduct</option>
                    <option value="ADD">Add</option>
                  </select>
                  <button
                    className="btn btn-secondary btn-xs"
                    onClick={() =>
                      updateTx.mutate({
                        id: tx.id,
                        subject: editSubject,
                        amountCents: Math.round(Number(editAmount) * 100),
                        operation: editOperation,
                      })
                    }
                    disabled={updateTx.isPending}
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditingTxId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={tx.id} className="crud-row">
                <div style={{ display: "grid", gap: "3px" }}>
                  <span className={tx.direction === "DEBIT" ? "negative" : "positive"}>
                    {tx.subject} {formatCents(tx.amountCents)}
                  </span>
                  <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{new Date(tx.date).toLocaleString()}</span>
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
            ),
          )}
          {!filteredTransactions.length && <p className="muted">No transactions yet.</p>}
        </div>
      </section>
    </div>
  );
}
