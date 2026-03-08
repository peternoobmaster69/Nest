"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { FormEvent, useMemo, useState } from "react";
import { SkeletonMiniCard, SkeletonList, EmptyState } from "@/components/ui-skeleton";

type AppContext = {
  workspaceId: string | null;
  baseCurrency?: string | null;
};

type Receivable = {
  id: string;
  amountCents: number;
  date: string;
  transactionDate?: string | null;
  remarkTogether?: string | null;
  status: "OPEN" | "PARTIAL" | "PAID" | "VOID";
};

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

function toIsoFromDateInput(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export function ReceivablesPage() {
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [sortBy, setSortBy] = useState<"amount" | "remarks" | "receivableDate" | "transactionDate">("receivableDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [activeId, setActiveId] = useState<string | null>(null);

  const [formReceivableDate, setFormReceivableDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formTransactionDate, setFormTransactionDate] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formRemarks, setFormRemarks] = useState("");
  const [formStatus, setFormStatus] = useState<Receivable["status"]>("OPEN");

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const formatCents = (value: number) => formatMoney(value, baseCurrency);

  const receivables = useQuery({
    queryKey: ["receivables", workspaceId],
    queryFn: () => fetchJson<Receivable[]>(`/api/receivables?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  const { isLoading, isError, refetch } = receivables;

  const createReceivable = useMutation({
    mutationFn: (payload: { receivableDate: string; transactionDate?: string; amountCents: number; remarks?: string }) =>
      fetchJson("/api/receivables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          amountCents: payload.amountCents,
          receivableDate: payload.receivableDate,
          transactionDate: payload.transactionDate,
          remarks: payload.remarks,
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
      remarks?: string;
      status: Receivable["status"];
    }) =>
      fetchJson(`/api/receivables/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: payload.receivableDate,
          transactionDate: payload.transactionDate,
          amountCents: payload.amountCents,
          remarks: payload.remarks,
          status: payload.status,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receivables", workspaceId] });
      closeModal();
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
      const aa = (a.remarkTogether || "").toLowerCase();
      const bb = (b.remarkTogether || "").toLowerCase();
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
    () => sortedReceivables.filter((r) => new Date(r.date).getMonth() + 1 === selectedMonth),
    [sortedReceivables, selectedMonth],
  );

  const monthLabels = useMemo(
    () => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    [],
  );

  const resetForm = () => {
    setFormReceivableDate(new Date().toISOString().slice(0, 10));
    setFormTransactionDate("");
    setFormAmount("");
    setFormRemarks("");
    setFormStatus("OPEN");
    setActiveId(null);
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
    setFormReceivableDate(new Date(r.date).toISOString().slice(0, 10));
    setFormTransactionDate(r.transactionDate ? new Date(r.transactionDate).toISOString().slice(0, 10) : "");
    setFormAmount((r.amountCents / 100).toFixed(2));
    setFormRemarks(r.remarkTogether || "");
    setFormStatus(r.status);
    setIsModalOpen(true);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !formReceivableDate || !formAmount) return;

    if (modalMode === "edit" && activeId) {
      updateReceivable.mutate({
        id: activeId,
        receivableDate: toIsoFromDateInput(formReceivableDate),
        transactionDate: formTransactionDate ? toIsoFromDateInput(formTransactionDate) : null,
        amountCents: Math.round(Number(formAmount || "0") * 100),
        remarks: formRemarks.trim() || undefined,
        status: formStatus,
      });
      return;
    }

    createReceivable.mutate({
      receivableDate: toIsoFromDateInput(formReceivableDate),
      transactionDate: formTransactionDate ? toIsoFromDateInput(formTransactionDate) : undefined,
      amountCents: Math.round(Number(formAmount) * 100),
      remarks: formRemarks.trim() || undefined,
    });
  };

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <section className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "13px", fontWeight: 600 }}>Receivables</div>
        <button className="btn btn-primary" type="button" onClick={openCreateModal} title="Add receivable" aria-label="Add receivable">
          +
        </button>
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600 }}>Receivables ({pendingCount} open)</div>
          {isLoading ? (
            <SkeletonMiniCard />
          ) : (
            <div className={getAmountToneClass(totalReceivableCents)} style={{ fontSize: "20px", fontWeight: 700, fontFamily: "var(--font-display)" }}>
              {formatCents(totalReceivableCents)}
            </div>
          )}
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
                onClick={() => setSelectedMonth(month)}
                type="button"
              >
                <span className="recv-month-chip-label">{label}</span>
                <span className="recv-month-chip-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          <select
            className="input"
            style={{ maxWidth: "190px" }}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "amount" | "remarks" | "receivableDate" | "transactionDate")}
          >
            <option value="amount">Sort: Amount</option>
            <option value="remarks">Sort: Remarks</option>
            <option value="receivableDate">Sort: Receivable Date</option>
            <option value="transactionDate">Sort: Transaction Date</option>
          </select>
          <select className="input" style={{ maxWidth: "140px" }} value={sortDir} onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}>
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
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
                  {r.remarkTogether || "No remarks"}
                </span>
                <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>
                  Receivable: {new Date(r.date).toLocaleDateString()} · Transaction:{" "}
                  {r.transactionDate ? new Date(r.transactionDate).toLocaleDateString() : "—"} · Status: {r.status}
                </span>
              </span>
              <span style={{ display: "inline-flex", gap: "10px", alignItems: "center", flexShrink: 0 }}>
                <span className={getAmountToneClass(r.amountCents)} style={{ fontWeight: 700 }}>
                  {formatCents(r.amountCents)}
                </span>
                <button className="btn btn-ghost btn-xs" onClick={() => openEditModal(r)}>
                  Edit
                </button>
              </span>
            </div>
          ))}
          {!isLoading && !isError && monthFilteredReceivables.length === 0 && (
            <EmptyState
              icon="📥"
              title="No receivables for this month"
              description="Add a receivable to track money owed to you and expected payment dates."
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
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>{modalMode === "edit" ? "Edit Receivable" : "Add Receivable"}</h3>
              <button className="profile-modal-close" onClick={closeModal}>
                Close
              </button>
            </div>
            <div className="profile-modal-body" style={{ display: "grid", gap: "12px" }}>
              <form style={{ display: "grid", gap: "10px" }} onSubmit={onSubmit}>
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
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Remarks
                  <input className="input" placeholder="Remarks" value={formRemarks} onChange={(e) => setFormRemarks(e.target.value)} />
                </label>
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
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
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
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
