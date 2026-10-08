"use client";

import { apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";

import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { BudgetPlanCompactCardsSkeleton } from "@/components/skeletons/BudgetPlanSkeleton";
import { normalizeCurrency } from "@/lib/currency";
import { useMoneyFormat } from "@/lib/use-money-format";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { summarizeMonthlyBudgetPlan } from "@/lib/monthly-budget-plan.mjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarRange,
  Check,
  ChevronDown,
  CircleDollarSign,
  FilePlus2,
  LayoutTemplate,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { SubmitEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { useSessionState } from "@/lib/use-session-state";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";

type WorkspaceMember = {
  user: { id: string; name: string | null; email: string | null };
};

type SubAccount = {
  id: string;
  name: string;
  availableCents: number;
};

type SetupItem = {
  id: string;
  title: string;
  amountCents: number;
  isMonthly: boolean;
  destinationSubAccountId: string | null;
  destinationSubAccount?: SubAccount | null;
};

type SetupSource = {
  id: string;
  title: string;
  amountCents: number;
  ownerId: string;
  owner?: { id: string; name: string | null; email: string | null } | null;
};

type MonthlyBudgetPlanItem = {
  id: string;
  planId: string;
  templateItemId?: string | null;
  title: string;
  amountCents: number;
  destinationSubAccountId: string | null;
  destinationSubAccount?: SubAccount | null;
  sortOrder?: number;
  appliedCents?: number;
};

type MonthlyBudgetPlanSource = {
  id: string;
  planId: string;
  templateSourceId?: string | null;
  title: string;
  amountCents: number;
  ownerId: string;
  owner?: { id: string; name: string | null; email: string | null } | null;
  sortOrder?: number;
};

type MonthlyBudgetPlan = {
  id: string;
  year: number;
  month: number;
  status: "DRAFT" | "CONFIRMING" | "CONFIRMED" | "REVIEW";
  confirmedAt: string | null;
  sources: MonthlyBudgetPlanSource[];
  items: MonthlyBudgetPlanItem[];
};

type BudgetPlanData = {
  setup: {
    items: SetupItem[];
    sources: SetupSource[];
  };
  monthlyPlan: MonthlyBudgetPlan | null;
  members: WorkspaceMember[];
  subAccounts: SubAccount[];
};

type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  baseCurrency?: string | null;
};

type ModalScope = "template" | "monthly";
type EditModalState = { scope: ModalScope; id: string | null };
type DeleteType = "templateItem" | "templateSource" | "monthlyItem" | "monthlySource";

type ItemFields = {
  title: string;
  amountCents: number;
  isMonthly: boolean;
  destinationSubAccountId: string | null;
};

type SourceFields = {
  title: string;
  amountCents: number;
  ownerId: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function requestBody(action: string, workspaceId: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ workspaceId, action, ...payload });
}

