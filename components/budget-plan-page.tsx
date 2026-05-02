"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, GeneratingState, SkeletonCard, SkeletonGrid } from "@/components/ui-skeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";

type BudgetItem = {
  id: string;
  title: string;
  amountCents: number;
  isMonthly: boolean;
  destinationSubAccountId: string | null;
  destinationSubAccount: { id: string; name: string } | null;
};

type BudgetSource = {
  id: string;
  title: string;
  amountCents: number;
  ownerId: string;
  owner: { id: string; name: string | null; email: string | null };
};

type MonthlyBudgetSource = {
  id: string;
  budgetSourceId: string;
  year: number;
  month: number;
  title: string;
  ownerId: string;
  amountCents: number;
  isDraft: boolean;
  owner: { id: string; name: string | null; email: string | null };
};

type WorkspaceMember = {
  user: { id: string; name: string | null; email: string | null };
};

type MonthlyBudget = {
  id: string;
  budgetItemId: string;
  budgetSourceId: string;
  year: number;
  month: number;
  isDraft: boolean;
  allocatedCents: number;
  budgetItemTitle?: string | null;
  budgetSourceTitle?: string | null;
  budgetItem: { id: string; title: string };
  budgetSource: { id: string; title: string };
};

type AllocationPreview = {
  id?: string;
  budgetItemId: string;
  budgetItemTitle: string;
  budgetSourceId: string;
  budgetSourceTitle: string;
  allocatedCents: number;
};

type AllocationSummary = {
  id: string;
  title: string;
  allocatedCents: number;
};

type GenerateMonthlyPayload = {
  workspaceId: string;
  action: "generateMonthly";
  year: number;
  month: number;
};

type GenerateMonthlyResponse = {
  monthlyBudgets: Array<{
    id: string;
    budgetItemId: string;
    budgetSourceId: string;
    budgetItemTitle?: string | null;
    budgetSourceTitle?: string | null;
    allocatedCents: number;
  }>;
};

type AppContext = {
  workspaceId: string | null;
  baseCurrency?: string | null;
};

