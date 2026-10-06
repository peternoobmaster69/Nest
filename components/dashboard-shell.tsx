"use client";

import { apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SubmitEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CreditCard,
  LayoutGrid,
  Plus,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { normalizeCurrency } from "@/lib/currency";
import { useMoneyFormat } from "@/lib/use-money-format";
import { getBrowserCookie, setBrowserCookie } from "@/lib/browser-cookies";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { SavingsSubAccountCheckbox } from "@/components/savings-sub-account-checkbox";
import { AppShell } from "./app-shell";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { EmptyState } from "@/components/ui-skeleton";
import {
  DashboardOverviewSkeleton,
  DashboardRecentTransactionsSkeleton,
} from "@/components/skeletons/DashboardSkeleton";
import { useToast } from "@/components/toast-provider";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { buildCreditCardStatementPath, buildWorkspacePath } from "@/lib/workspace-entry";
import { getLatestInvestmentEntry } from "@/lib/investment-entry-order";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { DashboardTransactionRow } from "@/components/dashboard/dashboard-transaction-row";
import { bankAccountsQueryOptions, type BankAccount } from "@/lib/accounts";
import { confirmMoneyChange } from "@/lib/confirm-destructive";

const CashFlowChart = dynamic(
  () => import("@/components/dashboard/cash-flow-chart").then((module) => module.CashFlowChart),
  { ssr: false, loading: () => <div className="cash-flow-chart-loading skeleton" aria-hidden="true" /> },
);

type CashFlowPoint = import("@/components/dashboard/cash-flow-chart").CashFlowPoint;

const ALL_BANKS_FILTER = "ALL";
const RECENT_TRANSACTION_LIMIT = 5;
const DASHBOARD_SUBACCOUNT_SHORTCUT_LIMIT = 10;
const CASH_FLOW_ALL_ACCOUNTS = "ALL";

type CashFlowAccountMonth = {
  inflowCents: number;
  outflowCents: number;
  netCents: number;
};

type CashFlowMonth = CashFlowAccountMonth & {
  key: string;
  label: string;
  accounts: Record<string, CashFlowAccountMonth>;
  budgets: Record<string, CashFlowAccountMonth>;
};


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
    isSavings: boolean;
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
  cashFlow: CashFlowMonth[];
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
  role?: "OWNER" | "EDITOR" | "VIEWER";
  setupProgress?: {
    bankAccountCount: number;
    subAccountCount: number;
    creditCardCount: number;
  };
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
  isSavings: boolean;
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

type TransactionsSummaryResponse = {
  transactions: Transaction[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

type Receivable = {
  status: string;
};

type InvestmentAccountSummary = {
  id: string;
  entries: Array<{
    id: string;
    date: string;
    createdAt: string;
    investedCents: number;
    currentValueCents: number;
  }>;
};

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

async function getSummary(): Promise<DashboardSummary> {
  return fetchJson<DashboardSummary>("/api/dashboard/summary", { cache: "no-cache" });
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
}: Readonly<{
  userName: string;
  userEmail: string;
  userImage?: string | null;
}>) {
  const routeWorkspaceId = useWorkspaceId();
  const workspaceHref = useCallback(
    (path: string) => routeWorkspaceId ? buildWorkspacePath(routeWorkspaceId, path) : path,
    [routeWorkspaceId],
  );
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const displayName = userName;
  const [budgetName, setBudgetName] = useState("");
  const [budgetTarget, setBudgetTarget] = useState("");
  const [budgetAccountId, setBudgetAccountId] = useState("");
  const [budgetIsSavings, setBudgetIsSavings] = useState(false);
  const [createBudgetOpen, setCreateBudgetOpen] = useState(false);
  const [selectedBankFilterId, setSelectedBankFilterId] = useState<string>(ALL_BANKS_FILTER);
  const [selectedCashFlowAccountId, setSelectedCashFlowAccountId] = useState<string>(CASH_FLOW_ALL_ACCOUNTS);
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const [failedBankLogos, setFailedBankLogos] = useState<Record<string, boolean>>({});
  const [failedCreditCardBankLogos, setFailedCreditCardBankLogos] = useState<Record<string, boolean>>({});
  const [bankFilterHydrated, setBankFilterHydrated] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccount | null>(null);
  const [editBankBalance, setEditBankBalance] = useState("");
  const bankPickerRef = useRef<HTMLDivElement | null>(null);

  const contextQuery = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  const workspaceId = contextQuery.data?.workspaceId;
  const isContextLoading = contextQuery.isLoading && !contextQuery.data;

  const { data, isLoading, isPending } = useQuery({
    queryKey: queryKeys.key(["dashboard-summary", workspaceId]),
    queryFn: getSummary,
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });

  const isDataReady = !isPending && data !== undefined;

  const baseCurrency = normalizeCurrency(contextQuery.data?.baseCurrency);
  const { format: formatCents, formatShort: formatCentsShort } = useMoneyFormat(baseCurrency);
  const defaultUserId = contextQuery.data?.defaultUserId;
  const dashboardBankStorageKey = workspaceId ? `nest:selectedBank:${workspaceId}` : null;
  const sidebarMoneyPages = contextQuery.data?.sidebarMoneyPages;
  const showCreditCardDashboardSection =
    sidebarMoneyPages?.creditCards !== false || sidebarMoneyPages?.creditTransactions !== false;
  const creditCardDueGroups = useMemo(
    () => getCreditCardDueGroups(data?.creditCardSummary?.nextDueCards ?? []),
    [data?.creditCardSummary?.nextDueCards],
  );
  const budgetsQuery = useQuery({
    queryKey: queryKeys.key(["budgets", workspaceId]),
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const bankAccountsQuery = useQuery(bankAccountsQueryOptions(workspaceId));
  const bankAccountOptions = useMemo(() => bankAccountsQuery.data ?? [], [bankAccountsQuery.data]);
  const hasMultipleBankAccounts = bankAccountOptions.length > 1;
  const effectiveSelectedBankFilterId =
    bankAccountOptions.length === 1 ? bankAccountOptions[0].id : selectedBankFilterId;

  const transactionsQuery = useQuery({
    queryKey: queryKeys.key(["transactions", workspaceId, effectiveSelectedBankFilterId]),
    queryFn: () => {
      const params = new URLSearchParams({
        workspaceId: workspaceId ?? "",
        paginated: "1",
        limit: String(RECENT_TRANSACTION_LIMIT),
      });
      if (effectiveSelectedBankFilterId !== "ALL") {
        params.set("accountId", effectiveSelectedBankFilterId);
      }
      return fetchJson<TransactionsSummaryResponse>(`/api/transactions?${params.toString()}`);
    },
    enabled: Boolean(workspaceId),
  });

  const receivablesQuery = useQuery({
    queryKey: queryKeys.key(["receivables", workspaceId]),
    queryFn: () => fetchJson<Receivable[]>(`/api/receivables?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const investmentsQuery = useQuery({
    queryKey: queryKeys.key(["investments", workspaceId]),
    queryFn: () => fetchJson<InvestmentAccountSummary[]>(`/api/investments?workspaceId=${workspaceId}`, { cache: "no-store" }),
    enabled: Boolean(workspaceId),
  });
  const updateBankBalance = useMutation({
    mutationFn: ({ id, startingCents, expectedUpdatedAt }: { id: string; startingCents: number; expectedUpdatedAt: string }) =>
      fetchJson(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `account-balance:${id}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ startingCents, expectedUpdatedAt }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary", workspaceId]) });
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
        queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary", workspaceId]) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets", workspaceId]) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts", workspaceId]) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.cioOverview(workspaceId) }),
      ]),
    [queryClient, workspaceId]
  );

  const budgetsKey = ["budgets", workspaceId] as const;

  const pushToast = (kind: "success" | "error" | "info", message: string) => toast.notify(message, kind);

  const openEditBankBalance = (bank: BankAccount) => {
    setEditingBankAccount(bank);
    setEditBankBalance((bank.currentBalanceCents / 100).toFixed(2));
  };

  const closeEditBankBalance = () => {
    setEditingBankAccount(null);
    setEditBankBalance("");
  };

  const onSubmitBankBalance = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!editingBankAccount || !editBankBalance) return;
    const nextBalanceCents = Math.round(Number(editBankBalance) * 100);
    const confirmed = await confirmMoneyChange({
      title: "Confirm bank balance adjustment",
      message: "This changes the starting balance used to reconcile this bank account.",
      confirmLabel: "Update balance",
      workspace: { name: contextQuery.data?.workspaceName || "Current workspace", role: contextQuery.data?.role || "EDITOR" },
      details: [
        { label: "Source", value: editingBankAccount.name },
        { label: "Destination", value: "Account reconciliation balance" },
        { label: "Amount", value: formatCents(nextBalanceCents - editingBankAccount.currentBalanceCents) },
        { label: "Date", value: new Date().toLocaleDateString("en-SG") },
        { label: "Resulting account balance", value: formatCents(nextBalanceCents) },
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

  const createBudget = useMutation({
    mutationFn: (payload: { name: string; targetCents: number; accountId: string; icon?: string; isSavings: boolean }) =>
      fetchJson("/api/budgets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `budget-create:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          workspaceId,
          accountId: payload.accountId,
          name: payload.name,
          icon: payload.icon,
          targetCents: payload.targetCents,
          isSavings: payload.isSavings,
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
        isSavings: payload.isSavings,
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
      setBudgetIsSavings(false);
    },
    onSettled: refreshAll,
  });

  const onCreateBudget = (event: SubmitEvent) => {
    event.preventDefault();
    if (!workspaceId || !budgetAccountId || !defaultUserId || !budgetName.trim()) return;
    const parsedTarget = budgetTarget.trim() ? Number(budgetTarget) : 0;
    if (Number.isNaN(parsedTarget) || parsedTarget < 0) return;
    createBudget.mutate({
      name: budgetName.trim(),
      targetCents: Math.round(parsedTarget * 100),
      accountId: budgetAccountId,
      icon: budgetIsSavings ? "🛡️" : undefined,
      isSavings: budgetIsSavings,
    });
  };

  const summary = data ?? {
    totalBalanceCents: 0,
    bankDiscrepancies: [],
    budgets: [],
    recentTransactions: [],
    cashFlow: [],
  };
  const filteredBudgets = useMemo(
    () =>
      (budgetsQuery.data ?? []).filter((b) => effectiveSelectedBankFilterId === "ALL" || b.accountId === effectiveSelectedBankFilterId),
    [budgetsQuery.data, effectiveSelectedBankFilterId],
  );
  const filteredTransactions = useMemo(
    () => transactionsQuery.data?.transactions ?? [],
    [transactionsQuery.data],
  );
  const goToTransactionsForSubAccount = useCallback((budgetId: string, accountId: string) => {
    const params = new URLSearchParams({
      budgetId,
      accountId,
    });
    router.push(workspaceHref(`/transactions?${params.toString()}`));
  }, [router, workspaceHref]);
  const goToCreditCardStatement = useCallback((card: CreditCardDueCard) => {
    router.push(workspaceHref(buildCreditCardStatementPath({
      cardId: card.cardId,
      statementMonth: card.statementMonth,
      statementYear: card.statementYear,
    })));
  }, [router, workspaceHref]);
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
      summary.bankDiscrepancies.filter((d) => effectiveSelectedBankFilterId === "ALL" || d.id === effectiveSelectedBankFilterId),
    [summary.bankDiscrepancies, effectiveSelectedBankFilterId],
  );
  const filteredBankBalance =
    effectiveSelectedBankFilterId === "ALL"
      ? summary.totalBalanceCents
      : bankAccountOptions.find((b) => b.id === effectiveSelectedBankFilterId)?.currentBalanceCents ?? 0;

  const totalBudgeted = useMemo(
    () => filteredBudgets.reduce((sum, b) => sum + b.availableCents, 0),
    [filteredBudgets],
  );
  const freeAmount = useMemo(
    () => Math.max(0, filteredBankBalance - totalBudgeted),
    [filteredBankBalance, totalBudgeted],
  );
  const recentTransactionRows = useMemo(
    () =>
      filteredTransactions.slice(0, RECENT_TRANSACTION_LIMIT).map((tx) => {
        const budget = tx.budgetId ? budgetById.get(tx.budgetId) : undefined;
        return {
          tx,
          showBudgetIcon: effectiveSelectedBankFilterId === "ALL" && Boolean(budget),
          budgetIcon: budget ? getBudgetIcon(budget.name, budget.icon) : null,
          budgetName: (tx.budgetId && budgetNameById.get(tx.budgetId)) || "Unassigned",
          amountClassName: getAmountToneClass(tx.direction === "DEBIT" ? -tx.amountCents : tx.amountCents),
          amountPrefix: tx.direction === "DEBIT" ? "−" : "+",
          formattedAmount: formatCents(tx.amountCents),
          formattedDate: new Date(tx.date).toLocaleDateString(),
        };
      }),
    [budgetById, budgetNameById, effectiveSelectedBankFilterId, filteredTransactions, formatCents],
  );
  const cashFlowAccountOptions = useMemo(
    () => [
      { id: CASH_FLOW_ALL_ACCOUNTS, name: "All sub-accounts" },
      ...filteredBudgets.map((budget) => ({ id: budget.id, name: budget.name })),
    ],
    [filteredBudgets],
  );
  useEffect(() => {
    if (
      selectedCashFlowAccountId !== CASH_FLOW_ALL_ACCOUNTS &&
      !cashFlowAccountOptions.some((account) => account.id === selectedCashFlowAccountId)
    ) {
      setSelectedCashFlowAccountId(CASH_FLOW_ALL_ACCOUNTS);
    }
  }, [cashFlowAccountOptions, selectedCashFlowAccountId]);
  const selectedCashFlowAccountName =
    cashFlowAccountOptions.find((account) => account.id === selectedCashFlowAccountId)?.name ?? "All sub-accounts";
  const cashFlowScopeName =
    effectiveSelectedBankFilterId === ALL_BANKS_FILTER
      ? "all accounts"
      : bankAccountOptions.find((account) => account.id === effectiveSelectedBankFilterId)?.name ?? "selected account";
  const cashFlowPoints = useMemo<CashFlowPoint[]>(
    () =>
      (summary.cashFlow ?? []).map((month) => {
        if (selectedCashFlowAccountId === CASH_FLOW_ALL_ACCOUNTS) {
          const accountMonth = effectiveSelectedBankFilterId === ALL_BANKS_FILTER
            ? month
            : month.accounts?.[effectiveSelectedBankFilterId] ?? {
                inflowCents: 0,
                outflowCents: 0,
                netCents: 0,
              };
          return {
            key: month.key,
            label: month.label,
            inflowCents: accountMonth.inflowCents,
            outflowCents: accountMonth.outflowCents,
            netCents: accountMonth.netCents,
          };
        }
        const budgetMonth = month.budgets?.[selectedCashFlowAccountId] ?? {
          inflowCents: 0,
          outflowCents: 0,
          netCents: 0,
        };
        return {
          key: month.key,
          label: month.label,
          inflowCents: budgetMonth.inflowCents,
          outflowCents: budgetMonth.outflowCents,
          netCents: budgetMonth.netCents,
        };
      }),
    [effectiveSelectedBankFilterId, selectedCashFlowAccountId, summary.cashFlow],
  );
  const hasCashFlowData = cashFlowPoints.some((point) => point.inflowCents > 0 || point.outflowCents > 0);

  const pendingReceivables = receivablesQuery.data?.filter((r) => r.status === "OPEN") || [];
  const investmentTotals = useMemo(() => {
    let invested = 0;
    let current = 0;
    for (const account of investmentsQuery.data ?? []) {
      const latest = getLatestInvestmentEntry(account.entries ?? []);
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
    .filter((budget) => budget.isSavings)
    .reduce((sum, budget) => sum + budget.availableCents, 0);
  const totalInvestmentsAndSavings = investmentTotals.current + totalSavings;
  const selectedBank =
    effectiveSelectedBankFilterId === "ALL"
      ? null
      : bankAccountOptions.find((bank) => bank.id === effectiveSelectedBankFilterId) ?? null;

  useEffect(() => {
    if (!dashboardBankStorageKey) return;
    const saved = getBrowserCookie(dashboardBankStorageKey);
    if (saved && saved !== ALL_BANKS_FILTER) {
      setSelectedBankFilterId(saved);
    } else {
      setSelectedBankFilterId(ALL_BANKS_FILTER);
    }
    setBankFilterHydrated(true);
  }, [dashboardBankStorageKey]);

  useEffect(() => {
    if (!dashboardBankStorageKey || !bankFilterHydrated) return;
    setBrowserCookie(dashboardBankStorageKey, selectedBankFilterId || ALL_BANKS_FILTER);
  }, [dashboardBankStorageKey, selectedBankFilterId, bankFilterHydrated]);

  useEffect(() => {
    if (!bankAccountOptions.length) return;
    if (bankAccountOptions.length === 1) {
      const onlyBankId = bankAccountOptions[0].id;
      if (selectedBankFilterId !== onlyBankId) setSelectedBankFilterId(onlyBankId);
      return;
    }
    if (selectedBankFilterId !== "ALL" && !bankAccountOptions.some((b) => b.id === selectedBankFilterId)) {
      setSelectedBankFilterId("ALL");
    }
  }, [bankAccountOptions, selectedBankFilterId]);

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
    <>
      <AppShell
        title="Dashboard"
        currentPath="/"
        userName={displayName}
        userEmail={userEmail}
        userImage={userImage}
        badgeCounts={{
          budgets: summary.budgets.length,
          receivables: pendingReceivables.length,
        }}
        contextData={contextQuery.data}
        contextLoading={isContextLoading}
        topbarTitle={<div className="tb-title">{getGreeting()}, {displayName.split(" ")[0]} 👋</div>}
      >
          {bankAccountsQuery.isLoading || !isDataReady ? (
            <DashboardOverviewSkeleton />
          ) : (
            <section className="dashboard-overview-card" aria-labelledby="dashboard-overview-title">
              <header className="dashboard-overview-header">
                <div className="dashboard-overview-bank">
                  {selectedBank ? (
                    (() => {
                      const bankMeta = getSingaporeBankByName(selectedBank.bankName || selectedBank.name);
                      const logo = getBankLogoUrl(bankMeta);
                      return logo && !failedBankLogos[selectedBank.id] ? (
                        <Image
                          src={logo}
                          alt={bankMeta?.name || "Bank"}
                          width={44}
                          height={28}
                          sizes="44px"
                          className={`bank-logo-img dashboard-overview-bank-logo ${bankMeta?.code === "DBS" ? "bank-logo-img-dbs" : ""}`}
                          loading="lazy"
                          onError={() => setFailedBankLogos((prev) => ({ ...prev, [selectedBank.id]: true }))}
                        />
                      ) : bankMeta ? (
                        <span className="bank-icon dashboard-overview-bank-icon" style={{ backgroundColor: bankMeta.color }}>
                          {bankMeta.short}
                        </span>
                      ) : (
                        <span className="bank-icon bank-icon-default dashboard-overview-bank-icon">BNK</span>
                      );
                    })()
                  ) : (
                    <span className="bank-icon bank-icon-default dashboard-overview-bank-icon">ALL</span>
                  )}
                  <div className="dashboard-overview-bank-copy">
                    <span>Viewing</span>
                    <strong>{selectedBank?.name ?? "All bank accounts"}</strong>
                  </div>
                </div>
                <div className="bank-selector-actions dashboard-overview-bank-actions" ref={bankPickerRef}>
                  {hasMultipleBankAccounts ? (
                    <Button
                      type="button"
                      className="bm-edit-btn tx-bank-action-btn"
                      onClick={() => setIsBankPickerOpen((open) => !open)}
                      aria-label="Choose bank"
                      aria-expanded={isBankPickerOpen}
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
                        className={`bank-selector-option${selectedBankFilterId === "ALL" ? " is-active" : ""}`}
                        onClick={() => {
                          setSelectedBankFilterId("ALL");
                          setIsBankPickerOpen(false);
                        }}
                      >
                        All banks
                      </Button>
                      {bankAccountOptions.map((bank) => (
                        <Button
                          key={bank.id}
                          type="button"
                          className={`bank-selector-option${selectedBankFilterId === bank.id ? " is-active" : ""}`}
                          onClick={() => {
                            setSelectedBankFilterId(bank.id);
                            setIsBankPickerOpen(false);
                          }}
                        >
                          {bank.name}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </header>

              <div className="dashboard-overview-main">
                <div>
                  <div className="dashboard-overview-eyebrow" id="dashboard-overview-title">Available bank balance</div>
                  <div className={`dashboard-overview-balance${filteredBankBalance < 0 ? " negative" : ""}`}>
                    {formatCents(filteredBankBalance)}
                  </div>
                  <p>{filteredBudgets.length} sub-account{filteredBudgets.length === 1 ? "" : "s"} in this view</p>
                </div>
                <div className="dashboard-overview-actions">
                  <Link href={workspaceHref("/transactions")} className="btn btn-primary btn-sm dashboard-overview-action">
                    <ReceiptText size={16} aria-hidden="true" /> Transactions <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                  <Button type="button" className="btn btn-ghost btn-sm dashboard-overview-action" onClick={() => { setBudgetIsSavings(false); setCreateBudgetOpen(true); }}>
                    <Plus size={16} aria-hidden="true" /> New sub-account
                  </Button>
                </div>
              </div>

              <div className={`dashboard-overview-metrics${freeAmount === 0 ? " has-zero-unallocated" : ""}`}>
                <article className="dashboard-overview-metric">
                  <span className="dashboard-overview-metric-icon"><LayoutGrid size={17} aria-hidden="true" /></span>
                  <div><span>Allocated</span><strong>{formatCents(totalBudgeted)}</strong><small>Across sub-accounts</small></div>
                </article>
                <article className="dashboard-overview-metric dashboard-overview-metric-unallocated">
                  <span className="dashboard-overview-metric-icon"><Wallet size={17} aria-hidden="true" /></span>
                  <div><span>Unallocated</span><strong>{formatCents(freeAmount)}</strong><small>Available to assign</small></div>
                </article>
                <article className="dashboard-overview-metric">
                  <span className="dashboard-overview-metric-icon"><TrendingUp size={17} aria-hidden="true" /></span>
                  <div>
                    <span>Net worth</span>
                    <strong>{formatCents(totalInvestmentsAndSavings)}</strong>
                    <small className={getAmountToneClass(investmentGain)}>
                      {investmentGain >= 0 ? "+" : "−"}{formatCents(Math.abs(investmentGain))} ({investmentGain >= 0 ? "+" : "−"}{Math.abs(investmentGainPct).toFixed(2)}%)
                    </small>
                  </div>
                </article>
              </div>

              {filteredBudgets.length > 0 ? (
                <div className="dashboard-overview-accounts" aria-label="Sub-account shortcuts">
                  {filteredBudgets.slice(0, DASHBOARD_SUBACCOUNT_SHORTCUT_LIMIT).map((budget) => (
                    <Button
                      key={budget.id}
                      type="button"
                      className="dashboard-overview-account"
                      onClick={() => goToTransactionsForSubAccount(budget.id, budget.accountId ?? "")}
                    >
                      <span className={`dashboard-overview-account-dot${budget.availableCents < 0 ? " is-negative" : ""}`} aria-hidden="true" />
                      <span>{budget.name}</span>
                      <strong>{formatCentsShort(budget.availableCents)}</strong>
                    </Button>
                  ))}
                  {filteredBudgets.length > DASHBOARD_SUBACCOUNT_SHORTCUT_LIMIT ? (
                    <Link href={workspaceHref("/transactions")} className="dashboard-overview-account dashboard-overview-account-more">
                      +{filteredBudgets.length - DASHBOARD_SUBACCOUNT_SHORTCUT_LIMIT} more
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </section>
          )}

          {filteredBankDiscrepancies.length > 0 && (
            <div className="dashboard-reconciliation-list" aria-label="Balances needing attention">
              {filteredBankDiscrepancies.map((discrepancy) => {
                const bank = bankAccountOptions.find((account) => account.id === discrepancy.id);
                const discrepancyAmount = formatCents(Math.abs(discrepancy.discrepancyCents));
                const discrepancyLabel = discrepancy.discrepancyCents > 0
                  ? `${discrepancyAmount} unallocated`
                  : `${discrepancyAmount} over-allocated`;
                const discrepancyDescription = discrepancy.discrepancyCents > 0
                  ? `${discrepancy.name} has funds not represented in sub-accounts.`
                  : `${discrepancy.name} sub-accounts exceed its bank balance.`;

                return (
                  <div key={discrepancy.id} className="tx-reconciliation dashboard-reconciliation" role="status">
                    <div className="tx-reconciliation-status">
                      <span className="tx-reconciliation-icon" aria-hidden="true"><AlertTriangle size={15} /></span>
                      <div className="tx-reconciliation-copy">
                        <strong>{discrepancyLabel}</strong>
                        <span>{discrepancyDescription}</span>
                      </div>
                    </div>

                    <dl className="tx-reconciliation-values">
                      <div>
                        <dt>Bank</dt>
                        <dd>{formatCents(discrepancy.currentBalanceCents)}</dd>
                      </div>
                      <div>
                        <dt>Sub-accounts</dt>
                        <dd>{formatCents(discrepancy.linkedBudgetTotalCents)}</dd>
                      </div>
                    </dl>

                    <div className="tx-reconciliation-actions">
                      {bank ? (
                        <Button
                          type="button"
                          className="btn btn-ghost btn-xs tx-reconciliation-action"
                          onClick={() => openEditBankBalance(bank)}
                        >
                          Edit bank
                        </Button>
                      ) : null}
                      <Link
                        href={workspaceHref(`/transactions?accountId=${discrepancy.id}`)}
                        className="btn btn-primary btn-xs tx-reconciliation-action"
                      >
                        Review <ArrowRight size={13} aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className={`dashboard-home-grid${showCreditCardDashboardSection ? "" : " dashboard-home-grid-no-credit"}`}>
            <div className="dashboard-home-main-stack">
              <section className="card cash-flow-card dashboard-cash-flow-panel" aria-labelledby="dashboard-cash-flow-title">
              <div className="cash-flow-head">
                <div>
                  <div className="cash-flow-title" id="dashboard-cash-flow-title">
                    <span className="dashboard-section-title-icon" aria-hidden="true"><TrendingUp size={16} /></span>
                    <span>Cash flow</span>
                  </div>
                  <div className="cash-flow-subtitle">{selectedCashFlowAccountName} in {cashFlowScopeName} - last 12 months</div>
                </div>
                <div className="cash-flow-legend" aria-label="Cash flow legend">
                  <span><span className="cash-flow-dot cash-flow-dot-in" />In</span>
                  <span><span className="cash-flow-dot cash-flow-dot-out" />Out</span>
                  <span><span className="cash-flow-dot cash-flow-dot-net" />Net</span>
                </div>
              </div>

              <div className="cash-flow-pills" aria-label="Cash flow account filter">
                {cashFlowAccountOptions.map((account) => (
                  <Button
                    key={account.id}
                    type="button"
                    className={`cash-flow-pill${selectedCashFlowAccountId === account.id ? " active" : ""}`}
                    onClick={() => setSelectedCashFlowAccountId(account.id)}
                  >
                    {account.name}
                  </Button>
                ))}
              </div>

              {isLoading || !isDataReady ? (
                <div className="cash-flow-chart-skeleton skeleton" />
              ) : hasCashFlowData ? (
                <CashFlowChart points={cashFlowPoints} formatShort={formatCentsShort} formatFull={formatCents} />
              ) : (
                <EmptyState
                  icon="$"
                  title="No cash flow yet"
                  description="Add income and expense transactions to see your monthly flow."
                />
              )}
            </section>

              {/* Recent Transactions */}
              <section className="card dashboard-recent-panel" aria-labelledby="dashboard-recent-title">
                <div className="dashboard-section-header">
                  <div className="dashboard-section-title" id="dashboard-recent-title">
                    <span className="dashboard-section-title-icon" aria-hidden="true"><ReceiptText size={16} /></span>
                    <span>Recent transactions</span>
                  </div>
                  <Button className="btn btn-ghost btn-xs dashboard-section-action" onClick={() => router.push(workspaceHref("/transactions"))}>
                    <span>View all</span><ArrowRight size={14} aria-hidden="true" />
                  </Button>
                </div>

                <div>
                  {recentTransactionRows.map((row) => (
                    <DashboardTransactionRow key={row.tx.id} {...row} />
                  ))}
                  {transactionsQuery.isLoading && <DashboardRecentTransactionsSkeleton />}
                  {!transactionsQuery.isLoading && !filteredTransactions.length && (
                    <EmptyState
                      icon="📑"
                      title="No transactions yet"
                      description="Add your first transaction to start tracking your spending."
                    />
                  )}
                </div>
              </section>
            </div>

            {/* Credit Card Summary */}
            {showCreditCardDashboardSection ? (
              <section className="card cc-home-panel dashboard-payments-panel" aria-labelledby="dashboard-payments-title">
                <div className="cc-home-header">
                  <div className="cc-home-title">
                    <span className="dashboard-section-title-icon" aria-hidden="true"><CreditCard size={16} /></span>
                    <span id="dashboard-payments-title">Payments due</span>
                  </div>
                  <Button className="btn btn-ghost btn-xs dashboard-section-action" onClick={() => router.push(workspaceHref("/credit-transactions"))}>
                    <span>View all</span><ArrowRight size={14} aria-hidden="true" />
                  </Button>
                </div>

                {data?.creditCardSummary && creditCardDueGroups.length > 0 ? (
                  <>
                    <div className="cc-home-list">
                      {creditCardDueGroups.map((group) => {
                        const dueCountdown = getDueCountdownLabel(group.paymentDueDate);
                        const dueDate = getPaymentDueDateLabel(group.paymentDueDate);
                        const dueDays = getDaysUntil(group.paymentDueDate);
                        const dueTone = getDueTone(dueDays);
                        const dueColor = getDueToneColor(dueTone);
                        const showDueBadge = dueDays <= 20;
                        const bankMeta = getSingaporeBankByName(group.bankName);
                        const logo = getBankLogoUrl(bankMeta);
                        const logoKey = group.bankName ?? group.key;
                        return (
                          <div key={group.key} className={`cc-home-group cc-home-group-${dueTone}`}>
                            <div className="cc-home-group-head">
                              <div className="cc-home-bank">
                                {logo && !failedCreditCardBankLogos[logoKey] ? (
                                  <Image
                                    src={logo}
                                    alt={bankMeta?.name || "Bank"}
                                    width={34}
                                    height={34}
                                    sizes="34px"
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
                                {showDueBadge ? (
                                  <div
                                    className={`cc-home-due-badge cc-home-due-badge-${dueTone}`}
                                    title={`Payment due ${dueDate}`}
                                    style={{ color: dueColor }}
                                  >
                                    {dueCountdown}
                                  </div>
                                ) : null}
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
                                    <Button
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
                                    </Button>
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
              </section>
            ) : null}

          </div>

        {createBudgetOpen && (
          <Dialog open onClose={() => setCreateBudgetOpen(false)} title="Create sub-account" surface="custom" overlayClassName="profile-modal-overlay">
            <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
              <div className="profile-modal-head">
                <h3>New Sub-Account</h3>
                <ModalCloseButton onClick={() => setCreateBudgetOpen(false)} label="Close New Sub-Account" />
              </div>
              <form onSubmit={onCreateBudget} className="modal-form-shell">
                <div className="profile-modal-body profile-field">
                  <span>Name</span>
                  <Input
                    className="input"
                    placeholder="Sub-account name"
                    value={budgetName}
                    onChange={(e) => setBudgetName(e.target.value)}
                  />
                  <span>Bank account</span>
                  <Select className="input" value={budgetAccountId} onChange={(e) => setBudgetAccountId(e.target.value)}>
                    <option value="" disabled>
                      Select bank account
                    </option>
                    {bankAccountsQuery.data?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                  <span>Monthly limit (optional)</span>
                  <NumericCalculatorInput
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={budgetTarget}
                    onValueChange={setBudgetTarget}
                  />
                  <SavingsSubAccountCheckbox checked={budgetIsSavings} onCheckedChange={setBudgetIsSavings} />
                </div>
                <div className="profile-actions">
                  <Button className="btn btn-ghost btn-xs" type="button" onClick={() => setCreateBudgetOpen(false)}>
                    Cancel
                  </Button>
                  <Button className="btn btn-primary btn-xs" type="submit" disabled={createBudget.isPending}>
                    {createBudget.isPending ? "Creating..." : "Create"}
                  </Button>
                </div>
              </form>
            </div>
          </Dialog>
        )}

        {editingBankAccount && (
          <Dialog open onClose={closeEditBankBalance} title="Edit bank balance" surface="custom" overlayClassName="profile-modal-overlay txn-contained-modal-overlay">
            <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
              <div className="profile-modal-head">
                <h3>Edit Bank Balance</h3>
                <ModalCloseButton onClick={closeEditBankBalance} label="Close Edit Bank Balance" />
              </div>
              <form className="modal-form-shell" onSubmit={onSubmitBankBalance}>
                <div className="profile-modal-body txn-bank-balance-form">
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
                </div>
                <div className="profile-actions">
                  <Button type="button" className="btn btn-ghost" onClick={closeEditBankBalance}>Cancel</Button>
                  <Button type="submit" className="btn btn-primary" disabled={updateBankBalance.isPending}>
                    {updateBankBalance.isPending ? "Saving..." : "Save Balance"}
                  </Button>
                </div>
              </form>
            </div>
          </Dialog>
        )}
      </AppShell>

    </>
  );
}
