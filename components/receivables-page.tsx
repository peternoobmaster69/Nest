"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";

type AppContext = {
  workspaceId: string | null;
};

type Receivable = {
  id: string;
  amountCents: number;
  date: string;
  transactionDate?: string | null;
  remarkTogether?: string | null;
  status: string;
};

function formatCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
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
  const [receivableDate, setReceivableDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transactionDate, setTransactionDate] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [sortBy, setSortBy] = useState<"amount" | "remarks" | "receivableDate" | "transactionDate">("receivableDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingReceivableDate, setEditingReceivableDate] = useState("");
  const [editingTransactionDate, setEditingTransactionDate] = useState("");
  const [editingAmount, setEditingAmount] = useState("");
  const [editingRemarks, setEditingRemarks] = useState("");
  const [editingStatus, setEditingStatus] = useState<Receivable["status"]>("OPEN");

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId;

  const receivables = useQuery({
    queryKey: ["receivables", workspaceId],
    queryFn: () => fetchJson<Receivable[]>(`/api/receivables?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

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
      setTransactionDate("");
      setAmount("");
      setRemarks("");
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
      setEditingId(null);
      setEditingReceivableDate("");
      setEditingTransactionDate("");
      setEditingAmount("");
      setEditingRemarks("");
      setEditingStatus("OPEN");
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !receivableDate || !amount) return;
    createReceivable.mutate({
      receivableDate: toIsoFromDateInput(receivableDate),
      transactionDate: transactionDate ? toIsoFromDateInput(transactionDate) : undefined,
      amountCents: Math.round(Number(amount) * 100),
      remarks: remarks.trim() || undefined,
    });
  };

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

  const beginEdit = (r: Receivable) => {
    setEditingId(r.id);
    setEditingReceivableDate(new Date(r.date).toISOString().slice(0, 10));
    setEditingTransactionDate(r.transactionDate ? new Date(r.transactionDate).toISOString().slice(0, 10) : "");
    setEditingAmount((r.amountCents / 100).toFixed(2));
    setEditingRemarks(r.remarkTogether || "");
    setEditingStatus(r.status);
  };

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Add Receivable</div>
        <form className="crud-form" style={{ gridTemplateColumns: "150px 150px 140px 1fr auto" }} onSubmit={onSubmit}>
          <input
            className="input"
            type="date"
            value={receivableDate}
            onChange={(e) => setReceivableDate(e.target.value)}
            title="Receivable date"
          />
          <input
            className="input"
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            title="Transaction date"
          />
          <input
            className="input"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <input
            className="input"
            placeholder="Remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={createReceivable.isPending}>
            Add
          </button>
        </form>
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600 }}>
            Receivables ({pendingCount} open)
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, fontFamily: "var(--font-display)" }}>
            {formatCents(totalReceivableCents)}
          </div>
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
          {sortedReceivables.map((r) => (
            <div key={r.id} className="crud-row">
              {editingId === r.id ? (
                <div className="crud-edit" style={{ gridTemplateColumns: "150px 150px 130px 120px 1fr auto auto" }}>
                  <input
                    className="input"
                    type="date"
                    value={editingReceivableDate}
                    onChange={(e) => setEditingReceivableDate(e.target.value)}
                  />
                  <input
                    className="input"
                    type="date"
                    value={editingTransactionDate}
                    onChange={(e) => setEditingTransactionDate(e.target.value)}
                  />
                  <input
                    className="input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={editingAmount}
                    onChange={(e) => setEditingAmount(e.target.value)}
                  />
                  <select
                    className="input"
                    value={editingStatus}
                    onChange={(e) => setEditingStatus(e.target.value as Receivable["status"])}
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="PARTIAL">PARTIAL</option>
                    <option value="PAID">PAID</option>
                    <option value="VOID">VOID</option>
                  </select>
                  <input
                    className="input"
                    placeholder="Remarks"
                    value={editingRemarks}
                    onChange={(e) => setEditingRemarks(e.target.value)}
                  />
                  <button
                    className="btn btn-secondary btn-xs"
                    onClick={() =>
                      updateReceivable.mutate({
                        id: r.id,
                        receivableDate: toIsoFromDateInput(editingReceivableDate),
                        transactionDate: editingTransactionDate ? toIsoFromDateInput(editingTransactionDate) : null,
                        amountCents: Math.round(Number(editingAmount || "0") * 100),
                        remarks: editingRemarks.trim() || undefined,
                        status: editingStatus,
                      })
                    }
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
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
                    <span style={{ fontWeight: 700 }}>{formatCents(r.amountCents)}</span>
                    <button className="btn btn-ghost btn-xs" onClick={() => beginEdit(r)}>
                      Edit
                    </button>
                  </span>
                </>
              )}
            </div>
          ))}
          {!receivables.data?.length && <p className="muted">No receivables yet.</p>}
        </div>
      </section>
    </div>
  );
}
