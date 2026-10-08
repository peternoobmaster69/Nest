"use client";
import { getAmountToneClass, formatTransactionDate, formatTransactionGroupDateRange, normalizeTransactionGroupSearchValue } from "@/lib/transaction-presentation";
import { apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeCurrency } from "@/lib/currency";
import { useMoneyFormat } from "@/lib/use-money-format";
import { getBrowserCookie, setBrowserCookie } from "@/lib/browser-cookies";
import { MarkdownEditor } from "@/components/markdown-editor";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { type MouseEvent as ReactMouseEvent, SubmitEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useSessionState } from "@/lib/use-session-state";
import { getMotionSafeScrollBehavior } from "@/lib/motion";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { EmptyState, LoadingDots } from "@/components/ui-skeleton";
import { TransactionsInitialSkeleton, TransactionsListSkeleton, TransactionsReceivablesListSkeleton, TransactionsStatsSkeleton } from "@/components/skeletons/TransactionsSkeleton";
import { confirmDestructiveAction, confirmMoneyChange } from "@/lib/confirm-destructive";
import { AlertTriangle, ArrowLeftRight, Check, ChevronDown, ChevronUp, Layers3, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { TransactionOperationControl } from "@/components/transactions/transaction-operation-control";
import { TransactionMonthList } from "@/components/transactions/transaction-month-list";
import { TransactionCorrectionDialog } from "@/components/transactions/transaction-correction-dialog";
import type { TransactionLineageResponse } from "@/components/transactions/transaction-lineage-panel";
import { bankAccountsQueryOptions, type BankAccount } from "@/lib/accounts";
import { useUrlFilterSync } from "@/lib/use-url-filter-sync";
import { SavingsSubAccountCheckbox } from "@/components/savings-sub-account-checkbox";
import {
  getTransactionPeriodParam,
  getTransactionQuickPeriodDateRange,
  isTransactionQuickPeriod,
  TRANSACTION_ALL_PERIOD,
  type TransactionQuickPeriod,
} from "@/lib/transaction-date-filters";

const ALL_BANKS_FILTER = "ALL";
const GROUP_ICON_OPTIONS = [
  "📌", "🧳", "🛠️", "🎁", "🏥", "🚗", "🎓", "💼", "🎯", "✈️",
  "🏠", "🍽️", "🛒", "🎉", "💍", "👶", "🐾", "🎮", "📱", "💻",
  "🧾s", "🏖️", "⛺", "🎵", "📚", "🏋️", "🚌", "🚆", "💡", "🩺",
] as const;

type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  baseCurrency?: string | null;
  defaultBudgetId?: string | null;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  icon?: string | null;
  isSavings: boolean;
  availableCents: number;
  targetCents: number;
  receivableReservedCents?: number;
};
type Transaction = {
  id: string;
  accountId: string;
  budgetId?: string | null;
  groupId?: string | null;
  group?: { id: string; name: string; icon?: string | null } | null;
  subject: string;
  details?: string | null;
  notes?: string | null;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  kind: string;
  hasCorrectionHistory?: boolean;
  date: string;
};
type TransactionGroup = {
  id: string;
  budgetId: string;
  name: string;
  icon?: string | null;
  transactionCount: number;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  firstTransactionDate?: string | null;
  lastTransactionDate?: string | null;
};
type GroupTransactionOption = Pick<Transaction, "id" | "subject" | "date" | "amountCents" | "direction" | "groupId" | "group">;
type TransactionGroupDetail = {
  group: Pick<TransactionGroup, "id" | "budgetId" | "name" | "icon">;
  memberIds: string[];
  transactions: GroupTransactionOption[];
  candidateLimit: number;
};
type TransactionsPageResponse = {
  transactions: Transaction[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  summary?: {
    incomeCents: number;
    expenseCents: number;
  };
};
type TransactionMonthSummary = {
  monthKey: string;
  monthLabel: string;
  count: number;
  incomeCents: number;
  expenseCents: number;
};

type Receivable = {
  id: string;
  workspaceId?: string | null;
  sourceWorkspaceId?: string | null;
  workspaceName?: string | null;
  title: string;
  amountCents: number;
  date: string;
  status: "OPEN" | "PARTIAL" | "PAID" | "VOID";
  budgetId?: string | null;
};

type ReceivableBudgetSummary = {
  workspaceId: string;
  budgetId: string;
  receivableReservedCents: number;
  count: number;
  items: Receivable[];
};

// Month filter helpers - use UTC to avoid timezone shifts
function formatMonthYear(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getMonthKey(dateString: string): string {
  const date = new Date(dateString);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

type TransactionsByMonth = {
  monthKey: string;
  monthLabel: string;
  transactions: Transaction[];
  totalIncome: number;
  totalExpense: number;
};

function groupTransactionsByMonth(transactions: Transaction[]): TransactionsByMonth[] {
  const groups = new Map<string, TransactionsByMonth>();

  transactions.forEach((tx) => {
    const monthKey = getMonthKey(tx.date);
    const [year, month] = monthKey.split("-").map(Number);

    if (!groups.has(monthKey)) {
      groups.set(monthKey, {
        monthKey,
        monthLabel: formatMonthYear(year, month),
        transactions: [],
        totalIncome: 0,
        totalExpense: 0,
      });
    }

    const group = groups.get(monthKey)!;
    group.transactions.push(tx);
    if (tx.direction === "CREDIT") {
      group.totalIncome += tx.amountCents;
    } else {
      group.totalExpense += tx.amountCents;
    }
  });

  return Array.from(groups.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

function getBudgetIcon(name: string, icon?: string | null) {
  if (icon) return icon;
  const key = name.toLowerCase();
  if (key.includes("save")) return "🛡️";
  if (key.includes("loan")) return "🏠";
  if (key.includes("insurance")) return "🧾";
  if (key.includes("phone")) return "📱";
  if (key.includes("credit")) return "💳";
  return "💰";
}

function getContextualGroupDefaults(budget: Budget | undefined, transactions: Transaction[]) {
  const name = budget?.name ?? "Transactions";
  const key = name.toLocaleLowerCase();
  const contexts = [
    { match: /holiday|travel|vacation|trip/, icon: "🧳", example: "Japan trip" },
    { match: /home|house|renovation|repair/, icon: "🛠️", example: "Kitchen renovation" },
    { match: /health|medical|hospital|insurance/, icon: "🏥", example: "Insurance claim" },
    { match: /car|vehicle|transport/, icon: "🚗", example: "Major service" },
    { match: /gift|family|birthday/, icon: "🎁", example: "Mum's birthday" },
    { match: /school|education|course/, icon: "🎓", example: "Design course" },
    { match: /work|business|project/, icon: "💼", example: "Client project" },
    { match: /wedding/, icon: "💍", example: "Wedding expenses" },
  ];
  const context = contexts.find((item) => item.match.test(key));
  const dates = transactions.map((transaction) => new Date(transaction.date)).filter((date) => !Number.isNaN(date.getTime()));
  const latestDate = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : new Date();
  const period = latestDate.toLocaleDateString(undefined, { month: "short", year: "numeric" });

  return {
    icon: context?.icon ?? budget?.icon ?? "📌",
    suggestedName: `${name} · ${period}`,
    placeholder: `e.g. ${context?.example ?? "Annual renewal"}`,
  };
}

export function TransactionsPage() {
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const urlFilterKey = searchParams.toString();
  const targetTransactionId = searchParams.get("transactionId")?.trim().slice(0, 180) ?? "";
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [amount, setAmount] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [transactionGroupId, setTransactionGroupId] = useState("");
  const [operation, setOperation] = useState<"DEDUCT" | "ADD">("ADD");
  const [selectedBankId, setSelectedBankId] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [bankFilterHydrated, setBankFilterHydrated] = useState(false);
  const [activeBudgetFilterId, setActiveBudgetFilterId] = useSessionState<string>("nest:view:transactions:budget", "ALL");
  const [activeGroupFilterId, setActiveGroupFilterId] = useSessionState<string>("nest:view:transactions:group", "ALL");
  const [isSubAccountsExpanded, setIsSubAccountsExpanded] = useSessionState<boolean>("nest:view:transactions:subaccounts-expanded", false);
  const [subAccountGridColumns, setSubAccountGridColumns] = useState(8);
  const [hydratedUrlFilterKey, setHydratedUrlFilterKey] = useState<string | null>(null);
  const urlFilterHydrated = hydratedUrlFilterKey === urlFilterKey;
  const [failedBankLogos, setFailedBankLogos] = useState<Record<string, boolean>>({});
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [deletingTransactionIds, setDeletingTransactionIds] = useState<string[]>([]);
  const [editSubject, setEditSubject] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editOperation, setEditOperation] = useState<"DEDUCT" | "ADD">("ADD");
  const [editTransactionDate, setEditTransactionDate] = useState("");
  const [editBudgetId, setEditBudgetId] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccount | null>(null);
  const [editBankBalance, setEditBankBalance] = useState("");
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferTitle, setTransferTitle] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferSourceBudgetId, setTransferSourceBudgetId] = useState("");
  const [transferDestinationBudgetId, setTransferDestinationBudgetId] = useState("");
  const [receivableInfoBudgetId, setReceivableInfoBudgetId] = useState<string | null>(null);
  const recentTransactionsRef = useRef<HTMLElement | null>(null);
  const subAccountsRef = useRef<HTMLElement | null>(null);
  const subAccountsGridWrapRef = useRef<HTMLDivElement | null>(null);
  const subAccountsGridHeightBeforeToggle = useRef<number | null>(null);
  const bankPickerRef = useRef<HTMLDivElement | null>(null);
  const transactionGroupPickerRef = useRef<HTMLDivElement | null>(null);
  const transactionGroupPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const transactionGroupCardsRef = useRef<HTMLDivElement | null>(null);
  const focusedTransactionIdRef = useRef<string | null>(null);
  const loadMoreTransactionsRef = useRef<HTMLDivElement | null>(null);
  const requestedGroupIdRef = useRef<string | null>(null);
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const [isTransactionGroupPickerOpen, setIsTransactionGroupPickerOpen] = useState(false);
  const [transactionGroupPickerQuery, setTransactionGroupPickerQuery] = useState("");
  const [selectedMonthFilter, setSelectedMonthFilter] = useSessionState<string>("nest:view:transactions:month", "ALL"); // Format: "YYYY-MM" or "ALL"
  const [isGroupingMode, setIsGroupingMode] = useState(false);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupDestinationId, setGroupDestinationId] = useState<string>("NEW");
  const [groupName, setGroupName] = useState("");
  const [groupIcon, setGroupIcon] = useState("📌");
  const [editingGroup, setEditingGroup] = useState<TransactionGroup | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingGroupIcon, setEditingGroupIcon] = useState("📌");
  const [editingGroupSearch, setEditingGroupSearch] = useState("");
  const [debouncedEditingGroupSearch, setDebouncedEditingGroupSearch] = useState("");
  const [editingGroupMembershipChanges, setEditingGroupMembershipChanges] = useState<Record<string, boolean>>({});

  // Budget (sub-account) management modals
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editingBudgetName, setEditingBudgetName] = useState("");
  const [editingBudgetIcon, setEditingBudgetIcon] = useState("");
  const [editingBudgetIsSavings, setEditingBudgetIsSavings] = useState(false);
  const [editingBudgetTarget, setEditingBudgetTarget] = useState("");
  const [createBudgetName, setCreateBudgetName] = useState("");
  const [createBudgetTarget, setCreateBudgetTarget] = useState("");
  const [createBudgetAccountId, setCreateBudgetAccountId] = useState("");
  const [createBudgetIsSavings, setCreateBudgetIsSavings] = useState(false);

  // Icon options for budgets
  const budgetIconOptions = [
    "💰", "🏠", "🛡️", "✈️", "🍔", "🥬", "🚌", "🛍️", "💪", "💊", "🎬", "💡", "📚", "📈", "🚗", "📱", "🎯",
    "🧾", "🏦", "💳", "🧮", "👶", "🎓", "🐶", "🎁", "🛠️", "💼", "🏥", "🚴", "🍜", "☕",
    // Family/Parents & Religious
    "👴", "👵", "👪", "👨‍👩‍👧‍👦", "⛪",
    // Home & Cleaning
    "🧹", "🧽", "🧼", "🪣", "🧺", "🛋️", "🛏️", "🚿", "🚽", "🪟", "🪴",
    // Nature
    "🍃", "🌿", "🌱",
    // Globe/World
    "🌍", "🗺️", "🧭",
  ];

  const context = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  const workspaceId = context.data?.workspaceId;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const { format: formatCents, format: formatMoney } = useMoneyFormat(baseCurrency);
  const txBankStorageKey = workspaceId ? `nest:selectedBank:${workspaceId}` : null;

  const budgets = useQuery({
    queryKey: queryKeys.key(["budgets", workspaceId]),
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
  });

  const transactionGroups = useQuery({
    queryKey: queryKeys.key(["transaction-groups", workspaceId, activeBudgetFilterId]),
    queryFn: () =>
      fetchJson<TransactionGroup[]>(
        `/api/transaction-groups?workspaceId=${workspaceId}&budgetId=${activeBudgetFilterId}`,
      ),
    enabled: Boolean(workspaceId && activeBudgetFilterId !== "ALL"),
    staleTime: 0,
  });

  const createFormGroups = useQuery({
    queryKey: queryKeys.key(["transaction-groups", workspaceId, budgetId]),
    queryFn: () =>
      fetchJson<TransactionGroup[]>(`/api/transaction-groups?workspaceId=${workspaceId}&budgetId=${budgetId}`),
    enabled: Boolean(workspaceId && isCreateModalOpen && budgetId),
    staleTime: 0,
  });

  const editFormGroups = useQuery({
    queryKey: queryKeys.key(["transaction-groups", workspaceId, editBudgetId]),
    queryFn: () =>
      fetchJson<TransactionGroup[]>(`/api/transaction-groups?workspaceId=${workspaceId}&budgetId=${editBudgetId}`),
    enabled: Boolean(workspaceId && editingTxId && editBudgetId),
    staleTime: 0,
  });

  const editingGroupDetail = useQuery({
    queryKey: queryKeys.key(["transaction-group-detail", editingGroup?.id, debouncedEditingGroupSearch]),
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedEditingGroupSearch) params.set("search", debouncedEditingGroupSearch);
      return fetchJson<TransactionGroupDetail>(`/api/transaction-groups/${editingGroup?.id}?${params.toString()}`);
    },
    enabled: Boolean(editingGroup?.id),
    staleTime: 0,
  });

  // Debug: log budget icons
  useEffect(() => {
    if (budgets.data) {
      console.log("[Transactions] Budget icons:", budgets.data.map(b => ({ id: b.id, name: b.name, icon: b.icon })));
    }
  }, [budgets.data]);

  const bankAccounts = useQuery(bankAccountsQueryOptions(workspaceId));
  const bankAccountOptions = useMemo(() => bankAccounts.data ?? [], [bankAccounts.data]);
  const hasMultipleBankAccounts = bankAccountOptions.length > 1;
  const effectiveSelectedBankId = bankAccountOptions.length === 1 ? bankAccountOptions[0].id : selectedBankId;

  // Query for accurate month aggregation data (not paginated)
  const transactionMonths = useQuery({
    queryKey: queryKeys.key(["transaction-months", workspaceId, effectiveSelectedBankId, activeBudgetFilterId]),
    queryFn: () =>
      fetchJson<{
        months: TransactionMonthSummary[];
        total: number;
      }>(
        `/api/transactions/months?workspaceId=${workspaceId}${effectiveSelectedBankId ? `&accountId=${effectiveSelectedBankId}` : ""}${activeBudgetFilterId !== "ALL" ? `&budgetId=${activeBudgetFilterId}` : ""}`,
      ),
    enabled: Boolean(workspaceId),
  });

  const transactionAccountFilter = effectiveSelectedBankId || "";
  const transactionBudgetFilter = activeBudgetFilterId !== "ALL" ? activeBudgetFilterId : "";
  const transactionGroupFilter = activeGroupFilterId !== "ALL" ? activeGroupFilterId : "";

  // Month/Year filter state
  const [dateFilter, setDateFilter] = useSessionState<{ from?: string; to?: string }>("nest:view:transactions:dates", {});
  const [activeQuickSelect, setActiveQuickSelect] = useSessionState<string | null>("nest:view:transactions:quick-period", "thisMonth");
  const [selectedCustomMonths, setSelectedCustomMonths] = useSessionState<string[]>("nest:view:transactions:custom-months", []);
  const [draftCustomMonths, setDraftCustomMonths] = useState<string[]>([]);
  const [isCustomMonthOpen, setIsCustomMonthOpen] = useState(false);
  const customMonthBtnRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useSessionState("nest:view:transactions:search", "");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const currentMonthIndex = new Date().getMonth();
  const currentMonthLabel = MONTH_NAMES[currentMonthIndex];
  const previousMonthLabel = MONTH_NAMES[(currentMonthIndex + 11) % 12];

  // Initialize with "This Month" active
  useEffect(() => {
    if (activeQuickSelect === "thisMonth" && !dateFilter.from) {
      setDateFilter(getTransactionQuickPeriodDateRange("thisMonth"));
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedEditingGroupSearch(editingGroupSearch.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [editingGroupSearch]);

  const handleQuickSelect = (type: TransactionQuickPeriod) => {
    setActiveQuickSelect(type);
    setSelectedCustomMonths([]);
    setDateFilter(getTransactionQuickPeriodDateRange(type));
  };

  const toggleCustomMonth = (monthIndex: number, year: number) => {
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    setDraftCustomMonths((current) => (
      current.includes(monthKey)
        ? current.filter((value) => value !== monthKey)
        : [...current, monthKey].sort((left, right) => left.localeCompare(right))
    ));
  };

  const applyCustomMonths = () => {
    if (!draftCustomMonths.length) return;
    const sorted = draftCustomMonths.toSorted((left, right) => left.localeCompare(right));
    const [firstYear, firstMonth] = sorted[0].split("-").map(Number);
    const [lastYear, lastMonth] = sorted.at(-1)!.split("-").map(Number);
    setActiveQuickSelect("custom");
    setSelectedCustomMonths(sorted);
    setDateFilter({
      from: new Date(Date.UTC(firstYear, firstMonth - 1, 1)).toISOString().split("T")[0],
      to: new Date(Date.UTC(lastYear, lastMonth, 0)).toISOString().split("T")[0],
    });
    setIsCustomMonthOpen(false);
  };

  const clearDateFilter = () => {
    setActiveQuickSelect(null);
    setSelectedCustomMonths([]);
    setDateFilter({});
  };

  const scrollTransactionGroupIntoView = useCallback((groupId: string) => {
    window.requestAnimationFrame(() => {
      const cards = transactionGroupCardsRef.current;
      if (!cards) return;

      const groupCard = Array.from(cards.querySelectorAll<HTMLElement>("[data-group-id]")).find(
        (card) => card.dataset.groupId === groupId,
      );
      if (!groupCard) return;

      const cardsRect = cards.getBoundingClientRect();
      const cardRect = groupCard.getBoundingClientRect();
      const centeredLeft =
        cards.scrollLeft + cardRect.left - cardsRect.left - Math.max(0, (cards.clientWidth - cardRect.width) / 2);
      cards.scrollTo({ left: Math.max(0, centeredLeft), behavior: getMotionSafeScrollBehavior() });
    });
  }, []);

  const toggleTransactionGroupFilter = (groupId: string) => {
    const nextGroupId = activeGroupFilterId === groupId ? "ALL" : groupId;
    setActiveGroupFilterId(nextGroupId);
    clearDateFilter();
    if (nextGroupId !== "ALL") scrollTransactionGroupIntoView(nextGroupId);
  };

  const selectTransactionGroupFromPicker = (groupId: string) => {
    setActiveGroupFilterId(groupId);
    clearDateFilter();
    setIsTransactionGroupPickerOpen(false);
    setTransactionGroupPickerQuery("");
    if (groupId !== "ALL") scrollTransactionGroupIntoView(groupId);
  };

  const customMonthsFilter = activeQuickSelect === "custom" ? selectedCustomMonths.join(",") : "";
  const transactions = useInfiniteQuery({
    queryKey: queryKeys.key(["transactions", workspaceId, transactionAccountFilter, transactionBudgetFilter, transactionGroupFilter, targetTransactionId, dateFilter.from, dateFilter.to, customMonthsFilter, debouncedSearchQuery]),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        workspaceId: workspaceId ?? "",
        paginated: "1",
        limit: "50",
      });
      if (pageParam) params.set("cursor", pageParam);
      if (transactionAccountFilter) params.set("accountId", transactionAccountFilter);
      if (transactionBudgetFilter) params.set("budgetId", transactionBudgetFilter);
      if (transactionGroupFilter) params.set("groupId", transactionGroupFilter);
      if (targetTransactionId) params.set("transactionId", targetTransactionId);
      if (customMonthsFilter) {
        params.set("months", customMonthsFilter);
      } else {
        if (dateFilter.from) params.set("from", dateFilter.from);
        if (dateFilter.to) params.set("to", dateFilter.to);
      }
      if (debouncedSearchQuery) params.set("search", debouncedSearchQuery);
      return fetchJson<TransactionsPageResponse>(`/api/transactions?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(workspaceId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const transactionPages = transactions.data?.pages ?? [];
  const transactionList = useMemo(
    () => transactionPages.flatMap((page) => page.transactions),
    [transactionPages],
  );
  const receivableBudgetSummary = useQuery({
    queryKey: queryKeys.key(["receivable-budget-summary", workspaceId, receivableInfoBudgetId]),
    queryFn: () => fetchJson<ReceivableBudgetSummary>(
      `/api/receivables/budget-summary?workspaceId=${workspaceId}&budgetId=${receivableInfoBudgetId}`,
    ),
    enabled: Boolean(workspaceId && receivableInfoBudgetId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const isRefreshing =
    (bankAccounts.isFetching && !bankAccounts.isLoading) ||
    (budgets.isFetching && !budgets.isLoading) ||
    (transactions.isFetching && !transactions.isLoading);

  useEffect(() => {
    const target = loadMoreTransactionsRef.current;
    if (!target || !transactions.hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && transactions.hasNextPage && !transactions.isFetchingNextPage) {
          void transactions.fetchNextPage();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [transactions.hasNextPage, transactions.isFetchingNextPage, transactions.fetchNextPage]);

  useEffect(() => {
    if (!txBankStorageKey) return;
    const saved = getBrowserCookie(txBankStorageKey);
    if (saved && saved !== ALL_BANKS_FILTER) {
      setSelectedBankId(saved);
    } else {
      setSelectedBankId("");
    }
    setBankFilterHydrated(true);
  }, [txBankStorageKey]);

  useEffect(() => {
    if (!bankAccountOptions.length) return;
    if (bankAccountOptions.length === 1) {
      const onlyBankId = bankAccountOptions[0].id;
      if (selectedBankId !== onlyBankId) setSelectedBankId(onlyBankId);
      return;
    }
    if (selectedBankId && !bankAccountOptions.some((b) => b.id === selectedBankId)) {
      setSelectedBankId("");
    }
  }, [bankAccountOptions, selectedBankId]);

  useEffect(() => {
    if (!txBankStorageKey || !bankFilterHydrated) return;
    setBrowserCookie(txBankStorageKey, selectedBankId || ALL_BANKS_FILTER);
  }, [txBankStorageKey, selectedBankId, bankFilterHydrated]);

  useEffect(() => {
    // Keep in sync with the .tx-account-grid column breakpoints in app/styles/features.css.
    const updateColumns = () => {
      if (window.matchMedia("(max-width: 768px)").matches) setSubAccountGridColumns(3);
      else if (window.matchMedia("(max-width: 1024px)").matches) setSubAccountGridColumns(6);
      else setSubAccountGridColumns(8);
    };
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  const toggleSubAccountsExpanded = () => {
    // FLIP: record the wrapper's height before React swaps the card list so
    // the layout effect can animate from it to the post-render height.
    subAccountsGridHeightBeforeToggle.current =
      subAccountsGridWrapRef.current?.getBoundingClientRect().height ?? null;
    setIsSubAccountsExpanded((v) => !v);
  };

  useLayoutEffect(() => {
    const wrap = subAccountsGridWrapRef.current;
    const fromHeight = subAccountsGridHeightBeforeToggle.current;
    subAccountsGridHeightBeforeToggle.current = null;
    if (!wrap || fromHeight === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const toHeight = wrap.getBoundingClientRect().height;
    if (fromHeight === toHeight) return;
    wrap.style.overflow = "hidden";
    const animation = wrap.animate(
      [{ height: `${fromHeight}px` }, { height: `${toHeight}px` }],
      { duration: 240, easing: "ease-in-out" },
    );
    const clearClip = () => {
      wrap.style.overflow = "";
    };
    animation.onfinish = clearClip;
    animation.oncancel = clearClip;
  }, [isSubAccountsExpanded]);

  useEffect(() => {
    if (activeBudgetFilterId === "ALL") return;
    const activeBudget = budgets.data?.find((b) => b.id === activeBudgetFilterId);
    if (!activeBudget) {
      setActiveBudgetFilterId("ALL");
      return;
    }
    if (selectedBankId && activeBudget.accountId !== selectedBankId) {
      setActiveBudgetFilterId("ALL");
    }
  }, [activeBudgetFilterId, selectedBankId, budgets.data]);

  useEffect(() => {
    setActiveGroupFilterId(requestedGroupIdRef.current || "ALL");
    requestedGroupIdRef.current = null;
    setIsGroupingMode(false);
    setSelectedTransactionIds([]);
    setIsTransactionGroupPickerOpen(false);
    setTransactionGroupPickerQuery("");
  }, [activeBudgetFilterId]);

  useEffect(() => {
    if (activeGroupFilterId === "ALL" || transactionGroups.isLoading) return;
    if (!(transactionGroups.data ?? []).some((group) => group.id === activeGroupFilterId)) {
      setActiveGroupFilterId("ALL");
      return;
    }
    scrollTransactionGroupIntoView(activeGroupFilterId);
  }, [activeGroupFilterId, transactionGroups.data, transactionGroups.isLoading, scrollTransactionGroupIntoView]);

  useEffect(() => {
    if (urlFilterHydrated) return;
    if (!bankAccounts.data || !budgets.data) return;

    const requestedAccountId = searchParams.get("accountId");
    const requestedBudgetId = searchParams.get("budgetId");
    const requestedAccountName = searchParams.get("accountName")?.trim().toLocaleLowerCase();
    const requestedBudgetName = searchParams.get("budgetName")?.trim().toLocaleLowerCase();
    const requestedGroupId = searchParams.get("groupId");
    const requestedTransactionId = searchParams.get("transactionId");
    const requestedFrom = searchParams.get("from");
    const requestedTo = searchParams.get("to");
    const requestedMonths = searchParams.get("months");
    const requestedPeriod = searchParams.get("period");
    const requestedAllPeriod = requestedPeriod === TRANSACTION_ALL_PERIOD;
    const requestedQuickPeriod = isTransactionQuickPeriod(requestedPeriod) ? requestedPeriod : null;
    const requestedSearch = searchParams.get("search")?.trim().slice(0, 120) ?? "";
    const isAskNestView = searchParams.get("view") === "ask-nest";

    if (
      !isAskNestView &&
      !requestedAccountId &&
      !requestedBudgetId &&
      !requestedGroupId &&
      !requestedTransactionId &&
      !requestedFrom &&
      !requestedTo &&
      !requestedMonths &&
      !requestedAllPeriod &&
      !requestedQuickPeriod &&
      !requestedSearch
    ) {
      setHydratedUrlFilterKey(urlFilterKey);
      return;
    }

    const validAccountId =
      requestedAccountId && bankAccounts.data.some((bank) => bank.id === requestedAccountId)
        ? requestedAccountId
        : requestedAccountName
          ? bankAccounts.data.find((bank) => (
              bank.name.toLocaleLowerCase().includes(requestedAccountName) ||
              bank.bankName?.toLocaleLowerCase().includes(requestedAccountName)
            ))?.id ?? ""
          : "";
    const validBudget = requestedBudgetId
      ? budgets.data.find((budget) => budget.id === requestedBudgetId)
      : requestedBudgetName
        ? budgets.data.find((budget) => budget.name.toLocaleLowerCase().includes(requestedBudgetName))
        : undefined;
    const targetAccountId = validAccountId || validBudget?.accountId || "";

    setSelectedBankId(targetAccountId);

    if (validBudget && (!targetAccountId || validBudget.accountId === targetAccountId)) {
      requestedGroupIdRef.current = requestedGroupId;
      setActiveBudgetFilterId(validBudget.id);
      setActiveGroupFilterId(requestedGroupId || "ALL");
    } else {
      setActiveBudgetFilterId("ALL");
      setActiveGroupFilterId("ALL");
    }

    const validMonths = requestedMonths
      ? [...new Set(requestedMonths.split(",").filter((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)))].slice(0, 24)
      : [];
    if (requestedAllPeriod) {
      clearDateFilter();
    } else if (requestedQuickPeriod) {
      setSelectedCustomMonths([]);
      setActiveQuickSelect(requestedQuickPeriod);
      setDateFilter(getTransactionQuickPeriodDateRange(requestedQuickPeriod));
    } else if (validMonths.length) {
      const sorted = validMonths.toSorted((left, right) => left.localeCompare(right));
      const [firstYear, firstMonth] = sorted[0].split("-").map(Number);
      const [lastYear, lastMonth] = sorted.at(-1)!.split("-").map(Number);
      setSelectedCustomMonths(sorted);
      setActiveQuickSelect("custom");
      setDateFilter({
        from: new Date(Date.UTC(firstYear, firstMonth - 1, 1)).toISOString().split("T")[0],
        to: new Date(Date.UTC(lastYear, lastMonth, 0)).toISOString().split("T")[0],
      });
    } else if (requestedFrom || requestedTo) {
      setSelectedCustomMonths([]);
      setActiveQuickSelect("custom");
      setDateFilter({ from: requestedFrom || undefined, to: requestedTo || undefined });
    } else if (isAskNestView) {
      clearDateFilter();
    }
    setSearchQuery(requestedSearch);

    setHydratedUrlFilterKey(urlFilterKey);
  }, [urlFilterHydrated, urlFilterKey, bankAccounts.data, budgets.data, searchParams]);

  useUrlFilterSync({
    accountId: effectiveSelectedBankId || null,
    budgetId: activeBudgetFilterId === "ALL" ? null : activeBudgetFilterId,
    groupId: activeGroupFilterId === "ALL" ? null : activeGroupFilterId,
    months: customMonthsFilter || null,
    period: getTransactionPeriodParam(activeQuickSelect),
    from: activeQuickSelect === "custom" && !customMonthsFilter ? dateFilter.from : null,
    to: activeQuickSelect === "custom" && !customMonthsFilter ? dateFilter.to : null,
    search: debouncedSearchQuery || null,
  }, urlFilterHydrated && bankFilterHydrated);

  useEffect(() => {
    if (!targetTransactionId) focusedTransactionIdRef.current = null;
  }, [targetTransactionId]);

  useEffect(() => {
    if (!urlFilterHydrated || !targetTransactionId || transactions.isLoading) return;
    if (focusedTransactionIdRef.current === targetTransactionId) return;
    if (!transactionList.some((transaction) => transaction.id === targetTransactionId)) return;

    focusedTransactionIdRef.current = targetTransactionId;
    window.requestAnimationFrame(() => {
      const row = document.getElementById(`transaction-${targetTransactionId}`);
      row?.scrollIntoView({ behavior: getMotionSafeScrollBehavior(), block: "center" });
      row?.focus({ preventScroll: true });
    });
  }, [targetTransactionId, transactionList, transactions.isLoading, urlFilterHydrated]);

  // Close bank picker when clicking outside
  useEffect(() => {
    if (!isBankPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!bankPickerRef.current?.contains(event.target as Node)) {
        setIsBankPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isBankPickerOpen]);

  useEffect(() => {
    if (!isTransactionGroupPickerOpen) return;

    const closePicker = () => {
      setIsTransactionGroupPickerOpen(false);
      setTransactionGroupPickerQuery("");
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (!transactionGroupPickerRef.current?.contains(event.target as Node)) closePicker();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closePicker();
      transactionGroupPickerTriggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTransactionGroupPickerOpen]);

  const createTx = useMutation({
    mutationFn: (payload: {
      subject: string;
      notes?: string;
      amountCents: number;
      accountId: string;
      operation: "DEDUCT" | "ADD";
      date: string;
      budgetId: string;
      groupId?: string;
      budgetOperation: "DEDUCT" | "ADD";
    }) =>
      fetchJson("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          workspaceId,
          accountId: payload.accountId,
          subject: payload.subject,
          notes: payload.notes,
          amountCents: payload.amountCents,
          direction: payload.operation === "ADD" ? "CREDIT" : "DEBIT",
          kind: payload.operation === "ADD" ? "ADJUSTMENT" : "EXPENSE",
          date: new Date(payload.date).toISOString(),
          budgetId: payload.budgetId,
          groupId: payload.groupId || undefined,
          budgetOperation: payload.budgetOperation,
        }),
      }),
    onSuccess: async () => {
      setSubject("");
      setNotes("");
      setAmount("");
      setBudgetId("");
      setTransactionGroupId("");
      setOperation("ADD");
      setTransactionDate("");
      setIsCreateModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transactions", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-groups", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-months", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cioOverview(workspaceId), refetchType: "active" });
    },
  });

  const transferBetweenBudgets = useMutation({
    mutationFn: (payload: {
      title: string;
      amountCents: number;
      sourceBudgetId: string;
      destinationBudgetId: string;
    }) =>
      fetchJson("/api/transactions/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          workspaceId,
          title: payload.title,
          amountCents: payload.amountCents,
          sourceBudgetId: payload.sourceBudgetId,
          destinationBudgetId: payload.destinationBudgetId,
        }),
      }),
    onSuccess: async () => {
      setIsTransferModalOpen(false);
      setTransferTitle("");
      setTransferAmount("");
      setTransferSourceBudgetId("");
      setTransferDestinationBudgetId("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transactions", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-groups", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-months", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
    },
  });

  const saveTransactionGroup = useMutation({
    mutationFn: async (payload: {
      destinationId: string;
      name: string;
      icon: string;
      transactionIds: string[];
    }) => {
      if (payload.destinationId === "NEW") {
        return fetchJson("/api/transaction-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            budgetId: activeBudgetFilterId,
            name: payload.name,
            icon: payload.icon,
            transactionIds: payload.transactionIds,
          }),
        });
      }
      return fetchJson(`/api/transaction-groups/${payload.destinationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addTransactionIds: payload.transactionIds }),
      });
    },
    onSuccess: () => {
      setIsGroupModalOpen(false);
      setIsGroupingMode(false);
      setSelectedTransactionIds([]);
      setGroupDestinationId("NEW");
      setGroupName("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-groups", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transactions", workspaceId]), refetchType: "active" });
    },
  });

  const updateTransactionGroup = useMutation({
    mutationFn: ({
      id,
      name,
      icon,
      addTransactionIds,
      removeTransactionIds,
    }: {
      id: string;
      name: string;
      icon: string;
      addTransactionIds: string[];
      removeTransactionIds: string[];
    }) =>
      fetchJson(`/api/transaction-groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon, addTransactionIds, removeTransactionIds }),
      }),
    onSuccess: () => {
      setEditingGroup(null);
      setEditingGroupName("");
      setEditingGroupIcon("📌");
      setEditingGroupSearch("");
      setDebouncedEditingGroupSearch("");
      setEditingGroupMembershipChanges({});
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-groups", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transactions", workspaceId]), refetchType: "active" });
    },
  });

  const deleteTransactionGroup = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/transaction-groups/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setEditingGroup(null);
      setEditingGroupName("");
      setEditingGroupIcon("📌");
      setEditingGroupSearch("");
      setDebouncedEditingGroupSearch("");
      setEditingGroupMembershipChanges({});
      setActiveGroupFilterId("ALL");
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-groups", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transactions", workspaceId]), refetchType: "active" });
    },
  });

  // Budget management mutations
  const createBudget = useMutation({
    mutationFn: (payload: { name: string; targetCents: number; accountId: string; icon?: string; isSavings: boolean }) =>
      fetchJson("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: payload.name,
          targetCents: payload.targetCents,
          accountId: payload.accountId,
          icon: payload.icon || undefined,
          isSavings: payload.isSavings,
        }),
      }),
    onSuccess: () => {
      setIsBudgetModalOpen(false);
      setCreateBudgetName("");
      setCreateBudgetTarget("");
      setCreateBudgetAccountId("");
      setCreateBudgetIsSavings(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cioOverview(workspaceId), refetchType: "active" });
    },
  });

  const updateBudget = useMutation({
    mutationFn: (payload: { id: string; name: string; targetCents: number; icon?: string; isSavings: boolean }) =>
      fetchJson(`/api/budgets/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          targetCents: payload.targetCents,
          icon: payload.icon || undefined,
          isSavings: payload.isSavings,
        }),
      }),
    onSuccess: () => {
      setEditingBudgetId(null);
      setEditingBudgetName("");
      setEditingBudgetIcon("");
      setEditingBudgetIsSavings(false);
      setEditingBudgetTarget("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cioOverview(workspaceId), refetchType: "active" });
    },
  });

  const deleteBudget = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/budgets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setEditingBudgetId(null);
      setEditingBudgetName("");
      setEditingBudgetIcon("");
      setEditingBudgetIsSavings(false);
      setEditingBudgetTarget("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cioOverview(workspaceId), refetchType: "active" });
    },
  });

  const correctTx = useMutation({
    mutationFn: (payload: { id: string; subject: string; notes?: string | null; reason?: string; amountCents: number; operation: "DEDUCT" | "ADD"; date: string; budgetId: string; groupId?: string | null }) =>
      fetchJson(`/api/transactions/${payload.id}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          subject: payload.subject,
          notes: payload.notes ?? null,
          reason: payload.reason || undefined,
          amountCents: payload.amountCents,
          direction: payload.operation === "ADD" ? "CREDIT" : "DEBIT",
          kind: payload.operation === "ADD" ? "ADJUSTMENT" : "EXPENSE",
          date: new Date(payload.date).toISOString(),
          budgetId: payload.budgetId,
          groupId: payload.groupId || null,
        }),
      }),
    onSuccess: async () => {
      setEditingTxId(null);
      setEditSubject("");
      setEditNotes("");
      setEditReason("");
      setEditAmount("");
      setEditOperation("DEDUCT");
      setEditTransactionDate("");
      setEditBudgetId("");
      setEditGroupId("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transactions", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-groups", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-months", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]), refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
    },
  });

  const deleteTx = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/transactions/${id}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": `transaction-reversal:${id}` },
    }),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.key(["transactions", workspaceId]) });
      const previousTransactions = queryClient.getQueryData<Transaction[]>(["transactions", workspaceId]);
      queryClient.setQueryData<Transaction[]>(
        ["transactions", workspaceId],
        (current) => (current ?? []).filter((tx) => tx.id !== id),
      );
      return { previousTransactions };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["transactions", workspaceId]), refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-groups", workspaceId]), refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["transaction-months", workspaceId]), refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets", workspaceId]), refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]), refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
    },
    onError: (_error, id, context) => {
      if (context?.previousTransactions) {
        queryClient.setQueryData(queryKeys.transactions(workspaceId), context.previousTransactions);
      }
      setDeletingTransactionIds((current) => current.filter((transactionId) => transactionId !== id));
    },
    onSettled: (_data, _error, id) => {
      setDeletingTransactionIds((current) => current.filter((transactionId) => transactionId !== id));
    },
  });

  const updateBankBalance = useMutation({
    mutationFn: ({ id, startingCents, expectedUpdatedAt }: { id: string; startingCents: number; expectedUpdatedAt: string }) =>
      fetchJson(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startingCents, expectedUpdatedAt }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
      setEditingBankAccount(null);
      setEditBankBalance("");
    },
  });

  const handleAmountChange = (value: string) => {
    // Detect minus sign to switch to DEDUCT mode
    if (value.startsWith("-")) {
      setOperation("DEDUCT");
      setAmount(value.slice(1));
    } else {
      setAmount(value);
    }
  };

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const selectedBudget = budgets.data?.find((b) => b.id === budgetId);
    const accountId = selectedBudget?.accountId || effectiveSelectedBankId;
    if (!workspaceId || !accountId || !subject || !amount || !transactionDate || !budgetId) return;
    const selectedAccount = bankAccounts.data?.find((account) => account.id === accountId);
    const amountCents = Math.round(Number(amount) * 100);
    const confirmed = await confirmMoneyChange({
      title: operation === "ADD" ? "Confirm money added" : "Confirm money deducted",
      message: "Review the ledger impact before posting. The resulting transaction is retained as financial history.",
      confirmLabel: operation === "ADD" ? "Add money" : "Deduct money",
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      details: [
        { label: "Source", value: operation === "ADD" ? "External or untracked source" : `${selectedAccount?.name || "Bank account"} · ${selectedBudget?.name || "Sub-account"}` },
        { label: "Destination", value: operation === "ADD" ? `${selectedAccount?.name || "Bank account"} · ${selectedBudget?.name || "Sub-account"}` : "Expense or external destination" },
        { label: "Amount", value: formatMoney(amountCents, baseCurrency), tone: operation === "ADD" ? "positive" : "negative" },
        { label: "Date", value: new Date(`${transactionDate}T00:00:00`).toLocaleDateString("en-SG") },
        { label: "Resulting sub-account balance", value: formatMoney((selectedBudget?.availableCents ?? 0) + (operation === "ADD" ? amountCents : -amountCents), baseCurrency) },
      ],
      reversal: "Available from Transactions as an immutable compensating entry.",
    });
    if (!confirmed) return;
    createTx.mutate({
      subject,
      notes: notes || undefined,
      amountCents,
      accountId,
      operation,
      date: transactionDate,
      budgetId,
      groupId: transactionGroupId || undefined,
      budgetOperation: operation,
    });
  };

  const visibleBudgets = useMemo(() => {
    if (!budgets.data?.length) return [];
    if (!effectiveSelectedBankId) return budgets.data;
    return budgets.data.filter((b) => b.accountId === effectiveSelectedBankId);
  }, [budgets.data, effectiveSelectedBankId]);
  const collapsedBudgetCount = subAccountGridColumns * 2 - 1; // pinned "All accounts" card fills one slot
  const hasHiddenSubAccounts = visibleBudgets.length > collapsedBudgetCount;
  const displayedBudgets = useMemo(() => {
    if (isSubAccountsExpanded || !hasHiddenSubAccounts) return visibleBudgets;
    const collapsed = visibleBudgets.slice(0, collapsedBudgetCount);
    // Keep the active filter's card visible while collapsed (e.g. a persisted
    // filter after reload) by pulling it into the last visible slot.
    const activeIndex =
      activeBudgetFilterId === "ALL" ? -1 : visibleBudgets.findIndex((b) => b.id === activeBudgetFilterId);
    if (activeIndex >= collapsedBudgetCount) {
      collapsed[collapsed.length - 1] = visibleBudgets[activeIndex];
    }
    return collapsed;
  }, [isSubAccountsExpanded, hasHiddenSubAccounts, visibleBudgets, collapsedBudgetCount, activeBudgetFilterId]);
  const editingTransaction = useMemo(
    () => transactionList.find((tx) => tx.id === editingTxId) ?? null,
    [transactionList, editingTxId],
  );
  const editableBudgets = useMemo(() => {
    if (!budgets.data?.length) return [];
    if (!editingTransaction) return budgets.data;
    return budgets.data.filter((budget) => budget.accountId === editingTransaction.accountId);
  }, [budgets.data, editingTransaction]);
  const transactionLineage = useQuery({
    queryKey: queryKeys.transactions(workspaceId, "lineage", editingTransaction?.id),
    queryFn: () => fetchJson<TransactionLineageResponse>(`/api/transactions/${editingTransaction!.id}/lineage`),
    enabled: Boolean(editingTransaction?.id && editingTransaction.hasCorrectionHistory),
    staleTime: Infinity,
  });

  const filteredTransactions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return transactionList;

    return transactionList.filter((tx) =>
      [tx.subject, tx.details, tx.notes].some((value) => value?.toLocaleLowerCase().includes(query)),
    );
  }, [transactionList, searchQuery]);

  // Get summary from API response (first page has totals for all matching records)
  const transactionSummary = transactionPages[0]?.summary ?? { incomeCents: 0, expenseCents: 0 };
  const transactionStats = useMemo(() => {
    const income = transactionSummary.incomeCents;
    const expense = transactionSummary.expenseCents;
    return { income, expense, net: income - expense };
  }, [transactionSummary]);

  const getPeriodLabel = () => {
    if (activeQuickSelect === "thisMonth") return currentMonthLabel;
    if (activeQuickSelect === "lastMonth") return previousMonthLabel;
    if (activeQuickSelect === "thisYear") return "This Year";
    if (activeQuickSelect === "custom" && selectedCustomMonths.length === 1) {
      const [year, month] = selectedCustomMonths[0].split("-").map(Number);
      return `${MONTH_NAMES[month - 1]} ${year}`;
    }
    if (activeQuickSelect === "custom" && selectedCustomMonths.length > 1) {
      return `${selectedCustomMonths.length} Months`;
    }
    if (activeQuickSelect === "custom") return "Custom";
    return "All Time";
  };

  const transactionsByMonth = useMemo(() => {
    return groupTransactionsByMonth(filteredTransactions);
  }, [filteredTransactions]);

  const transactionMonthSummaryByKey = useMemo(() => {
    return new Map((transactionMonths.data?.months ?? []).map((month) => [month.monthKey, month]));
  }, [transactionMonths.data?.months]);

  useEffect(() => {
    if (selectedMonthFilter === "ALL" || transactionMonths.isLoading) return;
    const monthStillAvailable = transactionMonths.data?.months.some((month) => month.monthKey === selectedMonthFilter);
    if (!monthStillAvailable) {
      setSelectedMonthFilter("ALL");
    }
  }, [selectedMonthFilter, transactionMonths.data?.months, transactionMonths.isLoading]);

  const totalBankBalanceCents = useMemo(
    () => (bankAccounts.data ?? []).reduce((sum, b) => sum + b.currentBalanceCents, 0),
    [bankAccounts.data],
  );
  const totalLinkedBudgetCents = useMemo(
    () => (bankAccounts.data ?? []).reduce((sum, b) => sum + (b.linkedBudgetTotalCents ?? 0), 0),
    [bankAccounts.data],
  );
  const visibleBudgetTotalCents = useMemo(
    () => visibleBudgets.reduce((sum, budget) => sum + budget.availableCents, 0),
    [visibleBudgets],
  );
  const selectedBank = useMemo(
    () => bankAccountOptions.find((bank) => bank.id === effectiveSelectedBankId) ?? null,
    [bankAccountOptions, effectiveSelectedBankId],
  );
  const displayedBankBalanceCents = selectedBank ? selectedBank.currentBalanceCents : totalBankBalanceCents;
  const displayedLinkedBudgetCents = selectedBank ? visibleBudgetTotalCents : totalLinkedBudgetCents;
  const displayedDiscrepancyCents = displayedBankBalanceCents - displayedLinkedBudgetCents;
  const hasDisplayedDiscrepancy = displayedDiscrepancyCents !== 0;
  const displayedDiscrepancyAmount = formatCents(Math.abs(displayedDiscrepancyCents));
  const displayedDiscrepancyLabel = displayedDiscrepancyCents > 0
    ? `${displayedDiscrepancyAmount} unallocated`
    : `${displayedDiscrepancyAmount} over-allocated`;
  const displayedDiscrepancyDescription = displayedDiscrepancyCents > 0
    ? "Bank balance is higher than the sub-account total."
    : "Sub-accounts exceed the bank balance.";
  const receivableInfoBudget = useMemo(
    () => visibleBudgets.find((budget) => budget.id === receivableInfoBudgetId) ?? null,
    [visibleBudgets, receivableInfoBudgetId],
  );
  const receivableInfoItems = useMemo(
    () =>
      (receivableBudgetSummary.data?.items ?? [])
        .filter(
          (receivable) =>
            receivable.budgetId === receivableInfoBudgetId &&
            (receivable.status === "OPEN" || receivable.status === "PARTIAL"),
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [receivableBudgetSummary.data?.items, receivableInfoBudgetId],
  );
  const receivableInfoTotalCents = useMemo(
    () => receivableBudgetSummary.data?.receivableReservedCents ?? receivableInfoItems.reduce((sum, receivable) => sum + receivable.amountCents, 0),
    [receivableBudgetSummary.data?.receivableReservedCents, receivableInfoItems],
  );

  const beginEdit = (tx: Transaction) => {
    correctTx.reset();
    deleteTx.reset();
    setEditingTxId(tx.id);
    setEditSubject(tx.subject);
    setEditNotes(tx.notes || tx.details || "");
    setEditReason("");
    setEditAmount((tx.amountCents / 100).toFixed(2));
    setEditOperation(tx.direction === "CREDIT" ? "ADD" : "DEDUCT");
    setEditTransactionDate(new Date(tx.date).toISOString().split("T")[0]);
    setEditBudgetId(tx.budgetId || "");
    setEditGroupId(tx.groupId || "");
  };

  const closeEditModal = () => {
    correctTx.reset();
    deleteTx.reset();
    setEditingTxId(null);
    setEditSubject("");
    setEditNotes("");
    setEditReason("");
    setEditAmount("");
    setEditOperation("DEDUCT");
    setEditTransactionDate("");
    setEditBudgetId("");
    setEditGroupId("");
  };

  useEffect(() => {
    if (!isCreateModalOpen) return;
    if (!visibleBudgets.length) return;
    if (!budgetId || !visibleBudgets.some((budget) => budget.id === budgetId)) {
      setBudgetId(visibleBudgets[0].id);
    }
  }, [isCreateModalOpen, visibleBudgets, budgetId]);

  useEffect(() => {
    if (!isCreateModalOpen) return;
    if (!createFormGroups.data) return;
    if (transactionGroupId && !(createFormGroups.data ?? []).some((group) => group.id === transactionGroupId)) {
      setTransactionGroupId("");
    }
  }, [isCreateModalOpen, createFormGroups.data, transactionGroupId]);

  useEffect(() => {
    if (!editingTxId) return;
    if (!editFormGroups.data) return;
    if (!editableBudgets.length) return;
    if (!editBudgetId || !editableBudgets.some((budget) => budget.id === editBudgetId)) {
      setEditBudgetId(editableBudgets[0].id);
    }
  }, [editingTxId, editableBudgets, editBudgetId]);

  useEffect(() => {
    if (!editingTxId) return;
    if (editGroupId && !(editFormGroups.data ?? []).some((group) => group.id === editGroupId)) {
      setEditGroupId("");
    }
  }, [editingTxId, editFormGroups.data, editGroupId]);

  const onSubmitEdit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!editingTransaction || !editSubject || !editAmount || !editTransactionDate || !editBudgetId) return;
    const amountCents = Math.round(Number(editAmount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return;

    const currentBudget = budgets.data?.find((budget) => budget.id === editingTransaction.budgetId);
    const correctedBudget = editableBudgets.find((budget) => budget.id === editBudgetId);
    const currentEffectCents = editingTransaction.direction === "CREDIT"
      ? editingTransaction.amountCents
      : -editingTransaction.amountCents;
    const correctedEffectCents = editOperation === "ADD" ? amountCents : -amountCents;
    const resultingBudgetCents = (correctedBudget?.availableCents ?? 0) + correctedEffectCents - (
      editingTransaction.budgetId === editBudgetId ? currentEffectCents : 0
    );
    const confirmed = await confirmMoneyChange({
      title: "Correct transaction?",
      message: "The original entry will be reversed and the corrected replacement will be posted atomically.",
      confirmLabel: "Create correction",
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      details: [
        { label: "Entry", value: editingTransaction.subject },
        { label: "Current sub-account", value: currentBudget?.name || "Unassigned" },
        { label: "Corrected sub-account", value: correctedBudget?.name || "Unassigned" },
        { label: "Amount", value: `${formatMoney(editingTransaction.amountCents, baseCurrency)} → ${formatMoney(amountCents, baseCurrency)}`, tone: editOperation === "ADD" ? "positive" : "negative" },
        { label: "Date", value: new Date(editTransactionDate).toLocaleDateString("en-SG") },
        { label: "Resulting sub-account balance", value: formatMoney(resultingBudgetCents, baseCurrency) },
      ],
      reversal: "The original and compensating reversal remain immutable in financial history; the replacement becomes the visible entry.",
    });
    if (!confirmed) return;

    correctTx.mutate({
      id: editingTransaction.id,
      subject: editSubject,
      notes: editNotes || null,
      reason: editReason.trim() || undefined,
      amountCents,
      operation: editOperation,
      date: editTransactionDate,
      budgetId: editBudgetId,
      groupId: editGroupId || null,
    });
  };

  const openCreateModal = () => {
    createTx.reset();
    setSubject("");
    setNotes("");
    setAmount("");
    setOperation("ADD");
    setBudgetId(activeBudgetFilterId !== "ALL" ? activeBudgetFilterId : visibleBudgets[0]?.id ?? "");
    setTransactionGroupId(activeGroupFilterId !== "ALL" ? activeGroupFilterId : "");
    setTransactionDate(new Date().toISOString().split("T")[0]);
    setIsCreateModalOpen(true);
  };

  const openTransferModal = () => {
    transferBetweenBudgets.reset();
    const firstBudgetId = visibleBudgets[0]?.id ?? budgets.data?.[0]?.id ?? "";
    const secondBudgetId =
      visibleBudgets.find((budget) => budget.id !== firstBudgetId)?.id ??
      budgets.data?.find((budget) => budget.id !== firstBudgetId)?.id ??
      "";
    setTransferTitle("");
    setTransferAmount("");
    setTransferSourceBudgetId(firstBudgetId);
    setTransferDestinationBudgetId(secondBudgetId);
    setIsTransferModalOpen(true);
  };

  const closeTransferModal = () => {
    transferBetweenBudgets.reset();
    setIsTransferModalOpen(false);
    setTransferTitle("");
    setTransferAmount("");
    setTransferSourceBudgetId("");
    setTransferDestinationBudgetId("");
  };

  const confirmDeleteTx = async (transactionId: string) => {
    const transaction = transactionList.find((item) => item.id === transactionId);
    if (!transaction) return;
    const transactionBudget = budgets.data?.find((budget) => budget.id === transaction.budgetId);
    const confirmed = await confirmMoneyChange({
      title: "Reverse transaction?",
      message: "The original entry will remain in history and a compensating entry will restore its ledger effect.",
      confirmLabel: "Create reversal",
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      details: [
        { label: "Entry", value: transaction.subject },
        { label: "Sub-account", value: transactionBudget?.name || "Unassigned" },
        { label: "Amount", value: formatMoney(transaction.amountCents, baseCurrency), tone: transaction.direction === "DEBIT" ? "negative" : "positive" },
        { label: "Date", value: new Date(transaction.date).toLocaleDateString("en-SG") },
        { label: "Resulting sub-account balance", value: formatMoney((transactionBudget?.availableCents ?? 0) + (transaction.direction === "DEBIT" ? transaction.amountCents : -transaction.amountCents), baseCurrency) },
      ],
      reversal: "This action is itself the immutable reversal; it cannot erase the original entry.",
    });
    if (!confirmed) return;
    if (deletingTransactionIds.includes(transactionId)) return;
    setDeletingTransactionIds((current) => [...current, transactionId]);
    window.setTimeout(() => {
      deleteTx.mutate(transactionId);
    }, 180);
  };
  const confirmDeleteEditingTx = () => {
    if (!editingTxId) return;
    closeEditModal();
    confirmDeleteTx(editingTxId);
  };

  const openEditBankBalance = (bank: BankAccount) => {
    updateBankBalance.reset();
    setEditingBankAccount(bank);
    setEditBankBalance((bank.currentBalanceCents / 100).toFixed(2));
  };

  const closeEditBankBalance = () => {
    updateBankBalance.reset();
    setEditingBankAccount(null);
    setEditBankBalance("");
  };

  const onSubmitBankBalance = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!editingBankAccount || !editBankBalance) return;
    const nextBalanceCents = Math.round(Number(editBankBalance) * 100);
    const confirmed = await confirmMoneyChange({
      title: "Confirm bank balance adjustment",
      message: "This changes the account starting balance used by reconciliation.",
      confirmLabel: "Update balance",
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      details: [
        { label: "Source", value: editingBankAccount.name },
        { label: "Destination", value: "Account reconciliation balance" },
        { label: "Amount", value: formatMoney(nextBalanceCents - editingBankAccount.currentBalanceCents, baseCurrency) },
        { label: "Date", value: new Date().toLocaleDateString("en-SG") },
        { label: "Resulting account balance", value: formatMoney(nextBalanceCents, baseCurrency) },
      ],
      reversal: "Available by recording another reviewed balance adjustment.",
    });
    if (!confirmed) return;
    updateBankBalance.mutate({
      id: editingBankAccount.id,
      startingCents: nextBalanceCents,
      expectedUpdatedAt: editingBankAccount.updatedAt,
    });
  };

  const onSubmitTransfer = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!workspaceId || !transferTitle || !transferAmount || !transferSourceBudgetId || !transferDestinationBudgetId) return;
    const sourceBudget = budgets.data?.find((budget) => budget.id === transferSourceBudgetId);
    const destinationBudget = budgets.data?.find((budget) => budget.id === transferDestinationBudgetId);
    const amountCents = Math.round(Number(transferAmount) * 100);
    const confirmed = await confirmMoneyChange({
      title: "Confirm sub-account transfer",
      message: "Review both sides of this transfer before posting.",
      confirmLabel: "Transfer",
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      details: [
        { label: "Source", value: sourceBudget?.name || "Source sub-account" },
        { label: "Destination", value: destinationBudget?.name || "Destination sub-account" },
        { label: "Amount", value: formatMoney(amountCents, baseCurrency) },
        { label: "Date", value: new Date().toLocaleDateString("en-SG") },
        { label: "Resulting source balance", value: formatMoney((sourceBudget?.availableCents ?? 0) - amountCents, baseCurrency), tone: "negative" },
        { label: "Resulting destination balance", value: formatMoney((destinationBudget?.availableCents ?? 0) + amountCents, baseCurrency), tone: "positive" },
      ],
      reversal: "Available from Transactions as an immutable compensating transfer.",
    });
    if (!confirmed) return;
    transferBetweenBudgets.mutate({
      title: transferTitle,
      amountCents,
      sourceBudgetId: transferSourceBudgetId,
      destinationBudgetId: transferDestinationBudgetId,
    });
  };

  const syncSelectedBankBalance = async () => {
    if (!selectedBank) return;
    const confirmed = await confirmMoneyChange({
      title: "Confirm reconciliation adjustment",
      message: "This updates the bank account balance to match the total currently allocated across its sub-accounts.",
      confirmLabel: "Match balance",
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      details: [
        { label: "Source", value: selectedBank.name },
        { label: "Destination", value: "Sub-account reconciliation total" },
        { label: "Amount", value: formatMoney(displayedLinkedBudgetCents - selectedBank.currentBalanceCents, baseCurrency) },
        { label: "Date", value: new Date().toLocaleDateString("en-SG") },
        { label: "Resulting account balance", value: formatMoney(displayedLinkedBudgetCents, baseCurrency) },
      ],
      reversal: "Available by recording another reviewed balance adjustment.",
    });
    if (!confirmed) return;
    updateBankBalance.mutate({
      id: selectedBank.id,
      startingCents: displayedLinkedBudgetCents,
      expectedUpdatedAt: selectedBank.updatedAt,
    });
  };

  // Budget (sub-account) management handlers
  const openCreateBudgetModal = () => {
    createBudget.reset();
    setCreateBudgetName("");
    setCreateBudgetTarget("");
    setCreateBudgetAccountId(effectiveSelectedBankId || bankAccountOptions[0]?.id || "");
    setCreateBudgetIsSavings(false);
    setIsBudgetModalOpen(true);
  };

  const openEditBudgetModal = (budget: Budget) => {
    updateBudget.reset();
    const resolvedIcon = budget.icon || getBudgetIcon(budget.name);
    setEditingBudgetId(budget.id);
    setEditingBudgetName(budget.name);
    setEditingBudgetIcon(resolvedIcon);
    setEditingBudgetIsSavings(budget.isSavings);
    setEditingBudgetTarget(budget.targetCents > 0 ? String((budget.targetCents / 100).toFixed(2)) : "");
    setIsBudgetModalOpen(true);
  };

  const closeBudgetModal = () => {
    setIsBudgetModalOpen(false);
    setEditingBudgetId(null);
    setEditingBudgetName("");
    setEditingBudgetIcon("");
    setEditingBudgetIsSavings(false);
    setEditingBudgetTarget("");
    setCreateBudgetName("");
    setCreateBudgetTarget("");
    setCreateBudgetAccountId("");
    setCreateBudgetIsSavings(false);
  };

  const onCreateBudget = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!workspaceId || !createBudgetAccountId || !createBudgetName.trim()) return;
    const parsedTarget = createBudgetTarget.trim() ? Number(createBudgetTarget) : 0;
    createBudget.mutate({
      name: createBudgetName.trim(),
      targetCents: Math.round(parsedTarget * 100),
      accountId: createBudgetAccountId,
      icon: createBudgetIsSavings ? "🛡️" : undefined,
      isSavings: createBudgetIsSavings,
    });
  };

  const onUpdateBudget = () => {
    if (!editingBudgetId || !editingBudgetName.trim()) return;
    const parsedTarget = editingBudgetTarget.trim() ? Number(editingBudgetTarget) : 0;
    updateBudget.mutate({
      id: editingBudgetId,
      name: editingBudgetName.trim(),
      targetCents: Math.round(parsedTarget * 100),
      icon: editingBudgetIsSavings ? "🛡️" : editingBudgetIcon || undefined,
      isSavings: editingBudgetIsSavings,
    });
  };

  const confirmDeleteBudget = async () => {
    if (!editingBudgetId) return;
    if (!(await confirmDestructiveAction("This will delete the sub-account and remove all transaction links.", "Delete sub-account?", {
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      reversal: "The sub-account cannot be restored automatically. Ledger entries remain in financial history.",
    }))) return;
    deleteBudget.mutate(editingBudgetId);
  };

  const activeBudget = budgets.data?.find((budget) => budget.id === activeBudgetFilterId);
  const visibleTransactionGroups = transactionGroups.data ?? [];
  const hasTransactionGroups = visibleTransactionGroups.length > 0;
  const normalizedTransactionGroupPickerQuery = normalizeTransactionGroupSearchValue(transactionGroupPickerQuery);
  const filteredTransactionGroupPickerGroups = normalizedTransactionGroupPickerQuery
    ? visibleTransactionGroups.filter((group) => {
        const dateRange = formatTransactionGroupDateRange(group.firstTransactionDate, group.lastTransactionDate);
        const searchableValue = normalizeTransactionGroupSearchValue(`${group.name} ${dateRange}`);
        return searchableValue.includes(normalizedTransactionGroupPickerQuery);
      })
    : visibleTransactionGroups;
  const editingGroupOriginalMemberIds = new Set(editingGroupDetail.data?.memberIds ?? []);
  const editingGroupSelectedCount = (() => {
    let count = editingGroupOriginalMemberIds.size;
    for (const [transactionId, selected] of Object.entries(editingGroupMembershipChanges)) {
      const wasSelected = editingGroupOriginalMemberIds.has(transactionId);
      if (selected && !wasSelected) count += 1;
      if (!selected && wasSelected) count -= 1;
    }
    return count;
  })();

  const openEditingGroupModal = (group: TransactionGroup) => {
    updateTransactionGroup.reset();
    deleteTransactionGroup.reset();
    setEditingGroup(group);
    setEditingGroupName(group.name);
    setEditingGroupIcon(group.icon || "📌");
    setEditingGroupSearch("");
    setDebouncedEditingGroupSearch("");
    setEditingGroupMembershipChanges({});
  };

  const closeEditingGroupModal = () => {
    setEditingGroup(null);
    setEditingGroupName("");
    setEditingGroupIcon("📌");
    setEditingGroupSearch("");
    setDebouncedEditingGroupSearch("");
    setEditingGroupMembershipChanges({});
  };

  const toggleEditingGroupTransaction = (transactionId: string) => {
    const isSelected = editingGroupMembershipChanges[transactionId] ?? editingGroupOriginalMemberIds.has(transactionId);
    setEditingGroupMembershipChanges((current) => ({ ...current, [transactionId]: !isSelected }));
  };

  const submitEditingGroup = (event: SubmitEvent) => {
    event.preventDefault();
    if (!editingGroup || !editingGroupName.trim()) return;
    const addTransactionIds: string[] = [];
    const removeTransactionIds: string[] = [];
    for (const [transactionId, selected] of Object.entries(editingGroupMembershipChanges)) {
      const wasSelected = editingGroupOriginalMemberIds.has(transactionId);
      if (selected && !wasSelected) addTransactionIds.push(transactionId);
      if (!selected && wasSelected) removeTransactionIds.push(transactionId);
    }
    updateTransactionGroup.mutate({
      id: editingGroup.id,
      name: editingGroupName.trim(),
      icon: editingGroupIcon,
      addTransactionIds,
      removeTransactionIds,
    });
  };

  const toggleTransactionSelection = (transactionId: string) => {
    setSelectedTransactionIds((current) =>
      current.includes(transactionId)
        ? current.filter((id) => id !== transactionId)
        : [...current, transactionId],
    );
  };

  const openGroupingModal = () => {
    if (!selectedTransactionIds.length) return;
    saveTransactionGroup.reset();
    const selectedTransactions = transactionList.filter((transaction) => selectedTransactionIds.includes(transaction.id));
    const defaults = getContextualGroupDefaults(activeBudget, selectedTransactions);
    setGroupDestinationId("NEW");
    setGroupName(defaults.suggestedName);
    setGroupIcon(defaults.icon);
    setIsGroupModalOpen(true);
  };

  const submitGrouping = (event: SubmitEvent) => {
    event.preventDefault();
    if (!selectedTransactionIds.length) return;
    if (groupDestinationId === "NEW" && !groupName.trim()) return;
    saveTransactionGroup.mutate({
      destinationId: groupDestinationId,
      name: groupName.trim(),
      icon: groupIcon,
      transactionIds: selectedTransactionIds,
    });
  };

  const confirmDeleteGroup = async () => {
    if (!editingGroup) return;
    if (!(await confirmDestructiveAction(`Delete “${editingGroup.name}”? Its transactions will remain in the sub-account.`, "Delete transaction group?", {
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      reversal: "The group cannot be restored automatically; its transactions are not deleted.",
    }))) return;
    deleteTransactionGroup.mutate(editingGroup.id);
  };

  return (
    <div className="txn-page" style={{ display: "grid", gap: "14px" }}>
      {isRefreshing ? (
        <div className="tx-refresh-indicator" aria-live="polite">
          <LoadingDots className="tx-refresh-dots" />
          <span className="tx-refresh-label">Refreshing</span>
        </div>
      ) : null}

      {/* Show full skeleton while initial loading */}
      {bankAccounts.isLoading || budgets.isLoading ? (
        <TransactionsInitialSkeleton />
      ) : (
        <>
          {/* Compact Bank Selector */}
        <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
          <div className="bank-selector-summary">
            <div className="bank-selector-main">
              {selectedBank ? (
                (() => {
                  const bankMeta = getSingaporeBankByName(selectedBank.bankName || selectedBank.name);
                  const logo = getBankLogoUrl(bankMeta);
                  return logo && !failedBankLogos[selectedBank.id] ? (
                    <Image
                      src={logo}
                      alt={bankMeta?.name || "Bank"}
                      width={44}
                      height={24}
                      sizes="44px"
                      className={`bank-logo-img ${bankMeta?.code === "DBS" ? "bank-logo-img-dbs" : ""}`}
                      loading="lazy"
                      onError={() => setFailedBankLogos((prev) => ({ ...prev, [selectedBank.id]: true }))}
                    />
                  ) : bankMeta ? (
                    <span className="bank-icon" style={{ backgroundColor: bankMeta.color }}>
                      {bankMeta.short}
                    </span>
                  ) : (
                    <span className="bank-icon bank-icon-default">BNK</span>
                  );
                })()
              ) : (
                <span className="bank-icon bank-icon-default">ALL</span>
              )}
              <div className={`bank-selector-amount ${getAmountToneClass(displayedBankBalanceCents)}`}>
                {formatCents(displayedBankBalanceCents)}
              </div>
            </div>
            <div className="bank-selector-actions" ref={bankPickerRef}>
              {hasMultipleBankAccounts ? (
                <Button
                  type="button"
                  className="bm-edit-btn tx-bank-action-btn"
                  onClick={() => setIsBankPickerOpen((open) => !open)}
                  aria-label="Choose bank"
                  title="Choose bank"
                >
                  ▾
                </Button>
              ) : null}
              {selectedBank ? (
                <Button
                  type="button"
                  className="bm-edit-btn tx-bank-action-btn"
                  onClick={() => openEditBankBalance(selectedBank)}
                  aria-label={`Edit ${selectedBank.name} balance`}
                  title="Edit balance"
                >
                  ✎
                </Button>
              ) : null}
              {isBankPickerOpen && hasMultipleBankAccounts ? (
                <div className="bank-selector-menu" role="menu" aria-label="Bank options">
                  <Button
                    type="button"
                    className={`bank-selector-option${selectedBankId === "" ? " is-active" : ""}`}
                    onClick={() => {
                      setSelectedBankId("");
                      setIsBankPickerOpen(false);
                    }}
                  >
                    All banks
                  </Button>
                  {bankAccountOptions.map((bank) => (
                    <Button
                      key={bank.id}
                      type="button"
                      className={`bank-selector-option${selectedBankId === bank.id ? " is-active" : ""}`}
                      onClick={() => {
                        setSelectedBankId(bank.id);
                        setIsBankPickerOpen(false);
                      }}
                    >
                      {bank.name}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

      <section ref={subAccountsRef} className="card tx-subaccounts-section">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
            <span aria-hidden="true">📁</span>
            <span>Sub-Accounts</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Button
              type="button"
              className="bm-edit-btn tx-subaccount-add-btn"
              onClick={openCreateBudgetModal}
              aria-label="Add new sub-account"
              title="Add new sub-account"
            >
              +
            </Button>
          </div>
        </div>
        {hasDisplayedDiscrepancy ? (
          <div className="tx-reconciliation" role="status" aria-live="polite">
            <div className="tx-reconciliation-status">
              <span className="tx-reconciliation-icon" aria-hidden="true"><AlertTriangle size={15} /></span>
              <div className="tx-reconciliation-copy">
                <strong>{displayedDiscrepancyLabel}</strong>
                <span>{displayedDiscrepancyDescription}</span>
              </div>
            </div>

            <dl className="tx-reconciliation-values">
              <div>
                <dt>Bank</dt>
                <dd>{formatCents(displayedBankBalanceCents)}</dd>
              </div>
              <div>
                <dt>Sub-accounts</dt>
                <dd>{formatCents(displayedLinkedBudgetCents)}</dd>
              </div>
            </dl>

            <div className="tx-reconciliation-actions">
            {selectedBank ? (
                <>
                  <Button
                    type="button"
                    className="btn btn-ghost btn-xs tx-reconciliation-action"
                    onClick={() => openEditBankBalance(selectedBank)}
                  >
                    <Pencil size={13} aria-hidden="true" /> Edit bank
                  </Button>
                  <Button
                    type="button"
                    className="btn btn-primary btn-xs tx-reconciliation-action"
                    onClick={syncSelectedBankBalance}
                    disabled={updateBankBalance.isPending}
                    title="Update bank balance to match the sub-account total"
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    {updateBankBalance.isPending ? "Updating…" : "Use sub-account total"}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  className="btn btn-ghost btn-xs tx-reconciliation-action"
                  onClick={() => setIsBankPickerOpen(true)}
                >
                  Choose bank
                </Button>
              )}
            </div>
          </div>
        ) : null}
        <div ref={subAccountsGridWrapRef} id="tx-account-grid-wrap">
        <div id="tx-account-grid" className="account-cards-grid tx-account-grid">
          {/*
            Transactions page: compact account chips with only name + amount.
          */}
          <div
            className="budget-mini budget-mini-compact tx-account-card"
            role="button"
            tabIndex={0}
            aria-pressed={activeBudgetFilterId === "ALL"}
            aria-label="Show transactions from all sub-accounts"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
            onClick={() => {
              setActiveBudgetFilterId("ALL");
              if (subAccountsRef.current) {
                const rect = subAccountsRef.current.getBoundingClientRect();
                if (rect.top > 0) {
                  subAccountsRef.current.scrollIntoView({ behavior: getMotionSafeScrollBehavior(), block: "start" });
                }
              }
            }}
            style={{
              borderColor: activeBudgetFilterId === "ALL" ? "var(--brand-500)" : undefined,
              boxShadow: activeBudgetFilterId === "ALL" ? "var(--shadow-sm)" : undefined,
            }}
          >
            <div className="tx-account-card-body">
              <div className="bm-name" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span aria-hidden="true">📁</span>
                <span>All accounts</span>
              </div>
              <div className={`bm-amount ${getAmountToneClass(visibleBudgetTotalCents)}`}>
                {formatCents(visibleBudgetTotalCents)}
              </div>
              <div className="bm-target tx-account-card-footer tx-account-card-footer-empty" aria-hidden="true">
                —
              </div>
            </div>
          </div>
          {displayedBudgets.map((b) => (
            <div
              key={b.id}
              className="budget-mini budget-mini-compact tx-account-card"
              role="button"
              tabIndex={0}
              aria-pressed={activeBudgetFilterId === b.id}
              aria-label={`Show transactions from ${b.name}`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.currentTarget.click();
                }
              }}
              onClick={() => {
                setActiveBudgetFilterId(b.id);
                if (subAccountsRef.current) {
                  const rect = subAccountsRef.current.getBoundingClientRect();
                  if (rect.top > 0) {
                    subAccountsRef.current.scrollIntoView({ behavior: getMotionSafeScrollBehavior(), block: "start" });
                  }
                }
              }}
              style={{
                borderColor: activeBudgetFilterId === b.id ? "var(--brand-500)" : undefined,
                boxShadow: activeBudgetFilterId === b.id ? "var(--shadow-sm)" : undefined,
                position: "relative",
              }}
            >
              <div className="tx-account-card-body">
                <div className="tx-account-card-head">
                  <div className="bm-name">{b.name}</div>
                  <Button
                    type="button"
                    className="bm-edit-btn tx-subaccount-edit-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditBudgetModal(b);
                    }}
                    aria-label={`Edit ${b.name}`}
                    title="Edit sub-account"
                  >
                    ✎
                  </Button>
                </div>
                <div className={`bm-amount ${getAmountToneClass(b.availableCents)}`}>{formatCents(b.availableCents)}</div>
                {b.receivableReservedCents && b.availableCents > 0 ? (
                  <div className="bm-target tx-account-card-footer tx-account-card-receivable">
                    <span>({formatCents(b.receivableReservedCents)})</span>
                    <Button
                      type="button"
                      className="tx-account-receivable-btn"
                      aria-label={`Show receivable breakdown for ${b.name}`}
                      title="Show receivable breakdown"
                      onClick={(event) => {
                        event.stopPropagation();
                        setReceivableInfoBudgetId(b.id);
                      }}
                    >
                      i
                    </Button>
                  </div>
                ) : (
                  <div className="bm-target tx-account-card-footer tx-account-card-footer-empty" aria-hidden="true">
                    —
                  </div>
                )}
              </div>
              <span
                aria-hidden="true"
                className="tx-account-card-icon"
              >
                {getBudgetIcon(b.name, b.icon)}
              </span>
            </div>
          ))}
        </div>
        </div>
        {hasHiddenSubAccounts ? (
          <Button
            type="button"
            className="btn btn-ghost btn-sm tx-account-grid-more"
            aria-expanded={isSubAccountsExpanded}
            aria-controls="tx-account-grid-wrap"
            onClick={toggleSubAccountsExpanded}
          >
            {isSubAccountsExpanded ? (
              <>Show fewer <ChevronUp size={14} aria-hidden="true" /></>
            ) : (
              <>Show all {visibleBudgets.length} sub-accounts <ChevronDown size={14} aria-hidden="true" /></>
            )}
          </Button>
        ) : null}
      </section>

      {activeBudgetFilterId !== "ALL" ? (
        <section
          className={`card tx-group-panel${transactionGroups.isLoading ? " is-loading" : hasTransactionGroups ? " has-groups" : " is-empty"}`}
          aria-label={`Groups in ${activeBudget?.name ?? "sub-account"}`}
        >
          <div className="tx-group-panel-head">
            <div className="tx-group-panel-heading" ref={transactionGroupPickerRef}>
              {hasTransactionGroups ? (
                <Button
                  ref={transactionGroupPickerTriggerRef}
                  type="button"
                  className={`tx-group-panel-symbol tx-group-picker-trigger${isTransactionGroupPickerOpen ? " is-open" : ""}`}
                  aria-label={`Browse ${visibleTransactionGroups.length} transaction ${visibleTransactionGroups.length === 1 ? "group" : "groups"}`}
                  aria-expanded={isTransactionGroupPickerOpen}
                  aria-haspopup="dialog"
                  aria-controls="transaction-group-picker"
                  title="Browse and search groups"
                  onClick={() => {
                    setTransactionGroupPickerQuery("");
                    setIsTransactionGroupPickerOpen((isOpen) => !isOpen);
                  }}
                >
                  <Layers3 size={15} aria-hidden="true" />
                  <span className="tx-group-count" aria-hidden="true">
                    ×{visibleTransactionGroups.length}
                  </span>
                </Button>
              ) : (
                <span className="tx-group-panel-symbol" aria-hidden="true">
                  <Layers3 size={15} />
                </span>
              )}
              {hasTransactionGroups && isTransactionGroupPickerOpen ? (
                <dialog open
                  id="transaction-group-picker"
                  className="tx-group-picker-popover"
                  aria-label="Find a transaction group"
                >
                  <label className="tx-group-picker-search">
                    <Search size={15} aria-hidden="true" />
                    <Input
                      type="search"
                      value={transactionGroupPickerQuery}
                      aria-label="Search transaction groups"
                      placeholder="Search groups…"
                      autoFocus
                      onChange={(event) => setTransactionGroupPickerQuery(event.target.value)}
                    />
                  </label>
                  <div className="tx-group-picker-options">
                    {!normalizedTransactionGroupPickerQuery ? (
                      <Button
                        type="button"
                        className={`tx-group-picker-option${activeGroupFilterId === "ALL" ? " is-active" : ""}`}
                        aria-pressed={activeGroupFilterId === "ALL"}
                        onClick={() => selectTransactionGroupFromPicker("ALL")}
                      >
                        <span className="tx-group-picker-option-icon" aria-hidden="true">
                          <Layers3 size={15} />
                        </span>
                        <span className="tx-group-picker-option-copy">
                          <strong>All groups</strong>
                          <small>{visibleTransactionGroups.length} {visibleTransactionGroups.length === 1 ? "group" : "groups"}</small>
                        </span>
                        {activeGroupFilterId === "ALL" ? <Check size={15} aria-hidden="true" /> : null}
                      </Button>
                    ) : null}
                    {filteredTransactionGroupPickerGroups.map((group) => {
                      const isActive = activeGroupFilterId === group.id;
                      const transactionDateRange = formatTransactionGroupDateRange(
                        group.firstTransactionDate,
                        group.lastTransactionDate,
                      );
                      return (
                        <Button
                          key={group.id}
                          type="button"
                          className={`tx-group-picker-option${isActive ? " is-active" : ""}`}
                          aria-pressed={isActive}
                          onClick={() => selectTransactionGroupFromPicker(group.id)}
                        >
                          <span className="tx-group-picker-option-icon" aria-hidden="true">{group.icon || "📌"}</span>
                          <span className="tx-group-picker-option-copy">
                            <strong>{group.name}</strong>
                            <small className="tx-group-picker-option-amount">
                              {formatCents(group.expenseCents - group.incomeCents)}
                            </small>
                            <small className="tx-group-picker-option-range" title={transactionDateRange}>
                              {transactionDateRange}
                            </small>
                          </span>
                          {isActive ? <Check size={15} aria-hidden="true" /> : null}
                        </Button>
                      );
                    })}
                    {filteredTransactionGroupPickerGroups.length === 0 ? (
                      <p className="tx-group-picker-empty">No groups match “{transactionGroupPickerQuery.trim()}”.</p>
                    ) : null}
                  </div>
                </dialog>
              ) : null}
              {!hasTransactionGroups && !transactionGroups.isLoading ? (
                <p>No groups yet. Create one to organise related transactions.</p>
              ) : !hasTransactionGroups ? (
                <p><LoadingDots /> Loading groups</p>
              ) : null}
            </div>
            {hasTransactionGroups ? (
              <div className="tx-group-cards" ref={transactionGroupCardsRef}>
                {visibleTransactionGroups.map((group) => {
                  const isActive = activeGroupFilterId === group.id;
                  return (
                    <div
                      key={group.id}
                      data-group-id={group.id}
                      className={`tx-group-card${isActive ? " is-active" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isActive}
                      aria-label={isActive ? `Clear ${group.name} filter and show all transactions` : `Show ${group.name} transactions`}
                      title={isActive ? "Select again to show all transactions" : `Show ${group.name} transactions`}
                      onClick={() => toggleTransactionGroupFilter(group.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleTransactionGroupFilter(group.id);
                        }
                      }}
                    >
                      <span className="tx-group-card-icon" aria-hidden="true">{group.icon || "📌"}</span>
                      <span className="tx-group-card-copy">
                        <strong>{group.name}</strong>
                      </span>
                      <span className="tx-group-card-total">
                        <strong>{formatCents(group.expenseCents - group.incomeCents)}</strong>
                      </span>
                      <Button
                        type="button"
                        className="tx-group-card-edit"
                        aria-label={`Edit ${group.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditingGroupModal(group);
                        }}
                      >
                        <Pencil size={12} aria-hidden="true" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <Button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setIsGroupingMode(true);
                setSelectedTransactionIds([]);
                recentTransactionsRef.current?.scrollIntoView({ behavior: getMotionSafeScrollBehavior(), block: "start" });
              }}
              disabled={!filteredTransactions.length}
            >
              Group
            </Button>
          </div>
        </section>
      ) : null}

      {/* Month/Year Filter Bar */}
      <div className="tx-filter-bar" ref={customMonthBtnRef}>
        <div className="tx-filter-controls">
          <div className="tx-filter-pills">
            <Button
              type="button"
              className={`tx-filter-pill ${activeQuickSelect === "thisMonth" ? "is-active" : ""}`}
              onClick={() => handleQuickSelect("thisMonth")}
            >
              {currentMonthLabel}
            </Button>
            <Button
              type="button"
              className={`tx-filter-pill ${activeQuickSelect === "lastMonth" ? "is-active" : ""}`}
              onClick={() => handleQuickSelect("lastMonth")}
            >
              {previousMonthLabel}
            </Button>
            <Button
              type="button"
              className={`tx-filter-pill ${activeQuickSelect === null && !dateFilter.from ? "is-active" : ""}`}
              onClick={() => {
                setActiveQuickSelect(null);
                setSelectedCustomMonths([]);
                setDateFilter({});
              }}
            >
              All
            </Button>
            <Button
              type="button"
              className={`tx-filter-pill tx-filter-pill-custom ${activeQuickSelect === "custom" ? "is-active" : ""}`}
              onClick={() => {
                if (!isCustomMonthOpen) setDraftCustomMonths(selectedCustomMonths);
                setIsCustomMonthOpen(!isCustomMonthOpen);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style={{ marginRight: "4px" }}>
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              Custom
            </Button>
          </div>
          <div className="tx-primary-actions" aria-label="Transaction actions">
            <Button
              type="button"
              className="btn btn-ghost btn-sm tx-primary-action"
              onClick={openTransferModal}
              disabled={(budgets.data?.length ?? 0) < 2}
              aria-label="Transfer between sub-accounts"
              title="Transfer between sub-accounts"
            >
              <ArrowLeftRight size={16} aria-hidden="true" />
              <span className="tx-primary-action-label">Transfer</span>
            </Button>
            <Button
              type="button"
              className="btn btn-primary btn-sm tx-primary-action mobile-primary-create"
              onClick={openCreateModal}
              aria-label="Add transaction"
              title="Add transaction"
            >
              <Plus size={16} aria-hidden="true" />
              <span className="tx-primary-action-label mobile-primary-create-label">Add Transaction</span>
            </Button>
          </div>
        </div>
        <div className="tx-search-box">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className="tx-search-icon">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <Input
            type="text"
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="tx-search-input"
          />
          {searchQuery && (
            <Button
              type="button"
              className="tx-search-clear"
              onClick={() => setSearchQuery("")}
            >
              ×
            </Button>
          )}
        </div>

        {/* Custom Month Popover */}
        {isCustomMonthOpen && typeof document !== "undefined" && createPortal(
          <Dialog open onClose={() => setIsCustomMonthOpen(false)} title="Select months" surface="custom" overlayClassName="tx-popover-overlay">
            <dialog open className="tx-month-popover">
              <div className="tx-popover-header">
                <div>
                  <h4>Select months</h4>
                  <p>{draftCustomMonths.length ? `${draftCustomMonths.length} selected` : "Choose up to 24 months"}</p>
                </div>
                <ModalCloseButton onClick={() => setIsCustomMonthOpen(false)} label="Close Select Months" />
              </div>
              <div className="tx-popover-body">
                {/* Generate years from current year down to earliest transaction year (or 2020 as default) */}
                {(() => {
                  const currentYear = new Date().getFullYear();
                  const earliestYear = transactionList.length > 0
                    ? Math.min(2020, ...transactionList.map((tx) => new Date(tx.date).getFullYear()))
                    : 2020;
                  const yearsToShow = [];
                  for (let year = currentYear; year >= earliestYear; year--) {
                    yearsToShow.push(year);
                  }
                  return yearsToShow.map((year) => (
                    <div key={year} className="tx-popover-year">
                      <div className="tx-popover-year-label">{year}</div>
                      <div className="tx-popover-months">
                        {MONTH_NAMES.map((month, idx) => {
                          const isCurrentMonth = year === new Date().getFullYear() && idx === new Date().getMonth();
                          const monthKey = `${year}-${String(idx + 1).padStart(2, "0")}`;
                          const isSelected = draftCustomMonths.includes(monthKey);
                          return (
                            <Button
                              key={`${year}-${month}`}
                              type="button"
                              className={`tx-popover-month ${isSelected ? "is-active" : ""} ${isCurrentMonth ? "is-current" : ""}`}
                              aria-pressed={isSelected}
                              onClick={() => toggleCustomMonth(idx, year)}
                              disabled={!isSelected && draftCustomMonths.length >= 24}
                            >
                              {month}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
              <div className="tx-popover-actions">
                <Button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraftCustomMonths([])} disabled={!draftCustomMonths.length}>
                  Clear
                </Button>
                <Button type="button" className="btn btn-primary btn-sm" onClick={applyCustomMonths} disabled={!draftCustomMonths.length}>
                  Apply {draftCustomMonths.length ? `(${draftCustomMonths.length})` : ""}
                </Button>
              </div>
            </dialog>
          </Dialog>,
          document.body
        )}
      </div>
      {/* Recent Transactions List */}
      <section ref={recentTransactionsRef} className="card">
        {isGroupingMode ? (
          <div className="tx-selection-bar">
            <Button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setIsGroupingMode(false);
                setSelectedTransactionIds([]);
              }}
            >
              <X size={16} aria-hidden="true" /> Cancel
            </Button>
            <span><strong>{selectedTransactionIds.length}</strong> selected</span>
            <Button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openGroupingModal}
              disabled={!selectedTransactionIds.length}
            >
              <Layers3 size={16} aria-hidden="true" /> Continue
            </Button>
          </div>
        ) : (
        <div style={{ display: "flex", justifyContent: "center", gap: "10px", alignItems: "center", marginBottom: "8px" }}>
          {transactions.isLoading ? (
            <TransactionsStatsSkeleton />
          ) : filteredTransactions.length > 0 ? (
            <div className="transaction-stats-row">
              <span className="period-label-desktop">{getPeriodLabel()}</span>
              {filteredTransactions.length > 0 && (
                <div className="transaction-stats-summary">
                  <span style={{ color: "var(--amount-positive)" }}>
                    {formatCents(transactionStats.income)}
                  </span>
                  <span>-</span>
                  <span style={{ color: "var(--amount-negative)" }}>
                    {formatCents(transactionStats.expense)}
                  </span>
                  <span>=</span>
                  <span className={getAmountToneClass(transactionStats.net)}>
                    {transactionStats.net >= 0 ? "+" : ""}
                    {formatCents(Math.abs(transactionStats.net))}
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </div>
        )}
        <div className="simple-list tx-month-groups">
          {transactions.isLoading && <TransactionsListSkeleton />}

          {transactions.isError && (
            <div className="empty-state" style={{ padding: "40px 20px" }}>
              <div className="empty-state-icon">⚠️</div>
              <h3 className="empty-state-title">Failed to load transactions</h3>
              <Button className="btn btn-primary" onClick={() => transactions.refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!transactions.isLoading && !transactions.isError ? (
            <TransactionMonthList
              groups={transactionsByMonth}
              summaries={transactionMonthSummaryByKey}
              useServerSummaries={!searchQuery.trim() && activeGroupFilterId === "ALL"}
              deletingIds={deletingTransactionIds}
              selectedIds={selectedTransactionIds}
              targetId={targetTransactionId}
              grouping={isGroupingMode}
              formatAmount={formatCents}
              onActivate={(transaction) => {
                if (isGroupingMode) toggleTransactionSelection(transaction.id);
                else beginEdit(transaction);
              }}
            />
          ) : null}
          {!transactions.isLoading && !transactions.isError && transactions.hasNextPage ? (
            <div ref={loadMoreTransactionsRef} style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
              <Button
                className="btn btn-ghost"
                type="button"
                onClick={() => transactions.fetchNextPage()}
                disabled={transactions.isFetchingNextPage}
              >
                {transactions.isFetchingNextPage ? <LoadingDots /> : "Load more"}
              </Button>
            </div>
          ) : null}
          {!transactions.isLoading && !transactions.isError && filteredTransactions.length === 0 && (
            <EmptyState
              icon={searchQuery.trim() ? "🔎" : "📑"}
              title={searchQuery.trim() ? "No matching transactions" : "No transactions"}
              description={searchQuery.trim() ? `No transactions match “${searchQuery.trim()}”.` : selectedMonthFilter !== "ALL" ? "No transactions for this month." : effectiveSelectedBankId ? "Add your first transaction for this bank account." : "Add your first transaction to start tracking your spending."}
              action={!searchQuery.trim() ? (
                <Button className="btn btn-primary" onClick={openCreateModal}>
                  + Add Transaction
                </Button>
              ) : undefined}
            />
          )}
        </div>
      </section>

      {isGroupModalOpen && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={() => setIsGroupModalOpen(false)} title="Create transaction group" surface="custom" overlayClassName="profile-modal-overlay">
          <dialog open className="profile-modal tx-group-modal">
            <div className="profile-modal-head">
              <h3>Group {selectedTransactionIds.length} transactions</h3>
              <ModalCloseButton onClick={() => setIsGroupModalOpen(false)} label="Close Group Transactions" />
            </div>
            <form className="modal-form-shell" onSubmit={submitGrouping}>
              <div className="profile-modal-body">
                <p className="tx-group-modal-intro">
                  What do these {activeBudget?.name ?? "sub-account"} transactions belong to?
                </p>
                {(transactionGroups.data ?? []).length ? (
                  <label className="tx-group-field">
                    Group
                    <Select className="input" value={groupDestinationId} onChange={(event) => setGroupDestinationId(event.target.value)}>
                      <option value="NEW">Create a new group</option>
                      {(transactionGroups.data ?? []).map((group) => (
                        <option key={group.id} value={group.id}>{group.icon || "📌"} {group.name}</option>
                      ))}
                    </Select>
                  </label>
                ) : null}
                {groupDestinationId === "NEW" ? (
                  <div className="tx-group-name-row">
                    <label className="tx-group-field tx-group-icon-field">
                      Icon
                      <Select className="input" value={groupIcon} onChange={(event) => setGroupIcon(event.target.value)}>
                        {[groupIcon, ...GROUP_ICON_OPTIONS].filter((icon, index, icons) => icons.indexOf(icon) === index).map((icon) => (
                          <option key={icon} value={icon}>{icon}</option>
                        ))}
                      </Select>
                    </label>
                    <label className="tx-group-field">
                      Name
                      <Input
                        className="input"
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                        placeholder={getContextualGroupDefaults(activeBudget, transactionList.filter((transaction) => selectedTransactionIds.includes(transaction.id))).placeholder}
                        maxLength={80}
                        autoFocus
                        required
                      />
                    </label>
                  </div>
                ) : (
                  <p className="tx-group-modal-hint">Selected transactions will be moved here if they already belong to another group.</p>
                )}
                {saveTransactionGroup.isError ? <div className="form-error">{saveTransactionGroup.error.message}</div> : null}
              </div>
              <div className="txn-modal-actions">
                <Button type="button" className="btn btn-ghost" onClick={() => setIsGroupModalOpen(false)}>Cancel</Button>
                <Button type="submit" className="btn btn-primary" disabled={saveTransactionGroup.isPending || (groupDestinationId === "NEW" && !groupName.trim())}>
                  {saveTransactionGroup.isPending ? "Saving…" : groupDestinationId === "NEW" ? "Create group" : "Add to group"}
                </Button>
              </div>
            </form>
          </dialog>
        </Dialog>,
        document.body,
      )}

      {editingGroup && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={closeEditingGroupModal} title="Edit transaction group" surface="custom" overlayClassName="profile-modal-overlay">
          <dialog open className="profile-modal tx-group-modal">
            <div className="profile-modal-head">
              <h3>Edit group</h3>
              <ModalCloseButton onClick={closeEditingGroupModal} label="Close Edit Group" />
            </div>
            <form onSubmit={submitEditingGroup} className="modal-form-shell tx-group-edit-form">
              <div className="profile-modal-body">
                <div className="tx-group-name-row">
                  <label className="tx-group-field tx-group-icon-field">
                    Icon
                    <Select className="input" value={editingGroupIcon} onChange={(event) => setEditingGroupIcon(event.target.value)} aria-label="Group icon">
                      {[editingGroupIcon, ...GROUP_ICON_OPTIONS].filter((icon, index, icons) => icons.indexOf(icon) === index).map((icon) => (
                        <option key={icon} value={icon}>{icon}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="tx-group-field">
                    Name
                    <Input className="input" value={editingGroupName} onChange={(event) => setEditingGroupName(event.target.value)} maxLength={80} autoFocus required />
                  </label>
                </div>
                <div className="tx-group-members-head">
                  <div>
                    <strong>Transactions</strong>
                    <span>{editingGroupSelectedCount} selected</span>
                  </div>
                  <Input
                    className="input tx-group-members-search"
                    type="search"
                    value={editingGroupSearch}
                    onChange={(event) => setEditingGroupSearch(event.target.value)}
                    placeholder="Search this sub-account…"
                    aria-label="Search transactions in this sub-account"
                  />
                </div>
                <p className="tx-group-modal-hint">Select or clear transactions to change what belongs in this group. Selecting one from another group will move it here.</p>
                <div className="tx-group-members-list" aria-label="Transactions available for this group">
                  {editingGroupDetail.isLoading ? (
                    <div className="tx-group-members-state"><LoadingDots /> Loading transactions</div>
                  ) : editingGroupDetail.isError ? (
                    <div className="tx-group-members-state form-error">{editingGroupDetail.error.message}</div>
                  ) : (editingGroupDetail.data?.transactions ?? []).length ? (
                    (editingGroupDetail.data?.transactions ?? []).map((transaction) => {
                      const isSelected = editingGroupMembershipChanges[transaction.id] ?? editingGroupOriginalMemberIds.has(transaction.id);
                      const signedAmount = transaction.direction === "CREDIT" ? transaction.amountCents : -transaction.amountCents;
                      return (
                        <label key={transaction.id} className={`tx-group-member-row${isSelected ? " is-selected" : ""}`}>
                          <Input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleEditingGroupTransaction(transaction.id)}
                          />
                          <span className="tx-group-member-copy">
                            <strong>{transaction.subject}</strong>
                            <small>
                              {formatTransactionDate(transaction.date)}
                              {transaction.group && transaction.group.id !== editingGroup.id ? (
                                <span className="tx-group-member-current">{transaction.group.icon || "📌"} {transaction.group.name}</span>
                              ) : null}
                            </small>
                          </span>
                          <span className={`tx-group-member-amount ${getAmountToneClass(signedAmount)}`}>
                            {transaction.direction === "CREDIT" ? "+" : "−"}{formatCents(transaction.amountCents)}
                          </span>
                        </label>
                      );
                    })
                  ) : (
                    <div className="tx-group-members-state">No matching transactions.</div>
                  )}
                </div>
                {updateTransactionGroup.isError ? <div className="form-error">{updateTransactionGroup.error.message}</div> : null}
                {deleteTransactionGroup.isError ? <div className="form-error">{deleteTransactionGroup.error.message}</div> : null}
              </div>
              <div className="txn-modal-actions tx-group-edit-actions">
                <Button type="button" className="btn btn-danger modal-action-destructive" onClick={confirmDeleteGroup} disabled={deleteTransactionGroup.isPending}>Delete group</Button>
                <div className="modal-action-group">
                  <Button type="button" className="btn btn-ghost" onClick={closeEditingGroupModal}>Cancel</Button>
                  <Button type="submit" className="btn btn-primary" disabled={updateTransactionGroup.isPending || !editingGroupName.trim()}>
                    {updateTransactionGroup.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </form>
          </dialog>
        </Dialog>,
        document.body,
      )}

      {isCreateModalOpen && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={() => setIsCreateModalOpen(false)} title="Add transaction" surface="custom" overlayClassName="profile-modal-overlay">
          <dialog open className="profile-modal txn-modal txn-entry-modal">
            <div className="profile-modal-head">
              <h3>Add Transaction</h3>
              <ModalCloseButton onClick={() => setIsCreateModalOpen(false)} label="Close Add Transaction" />
            </div>
            <form onSubmit={onSubmit} className="txn-modal-form-wrapper">
              <div className="profile-modal-body txn-modal-body">
                <div className="txn-modal-form">
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Bank Account
                    {bankAccounts.data?.length === 1 ? (
                      <div className="crud-row" style={{ marginBottom: 0 }}>
                        <span>{bankAccounts.data[0].name}</span>
                      </div>
                    ) : (
                      <Select className="input" value={selectedBankId} onChange={(e) => setSelectedBankId(e.target.value)}>
                        <option value="" disabled>
                          Select bank account
                        </option>
                        {bankAccounts.data?.map((bank) => (
                          <option key={bank.id} value={bank.id}>
                            {bank.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </label>
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Sub Account
                    <Select className="input" value={budgetId} onChange={(e) => {
                      setBudgetId(e.target.value);
                      setTransactionGroupId("");
                    }} required>
                      <option value="" disabled>
                        Select sub account
                      </option>
                      {visibleBudgets.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {(createFormGroups.data ?? []).length ? (
                    <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                      Group <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
                      <Select className="input" value={transactionGroupId} onChange={(e) => setTransactionGroupId(e.target.value)}>
                        <option value="">No group</option>
                        {(createFormGroups.data ?? []).map((group) => (
                          <option key={group.id} value={group.id}>{group.icon || "📌"} {group.name}</option>
                        ))}
                      </Select>
                    </label>
                  ) : null}
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Date
                    <Input
                      type="date"
                      className="input"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      required
                    />
                  </label>
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Amount
                    <NumericCalculatorInput
                      min="1"
                      step="0.01"
                      placeholder="Amount"
                      value={amount}
                      onValueChange={handleAmountChange}
                    />
                  </label>
                  <TransactionOperationControl operation={operation} onChange={setOperation} />
                  <label className="modal-grid-span-2" style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Title
                    <Input className="input" placeholder="Title" value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </label>
                  <MarkdownEditor
                    className="modal-grid-span-2"
                    label="Notes"
                    value={notes}
                    onChange={setNotes}
                    placeholder="Write notes in Markdown"
                    calculator
                  />
                  {createTx.isError ? (
                    <div className="modal-grid-span-2" style={{ color: "var(--danger)", fontSize: "12px" }} role="alert">
                      {(createTx.error as Error).message || "Failed to save transaction"}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="txn-modal-actions">
                <Button className="btn btn-ghost" type="button" onClick={() => setIsCreateModalOpen(false)}>
                  Cancel
                </Button>
                <Button className="btn btn-primary" type="submit" disabled={createTx.isPending}>
                  {createTx.isPending ? "Adding..." : "Add"}
                </Button>
              </div>
            </form>
          </dialog>
        </Dialog>,
        document.body
      )}

      {editingTxId && typeof document !== "undefined" && createPortal(
        <TransactionCorrectionDialog
          amount={editAmount}
          budgets={editableBudgets}
          budgetId={editBudgetId}
          date={editTransactionDate}
          deletePending={deleteTx.isPending}
          deleting={deletingTransactionIds.includes(editingTxId)}
          error={correctTx.isError ? correctTx.error as Error : null}
          formatAmount={formatCents}
          groupId={editGroupId}
          groups={editFormGroups.data ?? []}
          lineage={transactionLineage.data ?? null}
          lineageError={transactionLineage.isError ? transactionLineage.error as Error : null}
          lineageLoading={transactionLineage.isLoading && transactionLineage.isFetching}
          notes={editNotes}
          operation={editOperation}
          pending={correctTx.isPending}
          reason={editReason}
          showLineage={Boolean(editingTransaction?.hasCorrectionHistory)}
          subject={editSubject}
          onAmountChange={setEditAmount}
          onBudgetChange={(value) => { setEditBudgetId(value); setEditGroupId(""); }}
          onClose={closeEditModal}
          onDateChange={setEditTransactionDate}
          onDelete={confirmDeleteEditingTx}
          onGroupChange={setEditGroupId}
          onLineageRetry={() => { void transactionLineage.refetch(); }}
          onNotesChange={setEditNotes}
          onOperationChange={setEditOperation}
          onReasonChange={setEditReason}
          onSubjectChange={setEditSubject}
          onSubmit={onSubmitEdit}
        />,
        document.body
      )}

      {editingBankAccount && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={closeEditBankBalance} title="Edit bank balance" surface="custom" overlayClassName="profile-modal-overlay">
          <dialog open className="profile-modal txn-modal">
            <div className="profile-modal-head">
              <h3>Edit Bank Balance</h3>
              <ModalCloseButton onClick={closeEditBankBalance} label="Close Edit Bank Balance" />
            </div>
            <form className="modal-form-shell" onSubmit={onSubmitBankBalance}>
              <div className="profile-modal-body txn-modal-body txn-modal-form txn-bank-balance-form">
              <div className="form-group">
                <label htmlFor="transactions-editing-bank-account-name" className="label">Bank Account</label>
                <Input id="transactions-editing-bank-account-name" className="input" value={editingBankAccount.name} disabled />
              </div>
              <div className="form-group">
                <label className="label">Balance ({baseCurrency})</label>
                <NumericCalculatorInput
                  step="0.01"
                  min="0"
                  value={editBankBalance}
                  onValueChange={setEditBankBalance}
                  required
                />
              </div>
              {updateBankBalance.isError ? (
                <div style={{ color: "var(--danger)", fontSize: "12px" }} role="alert">
                  {(updateBankBalance.error as Error).message || "Failed to save bank balance"}
                </div>
              ) : null}
              </div>
              <div className="txn-modal-actions">
                <Button type="button" className="btn btn-ghost" onClick={closeEditBankBalance}>Cancel</Button>
                <Button type="submit" className="btn btn-primary" disabled={updateBankBalance.isPending}>
                  {updateBankBalance.isPending ? "Saving..." : "Save Balance"}
                </Button>
              </div>
            </form>
          </dialog>
        </Dialog>,
        document.body
      )}

      {isTransferModalOpen && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={closeTransferModal} title="Transfer between sub-accounts" surface="custom" overlayClassName="profile-modal-overlay">
          <dialog open className="profile-modal txn-modal">
            <div className="profile-modal-head">
              <h3>Transfer Between Sub-Accounts</h3>
              <ModalCloseButton onClick={closeTransferModal} label="Close Transfer Between Sub-Accounts" />
            </div>
            <form className="modal-form-shell" onSubmit={onSubmitTransfer}>
              <div className="profile-modal-body txn-modal-body txn-modal-form">
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Title
                <Input className="input" placeholder="Transfer title" value={transferTitle} onChange={(e) => setTransferTitle(e.target.value)} required />
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Amount
                <NumericCalculatorInput
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={transferAmount}
                  onValueChange={setTransferAmount}
                  required
                />
              </label>
              <label className="modal-grid-span-2" style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Source Sub-Account
                <Select className="input" value={transferSourceBudgetId} onChange={(e) => setTransferSourceBudgetId(e.target.value)} required>
                  <option value="" disabled>Select source sub-account</option>
                  {(budgets.data ?? []).map((budget) => (
                    <option key={budget.id} value={budget.id}>
                      {budget.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="modal-grid-span-2" style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Destination Sub-Account
                <Select className="input" value={transferDestinationBudgetId} onChange={(e) => setTransferDestinationBudgetId(e.target.value)} required>
                  <option value="" disabled>Select destination sub-account</option>
                  {(budgets.data ?? []).map((budget) => (
                    <option key={budget.id} value={budget.id}>
                      {budget.name}
                    </option>
                  ))}
                </Select>
              </label>
              {transferBetweenBudgets.isError ? (
                <div className="modal-grid-span-2" style={{ color: "var(--danger)", fontSize: "12px" }} role="alert">
                  {(transferBetweenBudgets.error as Error)?.message || "Transfer failed"}
                </div>
              ) : null}
              </div>
              <div className="txn-modal-actions">
                <Button type="button" className="btn btn-ghost" onClick={closeTransferModal}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    transferBetweenBudgets.isPending ||
                    !transferTitle ||
                    !transferAmount ||
                    !transferSourceBudgetId ||
                    !transferDestinationBudgetId ||
                    transferSourceBudgetId === transferDestinationBudgetId
                  }
                >
                  {transferBetweenBudgets.isPending ? "Transferring..." : "Transfer"}
                </Button>
              </div>
            </form>
          </dialog>
        </Dialog>,
        document.body
      )}

      {receivableInfoBudgetId && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={() => setReceivableInfoBudgetId(null)} title="Receivable details" surface="custom" overlayClassName="profile-modal-overlay">
          <dialog open className="profile-modal txn-modal">
            <div className="profile-modal-head">
              <h3>{receivableInfoBudget?.name || "Receivable Breakdown"}</h3>
              <ModalCloseButton onClick={() => setReceivableInfoBudgetId(null)} label="Close Receivable Breakdown" />
            </div>
            <div className="profile-modal-body" style={{ display: "grid", gap: "12px" }}>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Open and partial receivables earmarked against this sub account.
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Reserved total</span>
                <strong className={getAmountToneClass(receivableInfoTotalCents)}>{formatCents(receivableInfoTotalCents)}</strong>
              </div>
              <div className="simple-list">
                {receivableBudgetSummary.isLoading ? (
                  <TransactionsReceivablesListSkeleton />
                ) : receivableInfoItems.length ? (
                  receivableInfoItems.map((receivable) => (
                    <div key={receivable.id} className="crud-row">
                      <div style={{ display: "grid", gap: "3px" }}>
                        <div style={{ fontWeight: 600 }}>{receivable.title || "Receivable"}</div>
                        <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {new Date(receivable.date).toLocaleDateString()} · {receivable.status}
                          {receivable.workspaceName && receivable.workspaceId !== workspaceId ? ` · ${receivable.workspaceName}` : ""}
                        </div>
                      </div>
                      <div className={getAmountToneClass(receivable.amountCents)}>{formatCents(receivable.amountCents)}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    No open receivables are currently linked to this sub account.
                  </div>
                )}
              </div>
            </div>
          </dialog>
        </Dialog>,
        document.body
      )}

      {isBudgetModalOpen && typeof document !== "undefined" && createPortal(
        <Dialog open onClose={closeBudgetModal} title="Sub-account" surface="custom" overlayClassName="profile-modal-overlay">
          <dialog open className="profile-modal txn-modal">
            <div className="profile-modal-head">
              <h3>{editingBudgetId ? "Edit Sub-Account" : "New Sub-Account"}</h3>
              <ModalCloseButton onClick={closeBudgetModal} label={`Close ${editingBudgetId ? "Edit Sub-Account" : "New Sub-Account"}`} />
            </div>
            <div className="profile-modal-body txn-modal-body" style={{ display: "grid", gap: "12px" }}>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Name
                <Input
                  className="input"
                  placeholder="Sub-account name"
                  value={editingBudgetId ? editingBudgetName : createBudgetName}
                  onChange={(e) => editingBudgetId ? setEditingBudgetName(e.target.value) : setCreateBudgetName(e.target.value)}
                />
              </label>
              {!editingBudgetId && bankAccounts.data && bankAccounts.data.length > 1 ? (
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Bank Account
                  <Select
                    className="input"
                    value={createBudgetAccountId}
                    onChange={(e) => setCreateBudgetAccountId(e.target.value)}
                  >
                    <option value="" disabled>Select bank account</option>
                    {(bankAccounts.data ?? []).map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Monthly Limit (optional)
                <NumericCalculatorInput
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={editingBudgetId ? editingBudgetTarget : createBudgetTarget}
                  onValueChange={(v) => editingBudgetId ? setEditingBudgetTarget(v) : setCreateBudgetTarget(v)}
                />
              </label>
              <SavingsSubAccountCheckbox
                checked={editingBudgetId ? editingBudgetIsSavings : createBudgetIsSavings}
                onCheckedChange={(checked) => {
                  if (!editingBudgetId) return setCreateBudgetIsSavings(checked);
                  setEditingBudgetIsSavings(checked);
                  if (checked) setEditingBudgetIcon("🛡️");
                  else if (editingBudgetIcon === "🛡️") setEditingBudgetIcon("");
                }}
              />
              {editingBudgetId && !editingBudgetIsSavings ? (
                <div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>Icon</div>
                  <div className="icon-picker">
                    {budgetIconOptions.map((icon) => (
                      <Button
                        key={icon}
                        type="button"
                        className={`icon-chip${editingBudgetIcon === icon ? " on" : ""}`}
                        onClick={() => setEditingBudgetIcon(icon)}
                        aria-label={`Select icon ${icon}`}
                      >
                        {icon}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="txn-modal-actions">
              {editingBudgetId ? (
                <Button
                  type="button"
                  className="btn btn-ghost modal-action-destructive"
                  onClick={confirmDeleteBudget}
                  disabled={deleteBudget.isPending}
                >
                  {deleteBudget.isPending ? "Deleting..." : "Delete"}
                </Button>
              ) : (
                <span />
              )}
              <div className="modal-action-group">
                <Button type="button" className="btn btn-ghost" onClick={closeBudgetModal}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="btn btn-primary"
                  onClick={editingBudgetId ? onUpdateBudget : onCreateBudget}
                  disabled={
                    (editingBudgetId
                      ? updateBudget.isPending || !editingBudgetName.trim()
                      : createBudget.isPending || !createBudgetName.trim() || !createBudgetAccountId)
                  }
                >
                  {editingBudgetId
                    ? (updateBudget.isPending ? "Saving..." : "Save")
                    : (createBudget.isPending ? "Creating..." : "Create")}
                </Button>
              </div>
            </div>
          </dialog>
        </Dialog>,
        document.body
      )}
        </>
      )}
    </div>
  );
}
