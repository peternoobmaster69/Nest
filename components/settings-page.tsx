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
  const [name, setName] = useState("");
  const [selectedBankName, setSelectedBankName] = useState(SINGAPORE_BANKS[0].name);
  const [balance, setBalance] = useState("");
  const [description, setDescription] = useState("");
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingBalance, setEditingBalance] = useState("");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingBankName, setEditingBankName] = useState(SINGAPORE_BANKS[0].name);
  const [editingDescription, setEditingDescription] = useState("");
  const [editingIsActive, setEditingIsActive] = useState(true);
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});

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
      setName("");
      setSelectedBankName(SINGAPORE_BANKS[0].name);
      setBalance("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["app-context"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
  });

  const updateBalance = useMutation({
    mutationFn: (payload: { id: string; startingCents: number }) =>
      fetchJson(`/api/accounts/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startingCents: payload.startingCents }),
      }),
    onSuccess: () => {
      setEditingBalanceId(null);
      setEditingBalance("");
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
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
      setEditingAccountId(null);
      setEditingName("");
      setEditingBankName(SINGAPORE_BANKS[0].name);
      setEditingDescription("");
      setEditingIsActive(true);
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() && !selectedBankName) return;
    createAccount.mutate();
  };

  return (
    <div className="grid-2">
      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Add Bank Account</div>
        <form className="crud-form" style={{ gridTemplateColumns: "1fr 120px 1fr auto" }} onSubmit={onSubmit}>
          <select className="input" value={selectedBankName} onChange={(e) => setSelectedBankName(e.target.value)}>
            {SINGAPORE_BANKS.map((bank) => (
              <option key={bank.code} value={bank.name}>
                {bank.name}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            placeholder="Starting balance"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
          <input
            className="input"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={createAccount.isPending}>
            Add
          </button>
        </form>
        {createAccount.isError && (
          <p className="muted" style={{ marginTop: "8px", fontSize: "12px", color: "var(--danger)" }}>
            Failed to save bank account. {(createAccount.error as Error)?.message || ""}
          </p>
        )}
        <p className="muted" style={{ marginTop: "8px", fontSize: "12px" }}>
          If account name is empty, Nest will use the selected bank name. If this is your first account, Nest auto-creates your workspace.
        </p>
      </section>

      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Bank Accounts</div>
        <div className="simple-list">
          {accounts.data?.map((a) => (
            <div key={a.id} className="crud-row">
              {editingAccountId === a.id ? (
                <div className="crud-edit" style={{ gridTemplateColumns: "1fr 1fr 130px 1fr 120px auto auto" }}>
                  <input className="input" value={editingName} onChange={(e) => setEditingName(e.target.value)} placeholder="Account name" />
                  <select className="input" value={editingBankName} onChange={(e) => setEditingBankName(e.target.value)}>
                    {SINGAPORE_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.name}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={editingBalance}
                    onChange={(e) => setEditingBalance(e.target.value)}
                    placeholder="Balance"
                  />
                  <input
                    className="input"
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    placeholder="Description"
                  />
                  <select className="input" value={editingIsActive ? "ACTIVE" : "INACTIVE"} onChange={(e) => setEditingIsActive(e.target.value === "ACTIVE")}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                  <button
                    className="btn btn-secondary btn-xs"
                    onClick={() =>
                      updateAccount.mutate({
                        id: a.id,
                        name: editingName.trim() || a.name,
                        bankName: editingBankName,
                        description: editingDescription.trim() || null,
                        startingCents: Math.round(Number(editingBalance || "0") * 100),
                        isActive: editingIsActive,
                      })
                    }
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditingAccountId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {(() => {
                        const bank = getSingaporeBankByName(a.bankName);
                        const logo = getBankLogoUrl(bank);
                        return logo && !failedLogos[a.id] ? (
                          <img
                            src={logo}
                            alt={bank?.name || "Bank"}
                            className="bank-logo-img"
                            loading="lazy"
                            onError={() => setFailedLogos((prev) => ({ ...prev, [a.id]: true }))}
                          />
                        ) : bank ? (
                          <span className="bank-icon" style={{ backgroundColor: bank.color }}>
                            {bank.short}
                          </span>
                        ) : (
                          <span className="bank-icon bank-icon-default">BNK</span>
                        );
                      })()}
                      {a.name}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                      {(a.bankName || "Bank")} · Linked budgets: {formatCents(a.linkedBudgetTotalCents)} | Current balance:{" "}
                      {formatCents(a.currentBalanceCents)}
                    </span>
                    {a.discrepancyCents !== 0 && (
                      <span style={{ fontSize: "11px", color: "var(--danger)" }}>
                        Discrepancy: {a.discrepancyCents > 0 ? "+" : ""}
                        {formatCents(a.discrepancyCents)}
                      </span>
                    )}
                  </div>
                  {editingBalanceId === a.id ? (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input
                        className="input"
                        style={{ width: "130px" }}
                        type="number"
                        min="0"
                        step="0.01"
                        value={editingBalance}
                        onChange={(e) => setEditingBalance(e.target.value)}
                      />
                      <button
                        className="btn btn-secondary btn-xs"
                        onClick={() =>
                          updateBalance.mutate({
                            id: a.id,
                            startingCents: Math.round(Number(editingBalance || "0") * 100),
                          })
                        }
                      >
                        Save
                      </button>
                      <button className="btn btn-ghost btn-xs" onClick={() => setEditingBalanceId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => {
                          setEditingBalanceId(a.id);
                          setEditingBalance((a.startingCents / 100).toFixed(2));
                        }}
                      >
                        Set balance
                      </button>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => {
                          setEditingAccountId(a.id);
                          setEditingBalanceId(null);
                          setEditingName(a.name);
                          setEditingBankName(a.bankName || SINGAPORE_BANKS[0].name);
                          setEditingBalance((a.startingCents / 100).toFixed(2));
                          setEditingDescription(a.description || "");
                          setEditingIsActive(a.isActive);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {!accounts.data?.length && <p className="muted">No bank accounts yet.</p>}
        </div>
      </section>
    </div>
  );
}
