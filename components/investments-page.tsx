"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { SkeletonCard, SkeletonMiniCard, EmptyState } from "@/components/ui-skeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";

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

function isWithinLastDay(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp < 24 * 60 * 60 * 1000;
}

function formatInceptionBadge(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = String(date.getFullYear());
  return `Since ${year}`;
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const controlX = current.x + (next.x - current.x) / 2;
    path += ` C ${controlX} ${current.y}, ${controlX} ${next.y}, ${next.x} ${next.y}`;
  }
  return path;
}

function buildAreaPath(points: Array<{ x: number; y: number }>, baselineY: number) {
  if (!points.length) return "";
  const linePath = buildSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
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
  const [entryAccountId, setEntryAccountId] = useState<string | null>(null);
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
  const entryAccount = useMemo(
    () => (accounts.data ?? []).find((a) => a.id === entryAccountId) ?? null,
    [accounts.data, entryAccountId],
  );
  const latestEntryAccountEntry = useMemo(() => {
    const entries = [...(entryAccount?.entries ?? [])].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    return entries[entries.length - 1] ?? null;
  }, [entryAccount?.entries]);

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

  // Calculate gain/loss and return
  const totalGainCents = totalCurrentAcrossAll - totalInvestedAcrossAll;
  const returnPercentage = totalInvestedAcrossAll > 0
    ? (totalGainCents / totalInvestedAcrossAll) * 100
    : 0;
  const isProfit = totalGainCents >= 0;

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

  const openCreateEntryModal = (account: InvestmentAccount) => {
    const accountEntries = [...account.entries].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const latestAccountEntry = accountEntries[accountEntries.length - 1] ?? null;
    const lastInvested = latestAccountEntry?.investedCents ?? 0;
    setEntryModalMode("create");
    setEntryAccountId(account.id);
    setEditingEntryId(null);
    setEntryDate(new Date().toISOString().slice(0, 10));
    setNewFunds("0");
    setEntryInvested((lastInvested / 100).toFixed(2));
    setEntryCurrentValue(((latestAccountEntry?.currentValueCents ?? lastInvested) / 100).toFixed(2));
    setEntryModalOpen(true);
    setEntryError("");
  };

  const openEditEntryModal = (entry: InvestmentEntry) => {
    setEntryModalMode("edit");
    setEntryAccountId(selectedAccountId);
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
    setEntryAccountId(null);
    setEditingEntryId(null);
  };

  const confirmDeleteAccount = (accountId: string) => {
    if (!confirmDestructiveAction("Delete this investment account and its history?")) return;
    deleteAccount.mutate(accountId);
  };

  const confirmDeleteEntry = (entryId: string) => {
    if (!confirmDestructiveAction("Delete this investment entry?")) return;
    deleteEntry.mutate(entryId);
  };

  useEffect(() => {
    if (entryModalMode !== "create") return;
    const base = (latestEntryAccountEntry?.investedCents ?? 0) / 100;
    const delta = Number(newFunds || "0");
    const nextValue = Number.isFinite(delta) ? base + delta : base;
    setEntryInvested(nextValue.toFixed(2));
  }, [entryModalMode, newFunds, latestEntryAccountEntry?.investedCents]);

  // Aggregate all accounts data by date with forward-fill for continuous chart
  const aggregatedAllAccountsData = useMemo(() => {
    // Collect all entries from all accounts with running totals per account
    const allDates = new Set<string>();
    const accountEntries = new Map<string, Array<{ date: string; invested: number; current: number }>>();

    for (const account of accounts.data ?? []) {
      const entries = (account.entries ?? [])
        .map((e) => ({
          date: e.date.slice(0, 10),
          invested: e.investedCents,
          current: e.currentValueCents,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      if (entries.length > 0) {
        accountEntries.set(account.id, entries);
        entries.forEach((e) => allDates.add(e.date));
      }
    }

    if (allDates.size === 0) return [];

    // Sort all unique dates
    const sortedDates = Array.from(allDates).sort();

    // For each date, sum up the latest known values from each account
    return sortedDates.map((dateKey) => {
      let totalInvested = 0;
      let totalCurrent = 0;

      for (const [, entries] of accountEntries) {
        // Find the latest entry for this account up to this date
        const latestEntry = entries
          .filter((e) => e.date <= dateKey)
          .pop();
        if (latestEntry) {
          totalInvested += latestEntry.invested;
          totalCurrent += latestEntry.current;
        }
      }

      return {
        id: `all-${dateKey}`,
        date: new Date(dateKey),
        invested: totalInvested,
        current: totalCurrent,
      };
    });
  }, [accounts.data]);

  // eslint-disable-next-line react-hooks/purity
  const currentTimestamp = Date.now();

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

    const now = currentTimestamp;
    const day = 24 * 60 * 60 * 1000;
    const threshold =
      timeRange === "90D" ? now - 90 * day : timeRange === "180D" ? now - 180 * day : now - 365 * day;
    return list.filter((row) => row.date.getTime() >= threshold);
  }, [selectedEntries, timeRange, showAllAccounts, aggregatedAllAccountsData, currentTimestamp]);

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
        baselineY: height - pad,
        investedPath: "",
        currentPath: "",
        currentAreaPath: "",
        currentTone: "gain" as "gain" | "loss",
        gridLines: [] as Array<{ id: string; y: number; value: number }>,
        points: [] as Array<{ id: string; x: number; yInvested: number; yCurrent: number; label: string; invested: number; current: number }>,
      };
    }

    const minTime = chartRows[0].date.getTime();
    const maxTime = chartRows[chartRows.length - 1].date.getTime();
    const rawLow = Math.min(...chartRows.map((r) => Math.min(r.invested, r.current)));
    const rawHigh = Math.max(...chartRows.map((r) => Math.max(r.invested, r.current)));
    const padding = Math.max((rawHigh - rawLow) * 0.14, rawHigh * 0.06, 1000);
    const low = Math.max(0, rawLow - padding);
    const high = rawHigh + padding;
    const spanTime = Math.max(1, maxTime - minTime);
    const spanY = Math.max(1, high - low);

    const points = chartRows.map((row) => {
      const x = pad + ((row.date.getTime() - minTime) / spanTime) * plotW;
      const yInvested = pad + (1 - (row.invested - low) / spanY) * plotH;
      const yCurrent = pad + (1 - (row.current - low) / spanY) * plotH;
      const label = row.date.toLocaleDateString();
      return { id: row.id, x, yInvested, yCurrent, label, invested: row.invested, current: row.current };
    });

    const investedPath = buildSmoothPath(points.map((point) => ({ x: point.x, y: point.yInvested })));
    const currentPath = buildSmoothPath(points.map((point) => ({ x: point.x, y: point.yCurrent })));
    const baselineY = height - pad;
    const currentAreaPath = buildAreaPath(points.map((point) => ({ x: point.x, y: point.yCurrent })), baselineY);
    const latestPoint = points[points.length - 1];
    const currentTone = latestPoint.current >= latestPoint.invested ? "gain" : "loss";
    const gridLines = Array.from({ length: 4 }, (_, index) => {
      const ratio = index / 3;
      const value = high - ratio * spanY;
      const y = pad + ratio * plotH;
      return { id: `grid-${index}`, y, value };
    });

    return { width, height, low, high, baselineY, investedPath, currentPath, currentAreaPath, currentTone, gridLines, points };
  }, [chartRows]);

  const hoveredPoint = chart.points.find((point) => point.id === hoveredPointId) ?? null;

  return (
    <div className="inv-page">
      {/* Add Button - Outside card */}
      {!accountsLoading && (
        <div style={{ marginBottom: "8px", display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={openCreateAccountModal}
            disabled={!workspaceId}
            aria-label="Add Investment Account"
            title="Add Investment Account"
          >
            + Add Account
          </button>
        </div>
      )}

      {/* Modern Fintech-Style Dashboard Header */}
      <section className="card" style={{ padding: "24px" }}>
        {accountsLoading ? (
          <div style={{ display: "flex", gap: "32px" }}>
            <div style={{ flex: 1 }}><SkeletonMiniCard /></div>
            <div style={{ flex: 1 }}><SkeletonMiniCard /></div>
            <div style={{ flex: 1 }}><SkeletonMiniCard /></div>
          </div>
        ) : (
          <div className="inv-portfolio-header">
              {/* Total Portfolio Value - Primary */}
              <div style={{ flex: "1 1 200px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
                  Total Portfolio Value
                </div>
                <div style={{ fontSize: "32px", fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>
                  {formatCents(totalCurrentAcrossAll)}
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: "1px", height: "50px", background: "var(--border-subtle)", flexShrink: 0 }} />

              {/* Invested Amount */}
              <div style={{ flex: "0 1 150px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "4px" }}>
                  Total Invested
                </div>
                <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-secondary)" }}>
                  {formatCents(totalInvestedAcrossAll)}
                </div>
              </div>

              {/* Gain/Loss */}
              <div style={{ flex: "0 1 150px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "4px" }}>
                  {isProfit ? "Gain" : "Loss"}
                </div>
                <div style={{ fontSize: "18px", fontWeight: 700, color: isProfit ? "var(--amount-positive)" : "var(--amount-negative)" }}>
                  {isProfit ? "+" : "-"}{formatCents(Math.abs(totalGainCents))}
                </div>
              </div>

              {/* Return Percentage */}
              <div style={{ flex: "0 1 150px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "4px" }}>
                  Return
                </div>
                <div style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: isProfit ? "var(--amount-positive)" : "var(--amount-negative)",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px"
                }}>
                  <span>{isProfit ? "▲" : "▼"}</span>
                  <span>{Math.abs(returnPercentage).toFixed(2)}%</span>
                </div>
              </div>
            </div>
          )}
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

        {!accountsLoading && [...(accounts.data ?? [])]
          .sort((a, b) => (a.displayName || a.productName).localeCompare(b.displayName || b.productName))
          .map((account) => {
          const entries = [...account.entries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          const latest = entries[entries.length - 1] ?? null;
          const recentlyUpdated = account.entries.some((entry) => isWithinLastDay(entry.createdAt));
          const selected = !showAllAccounts && account.id === selectedAccountId;
          const investedCents = latest?.investedCents ?? 0;
          const currentCents = latest?.currentValueCents ?? 0;
          const currentValueClass = currentCents >= investedCents ? "positive" : "negative";
          const inceptionBadge = formatInceptionBadge(account.inceptionDate);
          return (
            <article key={account.id} className={`card inv-account-card ${selected ? "is-selected" : ""} ${recentlyUpdated ? "is-recently-updated" : ""}`}>
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
                    <p className="positive">{formatCents(investedCents)}</p>
                  </div>
                  <div>
                    <small>Current</small>
                    <p className={currentValueClass}>{formatCents(currentCents)}</p>
                  </div>
                </div>
              </button>
              <div className="inv-account-actions">
                {inceptionBadge ? <span className="inv-inception-chip">{inceptionBadge}</span> : null}
                <button
                  className="btn btn-primary btn-icon btn-xs inv-add-update-btn"
                  type="button"
                  onClick={() => { setSelectedAccountId(account.id); openCreateEntryModal(account); }}
                  title="Add Update"
                >
                  🔄
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
                  <defs>
                    <linearGradient id="invCurrentGainFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--amount-positive)" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="var(--amount-positive)" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="invCurrentLossFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--amount-negative)" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="var(--amount-negative)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {chart.gridLines.map((line) => (
                    <g key={line.id}>
                      <line x1={36} x2={chart.width - 36} y1={line.y} y2={line.y} className="inv-grid-line" />
                      <text x={10} y={line.y + 4} className="inv-grid-label">
                        {formatCents(Math.round(line.value))}
                      </text>
                    </g>
                  ))}
                  <path
                    d={chart.currentAreaPath}
                    className={`inv-area ${chart.currentTone}`}
                    fill={chart.currentTone === "gain" ? "url(#invCurrentGainFill)" : "url(#invCurrentLossFill)"}
                  />
                  <path d={chart.investedPath} className="inv-line invested" />
                  <path d={chart.currentPath} className={`inv-line current ${chart.currentTone}`} />
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
                        className={`inv-dot current ${chart.currentTone}`}
                        onMouseEnter={() => setHoveredPointId(point.id)}
                      />
                    </g>
                  ))}
                </svg>
                <div className="inv-chart-legend">
                  <span><i className="inv-legend-dot invested" /> Invested Amount</span>
                  <span><i className={`inv-legend-dot current ${chart.currentTone}`} /> Current Value</span>
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
                <button className="btn btn-primary btn-xs" type="button" onClick={() => selectedAccount && openCreateEntryModal(selectedAccount)}>
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
                    onClick={() => confirmDeleteAccount(editingAccountId)}
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
              if (entryAccountId) {
                createEntry.mutate(entryAccountId);
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
                    onClick={() => confirmDeleteEntry(editingEntryId)}
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
