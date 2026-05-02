"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney, formatMoneyShort, normalizeCurrency } from "@/lib/currency";
import { getBrowserCookie, setBrowserCookie } from "@/lib/browser-cookies";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { AppSidebar } from "./app-sidebar";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { SkeletonCard, SkeletonMiniCard, SkeletonList, EmptyState } from "@/components/ui-skeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";

type DashboardSummary = {
  totalBalanceCents: number;
  bankDiscrepancies: Array<{
    id: string;
    name: string;
    currentBalanceCents: number;
    linkedBudgetTotalCents: number;
    discrepancyCents: number;
  }>;
  budgets: Array<{
    id: string;
    name: string;
    icon?: string | null;
    accountId?: string;
    availableCents: number;
    targetCents: number;
    monthlyOutgoingCents: number;
  }>;
  recentTransactions: Array<{
    id: string;
    subject: string;
    amountCents: number;
    direction: "DEBIT" | "CREDIT";
    date: string;
    budgetName?: string | null;
  }>;
  creditCardSummary?: {
    nextDueCards: CreditCardDueCard[];
    totalOutstandingCents: number;
    overdueCount: number;
    dueSoonCount: number;
  };
};

type CreditCardDueCard = {
  cardId: string;
  cardName: string;
  bankName?: string | null;
  statementMonth: number;
  statementYear: number;
  paymentDueDate: string;
  outstandingCents: number;
};

type CreditCardDueGroup = {
  key: string;
  bankName: string | null;
  paymentDueDate: string;
  outstandingCents: number;
  cards: CreditCardDueCard[];
};

type CreditCardDueTone = "danger" | "warning" | "success";

type AppContext = {
  workspaceId: string | null;
  defaultAccountId: string | null;
  defaultUserId: string | null;
  baseCurrency?: string | null;
  isShared?: boolean;
  isCollaborative?: boolean;
  workspaceName?: string | null;
  memberCount?: number;
  pendingInviteCount?: number;
  sidebarMoneyPages?: Record<string, boolean>;
  accounts: Array<{
    id: string;
    name: string;
    kind: string;
  }>;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  icon?: string | null;
  targetCents: number;
  availableCents: number;
  monthlyOutgoingCents?: number;
};

type Transaction = {
  id: string;
  accountId: string;
  subject: string;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  date: string;
  kind: string;
  budgetId?: string | null;
};

type Receivable = {
  id: string;
  title: string;
  amountCents: number;
  date: string;
  status: string;
};

type BankAccountSummary = {
  id: string;
  name: string;
  bankName?: string | null;
  startingCents: number;
  currentBalanceCents: number;
  linkedBudgetTotalCents: number;
  discrepancyCents: number;
};

type InvestmentAccountSummary = {
  id: string;
  entries: Array<{
    id: string;
    date: string;
    investedCents: number;
    currentValueCents: number;
  }>;
};

type Toast = {
  id: string;
  kind: "success" | "error" | "info";
  message: string;
};

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

async function getSummary(): Promise<DashboardSummary> {
  const res = await fetch("/api/dashboard/summary", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Unable to load dashboard");
  }
  return res.json();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json();
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Emoji mapping for budget icons
const budgetEmojis: Record<string, string> = {
  housing: "🏠",
  home: "🏠",
  rent: "🏠",
  emergency: "🛡️",
  savings: "🛡️",
  travel: "✈️",
  vacation: "✈️",
  food: "🍔",
  dining: "🍔",
  groceries: "🥬",
  transport: "🚌",
  transportation: "🚌",
  shopping: "🛍️",
  health: "💪",
  fitness: "💪",
  medical: "💊",
  entertainment: "🎬",
  bills: "💡",
  utilities: "💡",
  education: "📚",
  investment: "📈",
  insurance: "🧾",
  phone: "📱",
  media: "🎬",
  business: "💼",
  loan: "🏦",
  card: "💳",
  child: "👶",
  pet: "🐶",
  gift: "🎁",
  hospital: "🏥",
  default: "💰",
};
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

function getBudgetEmoji(name: string) {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(budgetEmojis)) {
    if (lower.includes(key)) return emoji;
  }
  return budgetEmojis.default;
}

function getBudgetIcon(name: string, icon?: string | null) {
  return icon || getBudgetEmoji(name);
}

// Transaction emoji mapping
const txEmojis: Record<string, string> = {
  grocery: "🛒",
  groceries: "🛒",
  grab: "🚗",
  uber: "🚗",
  taxi: "🚗",
  transport: "🚗",
  starbucks: "☕",
  coffee: "☕",
  gym: "🏋️",
  fitness: "🏋️",
  received: "💵",
  payment: "💵",
  default: "💳",
};

function getTxEmoji(subject: string) {
  const lower = subject.toLowerCase();
  for (const [key, emoji] of Object.entries(txEmojis)) {
    if (lower.includes(key)) return emoji;
  }
  return txEmojis.default;
}

function getDaysUntil(dateStr: string) {
  const now = new Date();
  const target = new Date(dateStr);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((target.getTime() - now.getTime()) / msPerDay);
}

function getStatementLabel(month: number, year: number) {
  const statementDate = new Date(Date.UTC(year, month - 1, 1));
  const monthName = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(statementDate);
  return `${monthName} ${year}`;
}

function getPaymentDueDateLabel(dateStr: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateStr));
}

function getPaymentDueDateKey(dateStr: string) {
  return new Date(dateStr).toISOString().slice(0, 10);
}

