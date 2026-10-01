"use client";

import { apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeCurrency } from "@/lib/currency";
import { useMoneyFormat } from "@/lib/use-money-format";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EmptyState } from "@/components/ui-skeleton";
import { InvestmentsAccountGridSkeleton, InvestmentsPortfolioHeaderSkeleton } from "@/components/skeletons/InvestmentsSkeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { ChartCursorTooltip, useChartCursorTooltip } from "@/components/chart-cursor-tooltip";
import { ArrowRightLeft, Droplet, Info, Lock, Plus } from "lucide-react";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { useSessionState } from "@/lib/use-session-state";
import {
  buildInvestmentCashFlows,
  calculateAnnualInvestmentContributions,
  calculateAnnualizedReturn,
  compareInvestmentEntries,
  getLatestInvestmentEntry,
} from "@/lib/investment-entry-order";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { useSearchParams } from "next/navigation";
import { useUrlFilterSync } from "@/lib/use-url-filter-sync";

type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  baseCurrency?: string | null;
};

type InvestmentEntry = {
  id: string;
  date: string;
  investedCents: number;
  currentValueCents: number;
  createdAt: string;
  updatedAt: string;
};

type InvestmentAccount = {
  id: string;
  displayName?: string | null;
  institutionName: string;
  productName: string;
  inceptionDate: string;
  divestedDate?: string | null;
  isLiquid: boolean;
  entries: InvestmentEntry[];
};

type TimeRange = "90D" | "180D" | "1Y" | "ALL";

type InvestmentChartPoint = {
  id: string;
  x: number;
  yInvested: number;
  yCurrent: number;
  label: string;
  invested: number;
  current: number;
};

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
  if (Number.isNaN(date.getTime())) return null;
  const year = String(date.getFullYear());
  return {
    full: `Since ${year}`,
    compact: `Since ’${year.slice(-2)}`,
  };
}

function ContributionTrendIndicator({
  currentCents,
  previousCents,
  previousYear,
}: {
  currentCents: number;
  previousCents: number | undefined;
  previousYear: number;
}) {
  if (previousCents === undefined || currentCents === previousCents) return null;
  const increased = currentCents > previousCents;
  return (
    <span
      className={`inv-contribution-trend ${increased ? "is-up" : "is-down"}`}
      role="img"
      aria-label={`${increased ? "Increased" : "Decreased"} from ${previousYear}`}
      title={`${increased ? "Increased" : "Decreased"} from ${previousYear}`}
    >
      {increased ? "▲" : "▼"}
    </span>
  );
}

function buildLinePath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const [first, ...rest] = points;
  return rest.reduce((path, point) => `${path} L ${point.x} ${point.y}`, `M ${first.x} ${first.y}`);
}

