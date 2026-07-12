"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { getBrowserCookie, setBrowserCookie } from "@/lib/browser-cookies";
import { MarkdownEditor } from "@/components/markdown-editor";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { EmptyState, LoadingDots } from "@/components/ui-skeleton";
import { TransactionsInitialSkeleton, TransactionsListSkeleton, TransactionsReceivablesListSkeleton, TransactionsStatsSkeleton } from "@/components/skeletons/TransactionsSkeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { closeOnBackdropClick } from "@/lib/modal-dismiss";
import { ArrowLeftRight, Check, Layers3, Pencil, Plus, X } from "lucide-react";

const ALL_BANKS_FILTER = "ALL";

type AppContext = {
  workspaceId: string | null;
  baseCurrency?: string | null;
  defaultBudgetId?: string | null;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  icon?: string | null;
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

type BankAccount = {
  id: string;
  name: string;
  bankName?: string | null;
  currentBalanceCents: number;
  linkedBudgetTotalCents?: number;
  discrepancyCents?: number;
};

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

function formatTransactionDate(dateString: string): string {
  const date = new Date(dateString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  // Hide time if time is midnight (00:00:00) or top of any hour (XX:00:00)
  if (minutes === 0 && seconds === 0) {
    return date.toLocaleDateString();
  }
  return date.toLocaleString();
}

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as
    | T
    | {
        error?: string;
        message?: string;
      }
    | null;

  if (!res.ok) {
    const errorMessage =
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : `Request failed (${res.status})`;
    throw new Error(errorMessage);
  }

  return data as T;
}

export function TransactionsPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
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
  const [activeBudgetFilterId, setActiveBudgetFilterId] = useState<string>("ALL");
  const [activeGroupFilterId, setActiveGroupFilterId] = useState<string>("ALL");
  const [urlFilterHydrated, setUrlFilterHydrated] = useState(false);
  const [failedBankLogos, setFailedBankLogos] = useState<Record<string, boolean>>({});
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [deletingTransactionIds, setDeletingTransactionIds] = useState<string[]>([]);
  const [editSubject, setEditSubject] = useState("");
  const [editNotes, setEditNotes] = useState("");
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
  const bankPickerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreTransactionsRef = useRef<HTMLDivElement | null>(null);
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>("ALL"); // Format: "YYYY-MM" or "ALL"
  const [isGroupingMode, setIsGroupingMode] = useState(false);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupDestinationId, setGroupDestinationId] = useState<"NEW" | string>("NEW");
  const [groupName, setGroupName] = useState("");
  const [groupIcon, setGroupIcon] = useState("📌");
  const [editingGroup, setEditingGroup] = useState<TransactionGroup | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
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
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  const workspaceId = context.data?.workspaceId;
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const formatCents = (value: number) => formatMoney(value, baseCurrency);
  const txBankStorageKey = workspaceId ? `nest:selectedBank:${workspaceId}` : null;

  const budgets = useQuery({
    queryKey: ["budgets", workspaceId],
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
  });

  const transactionGroups = useQuery({
    queryKey: ["transaction-groups", workspaceId, activeBudgetFilterId],
    queryFn: () =>
      fetchJson<TransactionGroup[]>(
        `/api/transaction-groups?workspaceId=${workspaceId}&budgetId=${activeBudgetFilterId}`,
      ),
    enabled: Boolean(workspaceId && activeBudgetFilterId !== "ALL"),
    staleTime: 0,
  });

  const createFormGroups = useQuery({
    queryKey: ["transaction-groups", workspaceId, budgetId],
    queryFn: () =>
      fetchJson<TransactionGroup[]>(`/api/transaction-groups?workspaceId=${workspaceId}&budgetId=${budgetId}`),
    enabled: Boolean(workspaceId && isCreateModalOpen && budgetId),
    staleTime: 0,
  });

  const editFormGroups = useQuery({
    queryKey: ["transaction-groups", workspaceId, editBudgetId],
    queryFn: () =>
      fetchJson<TransactionGroup[]>(`/api/transaction-groups?workspaceId=${workspaceId}&budgetId=${editBudgetId}`),
    enabled: Boolean(workspaceId && editingTxId && editBudgetId),
    staleTime: 0,
  });

  const editingGroupDetail = useQuery({
    queryKey: ["transaction-group-detail", editingGroup?.id, debouncedEditingGroupSearch],
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

  const bankAccounts = useQuery({
    queryKey: ["bank-accounts", workspaceId],
    queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  // Query for accurate month aggregation data (not paginated)
  const transactionMonths = useQuery({
    queryKey: ["transaction-months", workspaceId, selectedBankId, activeBudgetFilterId],
    queryFn: () =>
      fetchJson<{
        months: TransactionMonthSummary[];
        total: number;
      }>(
        `/api/transactions/months?workspaceId=${workspaceId}${selectedBankId ? `&accountId=${selectedBankId}` : ""}${activeBudgetFilterId !== "ALL" ? `&budgetId=${activeBudgetFilterId}` : ""}`,
      ),
    enabled: Boolean(workspaceId),
  });

  const transactionAccountFilter = selectedBankId || "";
  const transactionBudgetFilter = activeBudgetFilterId !== "ALL" ? activeBudgetFilterId : "";
  const transactionGroupFilter = activeGroupFilterId !== "ALL" ? activeGroupFilterId : "";

  // Month/Year filter state
  const [dateFilter, setDateFilter] = useState<{ from?: string; to?: string }>({});
  const [activeQuickSelect, setActiveQuickSelect] = useState<string | null>("thisMonth");
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [isCustomMonthOpen, setIsCustomMonthOpen] = useState(false);
  const customMonthBtnRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const currentMonthIndex = new Date().getMonth();
  const currentMonthLabel = MONTH_NAMES[currentMonthIndex];
  const previousMonthLabel = MONTH_NAMES[(currentMonthIndex + 11) % 12];

  // Convert dateFilter to month key format for API compatibility
  const transactionMonthFilter = useMemo(() => {
    if (!dateFilter.from) return "";
    const date = new Date(dateFilter.from);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }, [dateFilter.from]);

  const getDateRangeForQuickSelect = (type: string) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    switch (type) {
      case "thisMonth": {
        return {
          from: new Date(year, month, 1).toISOString().split("T")[0],
          to: new Date(year, month + 1, 0).toISOString().split("T")[0],
        };
      }
      case "lastMonth": {
        return {
          from: new Date(year, month - 1, 1).toISOString().split("T")[0],
          to: new Date(year, month, 0).toISOString().split("T")[0],
        };
      }
      case "thisYear": {
        return {
          from: new Date(year, 0, 1).toISOString().split("T")[0],
          to: new Date(year, 11, 31).toISOString().split("T")[0],
        };
      }
      default:
        return {};
    }
  };

  // Initialize with "This Month" active
  useEffect(() => {
    if (activeQuickSelect === "thisMonth" && !dateFilter.from) {
      setDateFilter(getDateRangeForQuickSelect("thisMonth"));
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

  const handleQuickSelect = (type: string) => {
    setActiveQuickSelect(type);
    setSelectedMonth(null);
    setDateFilter(getDateRangeForQuickSelect(type));
  };

  const handleCustomMonthSelect = (monthIndex: number, year: number) => {
    setActiveQuickSelect("custom");
    setSelectedMonth(monthIndex);
    setSelectedYear(year);
    setDateFilter({
      from: new Date(year, monthIndex, 1).toISOString().split("T")[0],
      to: new Date(year, monthIndex + 1, 0).toISOString().split("T")[0],
    });
    setIsCustomMonthOpen(false);
  };

  const clearDateFilter = () => {
    setActiveQuickSelect(null);
    setSelectedMonth(null);
    setDateFilter({});
  };

  const transactions = useInfiniteQuery({
    queryKey: ["transactions", workspaceId, transactionAccountFilter, transactionBudgetFilter, transactionGroupFilter, transactionMonthFilter, debouncedSearchQuery],
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
      if (dateFilter.from) params.set("from", dateFilter.from);
      if (dateFilter.to) params.set("to", dateFilter.to);
      if (transactionMonthFilter) params.set("month", transactionMonthFilter);
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
    queryKey: ["receivable-budget-summary", workspaceId, receivableInfoBudgetId],
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
    if (!selectedBankId || !bankAccounts.data?.length) return;
    if (!bankAccounts.data.some((b) => b.id === selectedBankId)) {
      setSelectedBankId("");
    }
  }, [bankAccounts.data, selectedBankId]);

  useEffect(() => {
    if (!txBankStorageKey || !bankFilterHydrated) return;
    setBrowserCookie(txBankStorageKey, selectedBankId || ALL_BANKS_FILTER);
  }, [txBankStorageKey, selectedBankId, bankFilterHydrated]);

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
    setActiveGroupFilterId("ALL");
    setIsGroupingMode(false);
    setSelectedTransactionIds([]);
  }, [activeBudgetFilterId]);

  useEffect(() => {
    if (activeGroupFilterId === "ALL" || transactionGroups.isLoading) return;
    if (!(transactionGroups.data ?? []).some((group) => group.id === activeGroupFilterId)) {
      setActiveGroupFilterId("ALL");
    }
  }, [activeGroupFilterId, transactionGroups.data, transactionGroups.isLoading]);

  useEffect(() => {
    if (urlFilterHydrated) return;
    if (!bankAccounts.data || !budgets.data) return;

    const requestedAccountId = searchParams.get("accountId");
    const requestedBudgetId = searchParams.get("budgetId");

    if (!requestedAccountId && !requestedBudgetId) {
      setUrlFilterHydrated(true);
      return;
    }

    const validAccountId =
      requestedAccountId && bankAccounts.data.some((bank) => bank.id === requestedAccountId) ? requestedAccountId : "";
    const validBudget = requestedBudgetId ? budgets.data.find((b) => b.id === requestedBudgetId) : undefined;
    const targetAccountId = validAccountId || validBudget?.accountId || "";

    if (targetAccountId) {
      setSelectedBankId(targetAccountId);
    }

    if (validBudget && (!targetAccountId || validBudget.accountId === targetAccountId)) {
      setActiveBudgetFilterId(validBudget.id);
    } else {
      setActiveBudgetFilterId("ALL");
    }

    setUrlFilterHydrated(true);
  }, [urlFilterHydrated, bankAccounts.data, budgets.data, searchParams]);

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
        headers: { "Content-Type": "application/json" },
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
      void queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["transaction-groups", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["transaction-months", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
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
        headers: { "Content-Type": "application/json" },
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
      void queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["transaction-groups", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["transaction-months", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
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
      void queryClient.invalidateQueries({ queryKey: ["transaction-groups", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId], refetchType: "active" });
    },
  });

  const updateTransactionGroup = useMutation({
    mutationFn: ({
      id,
      name,
      addTransactionIds,
      removeTransactionIds,
    }: {
      id: string;
      name: string;
      addTransactionIds: string[];
      removeTransactionIds: string[];
    }) =>
      fetchJson(`/api/transaction-groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, addTransactionIds, removeTransactionIds }),
      }),
    onSuccess: () => {
      setEditingGroup(null);
      setEditingGroupName("");
      setEditingGroupSearch("");
      setDebouncedEditingGroupSearch("");
      setEditingGroupMembershipChanges({});
      void queryClient.invalidateQueries({ queryKey: ["transaction-groups", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId], refetchType: "active" });
    },
  });

  const deleteTransactionGroup = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/transaction-groups/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setEditingGroup(null);
      setEditingGroupName("");
      setEditingGroupSearch("");
      setDebouncedEditingGroupSearch("");
      setEditingGroupMembershipChanges({});
      setActiveGroupFilterId("ALL");
      void queryClient.invalidateQueries({ queryKey: ["transaction-groups", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId], refetchType: "active" });
    },
  });

  // Budget management mutations
  const createBudget = useMutation({
    mutationFn: (payload: { name: string; targetCents: number; accountId: string; icon?: string }) =>
      fetchJson("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: payload.name,
          targetCents: payload.targetCents,
          accountId: payload.accountId,
          icon: payload.icon || undefined,
        }),
      }),
    onSuccess: () => {
      setIsBudgetModalOpen(false);
      setCreateBudgetName("");
      setCreateBudgetTarget("");
      setCreateBudgetAccountId("");
      void queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
    },
  });

  const updateBudget = useMutation({
    mutationFn: (payload: { id: string; name: string; targetCents: number; icon?: string }) =>
      fetchJson(`/api/budgets/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          targetCents: payload.targetCents,
          icon: payload.icon || undefined,
        }),
      }),
    onSuccess: () => {
      setEditingBudgetId(null);
      setEditingBudgetName("");
      setEditingBudgetIcon("");
      setEditingBudgetIsSavings(false);
      setEditingBudgetTarget("");
      void queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
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
      void queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
    },
  });

  const updateTx = useMutation({
    mutationFn: (payload: { id: string; subject: string; notes?: string | null; amountCents: number; operation: "DEDUCT" | "ADD"; date: string; budgetId: string; groupId?: string | null }) =>
      fetchJson(`/api/transactions/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: payload.subject,
          notes: payload.notes ?? null,
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
      setEditAmount("");
      setEditOperation("DEDUCT");
      setEditTransactionDate("");
      setEditBudgetId("");
      setEditGroupId("");
      void queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["transaction-groups", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["transaction-months", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
    },
  });

  const deleteTx = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/transactions/${id}`, { method: "DELETE" }),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ["transactions", workspaceId] });
      const previousTransactions = queryClient.getQueryData<Transaction[]>(["transactions", workspaceId]);
      queryClient.setQueryData<Transaction[]>(
        ["transactions", workspaceId],
        (current) => (current ?? []).filter((tx) => tx.id !== id),
      );
      return { previousTransactions };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId], refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: ["transaction-groups", workspaceId], refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: ["transaction-months", workspaceId], refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId], refetchType: "active" });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
    },
    onError: (_error, id, context) => {
      if (context?.previousTransactions) {
        queryClient.setQueryData(["transactions", workspaceId], context.previousTransactions);
      }
      setDeletingTransactionIds((current) => current.filter((transactionId) => transactionId !== id));
    },
    onSettled: (_data, _error, id) => {
      setDeletingTransactionIds((current) => current.filter((transactionId) => transactionId !== id));
    },
  });

  const updateBankBalance = useMutation({
    mutationFn: ({ id, startingCents }: { id: string; startingCents: number }) =>
      fetchJson(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startingCents }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
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

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const selectedBudget = budgets.data?.find((b) => b.id === budgetId);
    const accountId = selectedBudget?.accountId || selectedBankId;
    if (!workspaceId || !accountId || !subject || !amount || !transactionDate || !budgetId) return;
    createTx.mutate({
      subject,
      notes: notes || undefined,
      amountCents: Math.round(Number(amount) * 100),
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
    if (!selectedBankId) return budgets.data;
    return budgets.data.filter((b) => b.accountId === selectedBankId);
  }, [budgets.data, selectedBankId]);
  const editingTransaction = useMemo(
    () => transactionList.find((tx) => tx.id === editingTxId) ?? null,
    [transactionList, editingTxId],
  );
  const editableBudgets = useMemo(() => {
    if (!budgets.data?.length) return [];
    if (!editingTransaction) return budgets.data;
    return budgets.data.filter((budget) => budget.accountId === editingTransaction.accountId);
  }, [budgets.data, editingTransaction]);

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
    if (activeQuickSelect === "custom" && selectedMonth !== null) {
      return `${MONTH_NAMES[selectedMonth]} ${selectedYear}`;
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
    () => (bankAccounts.data ?? []).find((bank) => bank.id === selectedBankId) ?? null,
    [bankAccounts.data, selectedBankId],
  );
  const displayedBankBalanceCents = selectedBank ? selectedBank.currentBalanceCents : totalBankBalanceCents;
  const displayedLinkedBudgetCents = selectedBank ? visibleBudgetTotalCents : totalLinkedBudgetCents;
  const displayedDiscrepancyCents = displayedBankBalanceCents - displayedLinkedBudgetCents;
  const hasDisplayedDiscrepancy = displayedDiscrepancyCents !== 0;
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
    updateTx.reset();
    deleteTx.reset();
    setEditingTxId(tx.id);
    setEditSubject(tx.subject);
    setEditNotes(tx.notes || tx.details || "");
    setEditAmount((tx.amountCents / 100).toFixed(2));
    setEditOperation(tx.direction === "CREDIT" ? "ADD" : "DEDUCT");
    setEditTransactionDate(new Date(tx.date).toISOString().split("T")[0]);
    setEditBudgetId(tx.budgetId || "");
    setEditGroupId(tx.groupId || "");
  };

  const closeEditModal = () => {
    updateTx.reset();
    deleteTx.reset();
    setEditingTxId(null);
    setEditSubject("");
    setEditNotes("");
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

  const onSubmitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingTxId || !editSubject || !editAmount || !editTransactionDate || !editBudgetId) return;
    updateTx.mutate({
      id: editingTxId,
      subject: editSubject,
      notes: editNotes || null,
      amountCents: Math.round(Number(editAmount) * 100),
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
    if (!(await confirmDestructiveAction("Delete this transaction?"))) return;
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

  const onSubmitBankBalance = (event: FormEvent) => {
    event.preventDefault();
    if (!editingBankAccount || !editBankBalance) return;
    updateBankBalance.mutate({
      id: editingBankAccount.id,
      startingCents: Math.round(Number(editBankBalance) * 100),
    });
  };

  const onSubmitTransfer = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !transferTitle || !transferAmount || !transferSourceBudgetId || !transferDestinationBudgetId) return;
    transferBetweenBudgets.mutate({
      title: transferTitle,
      amountCents: Math.round(Number(transferAmount) * 100),
      sourceBudgetId: transferSourceBudgetId,
      destinationBudgetId: transferDestinationBudgetId,
    });
  };

  const syncSelectedBankBalance = async () => {
    if (!selectedBank) return;
    if (!(await confirmDestructiveAction(`Update ${selectedBank.name} balance to match the sub-account total?`))) return;
    updateBankBalance.mutate({
      id: selectedBank.id,
      startingCents: displayedLinkedBudgetCents,
    });
  };

  // Budget (sub-account) management handlers
  const openCreateBudgetModal = () => {
    createBudget.reset();
    setCreateBudgetName("");
    setCreateBudgetTarget("");
    setCreateBudgetAccountId(selectedBankId || bankAccounts.data?.[0]?.id || "");
    setIsBudgetModalOpen(true);
  };

  const openEditBudgetModal = (budget: Budget) => {
    updateBudget.reset();
    const resolvedIcon = budget.icon || getBudgetIcon(budget.name);
    setEditingBudgetId(budget.id);
    setEditingBudgetName(budget.name);
    setEditingBudgetIcon(resolvedIcon);
    setEditingBudgetIsSavings(resolvedIcon === "🛡️");
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
  };

  const onCreateBudget = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !createBudgetAccountId || !createBudgetName.trim()) return;
    const parsedTarget = createBudgetTarget.trim() ? Number(createBudgetTarget) : 0;
    createBudget.mutate({
      name: createBudgetName.trim(),
      targetCents: Math.round(parsedTarget * 100),
      accountId: createBudgetAccountId,
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
    });
  };

  const confirmDeleteBudget = async () => {
    if (!editingBudgetId) return;
    if (!(await confirmDestructiveAction(`This will delete the sub-account and remove all transaction links. Continue?`))) return;
    deleteBudget.mutate(editingBudgetId);
  };

  const activeBudget = budgets.data?.find((budget) => budget.id === activeBudgetFilterId);
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
    setEditingGroupSearch("");
    setDebouncedEditingGroupSearch("");
    setEditingGroupMembershipChanges({});
  };

  const closeEditingGroupModal = () => {
    setEditingGroup(null);
    setEditingGroupName("");
    setEditingGroupSearch("");
    setDebouncedEditingGroupSearch("");
    setEditingGroupMembershipChanges({});
  };

  const toggleEditingGroupTransaction = (transactionId: string) => {
    const isSelected = editingGroupMembershipChanges[transactionId] ?? editingGroupOriginalMemberIds.has(transactionId);
    setEditingGroupMembershipChanges((current) => ({ ...current, [transactionId]: !isSelected }));
  };

  const submitEditingGroup = (event: FormEvent) => {
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

  const submitGrouping = (event: FormEvent) => {
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
    if (!(await confirmDestructiveAction(`Delete “${editingGroup.name}”? Its transactions will remain in the sub-account.`))) return;
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
              <button
                type="button"
                className="bm-edit-btn"
                onClick={() => setIsBankPickerOpen((open) => !open)}
                aria-label="Choose bank"
                title="Choose bank"
              >
                ▾
              </button>
              {selectedBank ? (
                <button
                  type="button"
                  className="bm-edit-btn"
                  onClick={() => openEditBankBalance(selectedBank)}
                  aria-label={`Edit ${selectedBank.name} balance`}
                  title="Edit balance"
                >
                  ✎
                </button>
              ) : null}
              {isBankPickerOpen ? (
                <div className="bank-selector-menu" role="menu" aria-label="Bank options">
                  <button
                    type="button"
                    className={`bank-selector-option${selectedBankId === "" ? " is-active" : ""}`}
                    onClick={() => {
                      setSelectedBankId("");
                      setIsBankPickerOpen(false);
                    }}
                  >
                    All banks
                  </button>
                  {(bankAccounts.data ?? []).map((bank) => (
                    <button
                      key={bank.id}
                      type="button"
                      className={`bank-selector-option${selectedBankId === bank.id ? " is-active" : ""}`}
                      onClick={() => {
                        setSelectedBankId(bank.id);
                        setIsBankPickerOpen(false);
                      }}
                    >
                      {bank.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

      <section ref={subAccountsRef} className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
            <span aria-hidden="true">📁</span>
            <span>Sub-Accounts</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                fontSize: "12px",
                color: hasDisplayedDiscrepancy ? "var(--warning)" : "var(--text-secondary)",
                fontWeight: hasDisplayedDiscrepancy ? 600 : 500,
              }}
            >
              📊 {formatCents(visibleBudgetTotalCents)}&emsp;&emsp;🏦 {formatCents(displayedBankBalanceCents)}&emsp;
            </div>
            <button
              type="button"
              className="bm-edit-btn"
              onClick={openCreateBudgetModal}
              aria-label="Add new sub-account"
              title="Add new sub-account"
              style={{ width: "26px", height: "26px", fontSize: "14px" }}
            >
              +
            </button>
          </div>
        </div>
        {hasDisplayedDiscrepancy ? (
          <div className="tx-discrepancy-banner">
            <span>⚠️ Mismatch: {formatCents(Math.abs(displayedDiscrepancyCents))}</span>
            {selectedBank ? (
              <button
                type="button"
                className="bm-edit-btn"
                onClick={syncSelectedBankBalance}
                disabled={updateBankBalance.isPending}
                aria-label={`Update ${selectedBank.name} balance to match the sub-account total`}
                title="Update bank balance to match sub-account total"
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "auto",
                  height: "auto",
                  fontSize: "18px",
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  boxShadow: "none",
                }}
              >
                {updateBankBalance.isPending ? "…" : "↻"}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="account-cards-grid tx-account-grid">
          {/*
            Transactions page: compact account chips with only name + amount.
          */}
          <div
            className="budget-mini budget-mini-compact tx-account-card"
            onClick={() => {
              setActiveBudgetFilterId("ALL");
              if (subAccountsRef.current) {
                const rect = subAccountsRef.current.getBoundingClientRect();
                if (rect.top > 0) {
                  subAccountsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
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
          {visibleBudgets.map((b) => (
            <div
              key={b.id}
              className="budget-mini budget-mini-compact tx-account-card"
              onClick={() => {
                setActiveBudgetFilterId(b.id);
                if (subAccountsRef.current) {
                  const rect = subAccountsRef.current.getBoundingClientRect();
                  if (rect.top > 0) {
                    subAccountsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "4px" }}>
                  <div className="bm-name">{b.name}</div>
                  <button
                    type="button"
                    className="bm-edit-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditBudgetModal(b);
                    }}
                    aria-label={`Edit ${b.name}`}
                    title="Edit sub-account"
                    style={{ width: "18px", height: "18px", fontSize: "10px", flexShrink: 0 }}
                  >
                    ✎
                  </button>
                </div>
                <div className={`bm-amount ${getAmountToneClass(b.availableCents)}`}>{formatCents(b.availableCents)}</div>
                {b.receivableReservedCents && b.availableCents > 0 ? (
                  <div
                    className="bm-target tx-account-card-footer"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <span>({formatCents(b.receivableReservedCents)})</span>
                    <button
                      type="button"
                      aria-label={`Show receivable breakdown for ${b.name}`}
                      title="Show receivable breakdown"
                      onClick={(event) => {
                        event.stopPropagation();
                        setReceivableInfoBudgetId(b.id);
                      }}
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "999px",
                        border: "none",
                        background: "transparent",
                        color: "var(--text-secondary)",
                        fontSize: "11px",
                        fontWeight: 700,
                        lineHeight: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      i
                    </button>
                  </div>
                ) : (
                  <div className="bm-target tx-account-card-footer tx-account-card-footer-empty" aria-hidden="true">
                    —
                  </div>
                )}
              </div>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  bottom: "2px",
                  right: "4px",
                  fontSize: "28px",
                  lineHeight: 1,
                  opacity: 0.2,
                  pointerEvents: "none",
                }}
              >
                {getBudgetIcon(b.name, b.icon)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {activeBudgetFilterId !== "ALL" ? (
        <section className="card tx-group-panel" aria-label={`Groups in ${activeBudget?.name ?? "sub-account"}`}>
          <div className="tx-group-panel-head">
            <div>
              <div className="tx-group-panel-title">
                <Layers3 size={16} aria-hidden="true" />
                <span>{activeBudget?.name} groups</span>
              </div>
              <p>Bring related transactions together—by project, event, purchase, goal, trip, or anything else.</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setIsGroupingMode(true);
                setSelectedTransactionIds([]);
                recentTransactionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              disabled={!filteredTransactions.length}
            >
              <Plus size={15} aria-hidden="true" />
              Group transactions
            </button>
          </div>
          <div className="tx-group-cards">
            <button
              type="button"
              className={`tx-group-card tx-group-card-all${activeGroupFilterId === "ALL" ? " is-active" : ""}`}
              onClick={() => setActiveGroupFilterId("ALL")}
            >
              <span className="tx-group-card-icon" aria-hidden="true">📚</span>
              <span className="tx-group-card-copy">
                <strong>All transactions</strong>
                <small>Grouped and ungrouped</small>
              </span>
            </button>
            {(transactionGroups.data ?? []).map((group) => (
              <div
                key={group.id}
                className={`tx-group-card${activeGroupFilterId === group.id ? " is-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setActiveGroupFilterId(group.id);
                  clearDateFilter();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveGroupFilterId(group.id);
                    clearDateFilter();
                  }
                }}
              >
                <span className="tx-group-card-icon" aria-hidden="true">{group.icon || "📌"}</span>
                <span className="tx-group-card-copy">
                  <strong>{group.name}</strong>
                  <small>{group.transactionCount} {group.transactionCount === 1 ? "transaction" : "transactions"}</small>
                </span>
                <span className="tx-group-card-total">
                  <small>Net spent</small>
                  <strong>{formatCents(group.expenseCents - group.incomeCents)}</strong>
                </span>
                <button
                  type="button"
                  className="tx-group-card-edit"
                  aria-label={`Edit ${group.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditingGroupModal(group);
                  }}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          {!transactionGroups.isLoading && !(transactionGroups.data ?? []).length ? (
            <div className="tx-group-empty">No groups yet. Select a few transactions to create the first one.</div>
          ) : null}
        </section>
      ) : null}

      {/* Month/Year Filter Bar */}
      <div className="tx-filter-bar" ref={customMonthBtnRef}>
        <div className="tx-filter-controls">
          <div className="tx-filter-pills">
            <button
              type="button"
              className={`tx-filter-pill ${activeQuickSelect === "thisMonth" ? "is-active" : ""}`}
              onClick={() => handleQuickSelect("thisMonth")}
            >
              {currentMonthLabel}
            </button>
            <button
              type="button"
              className={`tx-filter-pill ${activeQuickSelect === "lastMonth" ? "is-active" : ""}`}
              onClick={() => handleQuickSelect("lastMonth")}
            >
              {previousMonthLabel}
            </button>
            <button
              type="button"
              className={`tx-filter-pill ${activeQuickSelect === null && !dateFilter.from ? "is-active" : ""}`}
              onClick={() => {
                setActiveQuickSelect(null);
                setSelectedMonth(null);
                setDateFilter({});
              }}
            >
              All
            </button>
            <button
              type="button"
              className={`tx-filter-pill tx-filter-pill-custom ${activeQuickSelect === "custom" ? "is-active" : ""}`}
              onClick={() => setIsCustomMonthOpen(!isCustomMonthOpen)}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style={{ marginRight: "4px" }}>
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              Custom
            </button>
          </div>
          <div className="tx-primary-actions" aria-label="Transaction actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm tx-primary-action"
              onClick={openTransferModal}
              disabled={(budgets.data?.length ?? 0) < 2}
              aria-label="Transfer between sub-accounts"
              title="Transfer between sub-accounts"
            >
              <ArrowLeftRight size={16} aria-hidden="true" />
              <span className="tx-primary-action-label">Transfer</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm tx-primary-action"
              onClick={openCreateModal}
              aria-label="Add transaction"
              title="Add transaction"
            >
              <Plus size={16} aria-hidden="true" />
              <span className="tx-primary-action-label">Add Transaction</span>
            </button>
          </div>
        </div>
        <div className="tx-search-box">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className="tx-search-icon">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="tx-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              className="tx-search-clear"
              onClick={() => setSearchQuery("")}
            >
              ×
            </button>
          )}
        </div>

        {/* Custom Month Popover */}
        {isCustomMonthOpen && typeof document !== "undefined" && createPortal(
          <>
            <div className="tx-popover-overlay" onMouseDown={(event) => closeOnBackdropClick(event, () => setIsCustomMonthOpen(false))} />
            <div className="tx-month-popover">
              <div className="tx-popover-header">
                <h4>Select Month</h4>
                <button type="button" className="tx-popover-close" onClick={() => setIsCustomMonthOpen(false)}>×</button>
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
                          return (
                            <button
                              key={`${year}-${month}`}
                              type="button"
                              className={`tx-popover-month ${selectedMonth === idx && selectedYear === year && activeQuickSelect === "custom" ? "is-active" : ""} ${isCurrentMonth ? "is-current" : ""}`}
                              onClick={() => handleCustomMonthSelect(idx, year)}
                            >
                              {month}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </>,
          document.body
        )}
      </div>
      {/* Recent Transactions List */}
      <section ref={recentTransactionsRef} className="card">
        {isGroupingMode ? (
          <div className="tx-selection-bar">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setIsGroupingMode(false);
                setSelectedTransactionIds([]);
              }}
            >
              <X size={16} aria-hidden="true" /> Cancel
            </button>
            <span><strong>{selectedTransactionIds.length}</strong> selected</span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openGroupingModal}
              disabled={!selectedTransactionIds.length}
            >
              <Layers3 size={16} aria-hidden="true" /> Continue
            </button>
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
              <button className="btn btn-primary" onClick={() => transactions.refetch()}>
                Retry
              </button>
            </div>
          )}

          {!transactions.isLoading && !transactions.isError && transactionsByMonth.map((monthGroup) => {
            const monthSummary = searchQuery.trim() || activeGroupFilterId !== "ALL"
              ? undefined
              : transactionMonthSummaryByKey.get(monthGroup.monthKey);
            const totalIncome = monthSummary?.incomeCents ?? monthGroup.totalIncome;
            const totalExpense = monthSummary?.expenseCents ?? monthGroup.totalExpense;

            return (
            <div key={monthGroup.monthKey} className="tx-month-group">
              <div className="tx-month-header">
                <span className="tx-month-label">{monthGroup.monthLabel}</span>
                <div className="tx-month-summary">
                  {totalIncome > 0 && (
                    <span className="tx-month-income">+{formatCents(totalIncome)}</span>
                  )}
                  {totalExpense > 0 && (
                    <span className="tx-month-expense">−{formatCents(totalExpense)}</span>
                  )}
                </div>
              </div>
              <div className="tx-month-list">
                {monthGroup.transactions.map((tx) => {
                  const isDeleting = deletingTransactionIds.includes(tx.id);
                  const isIncome = tx.direction === "CREDIT";
                  const isSelected = selectedTransactionIds.includes(tx.id);
                  const signedAmount = isIncome ? tx.amountCents : -tx.amountCents;
                  return (
                    <div
                      key={tx.id}
                      className={`crud-row tx-recent-row${isDeleting ? " crud-row-deleting" : ""}${isSelected ? " is-selected" : ""}`}
                      onClick={() => {
                        if (isDeleting) return;
                        if (isGroupingMode) toggleTransactionSelection(tx.id);
                        else beginEdit(tx);
                      }}
                      onKeyDown={(event) => {
                        if (isDeleting) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (isGroupingMode) toggleTransactionSelection(tx.id);
                          else beginEdit(tx);
                        }
                      }}
                      role="button"
                      tabIndex={isDeleting ? -1 : 0}
                      aria-label={isGroupingMode ? `${isSelected ? "Deselect" : "Select"} transaction ${tx.subject}` : `Edit transaction ${tx.subject}`}
                      aria-pressed={isGroupingMode ? isSelected : undefined}
                    >
                      <div className={`tx-recent-arrow ${isGroupingMode ? "select" : isIncome ? "income" : "expense"}${isSelected ? " is-selected" : ""}`}>
                        {isGroupingMode ? (isSelected ? <Check size={17} aria-hidden="true" /> : null) : isIncome ? "→" : "←"}
                      </div>
                      <div className="tx-recent-main">
                        <span className="tx-recent-subject">{tx.subject}</span>
                        <span className={`tx-recent-amount ${getAmountToneClass(signedAmount)}`}>
                          {isIncome ? "+" : "−"}{formatCents(tx.amountCents)}
                        </span>
                        <span className="tx-recent-date">
                          {formatTransactionDate(tx.date)}
                          {tx.group ? <span className="tx-row-group-pill">{tx.group.icon || "📌"} {tx.group.name}</span> : null}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}
          {!transactions.isLoading && !transactions.isError && transactions.hasNextPage ? (
            <div ref={loadMoreTransactionsRef} style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => transactions.fetchNextPage()}
                disabled={transactions.isFetchingNextPage}
              >
                {transactions.isFetchingNextPage ? <LoadingDots /> : "Load more"}
              </button>
            </div>
          ) : null}
          {!transactions.isLoading && !transactions.isError && filteredTransactions.length === 0 && (
            <EmptyState
              icon={searchQuery.trim() ? "🔎" : "📑"}
              title={searchQuery.trim() ? "No matching transactions" : "No transactions"}
              description={searchQuery.trim() ? `No transactions match “${searchQuery.trim()}”.` : selectedMonthFilter !== "ALL" ? "No transactions for this month." : selectedBankId ? "Add your first transaction for this bank account." : "Add your first transaction to start tracking your spending."}
              action={!searchQuery.trim() ? (
                <button className="btn btn-primary" onClick={openCreateModal}>
                  + Add Transaction
                </button>
              ) : undefined}
            />
          )}
        </div>
      </section>

      {isGroupModalOpen && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, () => setIsGroupModalOpen(false))}>
          <div className="profile-modal tx-group-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Group {selectedTransactionIds.length} transactions</h3>
              <button type="button" className="profile-modal-close" onClick={() => setIsGroupModalOpen(false)}>Close</button>
            </div>
            <form onSubmit={submitGrouping}>
              <div className="profile-modal-body">
                <p className="tx-group-modal-intro">
                  What do these {activeBudget?.name ?? "sub-account"} transactions belong to?
                </p>
                {(transactionGroups.data ?? []).length ? (
                  <label className="tx-group-field">
                    Group
                    <select className="input" value={groupDestinationId} onChange={(event) => setGroupDestinationId(event.target.value)}>
                      <option value="NEW">Create a new group</option>
                      {(transactionGroups.data ?? []).map((group) => (
                        <option key={group.id} value={group.id}>{group.icon || "📌"} {group.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {groupDestinationId === "NEW" ? (
                  <div className="tx-group-name-row">
                    <label className="tx-group-field tx-group-icon-field">
                      Icon
                      <select className="input" value={groupIcon} onChange={(event) => setGroupIcon(event.target.value)}>
                        {[groupIcon, "📌", "🧳", "🛠️", "🎁", "🏥", "🚗", "🎓", "💼", "🎯"].filter((icon, index, icons) => icons.indexOf(icon) === index).map((icon) => (
                          <option key={icon} value={icon}>{icon}</option>
                        ))}
                      </select>
                    </label>
                    <label className="tx-group-field">
                      Name
                      <input
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
                <button type="button" className="btn btn-ghost" onClick={() => setIsGroupModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saveTransactionGroup.isPending || (groupDestinationId === "NEW" && !groupName.trim())}>
                  {saveTransactionGroup.isPending ? "Saving…" : groupDestinationId === "NEW" ? "Create group" : "Add to group"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {editingGroup && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeEditingGroupModal)}>
          <div className="profile-modal tx-group-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Edit group</h3>
              <button type="button" className="profile-modal-close" onClick={closeEditingGroupModal}>Close</button>
            </div>
            <form onSubmit={submitEditingGroup} className="tx-group-edit-form">
              <div className="profile-modal-body">
                <label className="tx-group-field">
                  Name
                  <input className="input" value={editingGroupName} onChange={(event) => setEditingGroupName(event.target.value)} maxLength={80} autoFocus required />
                </label>
                <div className="tx-group-members-head">
                  <div>
                    <strong>Transactions</strong>
                    <span>{editingGroupSelectedCount} selected</span>
                  </div>
                  <input
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
                          <input
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
                <button type="button" className="btn btn-danger" onClick={confirmDeleteGroup} disabled={deleteTransactionGroup.isPending}>Delete group</button>
                <div>
                  <button type="button" className="btn btn-ghost" onClick={closeEditingGroupModal}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={updateTransactionGroup.isPending || !editingGroupName.trim()}>
                    {updateTransactionGroup.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {isCreateModalOpen && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, () => setIsCreateModalOpen(false))}>
          <div className="profile-modal txn-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Add Transaction</h3>
              <button className="profile-modal-close" onClick={() => setIsCreateModalOpen(false)}>
                Close
              </button>
            </div>
            <form onSubmit={onSubmit} className="txn-modal-form-wrapper">
              <div className="profile-modal-body txn-modal-body">
                <div className="txn-modal-form">
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Bank Account
                    {bankAccounts.data && bankAccounts.data.length === 1 ? (
                      <div className="crud-row" style={{ marginBottom: 0 }}>
                        <span>{bankAccounts.data[0].name}</span>
                      </div>
                    ) : (
                      <select className="input" value={selectedBankId} onChange={(e) => setSelectedBankId(e.target.value)}>
                        <option value="" disabled>
                          Select bank account
                        </option>
                        {bankAccounts.data?.map((bank) => (
                          <option key={bank.id} value={bank.id}>
                            {bank.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Sub Account
                    <select className="input" value={budgetId} onChange={(e) => {
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
                    </select>
                  </label>
                  {(createFormGroups.data ?? []).length ? (
                    <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                      Group <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
                      <select className="input" value={transactionGroupId} onChange={(e) => setTransactionGroupId(e.target.value)}>
                        <option value="">No group</option>
                        {(createFormGroups.data ?? []).map((group) => (
                          <option key={group.id} value={group.id}>{group.icon || "📌"} {group.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Date
                    <input
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
                  <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Deduct or Add
                    <div className="segmented-toggle" role="tablist" aria-label="Transaction operation">
                      <button
                        type="button"
                        className={`segmented-toggle-btn segmented-toggle-btn-deduct ${operation === "DEDUCT" ? "is-active" : ""}`}
                        onClick={() => setOperation("DEDUCT")}
                      >
                        Deduct
                      </button>
                      <button
                        type="button"
                        className={`segmented-toggle-btn segmented-toggle-btn-add ${operation === "ADD" ? "is-active" : ""}`}
                        onClick={() => setOperation("ADD")}
                      >
                        Add
                      </button>
                    </div>
                  </label>
                  <label className="modal-grid-span-2" style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Title
                    <input className="input" placeholder="Title" value={subject} onChange={(e) => setSubject(e.target.value)} />
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
                <button className="btn btn-ghost" type="button" onClick={() => setIsCreateModalOpen(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={createTx.isPending}>
                  {createTx.isPending ? "Adding..." : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {editingTxId && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeEditModal)}>
          <div className="profile-modal txn-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Edit Transaction</h3>
              <button className="profile-modal-close" onClick={closeEditModal}>
                Close
              </button>
            </div>
            <form className="profile-modal-body txn-modal-body txn-modal-form" onSubmit={onSubmitEdit}>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Amount
                <NumericCalculatorInput
                  min="1"
                  step="0.01"
                  placeholder="Amount"
                  value={editAmount}
                  onValueChange={setEditAmount}
                />
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Date
                <input
                  type="date"
                  className="input"
                  value={editTransactionDate}
                  onChange={(e) => setEditTransactionDate(e.target.value)}
                  required
                />
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Deduct or Add
                <div className="segmented-toggle" role="tablist" aria-label="Transaction operation">
                  <button
                    type="button"
                    className={`segmented-toggle-btn segmented-toggle-btn-deduct ${editOperation === "DEDUCT" ? "is-active" : ""}`}
                    onClick={() => setEditOperation("DEDUCT")}
                  >
                    Deduct
                  </button>
                  <button
                    type="button"
                    className={`segmented-toggle-btn segmented-toggle-btn-add ${editOperation === "ADD" ? "is-active" : ""}`}
                    onClick={() => setEditOperation("ADD")}
                  >
                    Add
                  </button>
                </div>
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Sub Account
                <select className="input" value={editBudgetId} onChange={(e) => {
                  setEditBudgetId(e.target.value);
                  setEditGroupId("");
                }} required>
                  <option value="" disabled>
                    Select sub account
                  </option>
                  {editableBudgets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Group <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
                <select className="input" value={editGroupId} onChange={(e) => setEditGroupId(e.target.value)}>
                  <option value="">No group</option>
                  {(editFormGroups.data ?? []).map((group) => (
                    <option key={group.id} value={group.id}>{group.icon || "📌"} {group.name}</option>
                  ))}
                </select>
              </label>
              <label className="modal-grid-span-2" style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Title
                <input className="input" placeholder="Title" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
              </label>
              <MarkdownEditor
                className="modal-grid-span-2"
                label="Notes"
                value={editNotes}
                onChange={setEditNotes}
                placeholder="Write notes in Markdown"
                calculator
              />
              {updateTx.isError ? (
                <div className="modal-grid-span-2" style={{ color: "var(--danger)", fontSize: "12px" }} role="alert">
                  {(updateTx.error as Error).message || "Failed to save transaction"}
                </div>
              ) : null}
              <div className="modal-grid-span-2" style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={confirmDeleteEditingTx}
                  disabled={deleteTx.isPending || !editingTxId}
                  style={{ color: "var(--danger)" }}
                >
                  {deleteTx.isPending && editingTxId && deletingTransactionIds.includes(editingTxId) ? "Deleting..." : "Delete"}
                </button>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <button className="btn btn-ghost" type="button" onClick={closeEditModal}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" type="submit" disabled={updateTx.isPending}>
                    {updateTx.isPending ? <LoadingDots /> : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {editingBankAccount && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeEditBankBalance)}>
          <div className="profile-modal txn-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Edit Bank Balance</h3>
              <button className="profile-modal-close" onClick={closeEditBankBalance}>✕</button>
            </div>
            <form className="profile-modal-body txn-modal-body txn-modal-form txn-bank-balance-form" onSubmit={onSubmitBankBalance}>
              <div className="form-group">
                <label className="label">Bank Account</label>
                <input className="input" value={editingBankAccount.name} disabled />
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
              <div className="profile-actions">
                <button type="button" className="btn btn-ghost" onClick={closeEditBankBalance}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={updateBankBalance.isPending}>
                  {updateBankBalance.isPending ? "Saving..." : "Save Balance"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {isTransferModalOpen && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeTransferModal)}>
          <div className="profile-modal txn-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Transfer Between Sub-Accounts</h3>
              <button className="profile-modal-close" onClick={closeTransferModal}>
                Close
              </button>
            </div>
            <form className="profile-modal-body txn-modal-body txn-modal-form" onSubmit={onSubmitTransfer}>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Title
                <input className="input" placeholder="Transfer title" value={transferTitle} onChange={(e) => setTransferTitle(e.target.value)} required />
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
                <select className="input" value={transferSourceBudgetId} onChange={(e) => setTransferSourceBudgetId(e.target.value)} required>
                  <option value="" disabled>Select source sub-account</option>
                  {(budgets.data ?? []).map((budget) => (
                    <option key={budget.id} value={budget.id}>
                      {budget.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="modal-grid-span-2" style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Destination Sub-Account
                <select className="input" value={transferDestinationBudgetId} onChange={(e) => setTransferDestinationBudgetId(e.target.value)} required>
                  <option value="" disabled>Select destination sub-account</option>
                  {(budgets.data ?? []).map((budget) => (
                    <option key={budget.id} value={budget.id}>
                      {budget.name}
                    </option>
                  ))}
                </select>
              </label>
              {transferBetweenBudgets.isError ? (
                <div className="modal-grid-span-2" style={{ color: "var(--danger)", fontSize: "12px" }} role="alert">
                  {(transferBetweenBudgets.error as Error)?.message || "Transfer failed"}
                </div>
              ) : null}
              <div className="modal-grid-span-2" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button type="button" className="btn btn-ghost" onClick={closeTransferModal}>
                  Cancel
                </button>
                <button
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
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {receivableInfoBudgetId && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, () => setReceivableInfoBudgetId(null))}>
          <div className="profile-modal txn-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>{receivableInfoBudget?.name || "Receivable Breakdown"}</h3>
              <button className="profile-modal-close" onClick={() => setReceivableInfoBudgetId(null)}>
                Close
              </button>
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
          </div>
        </div>,
        document.body
      )}

      {isBudgetModalOpen && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeBudgetModal)}>
          <div className="profile-modal txn-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>{editingBudgetId ? "Edit Sub-Account" : "New Sub-Account"}</h3>
              <button className="profile-modal-close" onClick={closeBudgetModal}>
                Close
              </button>
            </div>
            <div className="profile-modal-body txn-modal-body" style={{ display: "grid", gap: "12px" }}>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                Name
                <input
                  className="input"
                  placeholder="Sub-account name"
                  value={editingBudgetId ? editingBudgetName : createBudgetName}
                  onChange={(e) => editingBudgetId ? setEditingBudgetName(e.target.value) : setCreateBudgetName(e.target.value)}
                />
              </label>
              {!editingBudgetId && bankAccounts.data && bankAccounts.data.length > 1 ? (
                <label style={{ display: "grid", gap: "4px", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Bank Account
                  <select
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
                  </select>
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
              {editingBudgetId ? (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    <input
                      type="checkbox"
                      checked={editingBudgetIsSavings}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setEditingBudgetIsSavings(checked);
                        if (checked) {
                          setEditingBudgetIcon("🛡️");
                        }
                      }}
                    />
                    <span>Is this a savings sub-account?</span>
                  </label>
                  {!editingBudgetIsSavings && (
                    <div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>Icon</div>
                      <div className="icon-picker">
                        {budgetIconOptions.map((icon) => (
                          <button
                            key={icon}
                            type="button"
                            className={`icon-chip${editingBudgetIcon === icon ? " on" : ""}`}
                            onClick={() => setEditingBudgetIcon(icon)}
                            aria-label={`Select icon ${icon}`}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <div className="profile-modal-body" style={{ display: "flex", justifyContent: "space-between", gap: "8px", borderTop: "1px solid var(--border-subtle)", paddingTop: "12px" }}>
              {editingBudgetId ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={confirmDeleteBudget}
                  disabled={deleteBudget.isPending}
                >
                  {deleteBudget.isPending ? "Deleting..." : "Delete"}
                </button>
              ) : (
                <span />
              )}
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" className="btn btn-ghost" onClick={closeBudgetModal}>
                  Cancel
                </button>
                <button
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
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
        </>
      )}
    </div>
  );
}