function getCreditCardDueGroups(cards: CreditCardDueCard[]): CreditCardDueGroup[] {
  const groups = new Map<string, CreditCardDueGroup>();

  for (const card of cards) {
    const bankName = card.bankName?.trim() || null;
    const dueDateKey = getPaymentDueDateKey(card.paymentDueDate);
    const key = `${bankName ?? "unknown"}:${dueDateKey}`;
    const group = groups.get(key);

    if (group) {
      group.outstandingCents += card.outstandingCents;
      group.cards.push(card);
      continue;
    }

    groups.set(key, {
      key,
      bankName,
      paymentDueDate: card.paymentDueDate,
      outstandingCents: card.outstandingCents,
      cards: [card],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      cards: [...group.cards].sort((a, b) => a.cardName.localeCompare(b.cardName)),
    }))
    .sort((a, b) => {
      const dueDiff = new Date(a.paymentDueDate).getTime() - new Date(b.paymentDueDate).getTime();
      if (dueDiff !== 0) return dueDiff;
      return (a.bankName ?? "").localeCompare(b.bankName ?? "");
    });
}

function getDueCountdownLabel(dateStr: string) {
  const days = getDaysUntil(dateStr);
  if (days < 0) return `Overdue by ${Math.abs(days)}d`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due in 1d";
  return `Due in ${days}d`;
}

function getDueTone(days: number): CreditCardDueTone {
  if (days < 10) return "danger";
  if (days < 20) return "warning";
  return "success";
}

function getDueToneColor(tone: CreditCardDueTone) {
  if (tone === "danger") return "var(--danger)";
  if (tone === "warning") return "var(--warning)";
  return "var(--success)";
}

