"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { MarkdownEditor } from "@/components/markdown-editor";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { SkeletonMiniCard, SkeletonList, EmptyState } from "@/components/ui-skeleton";

type AppContext = {
  workspaceId: string | null;
  defaultAccountId: string | null;
  defaultBudgetId: string | null;
  baseCurrency?: string | null;
  workspaces: Array<{ id: string; name: string }>;
};

type DeductionAccount = {
  id: string;
  name: string;
  workspaceId: string;
  workspace: {
    id: string;
    name: string;
  };
};

type Receivable = {
  id: string;
  title: string;
  amountCents: number;
  date: string;
  transactionDate?: string | null;
  remarkTogether?: string | null;
  notes?: string | null;
  status: "OPEN" | "PARTIAL" | "PAID" | "VOID";
  accountId?: string | null;
  budgetId?: string | null;
  account?: DeductionAccount | null;
};

type BankAccount = {
  id: string;
  name: string;
  isActive: boolean;
};

type DeductionBudget = {
  id: string;
  name: string;
  accountId: string;
  isActive: boolean;
};

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

function toIsoFromDateInput(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function toDateInputFromIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayDateInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    try {
      const payload = await res.json();
      const detail = payload?.message || payload?.error || JSON.stringify(payload) || `Request failed (${res.status})`;
      throw new Error(detail);
    } catch (e) {
      if (e instanceof Error && e.message !== `Request failed (${res.status})`) {
        throw e;
      }
      throw new Error(`Request failed (${res.status})`);
    }
  }
  return res.json();
}

