"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "./app-sidebar";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";

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
};

type AppContext = {
  workspaceId: string | null;
  defaultAccountId: string | null;
  defaultUserId: string | null;
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

type Toast = {
  id: string;
  kind: "success" | "error" | "info";
  message: string;
};

function formatCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

function formatCentsShort(value: number) {
  const dollars = value / 100;
  if (dollars >= 1000) {
    return `$${(dollars / 1000).toFixed(1)}k`;
  }
  return `$${dollars.toFixed(dollars % 1 === 0 ? 0 : 2)}`;
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
  "💰", "🏠", "🛡️", "✈️", "🍔", "🚌", "🛍️", "💪", "💊", "🎬", "💡", "📚", "📈", "🚗", "📱", "🎯",
  "🧾", "🏦", "💳", "🧮", "👶", "🎓", "🐶", "🎁", "🛠️", "💼", "🏥", "🚴", "🍜", "☕",
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

export function DashboardShell({
  userName,
  userEmail,
}: {
  userName: string;
  userEmail: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(userName);
  const [budgetName, setBudgetName] = useState("");
  const [budgetTarget, setBudgetTarget] = useState("");
  const [budgetAccountId, setBudgetAccountId] = useState("");
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
  const [editingBudgetTarget, setEditingBudgetTarget] = useState("");
  const [editingReceivableId, setEditingReceivableId] = useState<string | null>(null);
  const [editingReceivableTitle, setEditingReceivableTitle] = useState("");
  const [editingReceivableAmount, setEditingReceivableAmount] = useState("");
  const [selectedBankFilterId, setSelectedBankFilterId] = useState<string>("ALL");
  const [failedBankLogos, setFailedBankLogos] = useState<Record<string, boolean>>({});
  const [bankFilterHydrated, setBankFilterHydrated] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const contextQuery = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: getSummary,
  });

  const workspaceId = contextQuery.data?.workspaceId;
  const defaultUserId = contextQuery.data?.defaultUserId;
  const dashboardBankStorageKey = workspaceId ? `nest:selectedBank:${workspaceId}` : null;

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
  const firstBankAccountId = bankAccountsQuery.data?.[0]?.id;

  const refreshAll = useMemo(
    () => () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] }),
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
    onSuccess: () => pushToast("success", "Budget created."),
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

  const deleteTransaction = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/transactions/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: transactionsKey });
      const previousTransactions = queryClient.getQueryData<Transaction[]>(transactionsKey);
      queryClient.setQueryData<Transaction[]>(transactionsKey, (old) => (old ?? []).filter((t) => t.id !== id));
      return { previousTransactions };
    },
    onError: (_, __, context) => {
      if (context?.previousTransactions) {
        queryClient.setQueryData(transactionsKey, context.previousTransactions);
      }
      pushToast("error", "Transaction delete failed.");
    },
    onSuccess: () => pushToast("success", "Transaction deleted."),
    onSettled: refreshAll,
  });

  const onCreateBudget = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !budgetAccountId || !defaultUserId || !budgetName.trim()) return;
    const parsedTarget = budgetTarget.trim() ? Number(budgetTarget) : 0;
    if (Number.isNaN(parsedTarget) || parsedTarget < 0) return;
    createBudget.mutate({ name: budgetName.trim(), targetCents: Math.round(parsedTarget * 100), accountId: budgetAccountId });
    setBudgetName("");
    setBudgetTarget("");
    setBudgetAccountId("");
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
    setEditingBudgetId(budget.id);
    setEditingBudgetName(budget.name);
    setEditingBudgetIcon(getBudgetIcon(budget.name, budget.icon));
    setEditingBudgetTarget(String((budget.targetCents / 100).toFixed(2)));
  };

  const saveBudgetEdit = () => {
    if (!editingBudgetId || !editingBudgetName.trim()) return;
    const parsedTarget = editingBudgetTarget.trim() ? Number(editingBudgetTarget) : 0;
    if (Number.isNaN(parsedTarget) || parsedTarget < 0) return;
    updateBudget.mutate({
      id: editingBudgetId,
      name: editingBudgetName.trim(),
      icon: editingBudgetIcon || undefined,
      targetCents: Math.round(parsedTarget * 100),
    });
    setEditingBudgetId(null);
    setEditingBudgetName("");
    setEditingBudgetIcon("");
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
  const budgetNameById = useMemo(
    () => new Map((budgetsQuery.data ?? []).map((b) => [b.id, b.name])),
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
  const now = new Date();
  const spentThisMonth = filteredTransactions
    .filter((t) => t.direction === "DEBIT")
    .filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, t) => sum + t.amountCents, 0);

  const pendingReceivables = receivablesQuery.data?.filter((r) => r.status === "OPEN") || [];
  const pendingAmount = pendingReceivables.reduce((sum, r) => sum + r.amountCents, 0);

  useEffect(() => {
    if (!dashboardBankStorageKey || typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(dashboardBankStorageKey);
    if (saved) {
      setSelectedBankFilterId(saved);
    }
    setBankFilterHydrated(true);
  }, [dashboardBankStorageKey]);

  useEffect(() => {
    if (!dashboardBankStorageKey || typeof window === "undefined" || !bankFilterHydrated) return;
    window.sessionStorage.setItem(dashboardBankStorageKey, selectedBankFilterId);
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

  return (
    <div className="app-shell">
      <AppSidebar
        userName={displayName}
        userEmail={userEmail}
        onDisplayNameUpdated={setDisplayName}
        currentPath="/"
        badgeCounts={{
          budgets: summary.budgets.length,
          receivables: pendingReceivables.length,
        }}
        sidebarOpen={sidebarOpen}
        onSidebarChange={setSidebarOpen}
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
          <div className="card" style={{ marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Bank Accounts</div>
            <div className="account-cards-grid">
              <div
                className="budget-mini budget-mini-compact"
                onClick={() => setSelectedBankFilterId("ALL")}
                style={{
                  borderColor: selectedBankFilterId === "ALL" ? "var(--brand-500)" : undefined,
                  boxShadow: selectedBankFilterId === "ALL" ? "var(--shadow-sm)" : undefined,
                }}
              >
                <div className="bm-name">All banks</div>
                <div className="bm-amount">{formatCents(summary.totalBalanceCents)}</div>
              </div>
              {bankAccountsQuery.data?.map((bank) => (
                <div
                  key={bank.id}
                  className="budget-mini budget-mini-compact"
                  onClick={() => setSelectedBankFilterId(bank.id)}
                  style={{
                    borderColor: selectedBankFilterId === bank.id ? "var(--brand-500)" : undefined,
                    boxShadow: selectedBankFilterId === bank.id ? "var(--shadow-sm)" : undefined,
                  }}
                >
                  <div className="bm-name" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {(() => {
                      const bankMeta = getSingaporeBankByName(bank.bankName || bank.name);
                      const logo = getBankLogoUrl(bankMeta);
                      return logo && !failedBankLogos[bank.id] ? (
                        <img
                          src={logo}
                          alt={bankMeta?.name || "Bank"}
                          className="bank-logo-img"
                          loading="lazy"
                          onError={() => setFailedBankLogos((prev) => ({ ...prev, [bank.id]: true }))}
                        />
                      ) : bankMeta ? (
                        <span className="bank-icon" style={{ backgroundColor: bankMeta.color }}>
                          {bankMeta.short}
                        </span>
                      ) : (
                        <span className="bank-icon bank-icon-default">BNK</span>
                      );
                    })()}
                    <span>{bank.name}</span>
                  </div>
                  <div className="bm-amount">{formatCents(bank.currentBalanceCents)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hero Card */}
          <div className="hero-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 2 }}>
              <div>
                <div className="hero-label">Total Allocated</div>
                <div className="hero-amount">{isLoading ? "Loading..." : formatCents(totalBudgeted)}</div>
                <div className="hero-sub">Across {filteredBudgets.length} budget accounts</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "10px", opacity: 0.55, marginBottom: "3px" }}>Available in bank</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700 }}>
                  {isLoading ? "—" : formatCents(filteredBankBalance)}
                </div>
                <div style={{ fontSize: "10px", opacity: 0.55, marginTop: "2px" }}>
                  {isLoading ? "—" : formatCents(freeAmount)} free
                </div>
              </div>
            </div>

            {filteredBudgets.length > 0 && (
              <div className="hero-chips">
                {filteredBudgets.slice(0, 5).map((budget) => (
                  <div key={budget.id} className="hero-chip">
                    <div className="hero-chip-label">{getBudgetIcon(budget.name, budget.icon)} {budget.name}</div>
                    <div className="hero-chip-value">{formatCentsShort(budget.availableCents)}</div>
                  </div>
                ))}
                {filteredBudgets.length > 5 && (
                  <div className="hero-chip">
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

          {/* Stat Cards */}
          <div className="grid-4" style={{ marginBottom: "14px" }}>
            <div className="stat-card">
              <div className="stat-label">Spent this month</div>
              <div className="stat-value">
                {formatCentsShort(spentThisMonth)}
              </div>
              <div className="stat-sub">
                <span className="positive">&nbsp;</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-label">CC balance due</div>
              <div className="stat-value">$0</div>
              <div className="stat-sub">
                No cards <span className="warning">linked</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Receivables</div>
              <div className="stat-value">{formatCentsShort(pendingAmount)}</div>
              <div className="stat-sub">
                <span className="positive">{pendingReceivables.length} pending</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Sub-accounts</div>
              <div className="stat-value">{filteredBudgets.length}</div>
              <div className="stat-sub">
                <span className="positive">Active</span>
              </div>
            </div>
          </div>

          {/* Two Column Layout */}
          <div className="grid-2">
            {/* Spending Breakdown */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>Sub-Accounts Overview</div>
                <div className="segmented">
                  <button className="segmented-btn on">Month</button>
                  <button className="segmented-btn">Year</button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                <div className="ring-wrap">
                  <svg width="110" height="110" viewBox="0 0 110 110">
                    <circle cx="55" cy="55" r="44" fill="none" stroke="var(--bg-subtle)" strokeWidth="12" />
                    {filteredBudgets.length > 0 && (
                      <>
                        <circle
                          cx="55"
                          cy="55"
                          r="44"
                          fill="none"
                          stroke="#3AADA6"
                          strokeWidth="12"
                          strokeDasharray={`${Math.min(filteredBudgets[0]?.availableCents || 0, 27632) / 1000 * 14} 276`}
                          strokeDashoffset="0"
                          strokeLinecap="round"
                        />
                        {filteredBudgets[1] && (
                          <circle
                            cx="55"
                            cy="55"
                            r="44"
                            fill="none"
                            stroke="#8CC832"
                            strokeWidth="12"
                            strokeDasharray={`${Math.min(filteredBudgets[1]?.availableCents || 0, 27632) / 1000 * 10} 276`}
                            strokeDashoffset={`-${Math.min(filteredBudgets[0]?.availableCents || 0, 27632) / 1000 * 14}`}
                            strokeLinecap="round"
                          />
                        )}
                      </>
                    )}
                  </svg>
                  <div className="ring-center">
                    <div className="ring-value">{filteredBudgets.length}</div>
                    <div className="ring-label">accounts</div>
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  {filteredBudgets.slice(0, 5).map((budget, i) => {
                    const colors = ["#3AADA6", "#8CC832", "#F0926A", "#D97706", "var(--border-default)"];
                    const pct = budget.targetCents > 0 ? Math.round((budget.availableCents / budget.targetCents) * 100) : 0;
                    return (
                      <div className="legend" key={budget.id}>
                        <div className="legend-dot" style={{ background: colors[i % colors.length] }} />
                        <div className="legend-name">{budget.name}</div>
                        <div className="legend-value">{formatCents(budget.availableCents)}</div>
                      </div>
                    );
                  })}
                  {!filteredBudgets.length && <p style={{ color: "var(--text-tertiary)", fontSize: "13px" }}>No budgets yet.</p>}
                </div>
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>Recent transactions</div>
                <button className="btn btn-ghost btn-xs">View all →</button>
              </div>

              <div>
                {filteredTransactions.slice(0, 5).map((tx) => (
                  <div key={tx.id} className="tx-item">
                    <div className="tx-icon">{getTxEmoji(tx.subject)}</div>
                    <div className="tx-meta">
                      <div className="tx-name">{tx.subject}</div>
                      <div className="tx-date">
                        {new Date(tx.date).toLocaleDateString()} ·{" "}
                        {(tx.budgetId && budgetNameById.get(tx.budgetId)) || "Unassigned"}
                      </div>
                    </div>
                    <div>
                      <div className={`tx-amount ${tx.direction === "DEBIT" ? "negative" : "positive"}`}>
                        {tx.direction === "DEBIT" ? "−" : "+"}
                        {formatCents(tx.amountCents)}
                      </div>
                    </div>
                  </div>
                ))}
                {!filteredTransactions.length && (
                  <p style={{ color: "var(--text-tertiary)", fontSize: "13px", padding: "20px 0" }}>No transactions yet.</p>
                )}
              </div>
            </div>
          </div>

          {/* Budget Accounts Grid */}
          <div className="card" style={{ marginTop: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600 }}>Sub-Accounts</div>
              <span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                {formatCents(totalBudgeted)} / {formatCents(filteredBankBalance)}
              </span>
            </div>

            <div className="account-cards-grid" style={{ marginBottom: "12px" }}>
              {filteredBudgets.map((budget) => {
                const hasMonthlyLimit = budget.targetCents > 0;
                const outgoingCents = budget.monthlyOutgoingCents ?? 0;
                const pct = hasMonthlyLimit ? Math.min((outgoingCents / budget.targetCents) * 100, 100) : 0;
                const isOver = outgoingCents > budget.targetCents && budget.targetCents > 0;
                const isNear = pct >= 80 && !isOver;

                let badgeClass = "badge-ok";
                let badgeText = "";
                if (isOver) {
                  badgeClass = "badge-err";
                  badgeText = "Over!";
                } else if (isNear) {
                  badgeClass = "badge-warn";
                  badgeText = "Near limit";
                }

                return (
                  <div key={budget.id} className="budget-mini budget-mini-compact">
                    <div className="bm-top">
                      <div className="bm-icon">{getBudgetIcon(budget.name, budget.icon)}</div>
                      <div className="bm-top-right">
                        <button
                          className="bm-edit-btn"
                          onClick={() => startBudgetEdit(budget)}
                          title="Edit account"
                          aria-label={`Edit ${budget.name}`}
                        >
                          ✏
                        </button>
                        {badgeText ? (
                          <span className={`badge ${badgeClass}`}>
                            {isNear && <span className="badge-dot" />}
                            {badgeText}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="bm-name">{budget.name}</div>
                    <div className="bm-amount">
                      {hasMonthlyLimit ? formatCents(outgoingCents) : formatCents(budget.availableCents)}
                    </div>
                    {hasMonthlyLimit ? (
                      <>
                        <div className="bm-target">Monthly limit {formatCents(budget.targetCents)}</div>
                        <div className="bm-target">Outgoing this month {formatCents(outgoingCents)}</div>
                      </>
                    ) : null}
                    {hasMonthlyLimit && (
                      <div className="prog-track">
                        <div
                          className={`prog-bar ${isNear ? "prog-bar-warn" : ""} ${isOver ? "prog-bar-err" : ""}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                    {hasMonthlyLimit ? (
                      <div className="bm-foot">
                        <span>{`${Math.round(pct)}% used`}</span>
                        <span>
                          {isOver
                            ? `${formatCents(outgoingCents - budget.targetCents)} over`
                            : `${formatCents(budget.targetCents - outgoingCents)} to go`}
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Add Budget Form */}
            <form className="crud-form" onSubmit={onCreateBudget}>
              <input
                className="input"
                placeholder="Sub-account name"
                value={budgetName}
                onChange={(e) => setBudgetName(e.target.value)}
              />
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
              <input
                className="input"
                placeholder="Monthly limit (optional)"
                type="number"
                min="0"
                step="0.01"
                value={budgetTarget}
                onChange={(e) => setBudgetTarget(e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={createBudget.isPending}>
                + New account
              </button>
            </form>
          </div>

        </div>

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
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={editingBudgetTarget}
                    onChange={(e) => setEditingBudgetTarget(e.target.value)}
                  />
                </div>
                <div className="profile-field">
                  <span>Icon</span>
                  <div className="icon-picker">
                    {budgetIconOptions.map((icon) => (
                      <button
                        key={icon}
                        className={`icon-chip${editingBudgetIcon === icon ? " on" : ""}`}
                        onClick={() => setEditingBudgetIcon(icon)}
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
                      if (editingBudgetId) deleteBudget.mutate(editingBudgetId);
                      setEditingBudgetId(null);
                      setEditingBudgetIcon("");
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
