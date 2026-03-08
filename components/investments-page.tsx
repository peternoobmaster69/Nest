"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { SkeletonCard, SkeletonMiniCard, EmptyState } from "@/components/ui-skeleton";

type AppContext = {
  workspaceId: string | null;
  baseCurrency?: string | null;
};

type InvestmentEntry = {
  id: string;
  date: string;
  investedCents: number;
  currentValueCents: number;
  createdAt: string;
};

type InvestmentAccount = {
  id: string;
  displayName?: string | null;
  institutionName: string;
  productName: string;
  inceptionDate: string;
  divestedDate?: string | null;
  entries: InvestmentEntry[];
};

type TimeRange = "90D" | "180D" | "1Y" | "ALL";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    try {
      const payload = await res.json();
      throw new Error(payload?.message || payload?.error || `Request failed (${res.status})`);
    } catch {
      throw new Error(`Request failed (${res.status})`);
    }
  }
  return res.json();
}

function toIsoFromDateInput(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function dateInputFromIso(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function InvestmentsPage() {
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("ALL");
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [accountError, setAccountError] = useState("");
  const [entryError, setEntryError] = useState("");

  const [accountModalMode, setAccountModalMode] = useState<"create" | "edit">("create");
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [productName, setProductName] = useState("");
  const [inceptionDate, setInceptionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [divestedDate, setDivestedDate] = useState("");

  const [entryModalMode, setEntryModalMode] = useState<"create" | "edit">("create");
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newFunds, setNewFunds] = useState("0");
  const [entryInvested, setEntryInvested] = useState("0");
  const [entryCurrentValue, setEntryCurrentValue] = useState("0");

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const formatCents = (value: number) => formatMoney(value, baseCurrency);

  const accounts = useQuery({
    queryKey: ["investments", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => fetchJson<InvestmentAccount[]>(`/api/investments?workspaceId=${workspaceId}`),
  });
  const { isLoading: accountsLoading, isError: accountsError, refetch } = accounts;

  useEffect(() => {
    if (!accounts.data?.length) {
      setSelectedAccountId(null);
      return;
    }
    if (!selectedAccountId || !accounts.data.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(accounts.data[0].id);
    }
  }, [accounts.data, selectedAccountId]);

  const selectedAccount = useMemo(
    () => (accounts.data ?? []).find((a) => a.id === selectedAccountId) ?? null,
    [accounts.data, selectedAccountId],
  );

  // Combined entries from all accounts for the "All Accounts" view
  const allAccountsEntries = useMemo(() => {
    const allEntries: InvestmentEntry[] = [];
    for (const account of accounts.data ?? []) {
      for (const entry of account.entries ?? []) {
        allEntries.push({
          ...entry,
          // Tag entry with account info for display
          accountName: account.displayName || account.productName,
          accountId: account.id,
        } as InvestmentEntry & { accountName: string; accountId: string });
      }
    }
    return allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [accounts.data]);

  const selectedEntries = useMemo(
    () =>
      [...(selectedAccount?.entries ?? [])].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      ),
    [selectedAccount?.entries],
  );

  const latestSelectedEntry = selectedEntries[selectedEntries.length - 1] ?? null;
  const totalInvestedAcrossAll = useMemo(() => {
    let total = 0;
    for (const account of accounts.data ?? []) {
      const latest = [...(account.entries ?? [])]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .at(-1);
      total += latest?.investedCents ?? 0;
    }
    return total;
  }, [accounts.data]);
  const totalCurrentAcrossAll = useMemo(() => {
    let total = 0;
    for (const account of accounts.data ?? []) {
      const latest = [...(account.entries ?? [])]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .at(-1);
      total += latest?.currentValueCents ?? 0;
    }
    return total;
  }, [accounts.data]);

  const createAccount = useMutation({
    mutationFn: () =>
      fetchJson<InvestmentAccount>("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          displayName,
          institutionName,
          productName,
          inceptionDate: toIsoFromDateInput(inceptionDate),
          divestedDate: divestedDate ? toIsoFromDateInput(divestedDate) : null,
        }),
      }),
    onSuccess: (created) => {
      setAccountError("");
      queryClient.invalidateQueries({ queryKey: ["investments", workspaceId] });
      setSelectedAccountId(created.id);
      closeAccountModal();
    },
    onError: (error) => {
      setAccountError(error instanceof Error ? error.message : "Failed to create investment account.");
    },
  });

  const updateAccount = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/investments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          institutionName,
          productName,
          inceptionDate: toIsoFromDateInput(inceptionDate),
          divestedDate: divestedDate ? toIsoFromDateInput(divestedDate) : null,
        }),
      }),
    onSuccess: () => {
      setAccountError("");
      queryClient.invalidateQueries({ queryKey: ["investments", workspaceId] });
      closeAccountModal();
    },
    onError: (error) => {
      setAccountError(error instanceof Error ? error.message : "Failed to update investment account.");
    },
  });

  const deleteAccount = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/investments/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, deletedId) => {
      setAccountError("");
      queryClient.invalidateQueries({ queryKey: ["investments", workspaceId] });
      if (selectedAccountId === deletedId) {
        setSelectedAccountId(null);
      }
      closeAccountModal();
    },
    onError: (error) => {
      setAccountError(error instanceof Error ? error.message : "Failed to delete investment account.");
    },
  });

  const createEntry = useMutation({
    mutationFn: (accountId: string) =>
      fetchJson(`/api/investments/${accountId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: toIsoFromDateInput(entryDate),
          investedCents: Math.round(Number(entryInvested || "0") * 100),
          currentValueCents: Math.round(Number(entryCurrentValue || "0") * 100),
        }),
      }),
    onSuccess: () => {
      setEntryError("");
      queryClient.invalidateQueries({ queryKey: ["investments", workspaceId] });
      closeEntryModal();
    },
    onError: (error) => {
      setEntryError(error instanceof Error ? error.message : "Failed to add entry.");
    },
  });

  const updateEntry = useMutation({
    mutationFn: (entryId: string) =>
      fetchJson(`/api/investments/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: toIsoFromDateInput(entryDate),
          investedCents: Math.round(Number(entryInvested || "0") * 100),
          currentValueCents: Math.round(Number(entryCurrentValue || "0") * 100),
        }),
      }),
    onSuccess: () => {
      setEntryError("");
      queryClient.invalidateQueries({ queryKey: ["investments", workspaceId] });
      closeEntryModal();
    },
    onError: (error) => {
      setEntryError(error instanceof Error ? error.message : "Failed to update entry.");
    },
  });

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) =>
      fetchJson(`/api/investments/entries/${entryId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setEntryError("");
      queryClient.invalidateQueries({ queryKey: ["investments", workspaceId] });
      closeEntryModal();
    },
    onError: (error) => {
      setEntryError(error instanceof Error ? error.message : "Failed to delete entry.");
    },
  });

  const openCreateAccountModal = () => {
    setAccountModalMode("create");
    setEditingAccountId(null);
    setDisplayName("");
    setInstitutionName("");
    setProductName("");
    setInceptionDate(new Date().toISOString().slice(0, 10));
    setDivestedDate("");
    setAccountModalOpen(true);
    setAccountError("");
  };

  const openEditAccountModal = (account: InvestmentAccount) => {
    setAccountModalMode("edit");
    setEditingAccountId(account.id);
    setDisplayName(account.displayName || "");
    setInstitutionName(account.institutionName);
    setProductName(account.productName);
    setInceptionDate(dateInputFromIso(account.inceptionDate));
    setDivestedDate(dateInputFromIso(account.divestedDate));
    setAccountModalOpen(true);
    setAccountError("");
  };

  const closeAccountModal = () => {
    setAccountModalOpen(false);
    setEditingAccountId(null);
  };

  const openCreateEntryModal = () => {
    if (!selectedAccount) return;
    const lastInvested = latestSelectedEntry?.investedCents ?? 0;
    setEntryModalMode("create");
    setEditingEntryId(null);
    setEntryDate(new Date().toISOString().slice(0, 10));
    setNewFunds("0");
    setEntryInvested((lastInvested / 100).toFixed(2));
    setEntryCurrentValue(((latestSelectedEntry?.currentValueCents ?? lastInvested) / 100).toFixed(2));
    setEntryModalOpen(true);
    setEntryError("");
  };

  const openEditEntryModal = (entry: InvestmentEntry) => {
    setEntryModalMode("edit");
    setEditingEntryId(entry.id);
    setEntryDate(dateInputFromIso(entry.date));
    setNewFunds("0");
    setEntryInvested((entry.investedCents / 100).toFixed(2));
    setEntryCurrentValue((entry.currentValueCents / 100).toFixed(2));
    setEntryModalOpen(true);
    setEntryError("");
  };

  const closeEntryModal = () => {
    setEntryModalOpen(false);
    setEditingEntryId(null);
  };

  useEffect(() => {
    if (entryModalMode !== "create") return;
    const base = (latestSelectedEntry?.investedCents ?? 0) / 100;
    const delta = Number(newFunds || "0");
    const nextValue = Number.isFinite(delta) ? base + delta : base;
    setEntryInvested(nextValue.toFixed(2));
  }, [entryModalMode, newFunds, latestSelectedEntry?.investedCents]);

  // Aggregate all accounts data by date
  const aggregatedAllAccountsData = useMemo(() => {
    const entriesByDate = new Map<string, { invested: number; current: number }>();

    for (const account of accounts.data ?? []) {
      for (const entry of account.entries ?? []) {
        const dateKey = entry.date.slice(0, 10); // YYYY-MM-DD
        const existing = entriesByDate.get(dateKey);
        if (existing) {
          existing.invested += entry.investedCents;
          existing.current += entry.currentValueCents;
        } else {
          entriesByDate.set(dateKey, {
            invested: entry.investedCents,
            current: entry.currentValueCents,
          });
        }
      }
    }

    return Array.from(entriesByDate.entries())
      .map(([date, values]) => ({
        id: `all-${date}`,
        date: new Date(date),
        invested: values.invested,
        current: values.current,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [accounts.data]);

  const chartRows = useMemo(() => {
    const list = showAllAccounts
      ? aggregatedAllAccountsData
      : selectedEntries.map((entry) => ({
          id: entry.id,
          date: new Date(entry.date),
          invested: entry.investedCents,
          current: entry.currentValueCents,
        }));
    if (timeRange === "ALL") return list;

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const threshold =
      timeRange === "90D" ? now - 90 * day : timeRange === "180D" ? now - 180 * day : now - 365 * day;
    return list.filter((row) => row.date.getTime() >= threshold);
  }, [selectedEntries, timeRange, showAllAccounts, aggregatedAllAccountsData]);

  const chart = useMemo(() => {
    const width = 1000;
    const height = 300;
    const pad = 36;
    const plotW = width - pad * 2;
    const plotH = height - pad * 2;
    if (!chartRows.length) {
      return {
        width,
        height,
        investedPath: "",
        currentPath: "",
        points: [] as Array<{ id: string; x: number; yInvested: number; yCurrent: number; label: string; invested: number; current: number }>,
      };
    }

    const minTime = chartRows[0].date.getTime();
    const maxTime = chartRows[chartRows.length - 1].date.getTime();
    const low = Math.min(...chartRows.map((r) => Math.min(r.invested, r.current)));
    const high = Math.max(...chartRows.map((r) => Math.max(r.invested, r.current)));
    const spanTime = Math.max(1, maxTime - minTime);
    const spanY = Math.max(1, high - low);

    const points = chartRows.map((row) => {
      const x = pad + ((row.date.getTime() - minTime) / spanTime) * plotW;
      const yInvested = pad + (1 - (row.invested - low) / spanY) * plotH;
      const yCurrent = pad + (1 - (row.current - low) / spanY) * plotH;
      const label = row.date.toLocaleDateString();
      return { id: row.id, x, yInvested, yCurrent, label, invested: row.invested, current: row.current };
    });

    const investedPath = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.yInvested}`).join(" ");
    const currentPath = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.yCurrent}`).join(" ");
    return { width, height, investedPath, currentPath, points };
  }, [chartRows]);

  const hoveredPoint = chart.points.find((point) => point.id === hoveredPointId) ?? null;

  return (
    <div className="inv-page">
      <section className="card inv-topbar" style={{ display: "flex", alignItems: "center" }}>
        {accountsLoading ? (
          <>
            <div style={{ width: "40%" }}><SkeletonMiniCard /></div>
            <div style={{ width: "40%" }}><SkeletonMiniCard /></div>
          </>
        ) : (
          <>
            <div className="inv-top-stat" style={{ width: "40%", textAlign: "left" }}>
              <div className="inv-title">Total Invested</div>
              <div className="inv-top-amount">{formatCents(totalInvestedAcrossAll)}</div>
            </div>
            <div className="inv-top-stat" style={{ width: "40%", textAlign: "right" }}>
              <div className="inv-title">Total Current</div>
              <div className="inv-top-amount">{formatCents(totalCurrentAcrossAll)}</div>
            </div>
          </>
        )}
        <div style={{ width: "20%", display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn btn-primary btn-xs inv-add-btn"
            type="button"
            onClick={openCreateAccountModal}
            disabled={!workspaceId}
            aria-label="Add Investment Account"
            title="Add Investment Account"
          >
            <span className="inv-add-btn-icon">+</span>
          </button>
        </div>
      </section>

      {/* View Toggle */}
      <section className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600 }}>
          {showAllAccounts ? "Viewing: All Accounts" : selectedAccount ? `Viewing: ${selectedAccount.displayName || selectedAccount.productName}` : "Select an account to view details"}
        </div>
        <div className="segmented">
          <button
            type="button"
            className={`segmented-btn ${showAllAccounts ? "on" : ""}`}
            onClick={() => setShowAllAccounts(true)}
          >
            All Accounts
          </button>
          <button
            type="button"
            className={`segmented-btn ${!showAllAccounts ? "on" : ""}`}
            onClick={() => setShowAllAccounts(false)}
            disabled={!selectedAccount}
          >
            Single Account
          </button>
        </div>
      </section>

      <section className="inv-account-grid">
        {accountsLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {accountsError && (
          <div style={{ gridColumn: "1 / -1" }}>
            <EmptyState
              icon="⚠️"
              title="Failed to load investments"
              action={
                <button className="btn btn-primary" onClick={() => refetch()}>
                  Retry
                </button>
              }
            />
          </div>
        )}

        {!accountsLoading && !accountsError && (accounts.data ?? []).length === 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <EmptyState
              icon="📈"
              title="No investment accounts yet"
              description="Add your first investment account to start tracking your portfolio performance."
              action={
                <button className="btn btn-primary" onClick={openCreateAccountModal}>
                  + Add Investment Account
                </button>
              }
            />
          </div>
        )}

        {!accountsLoading && (accounts.data ?? []).map((account) => {
          const entries = [...account.entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          const latest = entries[entries.length - 1] ?? null;
          const selected = account.id === selectedAccountId;
          return (
            <article key={account.id} className={`card inv-account-card ${selected ? "is-selected" : ""}`}>
              <button
                className="inv-edit-icon"
                type="button"
                onClick={() => openEditAccountModal(account)}
                aria-label="Edit investment account"
                title="Edit"
              >
                ✎
              </button>
              <button className="inv-account-select" type="button" onClick={() => { setSelectedAccountId(account.id); setShowAllAccounts(false); }}>
                <div className="inv-account-head">
                  <strong>{account.displayName || account.productName}</strong>
                  <span>{account.productName} · {account.institutionName}</span>
                </div>
                <div className="inv-account-amounts">
                  <div>
                    <small>Invested</small>
                    <p>{formatCents(latest?.investedCents ?? 0)}</p>
                  </div>
                  <div>
                    <small>Current</small>
                    <p>{formatCents(latest?.currentValueCents ?? 0)}</p>
                  </div>
                </div>
              </button>
              <div className="inv-account-actions">
                <button className="btn btn-primary btn-xs" type="button" onClick={() => { setSelectedAccountId(account.id); openCreateEntryModal(); }}>
                  + Add Update
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {/* Chart Section - Show for All Accounts or Selected Account */}
      {(showAllAccounts || selectedAccount) ? (
        <>
          <section className="card inv-chart-card">
            <div className="inv-chart-head">
              <div>
                {showAllAccounts ? (
                  <>
                    <div className="inv-title">All Investment Accounts</div>
                    <div className="inv-subtitle">Combined portfolio performance</div>
                  </>
                ) : (
                  <>
                    <div className="inv-title">{selectedAccount?.displayName || selectedAccount?.productName}</div>
                    <div className="inv-subtitle">{selectedAccount?.productName} · {selectedAccount?.institutionName}</div>
                  </>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div className="inv-range">
                  {(["90D", "180D", "1Y", "ALL"] as TimeRange[]).map((range) => (
                    <button
                      key={range}
                      type="button"
                      className={`inv-range-btn ${timeRange === range ? "on" : ""}`}
                      onClick={() => setTimeRange(range)}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {chart.points.length ? (
              <div className="inv-chart-wrap">
                <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="inv-chart" role="img" aria-label="Investment time series chart">
                  <path d={chart.investedPath} className="inv-line invested" />
                  <path d={chart.currentPath} className="inv-line current" />
                  {chart.points.map((point) => (
                    <g key={point.id}>
                      <circle
                        cx={point.x}
                        cy={point.yInvested}
                        r={hoveredPointId === point.id ? 4 : 3}
                        className="inv-dot invested"
                        onMouseEnter={() => setHoveredPointId(point.id)}
                      />
                      <circle
                        cx={point.x}
                        cy={point.yCurrent}
                        r={hoveredPointId === point.id ? 4 : 3}
                        className="inv-dot current"
                        onMouseEnter={() => setHoveredPointId(point.id)}
                      />
                    </g>
                  ))}
                </svg>
                <div className="inv-chart-legend">
                  <span><i className="inv-legend-dot invested" /> Invested Amount</span>
                  <span><i className="inv-legend-dot current" /> Current Value</span>
                </div>
                {hoveredPoint ? (
                  <div className="inv-tooltip">
                    <strong>{hoveredPoint.label}</strong>
                    <span>Invested: {formatCents(hoveredPoint.invested)}</span>
                    <span>Current: {formatCents(hoveredPoint.current)}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon="📊"
                title="No data points yet"
                description="Add your first fund/value update to start tracking performance over time."
              />
            )}
          </section>

          {/* History section - only show for single account view */}
          {!showAllAccounts && selectedAccount && (
            <section className="card inv-history-card">
              <div className="inv-history-head">
                <div className="inv-title">History</div>
                <button className="btn btn-primary btn-xs" type="button" onClick={openCreateEntryModal}>
                  + Add Entry
                </button>
              </div>
              <div className="inv-history-list">
                {selectedEntries.length ? (
                  selectedEntries
                    .slice()
                    .reverse()
                    .map((entry) => (
                      <div key={entry.id} className="inv-history-row">
                        <div>
                          <strong>{new Date(entry.date).toLocaleDateString()}</strong>
                          <span>Invested: {formatCents(entry.investedCents)}</span>
                          <span>Current: {formatCents(entry.currentValueCents)}</span>
                        </div>
                        <button className="btn btn-ghost btn-xs" type="button" onClick={() => openEditEntryModal(entry)}>
                          Edit
                        </button>
                      </div>
                    ))
                ) : (
                  <EmptyState
                    icon="📋"
                    title="No entries yet"
                    description="Add your first entry to track invested amount and current value."
                  />
                )}
              </div>
            </section>
          )}
        </>
      ) : !accountsLoading && !accountsError ? (
        <EmptyState
          icon="📈"
          title="Select an investment account"
          description="Choose an account from above to view its performance chart and history."
        />
      ) : null}

      {accountModalOpen ? (
        <div className="profile-modal-overlay" onClick={closeAccountModal}>
          <div className="profile-modal inv-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>{accountModalMode === "edit" ? "Edit Investment Account" : "Add Investment Account"}</h3>
              <button className="profile-modal-close" onClick={closeAccountModal}>✕</button>
            </div>
            <form className="profile-modal-body inv-modal-body" onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!workspaceId) {
                setAccountError("Workspace is not ready. Please wait and try again.");
                return;
              }
              if (accountModalMode === "edit" && editingAccountId) {
                updateAccount.mutate(editingAccountId);
                return;
              }
              createAccount.mutate();
            }}>
              <div className="profile-field">
                <span>Display Name of the Account</span>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="profile-field">
                <span>Financial Institution Name</span>
                <input className="input" value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} required />
              </div>
              <div className="profile-field">
                <span>Product Name</span>
                <input className="input" value={productName} onChange={(e) => setProductName(e.target.value)} required />
              </div>
              <div className="profile-field">
                <span>Inception Date</span>
                <input className="input" type="date" value={inceptionDate} onChange={(e) => setInceptionDate(e.target.value)} required />
              </div>
              <div className="profile-field">
                <span>Divested Date (Optional)</span>
                <input className="input" type="date" value={divestedDate} onChange={(e) => setDivestedDate(e.target.value)} />
              </div>
              <div className="profile-actions inv-modal-actions">
                {accountModalMode === "edit" && editingAccountId ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => deleteAccount.mutate(editingAccountId)}
                    disabled={deleteAccount.isPending}
                  >
                    {deleteAccount.isPending ? "Deleting..." : "Delete"}
                  </button>
                ) : <span />}
                <div className="inv-modal-primary-actions">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={closeAccountModal}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-xs" disabled={createAccount.isPending || updateAccount.isPending}>
                    {accountModalMode === "edit" ? (updateAccount.isPending ? "Saving..." : "Save") : (createAccount.isPending ? "Adding..." : "Add")}
                  </button>
                </div>
              </div>
              {accountError ? <div className="profile-error">{accountError}</div> : null}
            </form>
          </div>
        </div>
      ) : null}

      {entryModalOpen ? (
        <div className="profile-modal-overlay" onClick={closeEntryModal}>
          <div className="profile-modal inv-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>{entryModalMode === "edit" ? "Edit Entry" : "Add Funds / Update Value"}</h3>
              <button className="profile-modal-close" onClick={closeEntryModal}>✕</button>
            </div>
            <form className="profile-modal-body inv-modal-body" onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (entryModalMode === "edit" && editingEntryId) {
                updateEntry.mutate(editingEntryId);
                return;
              }
              if (selectedAccountId) {
                createEntry.mutate(selectedAccountId);
              } else {
                setEntryError("Please select an investment account first.");
              }
            }}>
              <div className="profile-field">
                <span>Date</span>
                <input className="input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
              </div>
              {entryModalMode === "create" ? (
                <div className="profile-field">
                  <span>New Funds Added</span>
                  <input className="input" type="number" step="0.01" value={newFunds} onChange={(e) => setNewFunds(e.target.value)} />
                </div>
              ) : null}
              <div className="profile-field">
                <span>Total Invested Amount</span>
                <input className="input" type="number" step="0.01" value={entryInvested} onChange={(e) => setEntryInvested(e.target.value)} required />
              </div>
              <div className="profile-field">
                <span>Current Value</span>
                <input className="input" type="number" step="0.01" value={entryCurrentValue} onChange={(e) => setEntryCurrentValue(e.target.value)} required />
              </div>
              <div className="profile-actions inv-modal-actions">
                {entryModalMode === "edit" && editingEntryId ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => deleteEntry.mutate(editingEntryId)}
                    disabled={deleteEntry.isPending}
                  >
                    {deleteEntry.isPending ? "Deleting..." : "Delete"}
                  </button>
                ) : <span />}
                <div className="inv-modal-primary-actions">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={closeEntryModal}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-xs" disabled={createEntry.isPending || updateEntry.isPending}>
                    {entryModalMode === "edit" ? (updateEntry.isPending ? "Saving..." : "Save") : (createEntry.isPending ? "Adding..." : "Add")}
                  </button>
                </div>
              </div>
              {entryError ? <div className="profile-error">{entryError}</div> : null}
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