function buildAreaPath(points: Array<{ x: number; y: number }>, baselineY: number) {
  if (!points.length) return "";
  const linePath = buildLinePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

export function InvestmentsPage() {
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const investmentsUrlKey = searchParams.toString();
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const tooltip = useChartCursorTooltip<InvestmentChartPoint>(chartWrapRef);
  const [selectedAccountId, setSelectedAccountId] = useSessionState<string | null>("nest:view:investments:account", null);
  const [timeRange, setTimeRange] = useSessionState<TimeRange>("nest:view:investments:range", "ALL");
  const [showAllAccounts, setShowAllAccounts] = useSessionState("nest:view:investments:all", false);
  const [returnDisplayMode, setReturnDisplayMode] = useSessionState<"absolute" | "annualized">(
    "nest:view:investments:returnMode",
    "absolute",
  );
  const [accountError, setAccountError] = useState("");
  const [entryError, setEntryError] = useState("");
  const [hydratedInvestmentsUrlKey, setHydratedInvestmentsUrlKey] = useState<string | null>(null);
  const urlFiltersReady = hydratedInvestmentsUrlKey === investmentsUrlKey;
  const appliedInvestmentsUrlRef = useRef<string | null>(null);

  const [accountModalMode, setAccountModalMode] = useState<"create" | "edit">("create");
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [productName, setProductName] = useState("");
  const [inceptionDate, setInceptionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [divestedDate, setDivestedDate] = useState("");
  const [isLiquid, setIsLiquid] = useState(false);

  const [entryModalMode, setEntryModalMode] = useState<"create" | "edit">("create");
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryAccountId, setEntryAccountId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newFunds, setNewFunds] = useState("0");
  const [entryInvested, setEntryInvested] = useState("0");
  const [entryCurrentValue, setEntryCurrentValue] = useState("0");
  const [contributionAsOf] = useState(() => new Date());
  const currentYear = contributionAsOf.getFullYear();

  const context = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const { format: formatCents } = useMoneyFormat(baseCurrency);
  const investmentsQueryKey = queryKeys.investments(workspaceId);

  const accounts = useQuery({
    queryKey: investmentsQueryKey,
    enabled: Boolean(workspaceId),
    queryFn: () => fetchJson<InvestmentAccount[]>(`/api/investments?workspaceId=${workspaceId}`, { cache: "no-store" }),
  });
  const { isLoading: accountsLoading, isError: accountsError, refetch } = accounts;

  useEffect(() => {
    const requestedRange = searchParams.get("range");
    if (requestedRange === "90D" || requestedRange === "180D" || requestedRange === "1Y" || requestedRange === "ALL") {
      setTimeRange(requestedRange);
    }
    const requestedView = searchParams.get("view");
    if (requestedView === "all" || requestedView === "single") setShowAllAccounts(requestedView === "all");
  }, [investmentsUrlKey, searchParams, setShowAllAccounts, setTimeRange]);

  useEffect(() => {
    if (!accounts.data) return;
    if (!accounts.data.length) {
      setSelectedAccountId(null);
      appliedInvestmentsUrlRef.current = investmentsUrlKey;
      setHydratedInvestmentsUrlKey(investmentsUrlKey);
      return;
    }
    if (appliedInvestmentsUrlRef.current === investmentsUrlKey) {
      if (!selectedAccountId || !accounts.data.some((account) => account.id === selectedAccountId)) {
        setSelectedAccountId(accounts.data[0].id);
      }
      return;
    }
    const requestedAccountId = searchParams.get("accountId");
    if (requestedAccountId && accounts.data.some((account) => account.id === requestedAccountId)) {
      setSelectedAccountId(requestedAccountId);
    } else if (!selectedAccountId || !accounts.data.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(accounts.data[0].id);
    }
    appliedInvestmentsUrlRef.current = investmentsUrlKey;
    setHydratedInvestmentsUrlKey(investmentsUrlKey);
  }, [accounts.data, investmentsUrlKey, searchParams, selectedAccountId, setSelectedAccountId]);

  useUrlFilterSync({
    accountId: selectedAccountId,
    range: timeRange,
    view: showAllAccounts ? "all" : "single",
  }, urlFiltersReady);

  const selectedAccount = useMemo(
    () => (accounts.data ?? []).find((a) => a.id === selectedAccountId) ?? null,
    [accounts.data, selectedAccountId],
  );

  const selectedEntries = useMemo(
    () => [...(selectedAccount?.entries ?? [])].sort(compareInvestmentEntries),
    [selectedAccount?.entries],
  );

  const entryAccount = useMemo(
    () => (accounts.data ?? []).find((a) => a.id === entryAccountId) ?? null,
    [accounts.data, entryAccountId],
  );
  const latestEntryAccountEntry = useMemo(
    () => getLatestInvestmentEntry(entryAccount?.entries ?? []),
    [entryAccount?.entries],
  );

  const totalInvestedAcrossAll = useMemo(() => {
    let total = 0;
    for (const account of accounts.data ?? []) {
      const latest = getLatestInvestmentEntry(account.entries ?? []);
      total += latest?.investedCents ?? 0;
    }
    return total;
  }, [accounts.data]);
  const annualContributions = useMemo(
    () => calculateAnnualInvestmentContributions(accounts.data ?? [], contributionAsOf),
    [accounts.data, contributionAsOf],
  );
  const contributionsByYear = useMemo(
    () => new Map(annualContributions.map((contribution) => [contribution.year, contribution.contributedCents])),
    [annualContributions],
  );
  const ytdContributionCents = annualContributions
    .find((contribution) => contribution.year === currentYear)?.contributedCents ?? 0;
  const priorAnnualContributions = annualContributions
    .filter((contribution) => contribution.year < currentYear);
  const totalCurrentAcrossAll = useMemo(() => {
    let total = 0;
    for (const account of accounts.data ?? []) {
      const latest = getLatestInvestmentEntry(account.entries ?? []);
      total += latest?.currentValueCents ?? 0;
    }
    return total;
  }, [accounts.data]);
  const liquidCurrentAcrossAll = useMemo(() => {
    let total = 0;
    for (const account of accounts.data ?? []) {
      if (!account.isLiquid) continue;
      const latest = getLatestInvestmentEntry(account.entries ?? []);
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

  // Annualized (money-weighted) return: weighs the return by how long each
  // contribution has actually been invested, instead of blending recent and
  // long-held contributions into one undifferentiated percentage.
  const annualizedReturnPercentage = useMemo(() => {
    const cashFlows = (accounts.data ?? []).flatMap((account) => buildInvestmentCashFlows(account.entries ?? []));
    return calculateAnnualizedReturn(cashFlows);
  }, [accounts.data]);

  const displayedReturnPercentage = returnDisplayMode === "absolute" ? returnPercentage : annualizedReturnPercentage;
  const displayedReturnIsProfit = displayedReturnPercentage === null ? isProfit : displayedReturnPercentage >= 0;

  const reconcileInvestments = () => {
    void queryClient.invalidateQueries({ queryKey: investmentsQueryKey, refetchType: "active" });
  };

  const createAccount = useMutation({
    mutationFn: () =>
      fetchJson<Omit<InvestmentAccount, "entries">>("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          displayName,
          institutionName,
          productName,
          inceptionDate: toIsoFromDateInput(inceptionDate),
          divestedDate: divestedDate ? toIsoFromDateInput(divestedDate) : null,
          isLiquid,
        }),
      }),
    onSuccess: (created) => {
      setAccountError("");
      queryClient.setQueryData<InvestmentAccount[]>(investmentsQueryKey, (current) => [
        ...(current ?? []),
        { ...created, entries: [] },
      ]);
      reconcileInvestments();
      setSelectedAccountId(created.id);
      closeAccountModal();
    },
    onError: (error) => {
      setAccountError(error instanceof Error ? error.message : "Failed to create investment account.");
    },
  });

  const updateAccount = useMutation({
    mutationFn: (id: string) =>
      fetchJson<Omit<InvestmentAccount, "entries">>(`/api/investments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          institutionName,
          productName,
          inceptionDate: toIsoFromDateInput(inceptionDate),
          divestedDate: divestedDate ? toIsoFromDateInput(divestedDate) : null,
          isLiquid,
        }),
      }),
    onSuccess: (updated) => {
      setAccountError("");
      queryClient.setQueryData<InvestmentAccount[]>(investmentsQueryKey, (current) =>
        current?.map((account) => account.id === updated.id
          ? { ...account, ...updated, entries: account.entries }
          : account),
      );
      reconcileInvestments();
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
      queryClient.setQueryData<InvestmentAccount[]>(investmentsQueryKey, (current) =>
        current?.filter((account) => account.id !== deletedId),
      );
      reconcileInvestments();
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
      fetchJson<InvestmentEntry>(`/api/investments/${accountId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: toIsoFromDateInput(entryDate),
          investedCents: Math.round(Number(entryInvested || "0") * 100),
          currentValueCents: Math.round(Number(entryCurrentValue || "0") * 100),
        }),
      }),
    onSuccess: (created, accountId) => {
      setEntryError("");
      queryClient.setQueryData<InvestmentAccount[]>(investmentsQueryKey, (current) =>
        current?.map((account) => account.id === accountId
          ? { ...account, entries: [...account.entries, created] }
          : account),
      );
      reconcileInvestments();
      closeEntryModal();
    },
    onError: (error) => {
      setEntryError(error instanceof Error ? error.message : "Failed to add entry.");
    },
  });

  const updateEntry = useMutation({
    mutationFn: (entryId: string) =>
      fetchJson<InvestmentEntry>(`/api/investments/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: toIsoFromDateInput(entryDate),
          investedCents: Math.round(Number(entryInvested || "0") * 100),
          currentValueCents: Math.round(Number(entryCurrentValue || "0") * 100),
        }),
      }),
    onSuccess: (updated) => {
      setEntryError("");
      queryClient.setQueryData<InvestmentAccount[]>(investmentsQueryKey, (current) =>
        current?.map((account) => ({
          ...account,
          entries: account.entries.map((entry) => entry.id === updated.id ? updated : entry),
        })),
      );
      reconcileInvestments();
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
    onSuccess: (_data, deletedEntryId) => {
      setEntryError("");
      queryClient.setQueryData<InvestmentAccount[]>(investmentsQueryKey, (current) =>
        current?.map((account) => ({
          ...account,
          entries: account.entries.filter((entry) => entry.id !== deletedEntryId),
        })),
      );
      reconcileInvestments();
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
    setIsLiquid(false);
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
    setIsLiquid(account.isLiquid);
    setAccountModalOpen(true);
    setAccountError("");
  };

  const closeAccountModal = () => {
    setAccountModalOpen(false);
    setEditingAccountId(null);
  };

  const openCreateEntryModal = (account: InvestmentAccount) => {
    const latestAccountEntry = getLatestInvestmentEntry(account.entries);
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

  const confirmDeleteAccount = async (accountId: string) => {
    if (!(await confirmDestructiveAction("Delete this investment account and its history?", "Delete investment account?", {
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      reversal: "This cannot be undone; all snapshots for the account are removed.",
    }))) return;
    deleteAccount.mutate(accountId);
  };

  const confirmDeleteEntry = async (entryId: string) => {
    if (!(await confirmDestructiveAction("Delete this investment entry?", "Delete investment snapshot?", {
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      reversal: "This snapshot cannot be restored automatically.",
    }))) return;
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
    const accountEntries = new Map<string, Array<{
      id: string;
      date: string;
      createdAt: string;
      invested: number;
      current: number;
    }>>();

    for (const account of accounts.data ?? []) {
      const entries = (account.entries ?? [])
        .map((e) => ({
          id: e.id,
          date: e.date.slice(0, 10),
          createdAt: e.createdAt,
          invested: e.investedCents,
          current: e.currentValueCents,
        }))
        .sort(compareInvestmentEntries);

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
        points: [] as InvestmentChartPoint[],
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

    // For All Accounts view, use equal spacing for smoother, more uniform look
    const useEqualSpacing = showAllAccounts && chartRows.length > 1;
    const points = chartRows.map((row, index) => {
      const x = useEqualSpacing
        ? pad + (index / (chartRows.length - 1)) * plotW
        : pad + ((row.date.getTime() - minTime) / spanTime) * plotW;
      const yInvested = pad + (1 - (row.invested - low) / spanY) * plotH;
      const yCurrent = pad + (1 - (row.current - low) / spanY) * plotH;
      const label = row.date.toLocaleDateString();
      return { id: row.id, x, yInvested, yCurrent, label, invested: row.invested, current: row.current };
    });

    const investedPath = buildLinePath(points.map((point) => ({ x: point.x, y: point.yInvested })));
    const currentPath = buildLinePath(points.map((point) => ({ x: point.x, y: point.yCurrent })));
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

  const activePoint = tooltip.item;

  return (
    <div className="inv-page">
      {/* Modern Fintech-Style Dashboard Header */}
      {accountsLoading ? (
        <InvestmentsPortfolioHeaderSkeleton />
      ) : (
        <section className="card inv-portfolio-card">
          <div className="inv-portfolio-header">
              {/* Total Portfolio Value - Primary */}
              <div style={{ flex: "1 1 200px" }}>
                <div className="inv-header-total-label">
                  Total Portfolio Value
                </div>
                <div className="inv-header-total-value">
                  {formatCents(totalCurrentAcrossAll)}
                </div>
                <div className="inv-withdrawable-summary">
                  <span>Amount Available to withdraw</span>
                  <strong>{formatCents(liquidCurrentAcrossAll)}</strong>
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: "1px", height: "50px", background: "var(--border-subtle)", flexShrink: 0 }} />

              {/* Invested Amount */}
              <div className="inv-header-stat">
                <div className="inv-contribution-tooltip-shell inv-header-stat-label">
                  <Button
                    type="button"
                    className="inv-contribution-tooltip-trigger"
                    aria-label="Total Invested contribution history"
                    aria-describedby="inv-annual-contributions"
                  >
                    <span>Total Invested</span>
                    <Info size={12} aria-hidden="true" />
                  </Button>
                  <div id="inv-annual-contributions" className="inv-contribution-tooltip" role="tooltip">
                    <dl>
                      <div className="is-ytd">
                        <dt>{currentYear} YTD</dt>
                        <dd>
                          <ContributionTrendIndicator
                            currentCents={ytdContributionCents}
                            previousCents={contributionsByYear.get(currentYear - 1)}
                            previousYear={currentYear - 1}
                          />
                          {formatCents(ytdContributionCents)}
                        </dd>
                      </div>
                      {priorAnnualContributions.map((contribution) => (
                        <div key={contribution.year}>
                          <dt>{contribution.year}</dt>
                          <dd>
                            <ContributionTrendIndicator
                              currentCents={contribution.contributedCents}
                              previousCents={contributionsByYear.get(contribution.year - 1)}
                              previousYear={contribution.year - 1}
                            />
                            {formatCents(contribution.contributedCents)}
                          </dd>
                        </div>
                      ))}
                      {!priorAnnualContributions.length ? (
                        <div>
                          <dt>Earlier</dt>
                          <dd>None recorded</dd>
                        </div>
                      ) : null}
                    </dl>
                    <small>Net change in total invested</small>
                  </div>
                </div>
                <div className="inv-header-stat-value is-invested">
                  {formatCents(totalInvestedAcrossAll)}
                </div>
              </div>

              {/* Gain/Loss */}
              <div className="inv-header-stat">
                <div className="inv-header-stat-label">
                  {isProfit ? "Gain" : "Loss"}
                </div>
                <div className={`inv-header-stat-value ${isProfit ? "positive" : "negative"}`}>
                  {isProfit ? "+" : "-"}{formatCents(Math.abs(totalGainCents))}
                </div>
              </div>

              {/* Return Percentage */}
              <div
                className="inv-return-toggle inv-header-stat"
                role="button"
                tabIndex={0}
                aria-pressed={returnDisplayMode === "annualized"}
                title={
                  returnDisplayMode === "absolute"
                    ? "All-time return since inception. Tap for the annualized return, which accounts for when each contribution was made."
                    : annualizedReturnPercentage === null
                      ? "Not enough contribution history to annualize yet. Tap for the all-time return."
                      : "Annualized return, weighted by when each contribution was made. Tap for the all-time return."
                }
                onClick={() => setReturnDisplayMode((mode) => (mode === "absolute" ? "annualized" : "absolute"))}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setReturnDisplayMode((mode) => (mode === "absolute" ? "annualized" : "absolute"));
                }}
              >
                <div className="inv-header-stat-label inv-return-toggle-label">
                  <span>{returnDisplayMode === "absolute" ? "Return" : "Annualized Return"}</span>
                  <ArrowRightLeft size={10} aria-hidden="true" />
                </div>
                <div
                  className={`inv-header-stat-value is-return ${
                    displayedReturnPercentage === null
                      ? "is-muted"
                      : displayedReturnIsProfit ? "positive" : "negative"
                  }`}
                >
                  {displayedReturnPercentage === null ? (
                    <span>—</span>
                  ) : (
                    <>
                      <span>{displayedReturnIsProfit ? "▲" : "▼"}</span>
                      <span>{Math.abs(displayedReturnPercentage).toFixed(2)}%</span>
                    </>
                  )}
                </div>
              </div>
            </div>
        </section>
      )}

      {/* View Toggle */}
      <section className="card inv-view-toggle">
        <div style={{ fontSize: "13px", fontWeight: 600 }}>
          {showAllAccounts ? "All Accounts" : selectedAccount ? `${selectedAccount.displayName || selectedAccount.productName}` : "Select an account to view details"}
        </div>
        <div className="segmented">
          <Button
            type="button"
            className={`segmented-btn ${showAllAccounts ? "on" : ""}`}
            onClick={() => setShowAllAccounts(true)}
          >
            All Accounts
          </Button>
          <Button
            type="button"
            className={`segmented-btn ${!showAllAccounts ? "on" : ""}`}
            onClick={() => setShowAllAccounts(false)}
            disabled={!selectedAccount}
          >
            Single Account
          </Button>
        </div>
      </section>

      {!accountsLoading && !accountsError && (accounts.data?.length ?? 0) > 0 ? (
        <div className="inv-account-create-row">
          <Button
            className="btn btn-ghost btn-sm inv-add-account-btn"
            type="button"
            onClick={openCreateAccountModal}
            disabled={!workspaceId}
            aria-label="Add investment account"
            title="Add investment account"
          >
            <Plus size={15} aria-hidden="true" />
            <span>Add account</span>
          </Button>
        </div>
      ) : null}

      {accountsLoading ? (
        <InvestmentsAccountGridSkeleton />
      ) : (
        <section className="inv-account-grid">
        {accountsError && (
          <div style={{ gridColumn: "1 / -1" }}>
            <EmptyState
              icon="⚠️"
              title="Failed to load investments"
              action={
                <Button className="btn btn-primary" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            />
          </div>
        )}

        {!accountsError && (accounts.data ?? []).length === 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <EmptyState
              icon="📈"
              title="No investment accounts yet"
              description="Add your first investment account to start tracking your portfolio performance."
              action={
                <Button className="btn btn-primary" onClick={openCreateAccountModal}>
                  + Add Investment Account
                </Button>
              }
            />
          </div>
        )}

        {!accountsError && (accounts.data ?? [])
          .map((account) => ({ account, latest: getLatestInvestmentEntry(account.entries) }))
          .sort((a, b) => {
            const currentValueDifference = (b.latest?.currentValueCents ?? 0) - (a.latest?.currentValueCents ?? 0);
            return currentValueDifference ||
              (a.account.displayName || a.account.productName).localeCompare(b.account.displayName || b.account.productName);
          })
          .map(({ account, latest }) => {
          const recentlyUpdated = account.entries.some((entry) => isWithinLastDay(entry.updatedAt || entry.createdAt));
          const selected = !showAllAccounts && account.id === selectedAccountId;
          const investedCents = latest?.investedCents ?? 0;
          const currentCents = latest?.currentValueCents ?? 0;
          const currentValueClass = currentCents >= investedCents ? "positive" : "negative";
          const gainCents = currentCents - investedCents;
          const accountIsProfit = gainCents >= 0;
          const returnPercentage = investedCents > 0 ? (gainCents / investedCents) * 100 : null;
          const inceptionBadge = formatInceptionBadge(account.inceptionDate);
          return (
            <article key={account.id} className={`card inv-account-card ${selected ? "is-selected" : ""} ${recentlyUpdated ? "is-recently-updated" : ""}`}>
              <Button
                className="inv-edit-icon"
                type="button"
                onClick={() => openEditAccountModal(account)}
                aria-label="Edit investment account"
                title="Edit"
              >
                ✎
              </Button>
              <Button className="inv-account-select" type="button" onClick={() => { setSelectedAccountId(account.id); setShowAllAccounts(false); }}>
                <div className="inv-account-head">
                  <div className="inv-account-title-row">
                    <strong>{account.displayName || account.productName}</strong>
                    <span
                      className={`inv-account-liquidity-status ${account.isLiquid ? "is-liquid" : "is-locked"}`}
                      role="img"
                      aria-label={account.isLiquid ? "Liquid account" : "Non-liquid account"}
                      title={account.isLiquid ? "Liquid account" : "Non-liquid account"}
                    >
                      {account.isLiquid
                        ? <Droplet size={13} aria-hidden="true" />
                        : <Lock size={12} aria-hidden="true" />}
                    </span>
                  </div>
                  <span className="inv-account-subtitle">{account.productName} · {account.institutionName}</span>
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
                <div
                  className={`inv-account-performance ${currentValueClass}`}
                  title={`All-time ${accountIsProfit ? "gain" : "loss"} on this account`}
                >
                  <span aria-hidden="true">{accountIsProfit ? "▲" : "▼"}</span>
                  <span>{accountIsProfit ? "+" : "-"}{formatCents(Math.abs(gainCents))}</span>
                  {returnPercentage !== null ? (
                    <span className="inv-account-performance-return">
                      ({Math.abs(returnPercentage).toFixed(2)}%)
                    </span>
                  ) : null}
                </div>
              </Button>
              <div className="inv-account-actions">
                {inceptionBadge ? (
                  <span
                    className="inv-inception-chip"
                    title={inceptionBadge.full}
                    data-compact-label={inceptionBadge.compact}
                  >
                    {inceptionBadge.full}
                  </span>
                ) : null}
                <Button
                  className="btn btn-primary btn-icon btn-xs inv-add-update-btn"
                  type="button"
                  onClick={() => { setSelectedAccountId(account.id); openCreateEntryModal(account); }}
                  title="Add Update"
                >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13.5 8A5.5 5.5 0 1 1 10 3.07" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <polygon points="10,1 14,4 10,5.5" fill="currentColor"/>
              </svg>
                </Button>
              </div>
            </article>
          );
        })}
        </section>
      )}

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
                    <Button
                      key={range}
                      type="button"
                      className={`inv-range-btn ${timeRange === range ? "on" : ""}`}
                      onClick={() => setTimeRange(range)}
                    >
                      {range}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            {chart.points.length ? (
              <div ref={chartWrapRef} className="inv-chart-wrap">
                <svg
                  viewBox={`0 0 ${chart.width} ${chart.height}`}
                  className="inv-chart"
                  role="img"
                  aria-label="Investment time series chart"
                  onPointerLeave={tooltip.clear}
                >
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
                  {chart.points.map((point, index) => {
                    const previousPoint = chart.points[index - 1] ?? null;
                    const nextPoint = chart.points[index + 1] ?? null;
                    const hitX = previousPoint ? (previousPoint.x + point.x) / 2 : 36;
                    const hitRight = nextPoint ? (point.x + nextPoint.x) / 2 : chart.width - 36;
                    const isActive = activePoint?.id === point.id;

                    return (
                      <g key={point.id}>
                        <rect
                          className="inv-hit-area"
                          x={hitX}
                          y={36}
                          width={Math.max(16, hitRight - hitX)}
                          height={chart.height - 72}
                          rx="8"
                          tabIndex={0}
                          role="button"
                          aria-label={`${point.label}: Invested ${formatCents(point.invested)}, current ${formatCents(point.current)}`}
                          onPointerEnter={(event) => tooltip.showAtPointer(event, point)}
                          onPointerMove={(event) => tooltip.showAtPointer(event, point)}
                          onFocus={(event) => {
                            const wrapper = chartWrapRef.current;
                            const targetRect = event.currentTarget.getBoundingClientRect();
                            const wrapperRect = wrapper?.getBoundingClientRect();
                            if (!wrapperRect) return;
                            tooltip.showAtLocalPoint(
                              targetRect.left - wrapperRect.left + targetRect.width / 2,
                              targetRect.top - wrapperRect.top + targetRect.height / 2,
                              point,
                            );
                          }}
                          onBlur={tooltip.clear}
                        />
                        <circle
                          cx={point.x}
                          cy={point.yInvested}
                          r={isActive ? 4 : 3}
                          className="inv-dot invested"
                        />
                        <circle
                          cx={point.x}
                          cy={point.yCurrent}
                          r={isActive ? 4 : 3}
                          className={`inv-dot current ${chart.currentTone}`}
                        />
                      </g>
                    );
                  })}
                </svg>
                <div className="inv-chart-legend">
                  <span><i className="inv-legend-dot invested" /> Invested Amount</span>
                  <span><i className={`inv-legend-dot current ${chart.currentTone}`} /> Current Value</span>
                </div>
                {activePoint && tooltip.position ? (
                  <ChartCursorTooltip position={tooltip.position}>
                    <strong>{activePoint.label}</strong>
                    <span>Invested: {formatCents(activePoint.invested)}</span>
                    <span>Current: {formatCents(activePoint.current)}</span>
                  </ChartCursorTooltip>
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
                <Button className="btn btn-primary btn-xs" type="button" onClick={() => selectedAccount && openCreateEntryModal(selectedAccount)}>
                  + Add Entry
                </Button>
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
                        <Button
                          className="btn btn-ghost btn-icon"
                          style={{ width: "32px", height: "32px" }}
                          type="button"
                          onClick={() => openEditEntryModal(entry)}
                          title="Edit"
                          aria-label="Edit entry"
                        >
                          ✎
                        </Button>
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

      {accountModalOpen && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={closeAccountModal} title="Investment account" surface="custom" overlayClassName="profile-modal-overlay">
          <div className="profile-modal inv-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>{accountModalMode === "edit" ? "Edit Investment Account" : "Add Investment Account"}</h3>
              <ModalCloseButton onClick={closeAccountModal} label={`Close ${accountModalMode === "edit" ? "Edit Investment Account" : "Add Investment Account"}`} />
            </div>
            <form className="modal-form-shell" onSubmit={(event: FormEvent) => {
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
              <div className="profile-modal-body inv-modal-body">
              <div className="profile-field">
                <span>Display Name of the Account</span>
                <Input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="profile-field">
                <span>Financial Institution Name</span>
                <Input className="input" value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} required />
              </div>
              <div className="profile-field">
                <span>Product Name</span>
                <Input className="input" value={productName} onChange={(e) => setProductName(e.target.value)} required />
              </div>
              <div className="profile-field">
                <span>Inception Date</span>
                <Input className="input" type="date" value={inceptionDate} onChange={(e) => setInceptionDate(e.target.value)} required />
              </div>
              <div className="profile-field">
                <span>Divested Date (Optional)</span>
                <Input className="input" type="date" value={divestedDate} onChange={(e) => setDivestedDate(e.target.value)} />
              </div>
              <div className="profile-field">
                <span>Is liquid (Available to withdraw anytime?)</span>
                <div className="segmented-toggle inv-liquidity-toggle" role="group" aria-label="Is liquid">
                  <Button
                    type="button"
                    className={`segmented-toggle-btn inv-liquidity-toggle-btn ${isLiquid ? "is-active" : ""}`}
                    aria-pressed={isLiquid}
                    onClick={() => setIsLiquid(true)}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    className={`segmented-toggle-btn inv-liquidity-toggle-btn ${!isLiquid ? "is-active" : ""}`}
                    aria-pressed={!isLiquid}
                    onClick={() => setIsLiquid(false)}
                  >
                    No
                  </Button>
                </div>
              </div>
              {accountError ? <div className="profile-error">{accountError}</div> : null}
              </div>
              <div className="profile-actions inv-modal-actions">
                {accountModalMode === "edit" && editingAccountId ? (
                  <Button
                    type="button"
                    className="btn btn-ghost btn-xs modal-action-destructive"
                    onClick={() => confirmDeleteAccount(editingAccountId)}
                    disabled={deleteAccount.isPending}
                  >
                    {deleteAccount.isPending ? "Deleting..." : "Delete"}
                  </Button>
                ) : <span />}
                <div className="inv-modal-primary-actions modal-action-group">
                  <Button type="button" className="btn btn-ghost btn-xs" onClick={closeAccountModal}>Cancel</Button>
                  <Button type="submit" className="btn btn-primary btn-xs" disabled={createAccount.isPending || updateAccount.isPending}>
                    {accountModalMode === "edit" ? (updateAccount.isPending ? "Saving..." : "Save") : (createAccount.isPending ? "Adding..." : "Add")}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </Dialog>,
        document.body
      )}

      {entryModalOpen && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={closeEntryModal} title="Investment entry" surface="custom" overlayClassName="profile-modal-overlay">
          <div className="profile-modal inv-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>{entryModalMode === "edit" ? "Edit Entry" : "Add Funds / Update Value"}</h3>
              <ModalCloseButton onClick={closeEntryModal} label={`Close ${entryModalMode === "edit" ? "Edit Entry" : "Add Funds / Update Value"}`} />
            </div>
            <form className="modal-form-shell" onSubmit={(event: FormEvent) => {
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
              <div className="profile-modal-body inv-modal-body">
              <div className="profile-field">
                <span>Date</span>
                <Input className="input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
              </div>
              {entryModalMode === "create" ? (
                <div className="profile-field">
                  <span>New Funds Added</span>
                  <NumericCalculatorInput step="0.01" value={newFunds} onValueChange={setNewFunds} />
                </div>
              ) : null}
              <div className="profile-field">
                <span>Total Invested Amount</span>
                <NumericCalculatorInput step="0.01" value={entryInvested} onValueChange={setEntryInvested} required />
              </div>
              <div className="profile-field">
                <span>Current Value</span>
                <NumericCalculatorInput step="0.01" value={entryCurrentValue} onValueChange={setEntryCurrentValue} required />
              </div>
              {entryError ? <div className="profile-error">{entryError}</div> : null}
              </div>
              <div className="profile-actions inv-modal-actions">
                {entryModalMode === "edit" && editingEntryId ? (
                  <Button
                    type="button"
                    className="btn btn-ghost btn-xs modal-action-destructive"
                    onClick={() => confirmDeleteEntry(editingEntryId)}
                    disabled={deleteEntry.isPending}
                  >
                    {deleteEntry.isPending ? "Deleting..." : "Delete"}
                  </Button>
                ) : <span />}
                <div className="inv-modal-primary-actions modal-action-group">
                  <Button type="button" className="btn btn-ghost btn-xs" onClick={closeEntryModal}>Cancel</Button>
                  <Button type="submit" className="btn btn-primary btn-xs" disabled={createEntry.isPending || updateEntry.isPending}>
                    {entryModalMode === "edit" ? (updateEntry.isPending ? "Saving..." : "Save") : (createEntry.isPending ? "Adding..." : "Add")}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </Dialog>,
        document.body
      )}
    </div>
  );
}
