"use client";

import { apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeCurrency } from "@/lib/currency";
import { useMoneyFormat } from "@/lib/use-money-format";
import { MarkdownEditor } from "@/components/markdown-editor";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { EmptyState } from "@/components/ui-skeleton";
import { ReceivablesListSkeleton, ReceivablesSummarySkeleton } from "@/components/skeletons/ReceivablesSkeleton";
import { confirmDestructiveAction, confirmMoneyChange } from "@/lib/confirm-destructive";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { useSessionState } from "@/lib/use-session-state";
import { Plus } from "lucide-react";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { bankAccountsQueryOptions } from "@/lib/accounts";
import { MutationErrorSummary } from "@/components/ui/mutation-error-summary";
import { useSearchParams } from "next/navigation";
import { useUrlFilterSync } from "@/lib/use-url-filter-sync";

type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
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
  updatedAt: string;
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
  budget?: {
    id: string;
    name: string;
    availableCents: number;
  } | null;
  subaccount?: {
    id: string;
    name: string;
  } | null;
};

type DeductionBudget = {
  id: string;
  name: string;
  icon?: string | null;
  accountId: string;
  isActive: boolean;
  availableCents: number;
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

function getMonthEndDateInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return todayDateInputValue();
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  const year = monthEnd.getUTCFullYear();
  const month = String(monthEnd.getUTCMonth() + 1).padStart(2, "0");
  const day = String(monthEnd.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ReceivablesPage() {
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const receivableUrlKey = searchParams.toString();
  const [selectedMonth, setSelectedMonth] = useSessionState<number>("nest:view:receivables:month", () => new Date().getMonth() + 1);
  const [sortBy, setSortBy] = useSessionState<"amount" | "title" | "receivableDate" | "transactionDate">("nest:view:receivables:sort", "receivableDate");
  const [sortDir, setSortDir] = useSessionState<"asc" | "desc">("nest:view:receivables:direction", "desc");
  const [hideClosed, setHideClosed] = useSessionState("nest:view:receivables:hide-closed", true);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closingReceivableId, setClosingReceivableId] = useState<string | null>(null);
  const [deletingReceivableIds, setDeletingReceivableIds] = useState<string[]>([]);
  const [hydratedReceivableUrlKey, setHydratedReceivableUrlKey] = useState<string | null>(null);
  const urlFiltersReady = hydratedReceivableUrlKey === receivableUrlKey;

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

  useEffect(() => {
    const month = Number(searchParams.get("month"));
    const sort = searchParams.get("sort");
    const direction = searchParams.get("direction");
    const closed = searchParams.get("closed");
    if (Number.isInteger(month) && month >= 1 && month <= 12) setSelectedMonth(month);
    if (sort === "amount" || sort === "title" || sort === "receivableDate" || sort === "transactionDate") setSortBy(sort);
    if (direction === "asc" || direction === "desc") setSortDir(direction);
    if (closed !== null) setHideClosed(closed !== "include");
    setHydratedReceivableUrlKey(receivableUrlKey);
  }, [receivableUrlKey, searchParams, setHideClosed, setSelectedMonth, setSortBy, setSortDir]);

  useUrlFilterSync({
    month: selectedMonth,
    sort: sortBy,
    direction: sortDir,
    closed: hideClosed ? "hide" : "include",
  }, urlFiltersReady);

  const context = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const receivableDefaultAccountId = context.data?.defaultAccountId ?? null;
  const receivableDefaultBudgetId = context.data?.defaultBudgetId ?? null;
  const { format: formatCents } = useMoneyFormat(baseCurrency);

  const receivables = useQuery({
    queryKey: queryKeys.key(["receivables", workspaceId]),
    queryFn: () => fetchJson<Receivable[]>(`/api/receivables?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const activeWorkspaceAccounts = useQuery(bankAccountsQueryOptions(workspaceId));
  const activeWorkspaceBudgets = useQuery({
    queryKey: queryKeys.key(["budgets", workspaceId]),
    queryFn: () => fetchJson<DeductionBudget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const deductionAccounts = useQuery({
    ...bankAccountsQueryOptions(formDeductWorkspaceId),
    enabled: formUseCrossWorkspaceDeduction && Boolean(formDeductWorkspaceId),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const deductionBudgets = useQuery({
    queryKey: queryKeys.key(["budgets", formDeductWorkspaceId]),
    queryFn: () => fetchJson<DeductionBudget[]>(`/api/budgets?workspaceId=${formDeductWorkspaceId}`),
    enabled: formUseCrossWorkspaceDeduction && Boolean(formDeductWorkspaceId),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const deductionBudgetById = useMemo(
    () => new Map((deductionBudgets.data ?? []).map((budget) => [budget.id, budget])),
    [deductionBudgets.data],
  );
  const isDeductionSubaccountsLoading =
    formUseCrossWorkspaceDeduction &&
    Boolean(formDeductWorkspaceId) &&
    (deductionBudgets.isLoading || deductionAccounts.isLoading);

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

  const invalidateReceivableDependencies = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.key(["receivables", workspaceId]), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: queryKeys.key(["receivables-summary"]), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets"]), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts"]), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transactions"]), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
  };

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
      invalidateReceivableDependencies();
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
      expectedUpdatedAt: string;
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
          expectedUpdatedAt: payload.expectedUpdatedAt,
        }),
      }),
    onSuccess: () => {
      invalidateReceivableDependencies();
      closeModal();
    },
  });

  const closeReceivable = useMutation({
    mutationFn: (payload: { id: string }) =>
      fetchJson(`/api/receivables/${payload.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `receivable-close:${payload.id}` },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      setCloseError(null);
      setClosingReceivableId(null);
      invalidateReceivableDependencies();
    },
    onError: (error) => {
      setClosingReceivableId(null);
      setCloseError((error as Error)?.message || "Failed to close receivable");
    },
  });

  const deleteReceivable = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/receivables/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_result, id) => {
      setDeletingReceivableIds((current) => current.filter((item) => item !== id));
      queryClient.setQueryData<Receivable[]>(
        ["receivables", workspaceId],
        (current) => (current ?? []).filter((receivable) => receivable.id !== id),
      );
      invalidateReceivableDependencies();
    },
    onError: (_error, id) => {
      setDeletingReceivableIds((current) => current.filter((item) => item !== id));
    },
  });
  const isSavingReceivable = createReceivable.isPending || updateReceivable.isPending;

  const confirmCloseReceivable = async (receivable: Receivable) => {
    const targetAccount = activeWorkspaceAccounts.data?.find((account) => account.id === receivableDefaultAccountId);
    const targetBudget = activeWorkspaceBudgets.data?.find((budget) => budget.id === receivableDefaultBudgetId);
    const sourceIsTarget = receivable.budget?.id === targetBudget?.id;
    const confirmed = await confirmMoneyChange({
      title: "Confirm receivable close",
      message: "Closing marks this receivable paid and posts its ledger entries. Review any cross-workspace deduction carefully.",
      confirmLabel: "Close and post",
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      details: [
        { label: "Source", value: receivable.account ? `${receivable.account.workspace.name} · ${receivable.account.name} · ${receivable.budget?.name || "Sub-account"}` : "External payer" },
        { label: "Destination", value: `${context.data?.workspaceName || "Current workspace"} · ${targetAccount?.name || "Default receivable account"} · ${targetBudget?.name || "Default receivable sub-account"}` },
        { label: "Amount", value: formatCents(receivable.amountCents), tone: "positive" },
        { label: "Date", value: new Date().toLocaleDateString("en-SG") },
        ...(!sourceIsTarget && receivable.budget ? [{ label: "Resulting source balance", value: formatCents(receivable.budget.availableCents - receivable.amountCents), tone: "negative" as const }] : []),
        { label: "Resulting destination balance", value: formatCents((targetBudget?.availableCents ?? 0) + receivable.amountCents), tone: "positive" },
      ],
      reversal: "Available from Transactions as immutable compensating entries; the paid receivable remains auditable.",
    });
    if (!confirmed) return;
    setCloseError(null);
    setClosingReceivableId(receivable.id);
    closeReceivable.mutate({ id: receivable.id });
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
      const aa = (a.title || "").toLowerCase();
      const bb = (b.title || "").toLowerCase();
      return aa.localeCompare(bb) * dir;
    });
    return list;
  }, [receivables.data, sortBy, sortDir]);

  const monthlyCounts = useMemo(() => {
    const counts = Array.from({ length: 12 }, () => 0);
    for (const item of receivables.data ?? []) {
      if (item.status !== "OPEN" && item.status !== "PARTIAL") continue;
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
      const currentReceivable = receivables.data?.find((receivable) => receivable.id === activeId);
      if (!currentReceivable) return;
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
        expectedUpdatedAt: currentReceivable.updatedAt,
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

  useEffect(() => {
    if (modalMode !== "create") return;
    if (!formTransactionDate) return;
    setFormReceivableDate(getMonthEndDateInputValue(formTransactionDate));
  }, [modalMode, formTransactionDate]);

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
          {isLoading ? (
            <ReceivablesSummarySkeleton />
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
              <Button
                key={label}
                className={`recv-month-chip ${stateClass} ${isActive ? "is-active" : ""}`}
                onClick={() => {
                  setSelectedMonth(month);
                  setCloseError(null);
                }}
                type="button"
              >
                <span className="recv-month-chip-label">{label}</span>
                {count > 0 ? <span className="recv-month-chip-count">{count}</span> : null}
              </Button>
            );
          })}
        </div>
        {closeError && (
          <div style={{ marginBottom: "12px", padding: "12px 16px", background: "var(--danger-bg, #fee2e2)", border: "1px solid var(--danger, #ef4444)", borderRadius: "var(--r-md, 8px)", color: "var(--danger, #dc2626)", fontSize: "13px" }}>
            <strong>Cannot close receivable:</strong> {closeError}
            <Button
              onClick={() => setCloseError(null)}
              style={{ marginLeft: "12px", background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "inherit" }}
            >
              ✕
            </Button>
          </div>
        )}
        <div className="recv-toolbar">
          <Select
            className="input"
            style={{ maxWidth: "190px" }}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "amount" | "title" | "receivableDate" | "transactionDate")}
          >
            <option value="amount">Sort: Amount</option>
            <option value="title">Sort: Title</option>
            <option value="receivableDate">Sort: Receivable Date</option>
            <option value="transactionDate">Sort: Transaction Date</option>
          </Select>
          <Select className="input" style={{ maxWidth: "140px" }} value={sortDir} onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}>
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </Select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }}>
            <Input
              type="checkbox"
              checked={hideClosed}
              onChange={(e) => setHideClosed(e.target.checked)}
            />
            Hide closed
          </label>
          <Button className="btn btn-primary recv-add-btn mobile-primary-create" type="button" onClick={openCreateModal} title="Add receivable" aria-label="Add receivable">
            <Plus size={18} aria-hidden="true" />
            <span className="mobile-primary-create-label">Add Receivable</span>
          </Button>
        </div>
        {isLoading ? (
          <ReceivablesListSkeleton />
        ) : (
          <div className="simple-list">
            {isError && (
              <EmptyState
                icon="⚠️"
                title="Failed to load receivables"
                action={
                  <Button className="btn btn-primary" onClick={() => refetch()}>
                    Retry
                  </Button>
                }
              />
            )}

            {!isError && monthFilteredReceivables.map((r) => {
            const isClosing = closingReceivableId === r.id;
            const isDeleting = deletingReceivableIds.includes(r.id);
            return (
              <div key={r.id} className="crud-row recv-row">
                <div className="recv-row-main">
                  <div className="recv-row-title">
                    {r.title || "Untitled"}
                  </div>

                  <div className="recv-row-meta">
                    {r.transactionDate ? formatDisplayDate(r.transactionDate) : "—"}
                    {r.account ? ` · 💰 ${r.account.workspace.name} - ${r.budget?.name ?? r.account.name}` : ""}
                  </div>
                </div>

                <div className={`recv-row-amount ${getAmountToneClass(r.amountCents)}`}>
                  {formatCents(r.amountCents)}
                </div>

                <div className="recv-row-actions">
                  {isDeleting ? (
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-tertiary)" }}>Deleting...</span>
                  ) : r.status !== "PAID" ? (
                    <Button
                      className="btn btn-primary btn-xs"
                      onClick={() => void confirmCloseReceivable(r)}
                      disabled={Boolean(closingReceivableId) || !receivableDefaultAccountId || !receivableDefaultBudgetId}
                      title={
                        receivableDefaultAccountId && receivableDefaultBudgetId
                          ? "Close receivable"
                          : "Configure default receivable account and subaccount in Settings"
                      }
                    >
                      {isClosing ? "Closing..." : "Close"}
                    </Button>
                  ) : null}
                  <Button
                    className="btn btn-ghost btn-icon"
                    style={{ width: "32px", height: "32px" }}
                    onClick={() => openEditModal(r)}
                    title="Edit"
                    aria-label="Edit receivable"
                    disabled={isDeleting}
                  >
                    ✎
                  </Button>
                  <Button
                    className="btn btn-ghost btn-icon"
                    style={{ width: "32px", height: "32px", color: "var(--danger)" }}
                    onClick={async () => {
                      if (await confirmDestructiveAction("Delete this receivable?", "Delete receivable?", {
                        workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
                        reversal: "This cannot be undone. Close the receivable instead if you need an auditable paid record.",
                      })) {
                        if (deletingReceivableIds.includes(r.id)) return;
                        setDeletingReceivableIds((current) => [...current, r.id]);
                        window.setTimeout(() => {
                          deleteReceivable.mutate(r.id);
                        }, 180);
                      }
                    }}
                    disabled={deleteReceivable.isPending || isDeleting}
                    title="Delete"
                    aria-label="Delete receivable"
                  >
                    🗑
                  </Button>
                </div>
              </div>
            );
            })}
            {!isError && monthFilteredReceivables.length === 0 && (
              <EmptyState
                icon="📥"
                title={hideClosed ? "No open receivables for this month" : "No receivables for this month"}
                description={hideClosed ? "All receivables are closed. Uncheck 'Hide closed' to see them." : "Add a receivable to track money owed to you and expected payment dates."}
                action={
                  <Button className="btn btn-primary" onClick={openCreateModal}>
                    + Add Receivable
                  </Button>
                }
              />
            )}
          </div>
        )}
      </section>

      {isModalOpen && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={closeModal} title={modalMode === "edit" ? "Edit receivable" : "Add receivable"} closeDisabled={isSavingReceivable} surface="custom" overlayClassName="profile-modal-overlay">
          <div className="profile-modal recv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>{modalMode === "edit" ? "Edit Receivable" : "Add Receivable"}</h3>
              <ModalCloseButton onClick={closeModal} disabled={isSavingReceivable} label={`Close ${modalMode === "edit" ? "Edit Receivable" : "Add Receivable"}`} />
            </div>
            <form className="modal-form-shell" onSubmit={onSubmit}>
              <div className="profile-modal-body recv-modal-body">
                <div className="recv-modal-form">
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Title
                  <Input className="input" placeholder="Title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Receivable Date
                  <Input className="input" type="date" value={formReceivableDate} onChange={(e) => setFormReceivableDate(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Transaction Date
                  <Input className="input" type="date" value={formTransactionDate} onChange={(e) => setFormTransactionDate(e.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Amount
                  <NumericCalculatorInput
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={formAmount}
                    onValueChange={setFormAmount}
                  />
                </label>
                <MarkdownEditor
                  className="modal-grid-span-2"
                  label="Notes"
                  value={formNotes}
                  onChange={setFormNotes}
                  placeholder="Write notes in Markdown"
                  calculator
                />
                <label className="modal-grid-span-2" style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  <Input
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
                      <Select
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
                      </Select>
                    </label>
                    <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                      Deduction Sub Account
                      <div className={`recv-field-shell ${isDeductionSubaccountsLoading ? "is-loading" : ""}`}>
                        <Select
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
                            isDeductionSubaccountsLoading ||
                            (deductionBudgets.data ?? []).length === 0
                          }
                        >
                          <option value="">
                            {isDeductionSubaccountsLoading ? "Loading subaccounts..." : "Select subaccount"}
                          </option>
                          {(deductionBudgets.data ?? [])
                            .filter((budget) => budget.isActive !== false)
                            .map((budget) => (
                              <option key={budget.id} value={budget.id}>
                                {budget.icon ? `${budget.icon} ` : ""}
                                {budget.name}
                              </option>
                            ))}
                        </Select>
                      </div>
                    </label>
                  </>
                )}
                {modalMode === "edit" && (
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Status
                    <Select className="input" value={formStatus} onChange={(e) => setFormStatus(e.target.value as Receivable["status"])}>
                      <option value="OPEN">OPEN</option>
                      <option value="PARTIAL">PARTIAL</option>
                      <option value="PAID">PAID</option>
                      <option value="VOID">VOID</option>
                    </Select>
                  </label>
                )}
                {isSavingReceivable && (
                  <div className="modal-grid-span-2 recv-save-status" aria-live="polite">
                    <div className="workspace-save-progress" aria-hidden="true">
                      <div className="workspace-save-progress-bar" />
                    </div>
                    <div className="recv-save-status-text">
                      {modalMode === "edit" ? "Saving receivable..." : "Creating receivable..."}
                    </div>
                  </div>
                )}
                <MutationErrorSummary
                  className="modal-grid-span-2"
                  error={createReceivable.error || updateReceivable.error || closeReceivable.error || deleteReceivable.error}
                  onReload={async () => {
                    closeModal();
                    await receivables.refetch();
                  }}
                />
                </div>
              </div>
              <div className="txn-modal-actions">
                <Button className="btn btn-ghost" type="button" onClick={closeModal} disabled={isSavingReceivable}>
                  Cancel
                </Button>
                <Button
                  className={`btn btn-primary ${isSavingReceivable ? "recv-save-btn is-saving" : ""}`}
                  type="submit"
                  disabled={isSavingReceivable}
                >
                  {isSavingReceivable ? (
                    <>
                      <span className="recv-save-spinner" aria-hidden="true" />
                      {modalMode === "edit" ? "Saving..." : "Adding..."}
                    </>
                  ) : (
                    modalMode === "edit" ? "Save" : "Add"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>,
        document.body
      )}
    </div>
  );
}