function toCents(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function personLabel(person?: { name: string | null; email: string | null } | null) {
  return person?.name || person?.email || "Unknown member";
}

function ModalShell({
  title,
  onClose,
  children,
  closeDisabled = false,
}: Readonly<{
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeDisabled?: boolean;
}>) {
  return (
    <Dialog open onClose={onClose} title={title} closeDisabled={closeDisabled} surface="custom" overlayClassName="st-modal-overlay">
      <dialog open className="st-modal">
        <div className="st-modal-header">
          <h3>{title}</h3>
          <ModalCloseButton onClick={onClose} disabled={closeDisabled} label={`Close ${title}`} />
        </div>
        {children}
      </dialog>
    </Dialog>
  );
}

function IconTile({ icon: Icon, tone }: Readonly<{ icon: LucideIcon; tone: "source" | "item" }>) {
  return (
    <span
      className="st-bank-fallback"
      style={{
        backgroundColor: tone === "source" ? "#b45309" : "#15803d",
        width: "24px",
        height: "24px",
        minWidth: "24px",
      }}
      aria-hidden="true"
    >
      <Icon size={14} />
    </span>
  );
}

function ErrorMessage({ error }: Readonly<{ error: Error | null | undefined }>) {
  if (!error) return null;
  return <div className="st-error">{error.message}</div>;
}

export function BudgetPlanPage() {
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedYear, setSelectedYear] = useSessionState("nest:view:budget-plan:year", now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useSessionState("nest:view:budget-plan:month", now.getMonth() + 1);
  const [showSetup, setShowSetup] = useSessionState("nest:view:budget-plan:setup", false);
  const [itemModal, setItemModal] = useState<EditModalState | null>(null);
  const [sourceModal, setSourceModal] = useState<EditModalState | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const [itemTitle, setItemTitle] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [itemIsMonthly, setItemIsMonthly] = useState(true);
  const [itemDestinationId, setItemDestinationId] = useState("");

  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceAmount, setSourceAmount] = useState("");
  const [sourceOwnerId, setSourceOwnerId] = useState("");

  const contextQuery = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = contextQuery.data?.workspaceId ?? null;
  const baseCurrency = normalizeCurrency(contextQuery.data?.baseCurrency);
  const { format: formatCents } = useMoneyFormat(baseCurrency);

  const planQuery = useQuery({
    queryKey: queryKeys.key(["budget-plan", workspaceId, selectedYear, selectedMonth]),
    queryFn: () =>
      fetchJson<BudgetPlanData>(
        `/api/budgets/plan?workspaceId=${encodeURIComponent(workspaceId ?? "")}&year=${selectedYear}&month=${selectedMonth}`,
      ),
    enabled: Boolean(workspaceId),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const setupItems = planQuery.data?.setup.items ?? [];
  const setupSources = planQuery.data?.setup.sources ?? [];
  const monthlyPlan = planQuery.data?.monthlyPlan ?? null;
  const members = planQuery.data?.members ?? [];
  const subAccounts = planQuery.data?.subAccounts ?? [];
  const monthlyItems = monthlyPlan?.items ?? [];
  const monthlySources = monthlyPlan?.sources ?? [];
  const isDraft = monthlyPlan?.status === "DRAFT";
  const isConfirming = monthlyPlan?.status === "CONFIRMING";
  const isConfirmed = monthlyPlan?.status === "CONFIRMED";
  const isReview = monthlyPlan?.status === "REVIEW";

  const subAccountNameById = useMemo(
    () => new Map(subAccounts.map((subAccount) => [subAccount.id, subAccount.name])),
    [subAccounts],
  );
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.user.id, member.user])),
    [members],
  );
  const planSummary = useMemo(
    () => summarizeMonthlyBudgetPlan(monthlySources, monthlyItems),
    [monthlyItems, monthlySources],
  );
  const { sourceTotalCents, itemTotalCents, differenceCents } = planSummary;
  const canConfirm = isDraft && planSummary.canConfirm;
  const hasSetupSeed = setupSources.length > 0 || setupItems.some((item) => item.isMonthly);
  const confirmationDestinations = useMemo(() => {
    const amounts = new Map<string, number>();
    for (const item of monthlyItems) {
      if (!item.destinationSubAccountId) continue;
      const unappliedCents = Math.max(0, item.amountCents - (item.appliedCents ?? 0));
      amounts.set(item.destinationSubAccountId, (amounts.get(item.destinationSubAccountId) ?? 0) + unappliedCents);
    }
    return [...amounts].map(([id, amountCents]) => {
      const destination = subAccounts.find((subAccount) => subAccount.id === id);
      return {
        id,
        name: destination?.name || "Sub-account",
        amountCents,
        resultingBalanceCents: (destination?.availableCents ?? 0) + amountCents,
      };
    });
  }, [monthlyItems, subAccounts]);

  const invalidateCurrentPlan = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.key(["budget-plan", workspaceId, selectedYear, selectedMonth]) });
  const invalidateAllPlanData = () => queryClient.invalidateQueries({ queryKey: queryKeys.key(["budget-plan"]) });

  const startPlan = useMutation<MonthlyBudgetPlan, Error, "startBlank" | "startFromSetup">({
    mutationFn: (action) =>
      fetchJson<MonthlyBudgetPlan>("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody(action, workspaceId ?? "", { year: selectedYear, month: selectedMonth }),
      }),
    onSuccess: invalidateCurrentPlan,
  });

  const createTemplateItem = useMutation<SetupItem, Error, ItemFields>({
    mutationFn: (fields) =>
      fetchJson<SetupItem>("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody("createTemplateItem", workspaceId ?? "", fields),
      }),
    onSuccess: () => {
      setItemModal(null);
      invalidateAllPlanData();
    },
  });

  const updateTemplateItem = useMutation<SetupItem, Error, ItemFields & { id: string }>({
    mutationFn: (fields) =>
      fetchJson<SetupItem>("/api/budgets/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: requestBody("updateTemplateItem", workspaceId ?? "", fields),
      }),
    onSuccess: () => {
      setItemModal(null);
      invalidateAllPlanData();
    },
  });

  const createMonthlyItem = useMutation<MonthlyBudgetPlanItem, Error, ItemFields & { planId: string }>({
    mutationFn: ({ isMonthly: _isMonthly, ...fields }) =>
      fetchJson<MonthlyBudgetPlanItem>("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody("createMonthlyItem", workspaceId ?? "", fields),
      }),
    onSuccess: () => {
      setItemModal(null);
      invalidateCurrentPlan();
    },
  });

  const updateMonthlyItem = useMutation<MonthlyBudgetPlanItem, Error, ItemFields & { id: string; planId: string }>({
    mutationFn: ({ isMonthly: _isMonthly, ...fields }) =>
      fetchJson<MonthlyBudgetPlanItem>("/api/budgets/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: requestBody("updateMonthlyItem", workspaceId ?? "", fields),
      }),
    onSuccess: () => {
      setItemModal(null);
      invalidateCurrentPlan();
    },
  });

  const createTemplateSource = useMutation<SetupSource, Error, SourceFields>({
    mutationFn: (fields) =>
      fetchJson<SetupSource>("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody("createTemplateSource", workspaceId ?? "", fields),
      }),
    onSuccess: () => {
      setSourceModal(null);
      invalidateAllPlanData();
    },
  });

  const updateTemplateSource = useMutation<SetupSource, Error, SourceFields & { id: string }>({
    mutationFn: (fields) =>
      fetchJson<SetupSource>("/api/budgets/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: requestBody("updateTemplateSource", workspaceId ?? "", fields),
      }),
    onSuccess: () => {
      setSourceModal(null);
      invalidateAllPlanData();
    },
  });

  const createMonthlySource = useMutation<MonthlyBudgetPlanSource, Error, SourceFields & { planId: string }>({
    mutationFn: (fields) =>
      fetchJson<MonthlyBudgetPlanSource>("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody("createMonthlySource", workspaceId ?? "", fields),
      }),
    onSuccess: () => {
      setSourceModal(null);
      invalidateCurrentPlan();
    },
  });

  const updateMonthlySource = useMutation<MonthlyBudgetPlanSource, Error, SourceFields & { id: string; planId: string }>({
    mutationFn: (fields) =>
      fetchJson<MonthlyBudgetPlanSource>("/api/budgets/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: requestBody("updateMonthlySource", workspaceId ?? "", fields),
      }),
    onSuccess: () => {
      setSourceModal(null);
      invalidateCurrentPlan();
    },
  });

  const deleteEntity = useMutation<{ success: boolean }, Error, { id: string; type: DeleteType }>({
    mutationFn: ({ id, type }) =>
      fetchJson<{ success: boolean }>(
        `/api/budgets/plan?workspaceId=${encodeURIComponent(workspaceId ?? "")}&id=${encodeURIComponent(id)}&type=${type}`,
        { method: "DELETE" },
      ),
    onSuccess: (_data, variables) => {
      setItemModal(null);
      setSourceModal(null);
      if (variables.type.startsWith("template")) {
        invalidateAllPlanData();
      } else {
        invalidateCurrentPlan();
      }
    },
  });

  const discardDraft = useMutation<{ success: boolean }, Error, { planId: string }>({
    mutationFn: ({ planId }) =>
      fetchJson<{ success: boolean }>("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody("discardMonthlyDraft", workspaceId ?? "", { planId }),
      }),
    onSuccess: invalidateCurrentPlan,
  });

  const confirmPlan = useMutation<unknown, Error, { planId: string }>({
    mutationFn: ({ planId }) =>
      fetchJson("/api/budgets/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `monthly-budget-confirm:${planId}` },
        body: requestBody("confirmMonthly", workspaceId ?? "", { planId, applyToSubAccounts: true }),
      }),
    onSuccess: () => {
      setShowConfirmModal(false);
      invalidateCurrentPlan();
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets", workspaceId]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]) });
    },
  });

  const resetItemMutationErrors = () => {
    createTemplateItem.reset();
    updateTemplateItem.reset();
    createMonthlyItem.reset();
    updateMonthlyItem.reset();
    deleteEntity.reset();
  };

  const resetSourceMutationErrors = () => {
    createTemplateSource.reset();
    updateTemplateSource.reset();
    createMonthlySource.reset();
    updateMonthlySource.reset();
    deleteEntity.reset();
  };

  const openNewItem = (scope: ModalScope) => {
    resetItemMutationErrors();
    setItemTitle("");
    setItemAmount("");
    setItemIsMonthly(true);
    setItemDestinationId("");
    setItemModal({ scope, id: null });
  };

  const openSetupItem = (item: SetupItem) => {
    resetItemMutationErrors();
    setItemTitle(item.title);
    setItemAmount((item.amountCents / 100).toFixed(2));
    setItemIsMonthly(item.isMonthly);
    setItemDestinationId(item.destinationSubAccountId ?? "");
    setItemModal({ scope: "template", id: item.id });
  };

  const openMonthlyItem = (item: MonthlyBudgetPlanItem) => {
    if (!isDraft) return;
    resetItemMutationErrors();
    setItemTitle(item.title);
    setItemAmount((item.amountCents / 100).toFixed(2));
    setItemIsMonthly(true);
    setItemDestinationId(item.destinationSubAccountId ?? "");
    setItemModal({ scope: "monthly", id: item.id });
  };

  const closeItemModal = () => {
    setItemModal(null);
    setItemTitle("");
    setItemAmount("");
    setItemDestinationId("");
  };

  const openNewSource = (scope: ModalScope) => {
    resetSourceMutationErrors();
    setSourceTitle("");
    setSourceAmount("");
    setSourceOwnerId(members[0]?.user.id ?? "");
    setSourceModal({ scope, id: null });
  };

  const openSetupSource = (source: SetupSource) => {
    resetSourceMutationErrors();
    setSourceTitle(source.title);
    setSourceAmount((source.amountCents / 100).toFixed(2));
    setSourceOwnerId(source.ownerId);
    setSourceModal({ scope: "template", id: source.id });
  };

  const openMonthlySource = (source: MonthlyBudgetPlanSource) => {
    if (!isDraft) return;
    resetSourceMutationErrors();
    setSourceTitle(source.title);
    setSourceAmount((source.amountCents / 100).toFixed(2));
    setSourceOwnerId(source.ownerId);
    setSourceModal({ scope: "monthly", id: source.id });
  };

  const closeSourceModal = () => {
    setSourceModal(null);
    setSourceTitle("");
    setSourceAmount("");
    setSourceOwnerId("");
  };

  const saveItem = (event: SubmitEvent) => {
    event.preventDefault();
    if (!itemModal || !workspaceId) return;
    const amountCents = toCents(itemAmount);
    if (!itemTitle.trim() || amountCents === null) return;

    const fields: ItemFields = {
      title: itemTitle.trim(),
      amountCents,
      isMonthly: itemModal.scope === "template" ? itemIsMonthly : true,
      destinationSubAccountId: itemDestinationId || null,
    };

    if (itemModal.scope === "template") {
      if (itemModal.id) {
        updateTemplateItem.mutate({ ...fields, id: itemModal.id });
      } else {
        createTemplateItem.mutate(fields);
      }
      return;
    }

    if (!monthlyPlan || !isDraft) return;
    if (itemModal.id) {
      updateMonthlyItem.mutate({ ...fields, id: itemModal.id, planId: monthlyPlan.id });
    } else {
      createMonthlyItem.mutate({ ...fields, planId: monthlyPlan.id });
    }
  };

  const saveSource = (event: SubmitEvent) => {
    event.preventDefault();
    if (!sourceModal || !workspaceId) return;
    const amountCents = toCents(sourceAmount);
    if (!sourceTitle.trim() || !sourceOwnerId || amountCents === null) return;

    const fields: SourceFields = {
      title: sourceTitle.trim(),
      amountCents,
      ownerId: sourceOwnerId,
    };

    if (sourceModal.scope === "template") {
      if (sourceModal.id) {
        updateTemplateSource.mutate({ ...fields, id: sourceModal.id });
      } else {
        createTemplateSource.mutate(fields);
      }
      return;
    }

    if (!monthlyPlan || !isDraft) return;
    if (sourceModal.id) {
      updateMonthlySource.mutate({ ...fields, id: sourceModal.id, planId: monthlyPlan.id });
    } else {
      createMonthlySource.mutate({ ...fields, planId: monthlyPlan.id });
    }
  };

  const removeEntity = async (id: string, type: DeleteType, label: string) => {
    if (!(await confirmDestructiveAction(`Delete ${label}?`, `Delete ${label}?`, {
      workspace: { name: contextQuery.data?.workspaceName || "Current workspace", role: contextQuery.data?.role || "EDITOR" },
      reversal: "This setup record cannot be restored automatically.",
    }))) return;
    deleteEntity.mutate({ id, type });
  };

  const handleDiscardDraft = async () => {
    if (!monthlyPlan || !isDraft) return;
    if (!(await confirmDestructiveAction(`Discard the draft for ${MONTHS[selectedMonth - 1]} ${selectedYear}?`, "Discard monthly draft?", {
      workspace: { name: contextQuery.data?.workspaceName || "Current workspace", role: contextQuery.data?.role || "EDITOR" },
      reversal: "You can start a new draft, but the discarded draft values will not be restored.",
    }))) return;
    discardDraft.mutate({ planId: monthlyPlan.id });
  };

  useEffect(() => {
    setItemModal(null);
    setSourceModal(null);
    setShowConfirmModal(false);
    setItemTitle("");
    setItemAmount("");
    setItemIsMonthly(true);
    setItemDestinationId("");
    setSourceTitle("");
    setSourceAmount("");
    setSourceOwnerId("");
  }, [selectedMonth, selectedYear]);

  const itemSaving =
    createTemplateItem.isPending ||
    updateTemplateItem.isPending ||
    createMonthlyItem.isPending ||
    updateMonthlyItem.isPending;
  const sourceSaving =
    createTemplateSource.isPending ||
    updateTemplateSource.isPending ||
    createMonthlySource.isPending ||
    updateMonthlySource.isPending;
  const itemError =
    createTemplateItem.error || updateTemplateItem.error || createMonthlyItem.error || updateMonthlyItem.error || deleteEntity.error;
  const sourceError =
    createTemplateSource.error || updateTemplateSource.error || createMonthlySource.error || updateMonthlySource.error || deleteEntity.error;
  const planActionError = startPlan.error || discardDraft.error;

  return (
    <div className="bp-container">
      {!showSetup && (
        <section className="card" style={{ padding: "18px 20px" }}>
        <div
          className="card-header"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "18px" }}
        >
          <div>
            <h3 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>
              {MONTHS[selectedMonth - 1]} {selectedYear} Monthly Budget
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-tertiary)", margin: "4px 0 0" }}>
              Manage this month without changing Budget Setup.
            </p>
          </div>
          <Button className="btn btn-ghost" type="button" onClick={() => setShowSetup(true)}>
            <LayoutTemplate size={16} />
            Budget Setup
            <ChevronDown size={15} />
          </Button>
        </div>

        <div className="bp-form" style={{ paddingBottom: "18px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="form-row">
            <div className="form-group">
              <label className="label" htmlFor="budget-plan-month">Month</label>
              <Select
                id="budget-plan-month"
                className="input"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(Number(event.target.value))}
              >
                {MONTHS.map((month, index) => (
                  <option key={month} value={index + 1}>{month}</option>
                ))}
              </Select>
            </div>
            <div className="form-group">
              <label htmlFor="budget-plan-selected-year" className="label">Year</label>
              <NumericCalculatorInput id="budget-plan-selected-year"
                value={selectedYear}
                allowDecimal={false}
                min={2024}
                max={2100}
                onValueChange={(value) => setSelectedYear(Number.parseInt(value || String(now.getFullYear()), 10))}
              />
            </div>
          </div>
        </div>

        {planQuery.isLoading && (
          <div className="bp-two-col" aria-busy="true">
            <div className="bp-col"><BudgetPlanCompactCardsSkeleton /></div>
            <div className="bp-col"><BudgetPlanCompactCardsSkeleton /></div>
          </div>
        )}

        {planQuery.isError && (
          <div
            role="alert"
            style={{ marginTop: "18px", padding: "14px", color: "var(--danger)", background: "var(--danger-bg)", borderRadius: "var(--r-md)" }}
          >
            {planQuery.error instanceof Error ? planQuery.error.message : "Could not load the monthly budget."}
          </div>
        )}

        {!planQuery.isLoading && !planQuery.isError && !monthlyPlan && (
          <div className="empty-state" style={{ padding: "36px 16px 24px" }}>
            <div className="empty-state-icon" aria-hidden="true"><CalendarRange size={28} /></div>
            <h3 className="empty-state-title">No monthly budget</h3>
            <p className="empty-state-desc">Start with Budget Setup or create an empty monthly plan.</p>
            <div className="empty-state-action" style={{ display: "flex", justifyContent: "center", gap: "8px", flexWrap: "wrap" }}>
              <Button
                className="btn btn-primary"
                type="button"
                onClick={() => startPlan.mutate("startFromSetup")}
                disabled={!workspaceId || !hasSetupSeed || startPlan.isPending}
                title={hasSetupSeed ? "Create this month from Budget Setup" : "Add recurring items or sources to Budget Setup first"}
              >
                <LayoutTemplate size={16} />
                {startPlan.isPending && startPlan.variables === "startFromSetup" ? "Starting..." : "Start from Setup"}
              </Button>
              <Button
                className="btn btn-ghost"
                type="button"
                onClick={() => startPlan.mutate("startBlank")}
                disabled={!workspaceId || startPlan.isPending}
              >
                <FilePlus2 size={16} />
                {startPlan.isPending && startPlan.variables === "startBlank" ? "Starting..." : "Start Blank"}
              </Button>
            </div>
            {planActionError && <p style={{ marginTop: "12px", color: "var(--danger)", fontSize: "13px" }}>{planActionError.message}</p>}
          </div>
        )}

        {!planQuery.isLoading && !planQuery.isError && monthlyPlan && (
          <>
            {isConfirmed && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginTop: "18px",
                  padding: "12px 14px",
                  color: "var(--success)",
                  background: "var(--success-bg)",
                  border: "1px solid var(--success)",
                  borderRadius: "var(--r-md)",
                }}
              >
                <Lock size={16} />
                <span style={{ fontSize: "13px" }}>This monthly budget is confirmed and read-only.</span>
              </div>
            )}

            {isReview && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  marginTop: "18px",
                  padding: "12px 14px",
                  color: "var(--warning)",
                  background: "var(--warning-bg)",
                  border: "1px solid var(--warning)",
                  borderRadius: "var(--r-md)",
                }}
              >
                <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: "1px" }} />
                <span style={{ fontSize: "13px" }}>This migrated monthly budget needs review and is read-only.</span>
              </div>
            )}

            {isConfirming && (
              <output
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  marginTop: "18px",
                  padding: "12px 14px",
                  color: "var(--warning)",
                  background: "var(--warning-bg)",
                  border: "1px solid var(--warning)",
                  borderRadius: "var(--r-md)",
                }}
              >
                <RefreshCw size={17} style={{ flexShrink: 0, marginTop: "1px" }} />
                <span style={{ fontSize: "13px" }}>This monthly budget is being confirmed and is temporarily read-only.</span>
              </output>
            )}

            <div className="bp-stat-grid" style={{ marginTop: "18px" }}>
              <div className="bp-stat">
                <div className="bp-stat-label">Sources</div>
                <div className="bp-stat-value">{formatCents(sourceTotalCents)}</div>
                <div className="bp-stat-sub">{monthlySources.length} {monthlySources.length === 1 ? "source" : "sources"}</div>
              </div>
              <div className="bp-stat">
                <div className="bp-stat-label">Budget Items</div>
                <div className="bp-stat-value">{formatCents(itemTotalCents)}</div>
                <div className="bp-stat-sub">{monthlyItems.length} {monthlyItems.length === 1 ? "item" : "items"}</div>
              </div>
              <div className={`bp-stat ${differenceCents === 0 ? "positive" : "negative"}`}>
                <div className="bp-stat-label">Difference</div>
                <div className="bp-stat-value">{formatCents(Math.abs(differenceCents))}</div>
                <div className="bp-stat-sub">
                  {differenceCents === 0 ? "Balanced" : differenceCents > 0 ? "Left to budget" : "Over budget"}
                </div>
              </div>
            </div>

            {isDraft && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                  marginTop: "18px",
                  paddingTop: "18px",
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                <p style={{ margin: 0, color: canConfirm ? "var(--success)" : "var(--text-tertiary)", fontSize: "12px" }}>
                  {canConfirm
                    ? "Source and budget item totals match."
                    : monthlySources.length === 0 || monthlyItems.length === 0
                      ? "Add at least one source and one budget item before confirming."
                      : `Totals must match before confirming (${formatCents(Math.abs(differenceCents))} ${differenceCents > 0 ? "left to budget" : "over budget"}).`}
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {monthlySources.length === 0 && monthlyItems.length === 0 && (
                    <Button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => startPlan.mutate("startFromSetup")}
                      disabled={!hasSetupSeed || startPlan.isPending || discardDraft.isPending}
                      title={hasSetupSeed ? "Fill this empty draft from Budget Setup" : "Add recurring items or sources to Budget Setup first"}
                    >
                      <LayoutTemplate size={15} />
                      {startPlan.isPending ? "Applying..." : "Start from Setup"}
                    </Button>
                  )}
                  <Button className="btn btn-danger" type="button" onClick={handleDiscardDraft} disabled={discardDraft.isPending}>
                    <Trash2 size={15} />
                    {discardDraft.isPending ? "Discarding..." : "Discard Draft"}
                  </Button>
                  <Button className="btn btn-primary" type="button" onClick={() => setShowConfirmModal(true)} disabled={!canConfirm}>
                    <Check size={16} />
                    Confirm Monthly Budget
                  </Button>
                </div>
                {planActionError && <p style={{ width: "100%", margin: 0, color: "var(--danger)", fontSize: "13px" }}>{planActionError.message}</p>}
              </div>
            )}

            <div className="bp-two-col">
              <div className="bp-col">
                <div className="st-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "12px" }}>
                  <h4 className="st-title" style={{ fontSize: "16px", margin: 0 }}>Sources</h4>
                  {isDraft && (
                    <Button className="btn btn-ghost btn-xs" type="button" onClick={() => openNewSource("monthly")}>
                      <Plus size={14} /> Add Source
                    </Button>
                  )}
                </div>
                <div className="st-grid">
                  {monthlySources.map((source) => {
                    const owner = source.owner ?? memberById.get(source.ownerId);
                    return (
                      <div key={source.id} className="st-card bp-compact-card">
                        <div className="bp-compact-row">
                          <div className="bp-compact-left">
                            <IconTile icon={WalletCards} tone="source" />
                            <div className="bp-compact-info">
                              <span className="bp-compact-title">{source.title}</span>
                              <span className="bp-compact-meta"><Users size={11} /> {personLabel(owner)}</span>
                            </div>
                          </div>
                          <div className="bp-compact-right">
                            <span className="bp-compact-amount">{formatCents(source.amountCents)}</span>
                            {isDraft ? (
                              <Button className="btn btn-ghost btn-icon" type="button" onClick={() => openMonthlySource(source)} title="Edit source" aria-label={`Edit ${source.title}`}>
                                <Pencil size={13} />
                              </Button>
                            ) : (
                              <Lock size={14} color="var(--text-tertiary)" aria-label="Read-only source" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {monthlySources.length === 0 && (
                    <div className="st-grid-empty" style={{ padding: "18px", border: "1px dashed var(--border-default)", borderRadius: "var(--r-md)", textAlign: "center" }}>
                      <CircleDollarSign size={22} style={{ margin: "0 auto 8px", color: "var(--text-tertiary)" }} />
                      <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No monthly sources</div>
                      {isDraft && <Button className="btn btn-ghost btn-xs" type="button" onClick={() => openNewSource("monthly")} style={{ marginTop: "8px" }}><Plus size={14} /> Add Source</Button>}
                    </div>
                  )}
                </div>
              </div>

              <div className="bp-col">
                <div className="st-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "12px" }}>
                  <h4 className="st-title" style={{ fontSize: "16px", margin: 0 }}>Budget Items</h4>
                  {isDraft && (
                    <Button className="btn btn-ghost btn-xs" type="button" onClick={() => openNewItem("monthly")}>
                      <Plus size={14} /> Add Item
                    </Button>
                  )}
                </div>
                <div className="st-grid">
                  {monthlyItems.map((item) => {
                    const destinationName = item.destinationSubAccount?.name ?? (item.destinationSubAccountId ? subAccountNameById.get(item.destinationSubAccountId) : null);
                    return (
                      <div key={item.id} className="st-card bp-compact-card">
                        <div className="bp-compact-row">
                          <div className="bp-compact-left">
                            <IconTile icon={ListChecks} tone="item" />
                            <div className="bp-compact-info">
                              <span className="bp-compact-title">{item.title}</span>
                              <span className="bp-compact-meta">{destinationName || "No destination sub-account"}</span>
                            </div>
                          </div>
                          <div className="bp-compact-right">
                            <span className="bp-compact-amount">{formatCents(item.amountCents)}</span>
                            {isDraft ? (
                              <Button className="btn btn-ghost btn-icon" type="button" onClick={() => openMonthlyItem(item)} title="Edit budget item" aria-label={`Edit ${item.title}`}>
                                <Pencil size={13} />
                              </Button>
                            ) : (
                              <Lock size={14} color="var(--text-tertiary)" aria-label="Read-only budget item" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {monthlyItems.length === 0 && (
                    <div className="st-grid-empty" style={{ padding: "18px", border: "1px dashed var(--border-default)", borderRadius: "var(--r-md)", textAlign: "center" }}>
                      <ListChecks size={22} style={{ margin: "0 auto 8px", color: "var(--text-tertiary)" }} />
                      <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No monthly budget items</div>
                      {isDraft && <Button className="btn btn-ghost btn-xs" type="button" onClick={() => openNewItem("monthly")} style={{ marginTop: "8px" }}><Plus size={14} /> Add Item</Button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
        </section>
      )}

      {showSetup && (
        <section
          className="card"
          style={{ padding: "18px 20px", borderTop: "3px solid var(--brand-500)" }}
        >
          <div
            className="card-header"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}
          >
            <div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "6px",
                  color: "var(--brand-600)",
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                <LayoutTemplate size={14} />
                Setup mode
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Budget Setup</h3>
              <p style={{ fontSize: "13px", color: "var(--text-tertiary)", margin: "4px 0 0" }}>
                Edit reusable sources and items for future monthly budgets. Existing monthly budgets are not changed.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Button className="btn btn-ghost btn-icon" type="button" onClick={() => planQuery.refetch()} disabled={planQuery.isFetching} title="Refresh setup" aria-label="Refresh setup">
                <RefreshCw size={15} className={planQuery.isFetching ? "spin" : undefined} />
              </Button>
              <Button className="btn btn-ghost" type="button" onClick={() => setShowSetup(false)}>
                <CalendarRange size={16} />
                Monthly Budget
              </Button>
            </div>
          </div>

          {planQuery.isError && (
            <div role="alert" style={{ color: "var(--danger)", fontSize: "13px", marginBottom: "12px" }}>
              Could not load Budget Setup.
            </div>
          )}

          <div className="bp-two-col" style={{ marginTop: 0 }}>
            <div className="bp-col">
              <div className="st-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "12px" }}>
                <h4 className="st-title" style={{ fontSize: "16px", margin: 0 }}>Sources</h4>
                <Button className="btn btn-primary btn-xs" type="button" onClick={() => openNewSource("template")}>
                  <Plus size={14} /> Add Source
                </Button>
              </div>
              <div className="st-grid">
                {planQuery.isLoading && <BudgetPlanCompactCardsSkeleton />}
                {!planQuery.isLoading && setupSources.map((source) => {
                  const owner = source.owner ?? memberById.get(source.ownerId);
                  return (
                    <div key={source.id} className="st-card bp-compact-card">
                      <div className="bp-compact-row">
                        <div className="bp-compact-left">
                          <IconTile icon={WalletCards} tone="source" />
                          <div className="bp-compact-info">
                            <span className="bp-compact-title">{source.title}</span>
                            <span className="bp-compact-meta"><Users size={11} /> {personLabel(owner)}</span>
                          </div>
                        </div>
                        <div className="bp-compact-right">
                          <span className="bp-compact-amount">{formatCents(source.amountCents)}</span>
                          <Button className="btn btn-ghost btn-icon" type="button" onClick={() => openSetupSource(source)} title="Edit setup source" aria-label={`Edit ${source.title}`}>
                            <Pencil size={13} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!planQuery.isLoading && setupSources.length === 0 && (
                  <div className="st-grid-empty" style={{ padding: "18px", border: "1px dashed var(--border-default)", borderRadius: "var(--r-md)", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                    No setup sources
                  </div>
                )}
              </div>
            </div>

            <div className="bp-col">
              <div className="st-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "12px" }}>
                <h4 className="st-title" style={{ fontSize: "16px", margin: 0 }}>Budget Items</h4>
                <Button className="btn btn-primary btn-xs" type="button" onClick={() => openNewItem("template")}>
                  <Plus size={14} /> Add Item
                </Button>
              </div>
              <div className="st-grid">
                {planQuery.isLoading && <BudgetPlanCompactCardsSkeleton />}
                {!planQuery.isLoading && setupItems.map((item) => {
                  const destinationName = item.destinationSubAccount?.name ?? (item.destinationSubAccountId ? subAccountNameById.get(item.destinationSubAccountId) : null);
                  return (
                    <div key={item.id} className="st-card bp-compact-card">
                      <div className="bp-compact-row">
                        <div className="bp-compact-left">
                          <IconTile icon={ListChecks} tone="item" />
                          <div className="bp-compact-info">
                            <span className="bp-compact-title">{item.title}</span>
                            <span className="bp-compact-meta">
                              {item.isMonthly ? "Recurring monthly" : "Optional template"}
                              {destinationName ? ` | ${destinationName}` : ""}
                            </span>
                          </div>
                        </div>
                        <div className="bp-compact-right">
                          <span className="bp-compact-amount">{formatCents(item.amountCents)}</span>
                          <Button className="btn btn-ghost btn-icon" type="button" onClick={() => openSetupItem(item)} title="Edit setup item" aria-label={`Edit ${item.title}`}>
                            <Pencil size={13} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!planQuery.isLoading && setupItems.length === 0 && (
                  <div className="st-grid-empty" style={{ padding: "18px", border: "1px dashed var(--border-default)", borderRadius: "var(--r-md)", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                    No setup budget items
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {itemModal && (
        <ModalShell
          title={`${itemModal.id ? "Edit" : "Add"} ${itemModal.scope === "template" ? "Setup" : "Monthly"} Item`}
          onClose={closeItemModal}
          closeDisabled={itemSaving || deleteEntity.isPending}
        >
          <form className="st-modal-form" onSubmit={saveItem}>
            <div className="st-form-grid">
              <div className="form-group st-span-2">
                <label className="label" htmlFor="budget-item-title">Title</label>
                <Input id="budget-item-title" className="input" value={itemTitle} onChange={(event) => setItemTitle(event.target.value)} maxLength={200} required autoFocus />
              </div>
              <div className="form-group st-span-2">
                <label htmlFor="budget-plan-item-amount" className="label">Amount</label>
                <NumericCalculatorInput id="budget-plan-item-amount" value={itemAmount} onValueChange={setItemAmount} min="0" step="0.01" placeholder="0.00" required />
              </div>
              {itemModal.scope === "template" && (
                <div className="form-group st-span-2">
                  <label className="label" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Input type="checkbox" checked={itemIsMonthly} onChange={(event) => setItemIsMonthly(event.target.checked)} />
                    Include when starting a month from Setup
                  </label>
                </div>
              )}
              <div className="form-group st-span-2">
                <label className="label" htmlFor="budget-item-destination">Destination Sub-Account (optional)</label>
                <Select id="budget-item-destination" className="input" value={itemDestinationId} onChange={(event) => setItemDestinationId(event.target.value)}>
                  <option value="">No destination</option>
                  {subAccounts.map((subAccount) => <option key={subAccount.id} value={subAccount.id}>{subAccount.name}</option>)}
                </Select>
              </div>
            </div>
            <ErrorMessage error={itemError} />
            <div className="st-modal-actions">
              {itemModal.id && (
                <Button
                  className="btn btn-danger modal-action-destructive"
                  type="button"
                  onClick={() => removeEntity(itemModal.id!, itemModal.scope === "template" ? "templateItem" : "monthlyItem", "this budget item")}
                  disabled={itemSaving || deleteEntity.isPending}
                >
                  <Trash2 size={15} /> {deleteEntity.isPending ? "Deleting..." : "Delete"}
                </Button>
              )}
              <Button className="btn btn-ghost" type="button" onClick={closeItemModal} disabled={itemSaving || deleteEntity.isPending}>Cancel</Button>
              <Button className="btn btn-primary" type="submit" disabled={itemSaving || deleteEntity.isPending}>
                {itemSaving ? "Saving..." : itemModal.id ? "Save Changes" : "Add Item"}
              </Button>
            </div>
          </form>
        </ModalShell>
      )}

      {sourceModal && (
        <ModalShell
          title={`${sourceModal.id ? "Edit" : "Add"} ${sourceModal.scope === "template" ? "Setup" : "Monthly"} Source`}
          onClose={closeSourceModal}
          closeDisabled={sourceSaving || deleteEntity.isPending}
        >
          <form className="st-modal-form" onSubmit={saveSource}>
            <div className="st-form-grid">
              <div className="form-group st-span-2">
                <label className="label" htmlFor="budget-source-title">Title</label>
                <Input id="budget-source-title" className="input" value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={200} required autoFocus />
              </div>
              <div className="form-group st-span-2">
                <label htmlFor="budget-plan-source-amount" className="label">Amount</label>
                <NumericCalculatorInput id="budget-plan-source-amount" value={sourceAmount} onValueChange={setSourceAmount} min="0" step="0.01" placeholder="0.00" required />
              </div>
              <div className="form-group st-span-2">
                <label className="label" htmlFor="budget-source-owner">Owner</label>
                <Select id="budget-source-owner" className="input" value={sourceOwnerId} onChange={(event) => setSourceOwnerId(event.target.value)} required>
                  <option value="">Select workspace member</option>
                  {members.map((member) => <option key={member.user.id} value={member.user.id}>{personLabel(member.user)}</option>)}
                </Select>
              </div>
            </div>
            <ErrorMessage error={sourceError} />
            <div className="st-modal-actions">
              {sourceModal.id && (
                <Button
                  className="btn btn-danger modal-action-destructive"
                  type="button"
                  onClick={() => removeEntity(sourceModal.id!, sourceModal.scope === "template" ? "templateSource" : "monthlySource", "this budget source")}
                  disabled={sourceSaving || deleteEntity.isPending}
                >
                  <Trash2 size={15} /> {deleteEntity.isPending ? "Deleting..." : "Delete"}
                </Button>
              )}
              <Button className="btn btn-ghost" type="button" onClick={closeSourceModal} disabled={sourceSaving || deleteEntity.isPending}>Cancel</Button>
              <Button className="btn btn-primary" type="submit" disabled={sourceSaving || deleteEntity.isPending || !sourceOwnerId}>
                {sourceSaving ? "Saving..." : sourceModal.id ? "Save Changes" : "Add Source"}
              </Button>
            </div>
          </form>
        </ModalShell>
      )}

      {showConfirmModal && monthlyPlan && (
        <ModalShell title="Confirm Monthly Budget" onClose={() => setShowConfirmModal(false)} closeDisabled={confirmPlan.isPending}>
          <div className="st-modal-form">
            <div style={{ padding: "20px", display: "grid", gap: "16px" }}>
              <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.5 }}>
                Confirm {MONTHS[selectedMonth - 1]} {selectedYear}. Confirmed plans are read-only, and linked budget item amounts will be applied to their destination sub-accounts.
              </p>
              <div className="bp-confirm-summary">
                <div className="bp-stat">
                  <div className="bp-stat-label">Sources</div>
                  <div className="bp-item-amount" style={{ marginTop: "4px" }}>{formatCents(sourceTotalCents)}</div>
                </div>
                <div className="bp-stat">
                  <div className="bp-stat-label">Budget Items</div>
                  <div className="bp-item-amount" style={{ marginTop: "4px" }}>{formatCents(itemTotalCents)}</div>
                </div>
              </div>
              <dl className="confirm-dialog-details" aria-label="Monthly budget posting impact">
                <div><dt>Source</dt><dd>{monthlySources.map((source) => source.title).join(", ") || "No funding sources"}</dd></div>
                <div><dt>Destination</dt><dd>{confirmationDestinations.map((destination) => destination.name).join(", ") || "No linked sub-accounts"}</dd></div>
                <div><dt>Amount</dt><dd>{formatCents(itemTotalCents)}</dd></div>
                <div><dt>Date</dt><dd>{MONTHS[selectedMonth - 1]} {selectedYear}</dd></div>
                {confirmationDestinations.map((destination) => (
                  <div key={destination.id}>
                    <dt>Resulting {destination.name} balance</dt>
                    <dd>{formatCents(destination.resultingBalanceCents)}</dd>
                  </div>
                ))}
              </dl>
              <div className="confirm-dialog-reversal">
                <strong>Reversal</strong>
                <span>Applied ledger entries remain immutable and can be reversed from Transactions with compensating entries.</span>
              </div>
              {confirmPlan.error && <div role="alert" style={{ color: "var(--danger)", fontSize: "13px" }}>{confirmPlan.error.message}</div>}
            </div>
            <div className="st-modal-actions">
              <Button className="btn btn-ghost" type="button" onClick={() => setShowConfirmModal(false)} disabled={confirmPlan.isPending}>Cancel</Button>
              <Button className="btn btn-primary" type="button" onClick={() => confirmPlan.mutate({ planId: monthlyPlan.id })} disabled={confirmPlan.isPending || !canConfirm}>
                <Check size={16} /> {confirmPlan.isPending ? "Confirming..." : "Confirm"}
              </Button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