export function ReceivablesPage() {
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [sortBy, setSortBy] = useState<"amount" | "title" | "receivableDate" | "transactionDate">("receivableDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hideClosed, setHideClosed] = useState(true);
  const [closeError, setCloseError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [activeId, setActiveId] = useState<string | null>(null);

  const [formReceivableDate, setFormReceivableDate] = useState(todayDateInputValue);
  const [formTransactionDate, setFormTransactionDate] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formStatus, setFormStatus] = useState<Receivable["status"]>("OPEN");
  const [formUseCrossWorkspaceDeduction, setFormUseCrossWorkspaceDeduction] = useState(false);
  const [formDeductWorkspaceId, setFormDeductWorkspaceId] = useState("");
  const [formDeductAccountId, setFormDeductAccountId] = useState("");
  const [formDeductBudgetId, setFormDeductBudgetId] = useState("");

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const receivableDefaultAccountId = context.data?.defaultAccountId ?? null;
  const receivableDefaultBudgetId = context.data?.defaultBudgetId ?? null;
  const formatCents = (value: number) => formatMoney(value, baseCurrency);

  const receivables = useQuery({
    queryKey: ["receivables", workspaceId],
    queryFn: () => fetchJson<Receivable[]>(`/api/receivables?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const deductionAccounts = useQuery({
    queryKey: ["bank-accounts", formDeductWorkspaceId],
    queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${formDeductWorkspaceId}`),
    enabled: formUseCrossWorkspaceDeduction && Boolean(formDeductWorkspaceId),
  });

  const deductionBudgets = useQuery({
    queryKey: ["budgets", formDeductWorkspaceId],
    queryFn: () => fetchJson<DeductionBudget[]>(`/api/budgets?workspaceId=${formDeductWorkspaceId}`),
    enabled: formUseCrossWorkspaceDeduction && Boolean(formDeductWorkspaceId),
  });

  const deductionAccountNames = useMemo(
    () => new Map((deductionAccounts.data ?? []).map((account) => [account.id, account.name])),
    [deductionAccounts.data],
  );

  const deductionBudgetById = useMemo(
    () => new Map((deductionBudgets.data ?? []).map((budget) => [budget.id, budget])),
    [deductionBudgets.data],
  );

  useEffect(() => {
    if (!formUseCrossWorkspaceDeduction) return;
    if (formDeductBudgetId) return;
    if (!formDeductAccountId) return;
    const firstMatchingBudget = (deductionBudgets.data ?? []).find(
      (budget) => budget.isActive && budget.accountId === formDeductAccountId,
    );
    if (firstMatchingBudget) {
      setFormDeductBudgetId(firstMatchingBudget.id);
    }
  }, [
    formUseCrossWorkspaceDeduction,
    formDeductBudgetId,
    formDeductAccountId,
    deductionBudgets.data,
  ]);

  const { isLoading, isError, refetch } = receivables;

  const createReceivable = useMutation({
    mutationFn: (payload: {
      title: string;
      receivableDate: string;
      transactionDate?: string;
      amountCents: number;
      notes?: string;
      accountId?: string;
      budgetId?: string;
    }) =>
      fetchJson("/api/receivables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          amountCents: payload.amountCents,
          title: payload.title,
          receivableDate: payload.receivableDate,
          transactionDate: payload.transactionDate,
          notes: payload.notes,
          accountId: payload.accountId,
          budgetId: payload.budgetId,
          status: "OPEN",
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receivables", workspaceId] });
      closeModal();
    },
  });

  const updateReceivable = useMutation({
    mutationFn: (payload: {
      id: string;
      receivableDate: string;
      transactionDate?: string | null;
      amountCents: number;
      title: string;
      notes?: string | null;
      status: Receivable["status"];
      accountId?: string | null;
      budgetId?: string | null;
    }) =>
      fetchJson(`/api/receivables/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: payload.receivableDate,
          transactionDate: payload.transactionDate,
          amountCents: payload.amountCents,
          title: payload.title,
          notes: payload.notes,
          status: payload.status,
          accountId: payload.accountId,
          budgetId: payload.budgetId,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receivables", workspaceId] });
      closeModal();
    },
  });

  const closeReceivable = useMutation({
    mutationFn: (payload: { id: string }) =>
      fetchJson(`/api/receivables/${payload.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      setCloseError(null);
      queryClient.invalidateQueries({ queryKey: ["receivables", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: (error) => {
      setCloseError((error as Error)?.message || "Failed to close receivable");
    },
  });

  const deleteReceivable = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/receivables/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receivables", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const pendingCount = useMemo(
    () => (receivables.data ?? []).filter((r) => r.status === "OPEN").length,
    [receivables.data],
  );

  const totalReceivableCents = useMemo(
    () => (receivables.data ?? []).reduce((sum, r) => sum + r.amountCents, 0),
    [receivables.data],
  );

  const sortedReceivables = useMemo(() => {
    const list = [...(receivables.data ?? [])];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortBy === "amount") {
        return (a.amountCents - b.amountCents) * dir;
      }
      if (sortBy === "receivableDate") {
        return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dir;
      }
      if (sortBy === "transactionDate") {
        const ta = a.transactionDate ? new Date(a.transactionDate).getTime() : Number.NEGATIVE_INFINITY;
        const tb = b.transactionDate ? new Date(b.transactionDate).getTime() : Number.NEGATIVE_INFINITY;
        return (ta - tb) * dir;
      }
      const aa = (a.title || "").toLowerCase();
      const bb = (b.title || "").toLowerCase();
      return aa.localeCompare(bb) * dir;
    });
    return list;
  }, [receivables.data, sortBy, sortDir]);

  const monthlyCounts = useMemo(() => {
    const counts = Array.from({ length: 12 }, () => 0);
    for (const item of receivables.data ?? []) {
      const month = new Date(item.date).getMonth();
      counts[month] += 1;
    }
    return counts;
  }, [receivables.data]);

  const monthFilteredReceivables = useMemo(
    () => sortedReceivables.filter((r) => {
      const monthMatch = new Date(r.date).getMonth() + 1 === selectedMonth;
      const statusMatch = !hideClosed || (r.status !== "PAID" && r.status !== "VOID");
      return monthMatch && statusMatch;
    }),
    [sortedReceivables, selectedMonth, hideClosed],
  );

  const monthLabels = useMemo(
    () => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    [],
  );

  const workspacesForDeduction = useMemo(
    () => (context.data?.workspaces ?? []).filter((w) => w.id !== workspaceId),
    [context.data?.workspaces, workspaceId],
  );

  const resetForm = () => {
    setFormReceivableDate(todayDateInputValue());
    setFormTransactionDate("");
    setFormAmount("");
    setFormTitle("");
    setFormNotes("");
    setFormStatus("OPEN");
    setActiveId(null);
    setFormUseCrossWorkspaceDeduction(false);
    setFormDeductWorkspaceId("");
    setFormDeductAccountId("");
    setFormDeductBudgetId("");
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalMode("create");
    resetForm();
  };

  const openCreateModal = () => {
    setModalMode("create");
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (r: Receivable) => {
    setModalMode("edit");
    setActiveId(r.id);
    setFormReceivableDate(toDateInputFromIso(r.date));
    setFormTransactionDate(r.transactionDate ? toDateInputFromIso(r.transactionDate) : "");
    setFormAmount((r.amountCents / 100).toFixed(2));
    setFormTitle(r.title || "");
    setFormNotes(r.notes || "");
    setFormStatus(r.status);
    setFormUseCrossWorkspaceDeduction(Boolean(r.accountId));
    setFormDeductWorkspaceId(r.account?.workspaceId || "");
    setFormDeductAccountId(r.accountId || "");
    setFormDeductBudgetId(r.budgetId || "");
    setIsModalOpen(true);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !formReceivableDate || !formAmount) return;

    const accountId = formUseCrossWorkspaceDeduction ? formDeductAccountId || undefined : undefined;
    const budgetId = formUseCrossWorkspaceDeduction ? formDeductBudgetId || undefined : undefined;
    if (formUseCrossWorkspaceDeduction && !accountId) return;

    if (modalMode === "edit" && activeId) {
      updateReceivable.mutate({
        id: activeId,
        receivableDate: toIsoFromDateInput(formReceivableDate),
        transactionDate: formTransactionDate ? toIsoFromDateInput(formTransactionDate) : null,
        amountCents: Math.round(Number(formAmount || "0") * 100),
        title: formTitle.trim() || "Receivable",
        notes: formNotes.trim() || null,
        status: formStatus,
        accountId: formUseCrossWorkspaceDeduction ? accountId : null,
        budgetId: formUseCrossWorkspaceDeduction ? budgetId : null,
      });
      return;
    }

    createReceivable.mutate({
      title: formTitle.trim() || "Receivable",
      receivableDate: toIsoFromDateInput(formReceivableDate),
      transactionDate: formTransactionDate ? toIsoFromDateInput(formTransactionDate) : undefined,
      amountCents: Math.round(Number(formAmount) * 100),
      notes: formNotes.trim() || undefined,
      accountId,
      budgetId,
    });
  };

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
          {isLoading ? (
            <SkeletonMiniCard />
          ) : (
            <div className={getAmountToneClass(totalReceivableCents)} style={{ fontSize: "20px", fontWeight: 700, fontFamily: "var(--font-display)" }}>
              {formatCents(totalReceivableCents)}
            </div>
          )}
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            {pendingCount} open
          </div>
        </div>
        <div className="recv-month-grid">
          {monthLabels.map((label, index) => {
            const month = index + 1;
            const count = monthlyCounts[index] ?? 0;
            const isActive = selectedMonth === month;
            const stateClass = count === 0 ? "is-empty" : "is-has-items";

            return (
              <button
                key={label}
                className={`recv-month-chip ${stateClass} ${isActive ? "is-active" : ""}`}
                onClick={() => {
                  setSelectedMonth(month);
                  setCloseError(null);
                }}
                type="button"
              >
                <span className="recv-month-chip-label">{label}</span>
                <span className="recv-month-chip-count">{count}</span>
              </button>
            );
          })}
        </div>
        {closeError && (
          <div style={{ marginBottom: "12px", padding: "12px 16px", background: "var(--danger-bg, #fee2e2)", border: "1px solid var(--danger, #ef4444)", borderRadius: "var(--r-md, 8px)", color: "var(--danger, #dc2626)", fontSize: "13px" }}>
            <strong>Cannot close receivable:</strong> {closeError}
            <button
              onClick={() => setCloseError(null)}
              style={{ marginLeft: "12px", background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "inherit" }}
            >
              ✕
            </button>
          </div>
        )}
        <div className="recv-toolbar">
          <select
            className="input"
            style={{ maxWidth: "190px" }}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "amount" | "title" | "receivableDate" | "transactionDate")}
          >
            <option value="amount">Sort: Amount</option>
            <option value="title">Sort: Title</option>
            <option value="receivableDate">Sort: Receivable Date</option>
            <option value="transactionDate">Sort: Transaction Date</option>
          </select>
          <select className="input" style={{ maxWidth: "140px" }} value={sortDir} onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}>
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={hideClosed}
              onChange={(e) => setHideClosed(e.target.checked)}
            />
            Hide closed
          </label>
          <button className="btn btn-primary recv-add-btn" type="button" onClick={openCreateModal} title="Add receivable" aria-label="Add receivable">
            Add Receivable
          </button>
        </div>
        <div className="simple-list">
          {isLoading && <SkeletonList count={4} type="transaction" />}

          {isError && (
            <EmptyState
              icon="⚠️"
              title="Failed to load receivables"
              action={
                <button className="btn btn-primary" onClick={() => refetch()}>
                  Retry
                </button>
              }
            />
          )}

          {!isLoading && !isError && monthFilteredReceivables.map((r) => (
            <div key={r.id} className="crud-row">
              <span style={{ display: "grid", gap: "4px", minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    lineHeight: 1.25,
                    color: "var(--text-primary)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.title || "Untitled"}
                </span>
                <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>
                  Receivable: {new Date(r.date).toLocaleDateString()} · Transaction:{" "}
                  {r.transactionDate ? new Date(r.transactionDate).toLocaleDateString() : "—"} · Status: {r.status}
                  {r.account ? ` · Deduct from: ${r.account.workspace.name} / ${r.account.name}` : ""}
                </span>
                {r.notes ? (
                  <span style={{ color: "var(--text-secondary)", fontSize: "11px", whiteSpace: "pre-wrap" }}>
                    {r.notes}
                  </span>
                ) : null}
              </span>
              <span style={{ display: "inline-flex", gap: "10px", alignItems: "center", flexShrink: 0 }}>
                <span className={getAmountToneClass(r.amountCents)} style={{ fontWeight: 700 }}>
                  {formatCents(r.amountCents)}
                </span>
                {r.status !== "PAID" && (
                  <button
                    className="btn btn-primary btn-xs"
                    onClick={() => closeReceivable.mutate({ id: r.id })}
                    disabled={closeReceivable.isPending || !receivableDefaultAccountId || !receivableDefaultBudgetId}
                    title={
                      receivableDefaultAccountId && receivableDefaultBudgetId
                        ? "Close receivable"
                        : "Configure default receivable account and subaccount in Settings"
                    }
                  >
                    {closeReceivable.isPending ? "Closing..." : "Close"}
                  </button>
                )}
                <button className="btn btn-ghost btn-xs" onClick={() => openEditModal(r)}>
                  Edit
                </button>
                <button
                  className="btn btn-danger btn-xs"
                  onClick={() => {
                    if (confirm("Are you sure you want to delete this receivable?")) {
                      deleteReceivable.mutate(r.id);
                    }
                  }}
                  disabled={deleteReceivable.isPending}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
          {!isLoading && !isError && monthFilteredReceivables.length === 0 && (
            <EmptyState
              icon="📥"
              title={hideClosed ? "No open receivables for this month" : "No receivables for this month"}
              description={hideClosed ? "All receivables are closed. Uncheck 'Hide closed' to see them." : "Add a receivable to track money owed to you and expected payment dates."}
              action={
                <button className="btn btn-primary" onClick={openCreateModal}>
                  + Add Receivable
                </button>
              }
            />
          )}
        </div>
      </section>

      {isModalOpen && (
        <div className="profile-modal-overlay" onClick={closeModal}>
          <div className="profile-modal recv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>{modalMode === "edit" ? "Edit Receivable" : "Add Receivable"}</h3>
              <button className="profile-modal-close" onClick={closeModal}>
                Close
              </button>
            </div>
            <div className="profile-modal-body recv-modal-body">
              <form className="recv-modal-form" onSubmit={onSubmit}>
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Title
                  <input className="input" placeholder="Title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Receivable Date
                  <input className="input" type="date" value={formReceivableDate} onChange={(e) => setFormReceivableDate(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Transaction Date
                  <input className="input" type="date" value={formTransactionDate} onChange={(e) => setFormTransactionDate(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Amount
                  <input
                    className="input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                  />
                </label>
                <MarkdownEditor
                  className="modal-grid-span-2"
                  label="Notes"
                  value={formNotes}
                  onChange={setFormNotes}
                  placeholder="Write notes in Markdown"
                  rows={12}
                  minHeight={280}
                />
                <label className="modal-grid-span-2" style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  <input
                    type="checkbox"
                    checked={formUseCrossWorkspaceDeduction}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setFormUseCrossWorkspaceDeduction(checked);
                      if (!checked) {
                        setFormDeductWorkspaceId("");
                        setFormDeductAccountId("");
                      }
                    }}
                  />
                  Deduct from another workspace
                </label>
                {formUseCrossWorkspaceDeduction && (
                  <>
                    <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                      Deduction Workspace
                      <select
                        className="input"
                        value={formDeductWorkspaceId}
                      onChange={(e) => {
                        setFormDeductWorkspaceId(e.target.value);
                        setFormDeductAccountId("");
                        setFormDeductBudgetId("");
                      }}
                      >
                        <option value="">Select workspace</option>
                        {workspacesForDeduction.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                      Deduction Sub Account
                      <select
                        className="input"
                        value={formDeductBudgetId}
                        onChange={(e) => {
                          const budgetId = e.target.value;
                          setFormDeductBudgetId(budgetId);
                          const selectedBudget = deductionBudgetById.get(budgetId);
                          setFormDeductAccountId(selectedBudget?.accountId ?? "");
                        }}
                        disabled={
                          !formDeductWorkspaceId ||
                          deductionBudgets.isLoading ||
                          deductionAccounts.isLoading ||
                          (deductionBudgets.data ?? []).length === 0
                        }
                      >
                        <option value="">Select subaccount</option>
                        {(deductionBudgets.data ?? [])
                          .filter((budget) => budget.isActive)
                          .map((budget) => (
                            <option key={budget.id} value={budget.id}>
                              {budget.name}
                              {deductionAccountNames.get(budget.accountId) ? ` · ${deductionAccountNames.get(budget.accountId)}` : ""}
                            </option>
                          ))}
                      </select>
                    </label>
                  </>
                )}
                {modalMode === "edit" && (
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Status
                    <select className="input" value={formStatus} onChange={(e) => setFormStatus(e.target.value as Receivable["status"])}>
                      <option value="OPEN">OPEN</option>
                      <option value="PARTIAL">PARTIAL</option>
                      <option value="PAID">PAID</option>
                      <option value="VOID">VOID</option>
                    </select>
                  </label>
                )}
                <div className="modal-grid-span-2" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                  <button className="btn btn-ghost" type="button" onClick={closeModal}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={createReceivable.isPending || updateReceivable.isPending}
                  >
                    {modalMode === "edit" ? "Save" : "Add"}
                  </button>
                </div>
                {(createReceivable.isError || updateReceivable.isError || closeReceivable.isError || deleteReceivable.isError) && (
                  <div className="modal-grid-span-2" style={{ fontSize: "12px", color: "var(--danger)" }}>
                    {((createReceivable.error || updateReceivable.error || closeReceivable.error || deleteReceivable.error) as Error)?.message || "Action failed"}
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