type BudgetPlanData = {
  budgetItems: BudgetItem[];
  budgetSources: BudgetSource[];
  monthlyBudgetSources: MonthlyBudgetSource[];
  monthlyBudgets: MonthlyBudget[];
  members: WorkspaceMember[];
  subAccounts: { id: string; name: string }[];
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) {
        detail = `${detail}: ${body.message}`;
      } else if (body?.error && typeof body.error === "string") {
        detail = `${detail}: ${body.error}`;
      }
    } catch {
      // Ignore non-JSON error bodies and fall back to status code.
    }
    throw new Error(detail);
  }
  return res.json();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function BudgetPlanPage() {
  const queryClient = useQueryClient();

  // Template management visibility
  const [showTemplate, setShowTemplate] = useState(false);

  // Modal states
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);

  // Form states for budget items
  const [itemTitle, setItemTitle] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [itemIsMonthly, setItemIsMonthly] = useState(true);
  const [itemDestinationId, setItemDestinationId] = useState("");

  // Form states for budget sources
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceAmount, setSourceAmount] = useState("");
  const [sourceOwnerId, setSourceOwnerId] = useState("");

  // Month/year for generation
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  // Preview state for editable allocation
  const [previewAllocations, setPreviewAllocations] = useState<AllocationPreview[] | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [editingAllocationTarget, setEditingAllocationTarget] = useState<{ type: "source" | "item"; id: string } | null>(null);
  const [editingAllocationAmount, setEditingAllocationAmount] = useState("");
  const [isAddAllocationModalOpen, setIsAddAllocationModalOpen] = useState(false);
  const [allocationItemId, setAllocationItemId] = useState("");
  const [allocationSourceId, setAllocationSourceId] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("");
  const [quickEditTarget, setQuickEditTarget] = useState<{ type: "item" | "source"; id: string } | null>(null);
  const [quickEditDescription, setQuickEditDescription] = useState("");
  const [quickEditAmount, setQuickEditAmount] = useState("");

  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmProgress, setConfirmProgress] = useState(0);
  const [confirmStage, setConfirmStage] = useState("");
  const [pendingConfirmApplyToSubAccounts, setPendingConfirmApplyToSubAccounts] = useState(false);
  const confirmProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);


  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const formatCents = (cents: number) => formatMoney(cents, baseCurrency);

  const budgetData = useQuery({
    queryKey: ["budget-plan", workspaceId, selectedYear, selectedMonth],
    queryFn: () =>
      fetchJson<{
        budgetItems: BudgetItem[];
        budgetSources: BudgetSource[];
        monthlyBudgetSources: MonthlyBudgetSource[];
        monthlyBudgets: MonthlyBudget[];
        members: WorkspaceMember[];
        subAccounts: { id: string; name: string }[];
      }>(`/api/budgets/plan?workspaceId=${workspaceId}&year=${selectedYear}&month=${selectedMonth}`),
    enabled: Boolean(workspaceId),
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: false,
  });

  const budgetItems = budgetData.data?.budgetItems || [];
  const budgetSources = budgetData.data?.budgetSources || [];
  const monthlyBudgetSources = budgetData.data?.monthlyBudgetSources || [];
  const monthlyBudgets = budgetData.data?.monthlyBudgets || [];
  const members: WorkspaceMember[] = budgetData.data?.members || [];
  const subAccounts = budgetData.data?.subAccounts || [];
  const budgetDataError = budgetData.error instanceof Error ? budgetData.error.message : null;
  const isTemplateReady = budgetItems.length > 0 && budgetSources.length > 0;
  const hasDraftMonthlyBudgets = monthlyBudgets.some((budget) => budget.isDraft);

  // Template counts for display
  const templateCounts = useMemo(() => ({
    items: budgetItems.length,
    sources: budgetSources.length,
  }), [budgetItems, budgetSources]);

  const persistedAllocations = useMemo(
    () =>
      monthlyBudgets.map((mb) => ({
        id: mb.id,
        budgetItemId: mb.budgetItemId,
        budgetItemTitle: mb.budgetItemTitle || mb.budgetItem.title,
        budgetSourceId: mb.budgetSourceId,
        budgetSourceTitle: mb.budgetSourceTitle || mb.budgetSource.title,
        allocatedCents: mb.allocatedCents,
      })),
    [monthlyBudgets],
  );

  const displayAllocations = isPreviewMode && previewAllocations ? previewAllocations : persistedAllocations;

  const sourceAllocationSummaries = useMemo(() => {
    const grouped = new Map<string, AllocationSummary>();
    for (const allocation of displayAllocations) {
      const current = grouped.get(allocation.budgetSourceId);
      if (current) {
        current.allocatedCents += allocation.allocatedCents;
      } else {
        grouped.set(allocation.budgetSourceId, {
          id: allocation.budgetSourceId,
          title: allocation.budgetSourceTitle,
          allocatedCents: allocation.allocatedCents,
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [displayAllocations]);

  const budgetItemAllocationSummaries = useMemo(() => {
    const grouped = new Map<string, AllocationSummary>();
    for (const allocation of displayAllocations) {
      const current = grouped.get(allocation.budgetItemId);
      if (current) {
        current.allocatedCents += allocation.allocatedCents;
      } else {
        grouped.set(allocation.budgetItemId, {
          id: allocation.budgetItemId,
          title: allocation.budgetItemTitle,
          allocatedCents: allocation.allocatedCents,
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [displayAllocations]);

  const editingAllocationSummary = useMemo(() => {
    if (!editingAllocationTarget) return null;
    return editingAllocationTarget.type === "source"
      ? sourceAllocationSummaries.find((entry) => entry.id === editingAllocationTarget.id) ?? null
      : budgetItemAllocationSummaries.find((entry) => entry.id === editingAllocationTarget.id) ?? null;
  }, [budgetItemAllocationSummaries, editingAllocationTarget, sourceAllocationSummaries]);
  const editingAllocationTemplateSource = useMemo(() => {
    if (!editingAllocationTarget || editingAllocationTarget.type !== "source") return null;
    return monthlyBudgetSources.find((entry) => entry.budgetSourceId === editingAllocationTarget.id) ?? null;
  }, [monthlyBudgetSources, editingAllocationTarget]);

  const monthlyTotal = useMemo(
    () => displayAllocations.reduce((sum, allocation) => sum + allocation.allocatedCents, 0),
    [displayAllocations],
  );

  const planningSources = useMemo(
    () =>
      monthlyBudgetSources.length > 0
        ? monthlyBudgetSources
        : budgetSources.map((source) => ({
            id: `template-${source.id}`,
            budgetSourceId: source.id,
            year: selectedYear,
            month: selectedMonth,
            title: source.title,
            ownerId: source.ownerId,
            amountCents: source.amountCents,
            isDraft: true,
            owner: source.owner,
          })),
    [monthlyBudgetSources, budgetSources, selectedYear, selectedMonth],
  );
  const templateSourceTotal = useMemo(
    () => planningSources.reduce((sum, source) => sum + source.amountCents, 0),
    [planningSources],
  );
  const templateItemTotal = useMemo(
    () => budgetItems.filter((item) => item.isMonthly).reduce((sum, item) => sum + item.amountCents, 0),
    [budgetItems],
  );
  const sourceAllocatedById = useMemo(
    () => new Map(sourceAllocationSummaries.map((entry) => [entry.id, entry.allocatedCents])),
    [sourceAllocationSummaries],
  );
  const itemAllocatedById = useMemo(
    () => new Map(budgetItemAllocationSummaries.map((entry) => [entry.id, entry.allocatedCents])),
    [budgetItemAllocationSummaries],
  );
  const overAllocatedSources = useMemo(
    () => planningSources.filter((source) => (sourceAllocatedById.get(source.budgetSourceId) ?? 0) > source.amountCents),
    [planningSources, sourceAllocatedById],
  );
  const itemTargetMismatches = useMemo(
    () => budgetItems
      .filter((item) => item.isMonthly)
      .filter((item) => (itemAllocatedById.get(item.id) ?? 0) !== item.amountCents),
    [budgetItems, itemAllocatedById],
  );
  const totalUnallocatedSourceCents = Math.max(0, templateSourceTotal - monthlyTotal);
  // Approve allowed when total allocated equals total sources
  const canApproveMonthly = monthlyTotal === templateSourceTotal;

  const createBudgetItem = useMutation<BudgetItem, Error, {
    workspaceId: string;
    action: "createItem";
    title: string;
    amountCents: number;
    isMonthly: boolean;
    destinationSubAccountId?: string;
  }>({
    mutationFn: (payload) =>
      fetchJson<BudgetItem>("/api/budgets/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      // Optimistically add the new item to the cache
      queryClient.setQueryData<BudgetPlanData>(
        ["budget-plan", workspaceId, selectedYear, selectedMonth],
        (old) => {
          if (!old) return old;
          return { ...old, budgetItems: [...old.budgetItems, data] };
        }
      );
      closeItemModal();
    },
  });

  const createBudgetSource = useMutation<BudgetSource, Error, {
    workspaceId: string;
    action: "createSource";
    title: string;
    amountCents: number;
    ownerId: string;
  }>({
    mutationFn: (payload) =>
      fetchJson<BudgetSource>("/api/budgets/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      // Optimistically add the new source to the cache
      queryClient.setQueryData<BudgetPlanData>(
        ["budget-plan", workspaceId, selectedYear, selectedMonth],
        (old) => {
          if (!old) return old;
          return { ...old, budgetSources: [...old.budgetSources, data] };
        }
      );
      closeSourceModal();
    },
  });

  const createMonthlyBudgetSource = useMutation<
    MonthlyBudgetSource,
    Error,
    {
      workspaceId: string;
      action: "createMonthlySource";
      year: number;
      month: number;
      title: string;
      amountCents: number;
      ownerId: string;
    }
  >({
    mutationFn: (payload) =>
      fetchJson<MonthlyBudgetSource>("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<BudgetPlanData>(
        ["budget-plan", workspaceId, selectedYear, selectedMonth],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            budgetSources: old.budgetSources.some((source) => source.id === data.budgetSourceId)
              ? old.budgetSources
              : [
                  ...old.budgetSources,
                  {
                    id: data.budgetSourceId,
                    title: data.title,
                    amountCents: data.amountCents,
                    ownerId: data.ownerId,
                    owner: data.owner,
                  },
                ],
            monthlyBudgetSources: [...old.monthlyBudgetSources, data],
          };
        },
      );
      closeSourceModal();
    },
  });

  const confirmMonthly = useMutation({
    mutationFn: (payload: {
      workspaceId: string;
      action: "confirmMonthly";
      year: number;
      month: number;
      allocations: AllocationPreview[];
      applyToSubAccounts: boolean;
    }) => fetchJson("/api/budgets/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
      queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setIsPreviewMode(false);
      setPreviewAllocations(null);
    },
  });

  const addMonthlyAllocation = useMutation({
    mutationFn: (payload: {
      workspaceId: string;
      action: "addAllocation";
      year: number;
      month: number;
      budgetItemId: string;
      budgetSourceId: string;
      allocatedCents: number;
    }) =>
      fetchJson<{
        id: string;
        budgetItemId: string;
        budgetSourceId: string;
        budgetItemTitle?: string | null;
        budgetSourceTitle?: string | null;
        allocatedCents: number;
      }>("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (allocation) => {
      const itemTitle =
        allocation.budgetItemTitle || budgetItems.find((item) => item.id === allocation.budgetItemId)?.title || "Unknown";
      const sourceTitle =
        allocation.budgetSourceTitle ||
        planningSources.find((source) => source.budgetSourceId === allocation.budgetSourceId)?.title ||
        "Unknown";
      setPreviewAllocations((current) => {
        const next = current ? [...current] : [];
        const nextAllocation = {
          id: allocation.id,
          budgetItemId: allocation.budgetItemId,
          budgetItemTitle: itemTitle,
          budgetSourceId: allocation.budgetSourceId,
          budgetSourceTitle: sourceTitle,
          allocatedCents: allocation.allocatedCents,
        };
        const existingIndex = next.findIndex(
          (entry) =>
            entry.budgetItemId === allocation.budgetItemId && entry.budgetSourceId === allocation.budgetSourceId,
        );
        if (existingIndex >= 0) {
          next[existingIndex] = nextAllocation;
        } else {
          next.push(nextAllocation);
        }
        return next;
      });
      setIsPreviewMode(true);
      closeAddAllocationModal();
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
    },
  });

  const deleteMonthlyAllocation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      fetchJson(`/api/budgets/plan?id=${id}&type=allocation&workspaceId=${workspaceId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
    },
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/budgets/plan?id=${id}&type=item`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["budget-plan"] }),
  });

  const deleteSource = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/budgets/plan?id=${id}&type=source`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["budget-plan"] }),
  });

  const updateBudgetItem = useMutation({
    mutationFn: (payload: {
      id: string;
      workspaceId: string;
      action: "updateItem";
      title: string;
      amountCents: number;
      isMonthly: boolean;
      destinationSubAccountId?: string;
    }) => fetchJson("/api/budgets/plan", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
      closeItemModal();
    },
  });

  const updateBudgetSource = useMutation({
    mutationFn: (payload: {
      id: string;
      workspaceId: string;
      action: "updateSource";
      title: string;
      amountCents: number;
      ownerId: string;
    }) => fetchJson("/api/budgets/plan", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
      closeSourceModal();
    },
  });
  const quickUpdateBudgetItem = useMutation({
    mutationFn: (payload: {
      id: string;
      workspaceId: string;
      action: "updateItem";
      title: string;
      amountCents: number;
      isMonthly: boolean;
      destinationSubAccountId?: string;
    }) => fetchJson("/api/budgets/plan", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
      closeQuickEditModal();
    },
  });

  const quickUpdateBudgetSource = useMutation({
    mutationFn: (payload: {
      id: string;
      workspaceId: string;
      action: "updateSource";
      title: string;
      amountCents: number;
      ownerId: string;
    }) => fetchJson("/api/budgets/plan", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
      closeQuickEditModal();
    },
  });

  const openAddItemModal = () => {
    setEditingItemId(null);
    setItemTitle("");
    setItemAmount("");
    setItemIsMonthly(true);
    setItemDestinationId("");
    setIsAddItemModalOpen(true);
  };

  const openEditItemModal = (item: BudgetItem) => {
    setEditingItemId(item.id);
    setItemTitle(item.title);
    setItemAmount((item.amountCents / 100).toFixed(2));
    setItemIsMonthly(item.isMonthly);
    setItemDestinationId(item.destinationSubAccountId || "");
    setIsAddItemModalOpen(true);
  };

  const closeItemModal = () => {
    setIsAddItemModalOpen(false);
    setEditingItemId(null);
    setItemTitle("");
    setItemAmount("");
    setItemDestinationId("");
  };

  const openAddSourceModal = () => {
    setEditingSourceId(null);
    setSourceTitle("");
    setSourceAmount("");
    setSourceOwnerId("");
    setIsAddSourceModalOpen(true);
  };

  const openEditSourceModal = (source: BudgetSource) => {
    setEditingSourceId(source.id);
    setSourceTitle(source.title);
    setSourceAmount((source.amountCents / 100).toFixed(2));
    setSourceOwnerId(source.ownerId);
    setIsAddSourceModalOpen(true);
  };

  const closeSourceModal = () => {
    setIsAddSourceModalOpen(false);
    setEditingSourceId(null);
    setSourceTitle("");
    setSourceAmount("");
    setSourceOwnerId("");
  };

  const onSubmitItem = (e: FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !itemTitle || !itemAmount) return;
    if (editingItemId) {
      updateBudgetItem.mutate({
        id: editingItemId,
        workspaceId,
        action: "updateItem",
        title: itemTitle,
        amountCents: Math.round(parseFloat(itemAmount) * 100),
        isMonthly: itemIsMonthly,
        destinationSubAccountId: itemDestinationId || undefined,
      });
    } else {
      createBudgetItem.mutate({
        workspaceId,
        action: "createItem",
        title: itemTitle,
        amountCents: Math.round(parseFloat(itemAmount) * 100),
        isMonthly: itemIsMonthly,
        destinationSubAccountId: itemDestinationId || undefined,
      });
    }
  };

  const onSubmitSource = (e: FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !sourceTitle || !sourceAmount || !sourceOwnerId) return;
    const amountCents = Math.round(parseFloat(sourceAmount) * 100);
    if (editingSourceId) {
      updateBudgetSource.mutate({
        id: editingSourceId,
        workspaceId,
        action: "updateSource",
        title: sourceTitle,
        amountCents,
        ownerId: sourceOwnerId,
      });
    } else if (isPreviewMode) {
      createMonthlyBudgetSource.mutate({
        workspaceId,
        action: "createMonthlySource",
        year: selectedYear,
        month: selectedMonth,
        title: sourceTitle,
        amountCents,
        ownerId: sourceOwnerId,
      });
    } else {
      createBudgetSource.mutate({
        workspaceId,
        action: "createSource",
        title: sourceTitle,
        amountCents,
        ownerId: sourceOwnerId,
      });
    }
  };

  const generateMonthly = useMutation<GenerateMonthlyResponse, Error, GenerateMonthlyPayload>({
    mutationFn: (payload) =>
      fetchJson<GenerateMonthlyResponse>("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      const allocations: AllocationPreview[] = data.monthlyBudgets.map((mb) => ({
        id: mb.id,
        budgetItemId: mb.budgetItemId,
        budgetItemTitle: mb.budgetItemTitle || budgetItems.find(i => i.id === mb.budgetItemId)?.title || "Unknown",
        budgetSourceId: mb.budgetSourceId,
        budgetSourceTitle: mb.budgetSourceTitle || planningSources.find((s) => s.budgetSourceId === mb.budgetSourceId)?.title || "Unknown",
        allocatedCents: mb.allocatedCents,
      }));
      setPreviewAllocations(allocations);
      setIsPreviewMode(true);
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
    },
  });

  const generatePreview = () => {
    if (!workspaceId || budgetItems.length === 0 || planningSources.length === 0) return;
    generateMonthly.mutate({
      workspaceId,
      action: "generateMonthly",
      year: selectedYear,
      month: selectedMonth,
    });
  };

  const persistAllocations = (allocations: AllocationPreview[]) => {
    if (!workspaceId) return;
    for (const alloc of allocations) {
      fetch("/api/budgets/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          action: "updateAllocation",
          id: alloc.id,
          year: selectedYear,
          month: selectedMonth,
          budgetItemId: alloc.budgetItemId,
          budgetSourceId: alloc.budgetSourceId,
          allocatedCents: alloc.allocatedCents,
        }),
      });
    }
  };

  const distributeTotal = (rows: AllocationPreview[], totalCents: number) => {
    if (rows.length === 0) return [] as AllocationPreview[];
    if (totalCents <= 0) {
      return rows.map((row) => ({ ...row, allocatedCents: 0 }));
    }

    const existingTotal = rows.reduce((sum, row) => sum + row.allocatedCents, 0);
    let allocatedSoFar = 0;

    return rows.map((row, index) => {
      const allocatedCents =
        index === rows.length - 1
          ? totalCents - allocatedSoFar
          : existingTotal > 0
            ? Math.round((totalCents * row.allocatedCents) / existingTotal)
            : Math.floor(totalCents / rows.length);
      allocatedSoFar += allocatedCents;
      return { ...row, allocatedCents };
    });
  };

  const updateAllocationSummary = (target: { type: "source" | "item"; id: string }, newCents: number) => {
    if (!previewAllocations || !workspaceId) return;
    const matchingRows = previewAllocations.filter((allocation) =>
      target.type === "source" ? allocation.budgetSourceId === target.id : allocation.budgetItemId === target.id,
    );
    if (matchingRows.length === 0) return;

    const redistributedRows = distributeTotal(matchingRows, Math.max(0, newCents));
    const redistributedById = new Map(
      redistributedRows.map((allocation) => [
        `${allocation.budgetItemId}::${allocation.budgetSourceId}`,
        allocation.allocatedCents,
      ]),
    );
    const updated = previewAllocations.map((allocation) => {
      const key = `${allocation.budgetItemId}::${allocation.budgetSourceId}`;
      const nextCents = redistributedById.get(key);
      return nextCents === undefined ? allocation : { ...allocation, allocatedCents: nextCents };
    });
    setPreviewAllocations(updated);
    persistAllocations(updated.filter((allocation) =>
      target.type === "source" ? allocation.budgetSourceId === target.id : allocation.budgetItemId === target.id,
    ));
  };

  const openConfirmDialog = () => {
    setShowConfirmDialog(true);
    setConfirmProgress(0);
    setConfirmStage("Click Save to finalize...");
  };

  const clearConfirmProgressTimer = () => {
    if (confirmProgressTimerRef.current) {
      clearInterval(confirmProgressTimerRef.current);
      confirmProgressTimerRef.current = null;
    }
  };

  const resetConfirmDialog = () => {
    clearConfirmProgressTimer();
    setShowConfirmDialog(false);
    setConfirmProgress(0);
    setConfirmStage("");
    setPendingConfirmApplyToSubAccounts(false);
  };

  const executeConfirmMonthly = () => {
    if (!workspaceId || !previewAllocations) return;
    clearConfirmProgressTimer();
    setConfirmProgress(12);
    setConfirmStage("Sending approval request...");

    confirmProgressTimerRef.current = setInterval(() => {
      setConfirmProgress((current) => {
        if (current >= 90) return current;
        return Math.min(90, current + (current < 50 ? 12 : 5));
      });
    }, 450);

    confirmMonthly.mutate({
      workspaceId,
      action: "confirmMonthly",
      year: selectedYear,
      month: selectedMonth,
      allocations: previewAllocations,
      applyToSubAccounts: pendingConfirmApplyToSubAccounts,
    }, {
      onSuccess: () => {
        clearConfirmProgressTimer();
        setConfirmStage("Complete!");
        setConfirmProgress(100);
        setTimeout(() => {
          resetConfirmDialog();
        }, 400);
      },
      onError: (error) => {
        clearConfirmProgressTimer();
        setConfirmStage(error instanceof Error ? error.message : "Error occurred.");
        setTimeout(() => {
          resetConfirmDialog();
        }, 2000);
      },
    });
  };

  const onConfirmMonthly = (applyToSubAccounts: boolean) => {
    setPendingConfirmApplyToSubAccounts(applyToSubAccounts);
    openConfirmDialog();
  };

  const cancelPreview = () => {
    if (!workspaceId) return;
    fetchJson("/api/budgets/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        action: "cancelDraft",
        year: selectedYear,
        month: selectedMonth,
      }),
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
    });
    setIsPreviewMode(false);
    setPreviewAllocations(null);
  };

  const openEditAllocationModal = (target: { type: "source" | "item"; id: string }) => {
    const summary =
      target.type === "source"
        ? sourceAllocationSummaries.find((entry) => entry.id === target.id)
        : budgetItemAllocationSummaries.find((entry) => entry.id === target.id);
    if (!summary) return;
    setEditingAllocationTarget(target);
    setEditingAllocationAmount((summary.allocatedCents / 100).toFixed(2));
  };

  const closeEditAllocationModal = () => {
    setEditingAllocationTarget(null);
    setEditingAllocationAmount("");
  };

  const saveAllocationEdit = () => {
    if (!editingAllocationTarget || !previewAllocations) return;
    const value = parseFloat(editingAllocationAmount || "0");
    if (Number.isNaN(value) || value < 0) return;
    updateAllocationSummary(editingAllocationTarget, Math.round(value * 100));
    closeEditAllocationModal();
  };

  const removeAllocation = () => {
    if (!editingAllocationTarget || !previewAllocations) return;
    const matchingAllocations = previewAllocations.filter((allocation) =>
      editingAllocationTarget.type === "source"
        ? allocation.budgetSourceId === editingAllocationTarget.id
        : allocation.budgetItemId === editingAllocationTarget.id,
    );
    for (const allocation of matchingAllocations) {
      if (allocation.id) {
        deleteMonthlyAllocation.mutate({ id: allocation.id });
      }
    }
    setPreviewAllocations(
      previewAllocations.filter((allocation) =>
        editingAllocationTarget.type === "source"
          ? allocation.budgetSourceId !== editingAllocationTarget.id
          : allocation.budgetItemId !== editingAllocationTarget.id,
      ),
    );
    closeEditAllocationModal();
  };

  const openAddAllocationModal = () => {
    setAllocationItemId(budgetItems[0]?.id || "");
    setAllocationSourceId(planningSources[0]?.budgetSourceId || "");
    setAllocationAmount("");
    setIsAddAllocationModalOpen(true);
  };

  const closeAddAllocationModal = () => {
    setIsAddAllocationModalOpen(false);
    setAllocationItemId("");
    setAllocationSourceId("");
    setAllocationAmount("");
  };

  const saveAddedAllocation = (e: FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !allocationItemId || !allocationSourceId || !allocationAmount) return;
    const amountCents = Math.round(parseFloat(allocationAmount) * 100);
    if (Number.isNaN(amountCents) || amountCents < 0) return;
    addMonthlyAllocation.mutate({
      workspaceId,
      action: "addAllocation",
      year: selectedYear,
      month: selectedMonth,
      budgetItemId: allocationItemId,
      budgetSourceId: allocationSourceId,
      allocatedCents: amountCents,
    });
  };

  const openQuickEditItemModal = (itemId: string) => {
    const item = budgetItems.find((entry) => entry.id === itemId);
    if (!item) return;
    setQuickEditTarget({ type: "item", id: item.id });
    setQuickEditDescription(item.title);
    setQuickEditAmount((item.amountCents / 100).toFixed(2));
  };

  const openQuickEditSourceModal = (sourceId: string) => {
    const source = budgetSources.find((entry) => entry.id === sourceId);
    if (!source) return;
    setQuickEditTarget({ type: "source", id: source.id });
    setQuickEditDescription(source.title);
    setQuickEditAmount((source.amountCents / 100).toFixed(2));
  };

  const confirmDeleteItem = (itemId: string) => {
    if (!confirmDestructiveAction("Delete this budget item?")) return;
    deleteItem.mutate(itemId);
  };

  const confirmDeleteSource = (sourceId: string) => {
    if (!confirmDestructiveAction("Delete this budget source?")) return;
    deleteSource.mutate(sourceId);
  };

  const closeQuickEditModal = () => {
    setQuickEditTarget(null);
    setQuickEditDescription("");
    setQuickEditAmount("");
  };

  const saveQuickEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !quickEditTarget || !quickEditDescription || !quickEditAmount) return;
    const amountCents = Math.round(parseFloat(quickEditAmount) * 100);
    if (Number.isNaN(amountCents) || amountCents < 0) return;

    if (quickEditTarget.type === "item") {
      const item = budgetItems.find((entry) => entry.id === quickEditTarget.id);
      if (!item) return;
      quickUpdateBudgetItem.mutate({
        id: item.id,
        workspaceId,
        action: "updateItem",
        title: quickEditDescription,
        amountCents,
        isMonthly: item.isMonthly,
        destinationSubAccountId: item.destinationSubAccountId || undefined,
      });
      return;
    }

    const source = budgetSources.find((entry) => entry.id === quickEditTarget.id);
    if (!source) return;
    quickUpdateBudgetSource.mutate({
      id: source.id,
      workspaceId,
      action: "updateSource",
      title: quickEditDescription,
      amountCents,
      ownerId: source.ownerId,
    });
  };

  useEffect(() => {
    if (hasDraftMonthlyBudgets) {
      setPreviewAllocations(persistedAllocations);
      setIsPreviewMode(true);
      return;
    }
    setPreviewAllocations(null);
    setIsPreviewMode(false);
  }, [hasDraftMonthlyBudgets, persistedAllocations]);

  return (
    <div className="bp-container">
      {/* Monthly Budget Section - Primary */}
      <section className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h3 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>
              {isPreviewMode ? "Preview Monthly Budget" : `${MONTHS[selectedMonth - 1]} ${selectedYear} Budget`}
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-tertiary)", margin: "4px 0 0" }}>
              {isPreviewMode ? "Review and edit allocations before confirming" : "View and manage monthly allocations"}
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            {!isPreviewMode && (
              <button
                className="btn btn-ghost"
                onClick={() => setShowTemplate(!showTemplate)}
                disabled={budgetData.isLoading}
              >
                {showTemplate ? "Hide Setup" : "Edit Setup"}
              </button>
            )}
          </div>
        </div>

        {/* Month/Year Selection - Always visible */}
        <div className="bp-form" style={{ marginBottom: "20px", paddingBottom: "20px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="form-row">
            <div className="form-group">
              <label className="label">Month</label>
              <select className="input" value={selectedMonth} onChange={(e) => setSelectedMonth(parseInt(e.target.value))}>
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Year</label>
              <NumericCalculatorInput value={selectedYear} allowDecimal={false} onValueChange={(value) => setSelectedYear(parseInt(value || "2024", 10))} min={2024} max={2030} />
            </div>
          </div>
        </div>

        {/* Preview Controls */}
        {isPreviewMode && (
          <div style={{ marginBottom: "20px", padding: "16px", background: "var(--warning-bg)", borderRadius: "var(--r-md)" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: 1, fontSize: "14px" }} />
              <button className="btn btn-ghost" onClick={openAddAllocationModal}>
                Add Allocation
              </button>
              <button className="btn btn-ghost" onClick={openAddSourceModal}>
                Add Source
              </button>
              <button className="btn btn-ghost" onClick={cancelPreview}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => onConfirmMonthly(true)}
                disabled={confirmMonthly.isPending || !canApproveMonthly}
              >
                {confirmMonthly.isPending ? "Saving..." : "Confirm & Save"}
              </button>
            </div>
            {!canApproveMonthly && (
              <p style={{ fontSize: "12px", color: "var(--danger)", marginTop: "8px" }}>
                Approval disabled: allocated {formatCents(monthlyTotal)} ≠ sources {formatCents(templateSourceTotal)} ({formatCents(totalUnallocatedSourceCents)} unallocated)
              </p>
            )}
          </div>
        )}

        {/* Monthly Budget Stats */}
        {(displayAllocations.length > 0 || isPreviewMode) && (
          <div className="bp-stat-grid" style={{ marginBottom: "24px" }}>
            <div className="bp-stat">
              <div className="bp-stat-label">Allocated</div>
              <div className="bp-stat-value">{formatCents(monthlyTotal)}</div>
            </div>
            <div className="bp-stat">
              <div className="bp-stat-label">Monthly Source Plan</div>
              <div className="bp-stat-value">{formatCents(templateSourceTotal)}</div>
              <div className="bp-stat-sub">{formatCents(totalUnallocatedSourceCents)} unallocated</div>
            </div>
            <div className="bp-stat">
              <div className="bp-stat-label">Monthly Item Targets</div>
              <div className="bp-stat-value">{formatCents(templateItemTotal)}</div>
              <div className="bp-stat-sub">{itemTargetMismatches.length} items need review</div>
            </div>
          </div>
        )}

        {/* Generate Button when empty - only show if no monthly budgets exist */}
        {!isPreviewMode && displayAllocations.length === 0 && !generateMonthly.isPending && monthlyBudgets.length === 0 && (
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                className="btn btn-ghost"
                onClick={openAddAllocationModal}
                disabled={budgetData.isLoading || !isTemplateReady}
              >
                + Add Monthly Allocation
              </button>
              <button
                className="btn btn-primary"
                onClick={generatePreview}
                disabled={budgetData.isLoading || !isTemplateReady}
              >
                {budgetData.isLoading ? "Loading..." : "Generate from Template"}
              </button>
            </div>
            {!budgetData.isLoading && !isTemplateReady && (
              <p className="bp-hint">Add budget items and source templates first, then build the monthly plan here.</p>
            )}
          </div>
        )}

        {/* Review & Confirm section when there are existing monthly budgets */}
        {!isPreviewMode && displayAllocations.length > 0 && monthlyBudgets.length > 0 && (
          <div style={{ marginBottom: "20px", padding: "16px", background: "var(--success-bg)", borderRadius: "var(--r-md)", border: "1px solid var(--success)" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: 1, fontSize: "14px", color: "var(--success)" }}>
                A monthly budget already exists for this period. Open it again to review it or create a fresh draft from the current setup.
              </span>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const allocations: AllocationPreview[] = monthlyBudgets.map((mb) => ({
                    id: mb.id,
                    budgetItemId: mb.budgetItemId,
                    budgetItemTitle: mb.budgetItemTitle || mb.budgetItem.title,
                    budgetSourceId: mb.budgetSourceId,
                    budgetSourceTitle: mb.budgetSourceTitle || mb.budgetSource.title,
                    allocatedCents: mb.allocatedCents,
                  }));
                  setPreviewAllocations(allocations);
                  setIsPreviewMode(true);
                }}
              >
                Review Monthly Budget
              </button>
            </div>
          </div>
        )}

        {/* Generating animation */}
        {generateMonthly.isPending && (
          <div style={{ marginBottom: "20px" }}>
            <GeneratingState title="Generating monthly budget..." />
          </div>
        )}

        {/* Generation error */}
        {generateMonthly.isError && (
          <div style={{ marginBottom: "20px", padding: "16px", background: "var(--danger-bg)", borderRadius: "var(--r-md)", color: "var(--danger)" }}>
            Failed to generate: {generateMonthly.error?.message || "Unknown error"}
          </div>
        )}

        {budgetData.isError && (
          <div style={{ marginBottom: "20px", padding: "16px", background: "var(--danger-bg)", borderRadius: "var(--r-md)", color: "var(--danger)" }}>
            Failed to load budget plan data: {budgetDataError || "Unknown error"}
          </div>
        )}


        {/* Two Column Layout for Monthly Budget */}
        {displayAllocations.length > 0 && (
          <div className="bp-two-col">
            {/* Budget Sources Column - Left */}
            <div className="bp-col">
              <div className="st-header" style={{ marginBottom: "12px" }}>
                <h4 className="st-title">Sources</h4>
                {isPreviewMode && (
                  <button className="btn btn-ghost btn-xs" onClick={openAddSourceModal}>
                    + Add Source
                  </button>
                )}
              </div>
              <div className="st-grid">
                {monthlyBudgetSources.map((source) => (
                  <div
                    key={source.budgetSourceId}
                    className="st-card bp-two-line-card"
                  >
                    <div className="bp-two-line-head">
                      <div className="bp-two-line-title-wrap">
                        <span className="st-bank-fallback" style={{ backgroundColor: "#d97706", width: "24px", height: "24px", fontSize: "12px" }}>
                          💰
                        </span>
                        <h5 className="bp-two-line-title">{source.title}</h5>
                      </div>
                    </div>
                    <div className="bp-two-line-amount">
                      {formatCents(source.amountCents)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Budget Items Column - Right */}
            <div className="bp-col">
              <div className="st-header" style={{ marginBottom: "12px" }}>
                <h4 className="st-title">Budget Items</h4>
                {isPreviewMode && (
                  <button className="btn btn-ghost btn-xs" onClick={openAddAllocationModal}>
                    + Add Budget
                  </button>
                )}
              </div>
              <div className="st-grid">
                {budgetItemAllocationSummaries.map((alloc) => (
                  <div
                    key={alloc.id}
                    className={`st-card bp-two-line-card ${isPreviewMode ? 'bp-editable-card' : ''}`}
                    onClick={isPreviewMode ? () => openEditAllocationModal({ type: "item", id: alloc.id }) : undefined}
                    style={isPreviewMode ? { cursor: 'pointer' } : undefined}
                  >
                    <div className="bp-two-line-head">
                      <div className="bp-two-line-title-wrap">
                        <span className="st-bank-fallback" style={{ backgroundColor: "#1a8f58", width: "24px", height: "24px", fontSize: "12px" }}>
                          📋
                        </span>
                        <h5 className="bp-two-line-title">{alloc.title}</h5>
                      </div>
                    </div>
                    <div className="bp-two-line-amount">
                      {formatCents(alloc.allocatedCents)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!budgetData.isLoading && displayAllocations.length === 0 && !isPreviewMode && (
          <EmptyState
            icon="📅"
            title="No monthly budget"
            description="Click 'Generate from Template' to create a budget based on your template items and sources."
          />
        )}
      </section>

      {/* Template Section - Hidden by default */}
      {showTemplate && (
        <>
          {/* Template Header */}
          <section className="card" style={{ marginTop: "24px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>Budget Setup</h3>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => budgetData.refetch()}
                  disabled={budgetData.isLoading}
                >
                  {budgetData.isLoading ? "Refreshing..." : "Refresh"}
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => setShowTemplate(false)}>
                  Hide
                </button>
              </div>
            </div>
            <p style={{ fontSize: "13px", color: "var(--text-tertiary)", margin: "4px 0 0" }}>
              Budget items and source templates used to generate monthly budgets
              {budgetData.data && (
                <span style={{ marginLeft: "8px", color: "var(--text-secondary)" }}>
                  ({budgetItems.length} items, {budgetSources.length} sources)
                </span>
              )}
            </p>
          </section>

          {budgetData.isError && (
            <section className="card" style={{ marginTop: "12px", padding: "16px", background: "var(--danger-bg)", color: "var(--danger)" }}>
              Could not load template data: {budgetDataError || "Unknown error"}
            </section>
          )}

          {/* Two Column Layout: Budget Sources and Budget Items */}
          <div className="bp-two-col">
            {/* Budget Sources Column */}
            <div className="bp-col">
              <div className="st-header" style={{ marginBottom: '16px' }}>
                <h2 className="st-title">Budget Sources</h2>
                <button className="btn btn-primary" onClick={openAddSourceModal}>
                  + Add Source
                </button>
              </div>

              <div className="st-grid">
                {budgetData.isLoading && <SkeletonGrid count={2} type="card" />}

                {!budgetData.isLoading && !budgetData.isError && budgetSources.map((source) => (
                  <div key={source.id} className="st-card bp-compact-card" onClick={() => openEditSourceModal(source)} style={{ cursor: 'pointer' }}>
                    <div className="bp-two-line-head">
                      <div className="bp-two-line-title-wrap">
                        <span className="st-bank-fallback" style={{ backgroundColor: '#d97706', width: '24px', height: '24px', fontSize: '12px' }}>
                          💰
                        </span>
                        <h5 className="bp-two-line-title">{source.title}</h5>
                      </div>
                      <button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); openEditSourceModal(source); }} title="Edit">
                        ✏️
                      </button>
                    </div>
                    <div className="bp-two-line-amount">{formatCents(source.amountCents)}</div>
                  </div>
                ))}

                {!budgetData.isLoading && !budgetData.isError && budgetSources.length === 0 && (
                  <div className="st-grid-empty">
                    <EmptyState
                      icon="💰"
                      title="No budget sources"
                      description="Add your first funding source to start planning where money comes from."
                      action={
                        <button className="btn btn-primary" onClick={openAddSourceModal}>
                          + Add First Source
                        </button>
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Budget Items Column */}
            <div className="bp-col">
              <div className="st-header" style={{ marginBottom: '16px' }}>
                <h2 className="st-title">Budget Items</h2>
                <button className="btn btn-primary" onClick={openAddItemModal}>
                  + Add Item
                </button>
              </div>

              <div className="st-grid">
                {budgetData.isLoading && <SkeletonGrid count={2} type="card" />}

                {/* Debug info */}
                {!budgetData.isLoading && !budgetData.isError && budgetItems.length === 0 && (
                  <div style={{ padding: "12px", background: "var(--warning-bg)", borderRadius: "var(--r-md)", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                    No budget items found. Add your first item using the + Add Item button.
                  </div>
                )}

                {!budgetData.isLoading && !budgetData.isError && budgetItems.map((item) => (
                  <div key={item.id} className="st-card bp-compact-card" onClick={() => openEditItemModal(item)} style={{ cursor: 'pointer' }}>
                    <div className="bp-two-line-head">
                      <div className="bp-two-line-title-wrap">
                        <span className="st-bank-fallback" style={{ backgroundColor: '#1a8f58', width: '24px', height: '24px', fontSize: '12px' }}>
                          📋
                        </span>
                        <h5 className="bp-two-line-title">{item.title}</h5>
                      </div>
                      <button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); openEditItemModal(item); }} title="Edit">
                        ✏️
                      </button>
                    </div>
                    <div className="bp-two-line-amount">{formatCents(item.amountCents)}</div>
                  </div>
                ))}

                {!budgetData.isLoading && !budgetData.isError && budgetItems.length === 0 && (
                  <div className="st-grid-empty">
                    <EmptyState
                      icon="📋"
                      title="No budget items"
                      description="Add your first budget item to start planning where money should be allocated."
                      action={
                        <button className="btn btn-primary" onClick={openAddItemModal}>
                          + Add First Item
                        </button>
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Budget Item Modal - Add/Edit */}
      {isAddItemModalOpen && (
        <div className="st-modal-overlay" onClick={closeItemModal}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>{editingItemId ? "Edit Budget Item" : "Add Budget Item"}</h3>
              <button className="st-close-btn" onClick={closeItemModal}>✕</button>
            </div>
            <form className="st-modal-form" onSubmit={onSubmitItem}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Title</label>
                  <input
                    className="input"
                    placeholder="e.g., Groceries"
                    value={itemTitle}
                    onChange={(e) => setItemTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Amount</label>
                  <NumericCalculatorInput
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={itemAmount}
                    onValueChange={setItemAmount}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">
                    <input type="checkbox" checked={itemIsMonthly} onChange={(e) => setItemIsMonthly(e.target.checked)} /> Monthly recurring
                  </label>
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Destination Sub-Account (optional)</label>
                  <select className="input" value={itemDestinationId} onChange={(e) => setItemDestinationId(e.target.value)}>
                    <option value="">Select sub-account...</option>
                    {subAccounts.map((sa) => (
                      <option key={sa.id} value={sa.id}>{sa.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {(createBudgetItem.isError || updateBudgetItem.isError) && (
                <div className="st-error">
                  Failed to save: {(createBudgetItem.error as Error)?.message || (updateBudgetItem.error as Error)?.message || "Unknown error"}
                </div>
              )}
              <div className="st-modal-actions">
                {editingItemId && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => editingItemId && confirmDeleteItem(editingItemId)}
                    disabled={deleteItem.isPending}
                  >
                    {deleteItem.isPending ? "Deleting..." : "Delete"}
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={closeItemModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createBudgetItem.isPending || updateBudgetItem.isPending}
                >
                  {editingItemId
                    ? (updateBudgetItem.isPending ? "Saving..." : "Save Changes")
                    : (createBudgetItem.isPending ? "Adding..." : "Add Item")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Budget Source Modal - Add/Edit */}
      {isAddSourceModalOpen && (
        <div className="st-modal-overlay" onClick={closeSourceModal}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>{editingSourceId ? "Edit Budget Source" : "Add Budget Source"}</h3>
              <button className="st-close-btn" onClick={closeSourceModal}>✕</button>
            </div>
            <form className="st-modal-form" onSubmit={onSubmitSource}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Title</label>
                  <input
                    className="input"
                    placeholder="e.g., Salary"
                    value={sourceTitle}
                    onChange={(e) => setSourceTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Amount</label>
                  <NumericCalculatorInput
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={sourceAmount}
                    onValueChange={setSourceAmount}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Owner <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <select className="input" value={sourceOwnerId} onChange={(e) => setSourceOwnerId(e.target.value)} required>
                    <option value="">Select workspace member...</option>
                    {members.map((m) => (
                      <option key={m.user.id} value={m.user.id}>{m.user.name || m.user.email || 'Unknown'}</option>
                    ))}
                  </select>
                  <small style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    This source is tied to the selected workspace member
                  </small>
                </div>
              </div>
              {(createBudgetSource.isError || createMonthlyBudgetSource.isError || updateBudgetSource.isError) && (
                <div className="st-error">
                  Failed to save: {(createMonthlyBudgetSource.error as Error)?.message || (createBudgetSource.error as Error)?.message || (updateBudgetSource.error as Error)?.message || "Unknown error"}
                </div>
              )}
              <div className="st-modal-actions">
                {editingSourceId && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => editingSourceId && confirmDeleteSource(editingSourceId)}
                    disabled={deleteSource.isPending}
                  >
                    {deleteSource.isPending ? "Deleting..." : "Delete"}
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={closeSourceModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createBudgetSource.isPending || createMonthlyBudgetSource.isPending || updateBudgetSource.isPending || !sourceOwnerId}
                >
                  {editingSourceId
                    ? (updateBudgetSource.isPending ? "Saving..." : "Save Changes")
                    : ((createBudgetSource.isPending || createMonthlyBudgetSource.isPending) ? "Adding..." : "Add Source")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Allocation Modal */}
      {editingAllocationTarget !== null && editingAllocationSummary && (
        <div className="st-modal-overlay" onClick={closeEditAllocationModal}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Edit {editingAllocationTarget.type === "source" ? "Allocated Amount for Source" : "Budget Item Total"}</h3>
              <button className="st-close-btn" onClick={closeEditAllocationModal}>✕</button>
            </div>
            <div className="st-modal-form">
              <div className="form-group">
                <label className="label">{editingAllocationTarget.type === "source" ? "Source" : "Budget Item"}</label>
                <div className="input" style={{ background: "var(--bg-subtle)" }}>
                  {editingAllocationSummary.title}
                </div>
              </div>
              {editingAllocationTarget.type === "source" && editingAllocationTemplateSource && (
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "-4px" }}>
                  Template source amount stays at {formatCents(editingAllocationTemplateSource.amountCents)}. This only changes how much of that source is allocated in this month.
                </div>
              )}
              <div className="form-group">
                <label className="label">{editingAllocationTarget.type === "source" ? "Allocated Amount" : "Amount"}</label>
                <NumericCalculatorInput
                  min="0"
                  step="0.01"
                  value={editingAllocationAmount}
                  onValueChange={setEditingAllocationAmount}
                  autoFocus
                />
              </div>
              <div className="st-modal-actions" style={{ marginTop: "16px" }}>
                <button type="button" className="btn btn-danger" onClick={removeAllocation}>
                  Remove Allocation
                </button>
                <div style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={closeEditAllocationModal}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={saveAllocationEdit}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddAllocationModalOpen && (
        <div className="st-modal-overlay" onClick={closeAddAllocationModal}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Add Monthly Allocation</h3>
              <button className="st-close-btn" onClick={closeAddAllocationModal}>âœ•</button>
            </div>
            <form className="st-modal-form" onSubmit={saveAddedAllocation}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Budget Item</label>
                  <select className="input" value={allocationItemId} onChange={(e) => setAllocationItemId(e.target.value)} required>
                    <option value="">Select budget item...</option>
                    {budgetItems.map((item) => (
                      <option key={item.id} value={item.id}>{item.title}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Funding Source</label>
                  <select className="input" value={allocationSourceId} onChange={(e) => setAllocationSourceId(e.target.value)} required>
                    <option value="">Select source...</option>
                    {planningSources.map((source) => (
                      <option key={source.id} value={source.budgetSourceId}>{source.title}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Amount</label>
                  <NumericCalculatorInput
                    min="0"
                    step="0.01"
                    value={allocationAmount}
                    onValueChange={setAllocationAmount}
                    required
                  />
                </div>
              </div>
              <div className="st-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeAddAllocationModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={addMonthlyAllocation.isPending}>
                  {addMonthlyAllocation.isPending ? "Adding..." : "Add Allocation"}
                </button>
              </div>
              <p className="bp-hint" style={{ marginTop: "8px" }}>
                This saves a draft monthly allocation for {MONTHS[selectedMonth - 1]} {selectedYear}.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* Quick Edit Modal - opened from Source Breakdown and Budgeted Items cards */}
      {quickEditTarget && (
        <div className="st-modal-overlay" onClick={closeQuickEditModal}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>{quickEditTarget.type === "item" ? "Edit Budgeted Item" : "Edit Source"}</h3>
              <button className="st-close-btn" onClick={closeQuickEditModal}>✕</button>
            </div>
            <form className="st-modal-form" onSubmit={saveQuickEdit}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Description</label>
                  <input
                    className="input"
                    value={quickEditDescription}
                    onChange={(e) => setQuickEditDescription(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Amount</label>
                  <NumericCalculatorInput
                    step="0.01"
                    min="0"
                    value={quickEditAmount}
                    onValueChange={setQuickEditAmount}
                    required
                  />
                </div>
              </div>
              {(quickUpdateBudgetItem.isError || quickUpdateBudgetSource.isError) && (
                <div className="st-error">
                  Failed to save: {(quickUpdateBudgetItem.error as Error)?.message || (quickUpdateBudgetSource.error as Error)?.message || "Unknown error"}
                </div>
              )}
              <div className="st-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeQuickEditModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={quickUpdateBudgetItem.isPending || quickUpdateBudgetSource.isPending}
                >
                  {quickUpdateBudgetItem.isPending || quickUpdateBudgetSource.isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm & Save Progress Dialog */}
      {showConfirmDialog && (
        <div className="st-modal-overlay">
          <div className="st-modal" style={{ maxWidth: "400px" }}>
            <div className="st-modal-header">
              <h3>{confirmProgress === 0 ? "Confirm Monthly Budget" : "Finalizing..."}</h3>
            </div>
            <div className="st-modal-form" style={{ padding: "24px" }}>
              {confirmProgress === 0 ? (
                <>
                  <p style={{ marginBottom: "20px", fontSize: "14px", color: "var(--text-secondary)" }}>
                    This will finalize the monthly budget for {MONTHS[selectedMonth - 1]} {selectedYear}.
                    {pendingConfirmApplyToSubAccounts && " Allocated amounts will be added to sub-accounts."}
                  </p>
                  <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost" onClick={resetConfirmDialog}>
                      Cancel
                    </button>
                    <button className="btn btn-primary" onClick={executeConfirmMonthly}>
                      Save & Finalize
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ textAlign: "center", marginBottom: "20px" }}>
                    <div className="generating-spinner" style={{ margin: "0 auto 16px" }} />
                    <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>{confirmStage}</div>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${confirmProgress}%` }}
                    />
                  </div>
                  <div style={{ textAlign: "center", marginTop: "8px", fontSize: "12px", color: "var(--text-tertiary)" }}>
                    {confirmProgress}%
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
