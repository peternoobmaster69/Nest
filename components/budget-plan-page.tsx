"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { FormEvent, useMemo, useState } from "react";
import { EmptyState, SkeletonCard, SkeletonGrid } from "@/components/ui-skeleton";

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

type WorkspaceMember = {
  user: { id: string; name: string | null; email: string | null };
};

type MonthlyBudget = {
  id: string;
  budgetItemId: string;
  budgetSourceId: string;
  year: number;
  month: number;
  allocatedCents: number;
  budgetItem: { id: string; title: string };
  budgetSource: { id: string; title: string };
};

type AllocationPreview = {
  budgetItemId: string;
  budgetItemTitle: string;
  budgetSourceId: string;
  budgetSourceTitle: string;
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
    budgetItemId: string;
    budgetSourceId: string;
    allocatedCents: number;
  }>;
};

type AppContext = {
  workspaceId: string | null;
  baseCurrency?: string | null;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
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
  const [editingAllocationIndex, setEditingAllocationIndex] = useState<number | null>(null);
  const [editingAllocationAmount, setEditingAllocationAmount] = useState("");

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
        monthlyBudgets: MonthlyBudget[];
        members: WorkspaceMember[];
        subAccounts: { id: string; name: string }[];
      }>(`/api/budgets/plan?workspaceId=${workspaceId}&year=${selectedYear}&month=${selectedMonth}`),
    enabled: Boolean(workspaceId),
  });

  const budgetItems = budgetData.data?.budgetItems || [];
  const budgetSources = budgetData.data?.budgetSources || [];
  const monthlyBudgets = budgetData.data?.monthlyBudgets || [];
  const members: WorkspaceMember[] = budgetData.data?.members || [];
  const subAccounts = budgetData.data?.subAccounts || [];

  // Template counts for display
  const templateCounts = useMemo(() => ({
    items: budgetItems.length,
    sources: budgetSources.length,
  }), [budgetItems, budgetSources]);

  const monthlyTotal = useMemo(() => {
    if (isPreviewMode && previewAllocations) {
      return previewAllocations.reduce((sum, a) => sum + a.allocatedCents, 0);
    }
    return monthlyBudgets.reduce((sum, mb) => sum + mb.allocatedCents, 0);
  }, [monthlyBudgets, previewAllocations, isPreviewMode]);

  const totalSourcesCents = useMemo(
    () => budgetSources.reduce((sum, source) => sum + source.amountCents, 0),
    [budgetSources],
  );

  const createBudgetItem = useMutation({
    mutationFn: (payload: {
      workspaceId: string;
      action: "createItem";
      title: string;
      amountCents: number;
      isMonthly: boolean;
      destinationSubAccountId?: string;
    }) => fetchJson("/api/budgets/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
      closeItemModal();
    },
  });

  const createBudgetSource = useMutation({
    mutationFn: (payload: {
      workspaceId: string;
      action: "createSource";
      title: string;
      amountCents: number;
      ownerId: string;
    }) => fetchJson("/api/budgets/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
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
      setIsPreviewMode(false);
      setPreviewAllocations(null);
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
    if (editingSourceId) {
      updateBudgetSource.mutate({
        id: editingSourceId,
        workspaceId,
        action: "updateSource",
        title: sourceTitle,
        amountCents: Math.round(parseFloat(sourceAmount) * 100),
        ownerId: sourceOwnerId,
      });
    } else {
      createBudgetSource.mutate({
        workspaceId,
        action: "createSource",
        title: sourceTitle,
        amountCents: Math.round(parseFloat(sourceAmount) * 100),
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
      // Convert the saved monthly budgets to preview format
      const allocations: AllocationPreview[] = data.monthlyBudgets.map((mb) => ({
        budgetItemId: mb.budgetItemId,
        budgetItemTitle: budgetItems.find(i => i.id === mb.budgetItemId)?.title || "Unknown",
        budgetSourceId: mb.budgetSourceId,
        budgetSourceTitle: budgetSources.find(s => s.id === mb.budgetSourceId)?.title || "Unknown",
        allocatedCents: mb.allocatedCents,
      }));
      setPreviewAllocations(allocations);
      setIsPreviewMode(true);
      queryClient.invalidateQueries({ queryKey: ["budget-plan"] });
    },
  });

  const generatePreview = () => {
    if (!workspaceId || budgetItems.length === 0 || budgetSources.length === 0) return;
    generateMonthly.mutate({
      workspaceId,
      action: "generateMonthly",
      year: selectedYear,
      month: selectedMonth,
    });
  };

  const updateAllocation = (index: number, newCents: number) => {
    if (!previewAllocations || !workspaceId) return;
    const updated = [...previewAllocations];
    updated[index] = { ...updated[index], allocatedCents: Math.max(0, newCents) };
    setPreviewAllocations(updated);

    // Update in database immediately
    const alloc = updated[index];
    fetch("/api/budgets/plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        action: "updateAllocation",
        year: selectedYear,
        month: selectedMonth,
        budgetItemId: alloc.budgetItemId,
        budgetSourceId: alloc.budgetSourceId,
        allocatedCents: newCents,
      }),
    });
  };

  const onConfirmMonthly = (applyToSubAccounts: boolean) => {
    if (!workspaceId || !previewAllocations) return;
    confirmMonthly.mutate({
      workspaceId,
      action: "confirmMonthly",
      year: selectedYear,
      month: selectedMonth,
      allocations: previewAllocations,
      applyToSubAccounts,
    });
  };

  const cancelPreview = () => {
    if (!workspaceId) return;
    // Delete draft budgets
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

  const openEditAllocationModal = (index: number) => {
    if (!previewAllocations) return;
    setEditingAllocationIndex(index);
    setEditingAllocationAmount((previewAllocations[index].allocatedCents / 100).toFixed(2));
  };

  const closeEditAllocationModal = () => {
    setEditingAllocationIndex(null);
    setEditingAllocationAmount("");
  };

  const saveAllocationEdit = () => {
    if (editingAllocationIndex === null || !previewAllocations) return;
    const value = parseFloat(editingAllocationAmount || "0");
    if (Number.isNaN(value) || value < 0) return;
    updateAllocation(editingAllocationIndex, Math.round(value * 100));
    closeEditAllocationModal();
  };

  const displayAllocations = isPreviewMode && previewAllocations
    ? previewAllocations
    : monthlyBudgets.map(mb => ({
        budgetItemId: mb.budgetItemId,
        budgetItemTitle: mb.budgetItem.title,
        budgetSourceId: mb.budgetSourceId,
        budgetSourceTitle: mb.budgetSource.title,
        allocatedCents: mb.allocatedCents,
      }));

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
                {showTemplate ? "Hide Template" : "Edit Template"}
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
              <input className="input" type="number" value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value))} min={2024} max={2030} />
            </div>
          </div>
        </div>

        {/* Preview Controls */}
        {isPreviewMode && (
          <div style={{ marginBottom: "20px", padding: "16px", background: "var(--warning-bg)", borderRadius: "var(--r-md)" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: 1, fontSize: "14px" }}>
                Review allocations below. Click Budgeted Items to edit amounts, then confirm to save for {MONTHS[selectedMonth - 1]} {selectedYear}.
              </span>
              <button className="btn btn-ghost" onClick={cancelPreview}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => onConfirmMonthly(true)}
                disabled={confirmMonthly.isPending}
              >
                {confirmMonthly.isPending ? "Saving..." : "Confirm & Save"}
              </button>
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "8px" }}>
              This will save the monthly budget to the database for {MONTHS[selectedMonth - 1]} {selectedYear} and add allocated amounts to sub-accounts.
            </p>
          </div>
        )}

        {/* Monthly Budget Stats */}
        {(displayAllocations.length > 0 || isPreviewMode) && (
          <div className="bp-stat-grid" style={{ marginBottom: "24px" }}>
            <div className="bp-stat">
              <div className="bp-stat-label">Total Budgeted</div>
              <div className="bp-stat-value">{formatCents(displayAllocations.reduce((sum, a) => sum + a.allocatedCents, 0))}</div>
            </div>
            <div className="bp-stat">
              <div className="bp-stat-label">Total Sources</div>
              <div className="bp-stat-value">{formatCents(totalSourcesCents)}</div>
            </div>
            <div className="bp-stat">
              <div className="bp-stat-label">Allocations</div>
              <div className="bp-stat-value">{displayAllocations.length}</div>
              <div className="bp-stat-sub">Items</div>
            </div>
          </div>
        )}

        {/* Generate Button when empty */}
        {!isPreviewMode && displayAllocations.length === 0 && (
          <div style={{ marginBottom: "20px" }}>
            <button
              className="btn btn-primary"
              onClick={generatePreview}
              disabled={budgetItems.length === 0 || budgetSources.length === 0}
            >
              Generate from Template
            </button>
            {(budgetItems.length === 0 || budgetSources.length === 0) && (
              <p className="bp-hint">Add budget items and sources to the template first.</p>
            )}
          </div>
        )}


        {/* Two Column Layout for Monthly Budget */}
        {displayAllocations.length > 0 && (
          <div className="bp-two-col">
            {/* Budget Sources Column - Left */}
            <div className="bp-col">
              <div className="st-header">
                <h4 className="st-title">Source Breakdown</h4>
              </div>
              <div className="st-grid">
                {/* Group allocations by budget source */}
                {(() => {
                  const sourceTotals = new Map<string, { title: string; total: number }>();
                  displayAllocations.forEach(alloc => {
                    const existing = sourceTotals.get(alloc.budgetSourceId);
                    if (existing) {
                      existing.total += alloc.allocatedCents;
                    } else {
                      sourceTotals.set(alloc.budgetSourceId, { title: alloc.budgetSourceTitle, total: alloc.allocatedCents });
                    }
                  });
                  return Array.from(sourceTotals.entries()).map(([id, data]) => (
                    <div key={id} className="st-card">
                      <div className="st-card-header">
                        <div className="st-card-bank">
                          <span className="st-bank-fallback" style={{ backgroundColor: '#d97706' }}>
                            💰
                          </span>
                        </div>
                      </div>
                      <div className="st-card-body">
                        <h5 className="st-card-name">{data.title}</h5>
                      </div>
                      <div className="st-card-stats">
                        <div className="st-stat">
                          <span className="st-stat-label">Contribution</span>
                          <span className="st-stat-value">{formatCents(data.total)}</span>
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Budget Items Column - Right */}
            <div className="bp-col">
              <div className="st-header">
                <h4 className="st-title">Budgeted Items {isPreviewMode && "(click to edit)"}</h4>
              </div>
              <div className="st-grid">
                {/* Group allocations by budget item */}
                {(() => {
                  const itemTotals = new Map<string, { title: string; total: number; allocations: AllocationPreview[] }>();
                  displayAllocations.forEach(alloc => {
                    const existing = itemTotals.get(alloc.budgetItemId);
                    if (existing) {
                      existing.total += alloc.allocatedCents;
                      existing.allocations.push(alloc);
                    } else {
                      itemTotals.set(alloc.budgetItemId, { title: alloc.budgetItemTitle, total: alloc.allocatedCents, allocations: [alloc] });
                    }
                  });
                  return Array.from(itemTotals.entries()).map(([id, data]) => (
                    <div
                      key={id}
                      className={`st-card ${isPreviewMode ? 'bp-editable-card' : ''}`}
                      onClick={isPreviewMode ? () => {
                        // Find first allocation index for this item in previewAllocations
                        if (previewAllocations && data.allocations.length > 0) {
                          const firstAlloc = data.allocations[0];
                          const index = previewAllocations.findIndex(
                            a => a.budgetItemId === firstAlloc.budgetItemId && a.budgetSourceId === firstAlloc.budgetSourceId
                          );
                          if (index !== -1) openEditAllocationModal(index);
                        }
                      } : undefined}
                      style={isPreviewMode ? { cursor: 'pointer' } : undefined}
                    >
                      <div className="st-card-header">
                        <div className="st-card-bank">
                          <span className="st-bank-fallback" style={{ backgroundColor: '#1a8f58' }}>
                            📋
                          </span>
                        </div>
                        {isPreviewMode && (
                          <span style={{ fontSize: '14px', color: 'var(--text-tertiary)', opacity: 0.5 }}>✏️</span>
                        )}
                      </div>
                      <div className="st-card-body">
                        <h5 className="st-card-name">{data.title}</h5>
                      </div>
                      <div className="st-card-stats">
                        <div className="st-stat">
                          <span className="st-stat-label">Allocated</span>
                          <span className="st-stat-value">{formatCents(data.total)}</span>
                        </div>
                      </div>
                    </div>
                  ));
                })()}
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
              <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>Budget Template</h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setShowTemplate(false)}>
                Hide
              </button>
            </div>
            <p style={{ fontSize: "13px", color: "var(--text-tertiary)", margin: "4px 0 0" }}>
              Template items and sources used to generate monthly budgets
            </p>
          </section>

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
                    <div className="bp-compact-row">
                      <div className="bp-compact-left">
                        <span className="st-bank-fallback" style={{ backgroundColor: '#d97706', width: '24px', height: '24px', fontSize: '12px' }}>
                          💰
                        </span>
                        <div className="bp-compact-info">
                          <span className="bp-compact-title">{source.title}</span>
                          <span className="bp-compact-meta">
                            <span className="bp-meta-owner">{source.owner.name || source.owner.email || 'Unknown'}</span>
                          </span>
                        </div>
                      </div>
                      <div className="bp-compact-right">
                        <span className="bp-compact-amount">{formatCents(source.amountCents)}</span>
                        <button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); openEditSourceModal(source); }} title="Edit">
                          ✏️
                        </button>
                      </div>
                    </div>
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

                {!budgetData.isLoading && !budgetData.isError && budgetItems.map((item) => (
                  <div key={item.id} className="st-card bp-compact-card" onClick={() => openEditItemModal(item)} style={{ cursor: 'pointer' }}>
                    <div className="bp-compact-row">
                      <div className="bp-compact-left">
                        <span className="st-bank-fallback" style={{ backgroundColor: '#1a8f58', width: '24px', height: '24px', fontSize: '12px' }}>
                          📋
                        </span>
                        <div className="bp-compact-info">
                          <span className="bp-compact-title">{item.title}</span>
                          <span className="bp-compact-meta">
                            {item.isMonthly && <span className="bp-badge monthly">Monthly</span>}
                            {item.destinationSubAccount && (
                              <span className="bp-badge destination">→ {item.destinationSubAccount.name}</span>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="bp-compact-right">
                        <span className="bp-compact-amount">{formatCents(item.amountCents)}</span>
                        <button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); openEditItemModal(item); }} title="Edit">
                          ✏️
                        </button>
                      </div>
                    </div>
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
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={itemAmount}
                    onChange={(e) => setItemAmount(e.target.value)}
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
                    onClick={() => editingItemId && deleteItem.mutate(editingItemId)}
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
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={sourceAmount}
                    onChange={(e) => setSourceAmount(e.target.value)}
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
              {(createBudgetSource.isError || updateBudgetSource.isError) && (
                <div className="st-error">
                  Failed to save: {(createBudgetSource.error as Error)?.message || (updateBudgetSource.error as Error)?.message || "Unknown error"}
                </div>
              )}
              <div className="st-modal-actions">
                {editingSourceId && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => editingSourceId && deleteSource.mutate(editingSourceId)}
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
                  disabled={createBudgetSource.isPending || updateBudgetSource.isPending || !sourceOwnerId}
                >
                  {editingSourceId
                    ? (updateBudgetSource.isPending ? "Saving..." : "Save Changes")
                    : (createBudgetSource.isPending ? "Adding..." : "Add Source")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Allocation Modal - opened from Budgeted Items card */}
      {editingAllocationIndex !== null && previewAllocations && (
        <div className="st-modal-overlay" onClick={closeEditAllocationModal}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Edit Allocation</h3>
              <button className="st-close-btn" onClick={closeEditAllocationModal}>✕</button>
            </div>
            <div className="st-modal-form">
              <div className="form-group">
                <label className="label">Budget Item</label>
                <div className="input" style={{ background: "var(--bg-subtle)" }}>
                  {previewAllocations[editingAllocationIndex]?.budgetItemTitle}
                </div>
              </div>
              <div className="form-group">
                <label className="label">Source</label>
                <div className="input" style={{ background: "var(--bg-subtle)" }}>
                  {previewAllocations[editingAllocationIndex]?.budgetSourceTitle}
                </div>
              </div>
              <div className="form-group">
                <label className="label">Amount</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingAllocationAmount}
                  onChange={(e) => setEditingAllocationAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="st-modal-actions" style={{ marginTop: "16px" }}>
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
    </div>
  );
}