export function DashboardShell({
  userName,
  userEmail,
  userImage,
}: {
  userName: string;
  userEmail: string;
  userImage?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(userName);
  const [budgetName, setBudgetName] = useState("");
  const [budgetTarget, setBudgetTarget] = useState("");
  const [budgetAccountId, setBudgetAccountId] = useState("");
  const [createBudgetOpen, setCreateBudgetOpen] = useState(false);
  const [txSubject, setTxSubject] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [txAccountId, setTxAccountId] = useState("");
  const [txBudgetId, setTxBudgetId] = useState("");
  const [txBudgetOperation, setTxBudgetOperation] = useState<"DEDUCT" | "ADD">("DEDUCT");
  const [recvTitle, setRecvTitle] = useState("");
  const [recvAmount, setRecvAmount] = useState("");
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editingBudgetName, setEditingBudgetName] = useState("");
  const [editingBudgetIcon, setEditingBudgetIcon] = useState("");
  const [editingBudgetIsSavings, setEditingBudgetIsSavings] = useState(false);
  const [editingBudgetTarget, setEditingBudgetTarget] = useState("");
  const [editingReceivableId, setEditingReceivableId] = useState<string | null>(null);
  const [editingReceivableTitle, setEditingReceivableTitle] = useState("");
  const [editingReceivableAmount, setEditingReceivableAmount] = useState("");
  const [selectedBankFilterId, setSelectedBankFilterId] = useState<string>("ALL");
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const [failedBankLogos, setFailedBankLogos] = useState<Record<string, boolean>>({});
  const [failedCreditCardBankLogos, setFailedCreditCardBankLogos] = useState<Record<string, boolean>>({});
  const [bankFilterHydrated, setBankFilterHydrated] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccountSummary | null>(null);
  const [editBankBalance, setEditBankBalance] = useState("");
  const bankPickerRef = useRef<HTMLDivElement | null>(null);

  const contextQuery = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  const workspaceId = contextQuery.data?.workspaceId;
  const isContextLoading = contextQuery.isLoading && !contextQuery.data;

  const { data, isLoading, isPending } = useQuery({
    queryKey: ["dashboard-summary", workspaceId],
    queryFn: getSummary,
    enabled: Boolean(workspaceId),
  });

  const isDataReady = !isPending && data !== undefined;

  const baseCurrency = normalizeCurrency(contextQuery.data?.baseCurrency);
  const formatCents = (value: number) => formatMoney(value, baseCurrency);
  const formatCentsShort = (value: number) => formatMoneyShort(value, baseCurrency);
  const defaultUserId = contextQuery.data?.defaultUserId;
  const dashboardBankStorageKey = workspaceId ? `nest:selectedBank:${workspaceId}` : null;
  const creditCardDueGroups = useMemo(
    () => getCreditCardDueGroups(data?.creditCardSummary?.nextDueCards ?? []),
    [data?.creditCardSummary?.nextDueCards],
  );
  const urgentCreditCardGroupCount = creditCardDueGroups.filter((group) => {
    const days = getDaysUntil(group.paymentDueDate);
    return days >= 0 && days < 10;
  }).length;
  const overdueCreditCardGroupCount = creditCardDueGroups.filter((group) => getDaysUntil(group.paymentDueDate) < 0).length;

  const budgetsQuery = useQuery({
    queryKey: ["budgets", workspaceId],
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const transactionsQuery = useQuery({
    queryKey: ["transactions", workspaceId],
    queryFn: () => fetchJson<Transaction[]>(`/api/transactions?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const receivablesQuery = useQuery({
    queryKey: ["receivables", workspaceId],
    queryFn: () => fetchJson<Receivable[]>(`/api/receivables?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const bankAccountsQuery = useQuery({
    queryKey: ["bank-accounts", workspaceId],
    queryFn: () => fetchJson<BankAccountSummary[]>(`/api/accounts?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  const investmentsQuery = useQuery({
    queryKey: ["investments", workspaceId],
    queryFn: () => fetchJson<InvestmentAccountSummary[]>(`/api/investments?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  const firstBankAccountId = bankAccountsQuery.data?.[0]?.id;

  const updateBankBalance = useMutation({
    mutationFn: ({ id, startingCents }: { id: string; startingCents: number }) =>
      fetchJson(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startingCents }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-summary", workspaceId] });
      setEditingBankAccount(null);
      setEditBankBalance("");
      pushToast("success", "Bank balance updated.");
    },
    onError: (error) => {
      pushToast("error", error instanceof Error ? error.message : "Failed to update bank balance.");
    },
  });

  const refreshAll = useMemo(
    () => () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["receivables", workspaceId] }),
      ]),
    [queryClient, workspaceId]
  );

  const budgetsKey = ["budgets", workspaceId] as const;
  const transactionsKey = ["transactions", workspaceId] as const;
  const receivablesKey = ["receivables", workspaceId] as const;

  const pushToast = (kind: Toast["kind"], message: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2600);
  };

  const openEditBankBalance = (bank: BankAccountSummary) => {
    setEditingBankAccount(bank);
    setEditBankBalance((bank.currentBalanceCents / 100).toFixed(2));
  };

  const closeEditBankBalance = () => {
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

  const createBudget = useMutation({
    mutationFn: (payload: { name: string; targetCents: number; accountId: string; icon?: string }) =>
      fetchJson("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          accountId: payload.accountId,
          createdById: defaultUserId,
          name: payload.name,
          icon: payload.icon,
          targetCents: payload.targetCents,
        }),
      }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: budgetsKey });
      const previousBudgets = queryClient.getQueryData<Budget[]>(budgetsKey);
      const optimistic: Budget = {
        id: `temp-budget-${Date.now()}`,
        accountId: payload.accountId,
        name: payload.name,
        icon: payload.icon,
        targetCents: payload.targetCents,
        availableCents: 0,
      };
      queryClient.setQueryData<Budget[]>(budgetsKey, (old) => [optimistic, ...(old ?? [])]);
      return { previousBudgets };
    },
    onError: (_, __, context) => {
      if (context?.previousBudgets) {
        queryClient.setQueryData(budgetsKey, context.previousBudgets);
      }
      pushToast("error", "Budget creation failed.");
    },
    onSuccess: () => {
      pushToast("success", "Budget created.");
      setCreateBudgetOpen(false);
      setBudgetName("");
      setBudgetTarget("");
      setBudgetAccountId("");
    },
    onSettled: refreshAll,
  });

  const createTransaction = useMutation({
    mutationFn: (payload: {
      subject: string;
      amountCents: number;
      accountId: string;
      operation: "DEDUCT" | "ADD";
      budgetId?: string;
      budgetOperation?: "DEDUCT" | "ADD";
    }) =>
      fetchJson("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          accountId: payload.accountId,
          subject: payload.subject,
          amountCents: payload.amountCents,
          direction: payload.operation === "ADD" ? "CREDIT" : "DEBIT",
          kind: payload.operation === "ADD" ? "ADJUSTMENT" : "EXPENSE",
          date: new Date().toISOString(),
          budgetId: payload.budgetId,
          budgetOperation: payload.budgetOperation,
        }),
      }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: transactionsKey });
      const previousTransactions = queryClient.getQueryData<Transaction[]>(transactionsKey);
      const previousBudgets = queryClient.getQueryData<Budget[]>(budgetsKey);
      const optimistic: Transaction = {
        id: `temp-tx-${Date.now()}`,
        accountId: payload.accountId,
        subject: payload.subject,
        amountCents: payload.amountCents,
        direction: "DEBIT",
        date: new Date().toISOString(),
        kind: "EXPENSE",
      };
      queryClient.setQueryData<Transaction[]>(transactionsKey, (old) => [optimistic, ...(old ?? [])]);
      if (payload.budgetId && payload.budgetOperation) {
        const delta = payload.budgetOperation === "DEDUCT" ? -payload.amountCents : payload.amountCents;
        queryClient.setQueryData<Budget[]>(budgetsKey, (old) =>
          (old ?? []).map((b) => (b.id === payload.budgetId ? { ...b, availableCents: b.availableCents + delta } : b)),
        );
      }
      return { previousTransactions, previousBudgets };
    },
    onError: (_, __, context) => {
      if (context?.previousTransactions) {
        queryClient.setQueryData(transactionsKey, context.previousTransactions);
      }
      if (context?.previousBudgets) {
        queryClient.setQueryData(budgetsKey, context.previousBudgets);
      }
      pushToast("error", "Transaction creation failed.");
    },
    onSuccess: () => pushToast("success", "Transaction added."),
    onSettled: refreshAll,
  });

  const createReceivable = useMutation({
    mutationFn: (payload: { title: string; amountCents: number }) =>
      fetchJson("/api/receivables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          accountId: firstBankAccountId,
          fromUserId: defaultUserId || undefined,
          title: payload.title,
          amountCents: payload.amountCents,
          date: new Date().toISOString(),
          status: "OPEN",
        }),
      }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: receivablesKey });
      const previousReceivables = queryClient.getQueryData<Receivable[]>(receivablesKey);
      const optimistic: Receivable = {
        id: `temp-recv-${Date.now()}`,
        title: payload.title,
        amountCents: payload.amountCents,
        date: new Date().toISOString(),
        status: "OPEN",
      };
      queryClient.setQueryData<Receivable[]>(receivablesKey, (old) => [optimistic, ...(old ?? [])]);
      return { previousReceivables };
    },
    onError: (_, __, context) => {
      if (context?.previousReceivables) {
        queryClient.setQueryData(receivablesKey, context.previousReceivables);
      }
      pushToast("error", "Receivable creation failed.");
    },
    onSuccess: () => pushToast("success", "Receivable added."),
    onSettled: refreshAll,
  });

  const updateBudget = useMutation({
    mutationFn: ({ id, name, icon, targetCents }: { id: string; name: string; icon?: string; targetCents: number }) =>
      fetchJson(`/api/budgets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon, targetCents }),
      }),
    onMutate: async ({ id, name, icon, targetCents }) => {
      await queryClient.cancelQueries({ queryKey: budgetsKey });
      const previousBudgets = queryClient.getQueryData<Budget[]>(budgetsKey);
      queryClient.setQueryData<Budget[]>(budgetsKey, (old) =>
        (old ?? []).map((b) => (b.id === id ? { ...b, name, icon: icon ?? b.icon, targetCents } : b))
      );
      return { previousBudgets };
    },
    onError: (_, __, context) => {
      if (context?.previousBudgets) {
        queryClient.setQueryData(budgetsKey, context.previousBudgets);
      }
      pushToast("error", "Budget edit failed.");
    },
    onSuccess: () => pushToast("success", "Budget updated."),
    onSettled: refreshAll,
  });

  const deleteBudget = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/budgets/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: budgetsKey });
      const previousBudgets = queryClient.getQueryData<Budget[]>(budgetsKey);
      queryClient.setQueryData<Budget[]>(budgetsKey, (old) => (old ?? []).filter((b) => b.id !== id));
      return { previousBudgets };
    },
    onError: (_, __, context) => {
      if (context?.previousBudgets) {
        queryClient.setQueryData(budgetsKey, context.previousBudgets);
      }
      pushToast("error", "Budget delete failed.");
    },
    onSuccess: () => pushToast("success", "Budget deleted."),
    onSettled: refreshAll,
  });

  const markReceivablePaid = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/receivables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID" }),
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: receivablesKey });
      const previousReceivables = queryClient.getQueryData<Receivable[]>(receivablesKey);
      queryClient.setQueryData<Receivable[]>(receivablesKey, (old) =>
        (old ?? []).map((r) => (r.id === id ? { ...r, status: "PAID" } : r))
      );
      return { previousReceivables };
    },
    onError: (_, __, context) => {
      if (context?.previousReceivables) {
        queryClient.setQueryData(receivablesKey, context.previousReceivables);
      }
      pushToast("error", "Receivable update failed.");
    },
    onSuccess: () => pushToast("success", "Receivable marked paid."),
    onSettled: refreshAll,
  });

  const updateReceivable = useMutation({
    mutationFn: ({ id, title, amountCents }: { id: string; title: string; amountCents: number }) =>
      fetchJson(`/api/receivables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, amountCents }),
      }),
    onMutate: async ({ id, title, amountCents }) => {
      await queryClient.cancelQueries({ queryKey: receivablesKey });
      const previousReceivables = queryClient.getQueryData<Receivable[]>(receivablesKey);
      queryClient.setQueryData<Receivable[]>(receivablesKey, (old) =>
        (old ?? []).map((r) => (r.id === id ? { ...r, title, amountCents } : r))
      );
      return { previousReceivables };
    },
    onError: (_, __, context) => {
      if (context?.previousReceivables) {
        queryClient.setQueryData(receivablesKey, context.previousReceivables);
      }
      pushToast("error", "Receivable edit failed.");
    },
    onSuccess: () => pushToast("success", "Receivable updated."),
    onSettled: refreshAll,
  });

  const deleteReceivable = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/receivables/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: receivablesKey });
      const previousReceivables = queryClient.getQueryData<Receivable[]>(receivablesKey);
      queryClient.setQueryData<Receivable[]>(receivablesKey, (old) => (old ?? []).filter((r) => r.id !== id));
      return { previousReceivables };
    },
    onError: (_, __, context) => {
      if (context?.previousReceivables) {
        queryClient.setQueryData(receivablesKey, context.previousReceivables);
      }
      pushToast("error", "Receivable delete failed.");
    },
    onSuccess: () => pushToast("success", "Receivable deleted."),
    onSettled: refreshAll,
  });

  const onCreateBudget = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !budgetAccountId || !defaultUserId || !budgetName.trim()) return;
    const parsedTarget = budgetTarget.trim() ? Number(budgetTarget) : 0;
    if (Number.isNaN(parsedTarget) || parsedTarget < 0) return;
    createBudget.mutate({ name: budgetName.trim(), targetCents: Math.round(parsedTarget * 100), accountId: budgetAccountId });
  };

  const onCreateTx = (event: FormEvent) => {
    event.preventDefault();
    const selectedBudget = budgetsQuery.data?.find((b) => b.id === txBudgetId);
    const accountId = selectedBudget?.accountId || txAccountId;
    if (!workspaceId || !accountId || !txSubject || !txAmount) return;
    createTransaction.mutate({
      subject: txSubject,
      amountCents: Math.round(Number(txAmount) * 100),
      accountId,
      operation: txBudgetOperation,
      budgetId: txBudgetId || undefined,
      budgetOperation: txBudgetId ? txBudgetOperation : undefined,
    });
    setTxSubject("");
    setTxAmount("");
    setTxAccountId("");
  };

  const onCreateReceivable = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !recvTitle || !recvAmount) return;
    createReceivable.mutate({ title: recvTitle, amountCents: Math.round(Number(recvAmount) * 100) });
    setRecvTitle("");
    setRecvAmount("");
  };

  const startBudgetEdit = (budget: Budget) => {
    const resolvedIcon = getBudgetIcon(budget.name, budget.icon);
    setEditingBudgetId(budget.id);
    setEditingBudgetName(budget.name);
    setEditingBudgetIcon(resolvedIcon);
    setEditingBudgetIsSavings(resolvedIcon === "🛡️");
    setEditingBudgetTarget(String((budget.targetCents / 100).toFixed(2)));
  };

  const saveBudgetEdit = () => {
    if (!editingBudgetId || !editingBudgetName.trim()) return;
    const parsedTarget = editingBudgetTarget.trim() ? Number(editingBudgetTarget) : 0;
    if (Number.isNaN(parsedTarget) || parsedTarget < 0) return;
    updateBudget.mutate({
      id: editingBudgetId,
      name: editingBudgetName.trim(),
      icon: editingBudgetIsSavings ? "🛡️" : editingBudgetIcon || undefined,
      targetCents: Math.round(parsedTarget * 100),
    });
    setEditingBudgetId(null);
    setEditingBudgetName("");
    setEditingBudgetIcon("");
    setEditingBudgetIsSavings(false);
    setEditingBudgetTarget("");
  };

  const startReceivableEdit = (recv: Receivable) => {
    setEditingReceivableId(recv.id);
    setEditingReceivableTitle(recv.title);
    setEditingReceivableAmount(String((recv.amountCents / 100).toFixed(2)));
  };

  const saveReceivableEdit = () => {
    if (!editingReceivableId || !editingReceivableTitle || !editingReceivableAmount) return;
    updateReceivable.mutate({
      id: editingReceivableId,
      title: editingReceivableTitle,
      amountCents: Math.round(Number(editingReceivableAmount) * 100),
    });
    setEditingReceivableId(null);
    setEditingReceivableTitle("");
    setEditingReceivableAmount("");
  };

  const confirmDeleteBudget = (budgetId: string) => {
    if (!confirmDestructiveAction("Delete this sub-account?")) return;
    deleteBudget.mutate(budgetId);
    setEditingBudgetId(null);
    setEditingBudgetIcon("");
  };

  const summary = data ?? {
    totalBalanceCents: 0,
    bankDiscrepancies: [],
    budgets: [],
    recentTransactions: [],
  };
  const filteredBudgets = useMemo(
    () =>
      (budgetsQuery.data ?? []).filter((b) => selectedBankFilterId === "ALL" || b.accountId === selectedBankFilterId),
    [budgetsQuery.data, selectedBankFilterId],
  );
  const filteredTransactions = useMemo(
    () =>
      (transactionsQuery.data ?? []).filter((t) => selectedBankFilterId === "ALL" || t.accountId === selectedBankFilterId),
    [transactionsQuery.data, selectedBankFilterId],
  );
  const goToTransactionsForSubAccount = (budgetId: string, accountId: string) => {
    const params = new URLSearchParams({
      budgetId,
      accountId,
    });
    router.push(`/transactions?${params.toString()}`);
  };
  const goToCreditCardStatement = (card: CreditCardDueCard) => {
    const params = new URLSearchParams({
      cardId: card.cardId,
      month: String(card.statementMonth),
      year: String(card.statementYear),
    });
    router.push(`/credit-transactions?${params.toString()}`);
  };
  const budgetNameById = useMemo(
    () => new Map((budgetsQuery.data ?? []).map((b) => [b.id, b.name])),
    [budgetsQuery.data],
  );
  const budgetById = useMemo(
    () => new Map((budgetsQuery.data ?? []).map((b) => [b.id, b])),
    [budgetsQuery.data],
  );
  const filteredBankDiscrepancies = useMemo(
    () =>
      summary.bankDiscrepancies.filter((d) => selectedBankFilterId === "ALL" || d.id === selectedBankFilterId),
    [summary.bankDiscrepancies, selectedBankFilterId],
  );
  const filteredBankBalance =
    selectedBankFilterId === "ALL"
      ? summary.totalBalanceCents
      : bankAccountsQuery.data?.find((b) => b.id === selectedBankFilterId)?.currentBalanceCents ?? 0;

  const totalBudgeted = filteredBudgets.reduce((sum, b) => sum + b.availableCents, 0);
  const freeAmount = Math.max(0, filteredBankBalance - totalBudgeted);

  const pendingReceivables = receivablesQuery.data?.filter((r) => r.status === "OPEN") || [];
  const investmentTotals = useMemo(() => {
    let invested = 0;
    let current = 0;
    for (const account of investmentsQuery.data ?? []) {
      const latest = [...(account.entries ?? [])]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .at(-1);
      invested += latest?.investedCents ?? 0;
      current += latest?.currentValueCents ?? 0;
    }
    return { invested, current };
  }, [investmentsQuery.data]);
  const investmentGain = investmentTotals.current - investmentTotals.invested;
  const investmentGainPct = investmentTotals.invested > 0
    ? (investmentGain / investmentTotals.invested) * 100
    : 0;
  const totalSavings = filteredBudgets
    .filter((budget) => getBudgetIcon(budget.name, budget.icon) === "🛡️")
    .reduce((sum, budget) => sum + budget.availableCents, 0);
  const totalInvestmentsAndSavings = investmentTotals.current + totalSavings;
  const selectedBank =
    selectedBankFilterId === "ALL"
      ? null
      : bankAccountsQuery.data?.find((bank) => bank.id === selectedBankFilterId) ?? null;

  useEffect(() => {
    if (!dashboardBankStorageKey) return;
    const saved = getBrowserCookie(dashboardBankStorageKey);
    if (saved) {
      setSelectedBankFilterId(saved);
    }
    setBankFilterHydrated(true);
  }, [dashboardBankStorageKey]);

  useEffect(() => {
    if (!dashboardBankStorageKey || !bankFilterHydrated) return;
    setBrowserCookie(dashboardBankStorageKey, selectedBankFilterId);
  }, [dashboardBankStorageKey, selectedBankFilterId, bankFilterHydrated]);

  useEffect(() => {
    if (selectedBankFilterId === "ALL") return;
    if (!bankAccountsQuery.data?.some((b) => b.id === selectedBankFilterId)) {
      setSelectedBankFilterId("ALL");
    }
  }, [bankAccountsQuery.data, selectedBankFilterId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem("nest:ui:sidebarOpen");
    if (saved === "1") {
      setSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("nest:ui:sidebarOpen", sidebarOpen ? "1" : "0");
  }, [sidebarOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const workspaceName = contextQuery.data?.workspaceName?.trim();
    document.title = workspaceName ? `${workspaceName} [Dashboard]` : "Dashboard";
  }, [contextQuery.data?.workspaceName]);

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

  return (
    <div className="app-shell">
      <AppSidebar
        userName={displayName}
        userEmail={userEmail}
        userImage={userImage}
        onDisplayNameUpdated={setDisplayName}
        currentPath="/"
        badgeCounts={{
          budgets: summary.budgets.length,
          receivables: pendingReceivables.length,
        }}
        sidebarOpen={sidebarOpen}
        onSidebarChange={setSidebarOpen}
        contextData={contextQuery.data}
        contextLoading={isContextLoading}
      />

      <main className="main">
        <header className="topbar">
          <div className="tb-left">
            <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
              <span></span>
              <span></span>
              <span></span>
            </button>
            <div className="tb-title">{getGreeting()}, {displayName.split(" ")[0]} 👋</div>
          </div>
        </header>

        {/* Body */}
        <div className="body">
          <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
            {bankAccountsQuery.isLoading || !isDataReady ? (
              <SkeletonMiniCard />
            ) : (
              <>
                <div className="bank-selector-summary">
                  <div className="bank-selector-main">
                    {selectedBank ? (
                      (() => {
                        const bankMeta = getSingaporeBankByName(selectedBank.bankName || selectedBank.name);
                        const logo = getBankLogoUrl(bankMeta);
                        return logo && !failedBankLogos[selectedBank.id] ? (
                          <img
                            src={logo}
                            alt={bankMeta?.name || "Bank"}
                            className="bank-logo-img"
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
                    <div className={`bank-selector-amount ${getAmountToneClass(filteredBankBalance)}`}>
                      {formatCents(filteredBankBalance)}
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
                          className={`bank-selector-option${selectedBankFilterId === "ALL" ? " is-active" : ""}`}
                          onClick={() => {
                            setSelectedBankFilterId("ALL");
                            setIsBankPickerOpen(false);
                          }}
                        >
                          All banks
                        </button>
                        {bankAccountsQuery.data?.map((bank) => (
                          <button
                            key={bank.id}
                            type="button"
                            className={`bank-selector-option${selectedBankFilterId === bank.id ? " is-active" : ""}`}
                            onClick={() => {
                              setSelectedBankFilterId(bank.id);
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
              </>
            )}
          </div>

          <div style={{ marginBottom: "10px" }}>
            {!isDataReady ? (
              <SkeletonMiniCard />
            ) : (
              <div className="bank-selector-row dashboard-mini-card">
                <div className="dashboard-mini-card-stack dashboard-mini-card-strip">
                  <div className="dashboard-mini-card-primary">
                    <div className="dashboard-mini-card-label">Net Worth</div>
                    <div className={`dashboard-mini-card-total ${totalInvestmentsAndSavings > 0 ? "positive" : ""}`}>
                      {formatCents(totalInvestmentsAndSavings)}
                    </div>
                    <div className="dashboard-mini-card-breakdown">
                      <Link
                        href="/investments"
                        className="dashboard-breakdown-item"
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <span className="dashboard-breakdown-icon" style={{ color: "var(--brand-400)" }}>📈</span>
                        <span className="dashboard-breakdown-value">{formatCents(investmentTotals.current)}</span>
                      </Link>
                      <span className="dashboard-breakdown-sep">+</span>
                      <div className="dashboard-breakdown-item">
                        <span className="dashboard-breakdown-icon" style={{ color: "var(--success)" }}>🐷</span>
                        <span className="dashboard-breakdown-value">{formatCents(totalSavings)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="dashboard-mini-card-metric dashboard-mini-card-gain">
                    <div className="dashboard-mini-card-label">
                      <span className="gain-label-desktop">Investment Gain</span>
                      <span className="gain-label-mobile">Gain</span>
                    </div>
                    <div className={`dashboard-mini-card-value ${getAmountToneClass(investmentGain)}`}>
                      {formatCents(investmentGain)}
                    </div>
                    <div className={`gain-percent ${getAmountToneClass(investmentGain)}`}>
                      {investmentGain >= 0 ? "" : "-"}
                      {Math.abs(investmentGainPct).toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Hero Card */}
          <div className="hero-card">
            <div className="hero-content">
              {!isDataReady ? (
                <div style={{ width: "100%" }}>
                  <SkeletonMiniCard />
                </div>
              ) : (
                <>
                  <div className="hero-main">
                    <div className="hero-label">Total in record</div>
                    <div className={`hero-amount ${getAmountToneClass(totalBudgeted)}`}>{formatCents(totalBudgeted)}</div>
                    <div className="hero-sub">Across {filteredBudgets.length} sub-accounts</div>
                  </div>
                  {freeAmount > 0 && (
                    <div className="hero-side">
                      <div className="hero-side-label">Unallocated: <span className={getAmountToneClass(freeAmount)}>{formatCents(freeAmount)}</span></div>
                      <div className={`hero-side-amount ${getAmountToneClass(filteredBankBalance)}`}>
                        Available in bank
                      </div>
                      <div className={`hero-side-free ${getAmountToneClass(freeAmount)}`}>
                        {formatCents(filteredBankBalance)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {filteredBudgets.length > 0 && (
              <div className="hero-chips">
                {filteredBudgets.slice(0, 5).map((budget) => (
                  <div
                    key={budget.id}
                    className="hero-chip"
                    onClick={() => router.push(`/transactions?budgetId=${budget.id}&accountId=${budget.accountId}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(`/transactions?budgetId=${budget.id}&accountId=${budget.accountId}`);
                      }
                    }}
                  >
                    <span className={`hero-chip-dot ${budget.availableCents < 0 ? "is-negative" : ""}`} aria-hidden="true" />
                    <div className="hero-chip-label">{budget.name}</div>
                    <div className="hero-chip-value">{formatCentsShort(budget.availableCents)}</div>
                  </div>
                ))}
                {filteredBudgets.length > 5 && (
                  <div
                    className="hero-chip"
                    onClick={() => router.push("/transactions")}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push("/transactions");
                      }
                    }}
                  >
                    <div className="hero-chip-label">+{filteredBudgets.length - 5} more</div>
                    <div className="hero-chip-value">
                      {formatCentsShort(filteredBudgets.slice(5).reduce((sum, b) => sum + b.availableCents, 0))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {filteredBankDiscrepancies.length > 0 && (
            <div
              className="alert alert-warn"
              style={{
                marginBottom: "14px",
                borderColor: "var(--danger)",
                background: "var(--danger-bg)",
                color: "var(--danger)",
                padding: "12px 14px",
              }}
            >
              <span className="alert-icon" style={{ color: "var(--danger)", fontSize: "16px" }}>⚠️</span>
              <div className="alert-body">
                <div className="alert-title" style={{ color: "var(--danger)", fontWeight: 700 }}>
                  Bank balance to accounts discrepancy detected
                </div>
                {filteredBankDiscrepancies.map((d) => (
                  <div key={d.id} style={{ fontSize: "12px", color: "var(--danger)" }}>
                    {d.name}: bank {formatCents(d.currentBalanceCents)} vs accounts {formatCents(d.linkedBudgetTotalCents)}
                    {" "}({d.discrepancyCents > 0 ? "+" : ""}
                    {formatCents(d.discrepancyCents)} mismatch)
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two Column Layout */}
          <div className="grid-2" style={{ marginTop: "14px" }}>
            {/* Credit Card Summary */}
            <div className="card cc-home-panel">
              <div className="cc-home-header">
                <div className="cc-home-title">
                  <span aria-hidden="true">💳</span>
                  <span>Credit Cards</span>
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => router.push("/credit-transactions")}>
                  View all →
                </button>
              </div>

              {data?.creditCardSummary && creditCardDueGroups.length > 0 ? (
                <>
                  <div className="cc-home-stats">
                    <div className="cc-home-stat">
                      <div className="cc-home-stat-label">Total Due</div>
                      <div className="cc-home-stat-value">
                        {formatCents(data.creditCardSummary.totalOutstandingCents)}
                      </div>
                    </div>
                    <div className="cc-home-stat">
                      <div className="cc-home-stat-label">Due Soon</div>
                      <div className={`cc-home-stat-value ${urgentCreditCardGroupCount > 0 ? "is-warning" : ""}`}>
                        {urgentCreditCardGroupCount > 0
                          ? `${urgentCreditCardGroupCount} ${urgentCreditCardGroupCount === 1 ? "bank" : "banks"}`
                          : "—"}
                      </div>
                    </div>
                    <div className="cc-home-stat">
                      <div className="cc-home-stat-label">Overdue</div>
                      <div className={`cc-home-stat-value ${overdueCreditCardGroupCount > 0 ? "is-danger" : ""}`}>
                        {overdueCreditCardGroupCount > 0
                          ? `${overdueCreditCardGroupCount} ${overdueCreditCardGroupCount === 1 ? "bank" : "banks"}`
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="cc-home-list">
                    {creditCardDueGroups.map((group) => {
                      const dueCountdown = getDueCountdownLabel(group.paymentDueDate);
                      const dueDate = getPaymentDueDateLabel(group.paymentDueDate);
                      const dueDays = getDaysUntil(group.paymentDueDate);
                      const dueTone = getDueTone(dueDays);
                      const dueColor = getDueToneColor(dueTone);
                      const bankMeta = getSingaporeBankByName(group.bankName);
                      const logo = getBankLogoUrl(bankMeta);
                      const logoKey = group.bankName ?? group.key;
                      return (
                        <div key={group.key} className={`cc-home-group cc-home-group-${dueTone}`}>
                          <div className="cc-home-group-head">
                            <div className="cc-home-bank">
                              {logo && !failedCreditCardBankLogos[logoKey] ? (
                                <img
                                  src={logo}
                                  alt={bankMeta?.name || "Bank"}
                                  className="cc-home-bank-logo"
                                  loading="lazy"
                                  onError={() => setFailedCreditCardBankLogos((prev) => ({ ...prev, [logoKey]: true }))}
                                />
                              ) : bankMeta ? (
                                <span className="cc-home-bank-fallback" style={{ backgroundColor: bankMeta.color }}>
                                  {bankMeta.short}
                                </span>
                              ) : (
                                <span className="cc-home-bank-fallback cc-home-bank-fallback-default">CC</span>
                              )}
                              <div className="cc-home-bank-copy">
                                <div className="cc-home-bank-name">{bankMeta?.name || group.bankName || "Credit Cards"}</div>
                                <div className="cc-home-bank-meta">
                                  {group.cards.length} {group.cards.length === 1 ? "card" : "cards"}
                                </div>
                                <div className="cc-home-bank-due">Due {dueDate}</div>
                              </div>
                            </div>
                            <div className="cc-home-group-total">
                              <div className="cc-home-total-amount">{formatCents(group.outstandingCents)}</div>
                              <div
                                className={`cc-home-due-badge cc-home-due-badge-${dueTone}`}
                                title={`Payment due ${dueDate}`}
                                style={{ color: dueColor }}
                              >
                                {dueCountdown}
                              </div>
                            </div>
                          </div>
                          <div className="cc-home-card-list">
                            {group.cards.map((card) => (
                              <div
                                key={`${card.cardId}:${card.statementYear}:${card.statementMonth}`}
                                className="cc-home-card-row"
                              >
                                <div className="cc-home-card-copy">
                                  <div className="cc-home-card-name">{card.cardName}</div>
                                  <div className="cc-home-card-statement">{getStatementLabel(card.statementMonth, card.statementYear)}</div>
                                </div>
                                <div className="cc-home-card-actions">
                                  <div className="cc-home-card-amount">{formatCents(card.outstandingCents)}</div>
                                  <button
                                    type="button"
                                    className="cc-home-view-statement"
                                    title={`View ${card.cardName} ${getStatementLabel(card.statementMonth, card.statementYear)} transactions`}
                                    aria-label={`View ${card.cardName} ${getStatementLabel(card.statementMonth, card.statementYear)} transactions`}
                                    onClick={() => goToCreditCardStatement(card)}
                                  >
                                    <svg className="eye-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: "14px", height: "14px" }}>
                                      <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                                      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon="💳"
                  title="No credit card transactions"
                  description="Add credit card transactions to track your spending and accounting."
                />
              )}
            </div>

            {/* Recent Transactions */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>🆕 Recent transactions</div>
                <button className="btn btn-ghost btn-xs" onClick={() => router.push("/transactions")}>
                  View all →
                </button>
              </div>

              <div>
                {filteredTransactions.slice(0, 10).map((tx) => (
                  <div key={tx.id} className="tx-item">
                    <div className="tx-icon">{getTxEmoji(tx.subject)}</div>
                    <div className="tx-meta" style={{ flex: 1, minWidth: 0 }}>
                      <div className="tx-name" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        {selectedBankFilterId === "ALL" && tx.budgetId && budgetById.get(tx.budgetId) ? (
                          <span aria-hidden="true">
                            {getBudgetIcon(
                              budgetById.get(tx.budgetId)?.name || "",
                              budgetById.get(tx.budgetId)?.icon,
                            )}
                          </span>
                        ) : null}
                        <span>{tx.subject}</span>
                      </div>
                      <div className="tx-date">
                        {new Date(tx.date).toLocaleDateString()} ·{" "}
                        {(tx.budgetId && budgetNameById.get(tx.budgetId)) || "Unassigned"}
                      </div>
                    </div>
                    <div className={`tx-amount ${getAmountToneClass(tx.direction === "DEBIT" ? -tx.amountCents : tx.amountCents)}`}>
                      {tx.direction === "DEBIT" ? "−" : "+"}
                      {formatCents(tx.amountCents)}
                    </div>
                  </div>
                ))}
                {transactionsQuery.isLoading && <SkeletonList count={3} type="transaction" />}
                {!transactionsQuery.isLoading && !filteredTransactions.length && (
                  <EmptyState
                    icon="📑"
                    title="No transactions yet"
                    description="Add your first transaction to start tracking your spending."
                  />
                )}
              </div>
            </div>
          </div>

        </div>

        {createBudgetOpen && (
          <div className="profile-modal-overlay" onClick={() => setCreateBudgetOpen(false)}>
            <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
              <div className="profile-modal-head">
                <h3>New Sub-Account</h3>
                <button className="profile-modal-close" onClick={() => setCreateBudgetOpen(false)}>
                  ✕
                </button>
              </div>
              <div className="profile-modal-body">
                <form onSubmit={onCreateBudget} className="profile-field" style={{ display: "grid", gap: "10px" }}>
                  <span>Name</span>
                  <input
                    className="input"
                    placeholder="Sub-account name"
                    value={budgetName}
                    onChange={(e) => setBudgetName(e.target.value)}
                  />
                  <span>Bank account</span>
                  <select className="input" value={budgetAccountId} onChange={(e) => setBudgetAccountId(e.target.value)}>
                    <option value="" disabled>
                      Select bank account
                    </option>
                    {bankAccountsQuery.data?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <span>Monthly limit (optional)</span>
                  <NumericCalculatorInput
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={budgetTarget}
                    onValueChange={setBudgetTarget}
                  />
                  <div className="profile-actions">
                    <button className="btn btn-ghost btn-xs" type="button" onClick={() => setCreateBudgetOpen(false)}>
                      Cancel
                    </button>
                    <button className="btn btn-primary btn-xs" type="submit" disabled={createBudget.isPending}>
                      {createBudget.isPending ? "Creating..." : "Create"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {editingBudgetId && (
          <div className="profile-modal-overlay" onClick={() => setEditingBudgetId(null)}>
            <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
              <div className="profile-modal-head">
                <h3>Edit Account</h3>
                <button className="profile-modal-close" onClick={() => setEditingBudgetId(null)}>
                  ✕
                </button>
              </div>
              <div className="profile-modal-body">
                <div className="profile-field">
                  <span>Name</span>
                  <input className="input" value={editingBudgetName} onChange={(e) => setEditingBudgetName(e.target.value)} />
                </div>
                <div className="profile-field">
                  <span>Monthly limit (optional)</span>
                  <NumericCalculatorInput
                    min="0"
                    step="0.01"
                    value={editingBudgetTarget}
                    onValueChange={setEditingBudgetTarget}
                  />
                </div>
                <label className="profile-field" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={editingBudgetIsSavings}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setEditingBudgetIsSavings(checked);
                      if (checked) {
                        setEditingBudgetIcon("🛡️");
                      }
                    }}
                  />
                  <span>Is this a savings sub-account?</span>
                </label>
                <div className="profile-field">
                  <span>Icon</span>
                  <div className="icon-picker">
                    {budgetIconOptions.map((icon) => (
                      <button
                        key={icon}
                        className={`icon-chip${editingBudgetIcon === icon ? " on" : ""}`}
                        onClick={() => {
                          setEditingBudgetIcon(icon);
                          setEditingBudgetIsSavings(icon === "🛡️");
                        }}
                        type="button"
                        aria-label={`Use ${icon} icon`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="profile-actions">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      if (editingBudgetId) confirmDeleteBudget(editingBudgetId);
                    }}
                    disabled={deleteBudget.isPending}
                  >
                    Delete
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setEditingBudgetId(null);
                      setEditingBudgetIcon("");
                    }}
                  >
                    Cancel
                  </button>
                  <button className="btn btn-primary btn-xs" onClick={saveBudgetEdit} disabled={updateBudget.isPending}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {editingBankAccount && (
          <div className="profile-modal-overlay txn-contained-modal-overlay" onClick={closeEditBankBalance}>
            <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
              <div className="profile-modal-head">
                <h3>Edit Bank Balance</h3>
                <button className="profile-modal-close" onClick={closeEditBankBalance}>✕</button>
              </div>
              <form className="profile-modal-body txn-bank-balance-form" onSubmit={onSubmitBankBalance}>
                <div className="profile-field">
                  <span>Bank Account</span>
                  <strong>{editingBankAccount.name}</strong>
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
                <div className="profile-actions">
                  <button type="button" className="btn btn-ghost" onClick={closeEditBankBalance}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={updateBankBalance.isPending}>
                    {updateBankBalance.isPending ? "Saving..." : "Save Balance"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* Toast Stack */}
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
