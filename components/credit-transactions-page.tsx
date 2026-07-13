"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { MarkdownEditor } from "@/components/markdown-editor";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { ChangeEvent, FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { EmptyState } from "@/components/ui-skeleton";
import { CreditTransactionsTableRowsSkeleton } from "@/components/skeletons/CreditTransactionsSkeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { closeOnBackdropClick } from "@/lib/modal-dismiss";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useSearchParams } from "next/navigation";
import { useSessionState } from "@/lib/use-session-state";
import { getMotionSafeScrollBehavior } from "@/lib/motion";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Plus } from "lucide-react";

type CreditCard = {
  id: string;
  cardName: string;
  bankName: string | null;
  last4Digit: string;
};

type CreditCardTransaction = {
  id: string;
  creditCardId: string;
  transactionDate: string;
  paymentDueDate: string | null;
  statementMonth: number;
  statementYear: number;
  amountCents: number;
  subject: string;
  isAllocated: boolean;
  creditCard: {
    cardName: string;
    bankName: string | null;
  };
};

type CardCount = {
  creditCardId: string;
  _count: { id: number };
};

type CreditTransactionSummary = {
  totalAmountCents: number;
  unaccountedAmountCents: number;
  earliestPaymentDueDate: string | null;
};

type AppContext = {
  workspaceId: string | null;
  baseCurrency?: string | null;
  defaultAccountId?: string | null;
  defaultBudgetId?: string | null;
  workspaces?: Array<{ id: string; name: string }>;
};

type BankAccount = {
  id: string;
  name: string;
  isActive: boolean;
  workspaceId?: string;
  workspace?: {
    id: string;
    name: string;
  };
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  isActive: boolean;
  availableCents: number;
};

type CreditTransactionsQueryData = {
  transactions: CreditCardTransaction[];
  cardCounts: CardCount[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  summary: CreditTransactionSummary;
};

type CreditCardPaymentResponse = {
  ok: true;
  paidAmountCents: number;
  outstandingAmountCents: number;
  bankTransactionId: string;
  paymentTransaction: CreditCardTransaction;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CREDIT_TX_MONTH_COOKIE = "nest_credit_tx_month";
const CREDIT_TX_CARD_COOKIE = "nest_credit_tx_card";
const EMPTY_CREDIT_TRANSACTION_SUMMARY: CreditTransactionSummary = {
  totalAmountCents: 0,
  unaccountedAmountCents: 0,
  earliestPaymentDueDate: null,
};

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function getDateGroupDetails(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return { key: dateStr, label: dateStr, dateTime: "" };
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    key: `${year}-${month}-${day}`,
    label: `${WEEKDAYS[date.getDay()]}, ${formatDate(dateStr)}`,
    dateTime: `${year}-${month}-${day}`,
  };
}

function toDateInputValue(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toMonthEndDateInputValue(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return monthEnd.toISOString().slice(0, 10);
}

function getDaysUntil(dateStr: string): number {
  const date = new Date(dateStr);
  const today = new Date();
  const diff = date.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function readCookie(name: string) {
  if (typeof document === "undefined") return null;
  const entry = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.split("=").slice(1).join("=")) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

function scrollSelectedFilterIntoView(container: HTMLDivElement | null, selectedElement: HTMLElement | null) {
  if (!container || !selectedElement) return;

  const targetLeft =
    selectedElement.offsetLeft - (container.clientWidth - selectedElement.offsetWidth) / 2;
  container.scrollTo({
    left: Math.max(0, targetLeft),
    behavior: getMotionSafeScrollBehavior(),
  });
}

export function CreditTransactionsPage({ initialCards }: { initialCards: CreditCard[] }) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  const sortedCards = useMemo(() => {
    const list = [...initialCards];
    list.sort((a, b) => {
      const bankA = (a.bankName || "ZZZ").toLowerCase();
      const bankB = (b.bankName || "ZZZ").toLowerCase();
      const byBank = bankA.localeCompare(bankB);
      if (byBank !== 0) return byBank;
      return a.cardName.localeCompare(b.cardName);
    });
    return list;
  }, [initialCards]);
  const [selectedCardId, setSelectedCardId] = useState<string>("all");
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useSessionState<number>("nest:view:credit-transactions:year", new Date().getFullYear());
  const [showUnaccountedOnly, setShowUnaccountedOnly] = useSessionState("nest:view:credit-transactions:unaccounted", false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [isAccountingModalOpen, setIsAccountingModalOpen] = useState(false);
  const [isReceivableModalOpen, setIsReceivableModalOpen] = useState(false);
  const [accountingTarget, setAccountingTarget] = useState<CreditCardTransaction | null>(null);
  const [receivableTarget, setReceivableTarget] = useState<CreditCardTransaction | null>(null);
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});
  const [importMessage, setImportMessage] = useState("");
  const [paymentDueMessage, setPaymentDueMessage] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const maybankFileInputRef = useRef<HTMLInputElement | null>(null);
  const [deductAccountId, setDeductAccountId] = useState("");
  const [deductBudgetId, setDeductBudgetId] = useState("");
  const [receivableDate, setReceivableDate] = useState("");
  const [receivableTxnDate, setReceivableTxnDate] = useState("");
  const [receivableAmount, setReceivableAmount] = useState("");
  const [receivableTitle, setReceivableTitle] = useState("");
  const [receivableNotes, setReceivableNotes] = useState("");
  const [useCrossWorkspaceReceivableSource, setUseCrossWorkspaceReceivableSource] = useState(false);
  const [receivableSourceWorkspaceId, setReceivableSourceWorkspaceId] = useState("");
  const [receivableSourceAccountId, setReceivableSourceAccountId] = useState("");
  const [receivableSourceBudgetId, setReceivableSourceBudgetId] = useState("");
  const [sharedPaymentDueDate, setSharedPaymentDueDate] = useState("");
  const [deletingTransactionIds, setDeletingTransactionIds] = useState<string[]>([]);
  const cardBarRef = useRef<HTMLDivElement | null>(null);
  const monthTabsRef = useRef<HTMLDivElement | null>(null);
  const mobileCardPickerRef = useRef<HTMLDivElement | null>(null);
  const [isMonthTabsScrolled, setIsMonthTabsScrolled] = useState(false);
  const [canScrollCardsLeft, setCanScrollCardsLeft] = useState(false);
  const [canScrollCardsRight, setCanScrollCardsRight] = useState(false);
  const [isMobileCardPickerOpen, setIsMobileCardPickerOpen] = useState(false);
  const [mobileCardQuery, setMobileCardQuery] = useState("");

  // Form state
  const [formCardId, setFormCardId] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formPaymentDue, setFormPaymentDue] = useState("");
  const [formStatementMonth, setFormStatementMonth] = useState("");
  const [formStatementYear, setFormStatementYear] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [filtersReady, setFiltersReady] = useState(false);

  useEffect(() => {
    const queryCardId = searchParams.get("cardId");
    const queryMonth = searchParams.get("month");
    const queryYear = searchParams.get("year");
    const savedMonth = readCookie(CREDIT_TX_MONTH_COOKIE);
    const savedCard = readCookie(CREDIT_TX_CARD_COOKIE);

    if (queryMonth !== null) {
      const parsedMonth = parseInt(queryMonth, 10);
      if (parsedMonth >= 1 && parsedMonth <= 12) {
        setSelectedMonth(parsedMonth - 1);
      }
    } else if (savedMonth !== null) {
      const parsedSavedMonth = parseInt(savedMonth, 10);
      if (parsedSavedMonth >= -1 && parsedSavedMonth <= 11) {
        setSelectedMonth(parsedSavedMonth);
      }
    }

    if (queryYear !== null) {
      const parsedYear = parseInt(queryYear, 10);
      if (parsedYear >= 2020 && parsedYear <= 2100) {
        setSelectedYear(parsedYear);
      }
    }

    if (queryCardId) {
      setSelectedCardId(queryCardId);
    } else if (savedCard) {
      setSelectedCardId(savedCard);
    }

    setFiltersReady(true);
  }, [searchParams]);

  useEffect(() => {
    if (!filtersReady) return;
    writeCookie(CREDIT_TX_MONTH_COOKIE, String(selectedMonth));
  }, [filtersReady, selectedMonth]);

  useEffect(() => {
    if (!isMobileCardPickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !mobileCardPickerRef.current?.contains(event.target)) {
        setIsMobileCardPickerOpen(false);
        setMobileCardQuery("");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileCardPickerOpen(false);
        setMobileCardQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMobileCardPickerOpen]);

  useEffect(() => {
    const element = cardBarRef.current;
    if (!element) return;
    const update = () => {
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      setCanScrollCardsLeft(element.scrollLeft > 2);
      setCanScrollCardsRight(element.scrollLeft < maxScrollLeft - 2);
    };
    const resizeObserver = new ResizeObserver(update);
    update();
    element.addEventListener("scroll", update, { passive: true });
    resizeObserver.observe(element);
    Array.from(element.children).forEach((child) => resizeObserver.observe(child));
    return () => {
      element.removeEventListener("scroll", update);
      resizeObserver.disconnect();
    };
  }, [sortedCards]);

  useEffect(() => {
    const element = monthTabsRef.current;
    if (!element) return;
    const update = () => setIsMonthTabsScrolled(element.scrollLeft > 8);
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (selectedCardId === "all") return;
    const container = cardBarRef.current;
    const selectedChip = container?.querySelector<HTMLButtonElement>(`[data-card-id="${CSS.escape(selectedCardId)}"]`);
    scrollSelectedFilterIntoView(container ?? null, selectedChip ?? null);
  }, [selectedCardId, sortedCards]);

  useEffect(() => {
    if (!filtersReady) return;
    if (selectedCardId !== "all" && !sortedCards.some((card) => card.id === selectedCardId)) {
      setSelectedCardId("all");
      return;
    }
    writeCookie(CREDIT_TX_CARD_COOKIE, selectedCardId);
  }, [filtersReady, selectedCardId, sortedCards]);

  useEffect(() => {
    if (selectedMonth === -1) {
      monthTabsRef.current?.scrollTo({ left: 0, behavior: getMotionSafeScrollBehavior() });
      return;
    }
    const activeMonthTab = Array.from(monthTabsRef.current?.querySelectorAll<HTMLButtonElement>("[data-month]") ?? [])
      .find((tab) => tab.dataset.month === String(selectedMonth));
    requestAnimationFrame(() => scrollSelectedFilterIntoView(monthTabsRef.current, activeMonthTab ?? null));
  }, [selectedMonth]);

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const formatCurrency = (cents: number) => formatMoney(cents, baseCurrency);
  const defaultReceivableAccountId = context.data?.defaultAccountId ?? null;
  const defaultReceivableBudgetId = context.data?.defaultBudgetId ?? null;

  const bankAccounts = useQuery({
    queryKey: ["bank-accounts", context.data?.workspaceId],
    queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${context.data?.workspaceId}`),
    enabled: Boolean(context.data?.workspaceId),
  });

  const budgets = useQuery({
    queryKey: ["budgets", context.data?.workspaceId],
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${context.data?.workspaceId}`),
    enabled: Boolean(context.data?.workspaceId),
  });

  const receivableSourceAccounts = useQuery({
    queryKey: ["bank-accounts", receivableSourceWorkspaceId],
    queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${receivableSourceWorkspaceId}`),
    enabled: useCrossWorkspaceReceivableSource && Boolean(receivableSourceWorkspaceId),
  });

  const receivableSourceBudgets = useQuery({
    queryKey: ["budgets", receivableSourceWorkspaceId],
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${receivableSourceWorkspaceId}`),
    enabled: useCrossWorkspaceReceivableSource && Boolean(receivableSourceWorkspaceId),
  });

  const receivablesSummary = useQuery({
    queryKey: ["receivables-summary", context.data?.workspaceId],
    queryFn: () =>
      fetchJson<{ totalCents: number }>(`/api/receivables/summary?workspaceId=${context.data?.workspaceId}`),
    enabled: Boolean(context.data?.workspaceId),
  });

  const defaultReceivableSubaccount = useMemo(() => {
    if (!defaultReceivableBudgetId || !budgets.data) return null;
    return budgets.data.find((budget) => budget.id === defaultReceivableBudgetId) ?? null;
  }, [budgets.data, defaultReceivableBudgetId]);
  const defaultSubaccountBalance = defaultReceivableSubaccount?.availableCents ?? 0;
  const creditTransactionsKeyPrefix = ["credit-transactions", context.data?.workspaceId] as const;
  const currentCreditTransactionsKey = [
    "credit-transactions",
    context.data?.workspaceId,
    selectedCardId,
    selectedYear,
    selectedMonth,
  ] as const;

  const invalidateCreditTransactionDependencies = () => {
    void queryClient.invalidateQueries({ queryKey: creditTransactionsKeyPrefix, refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
  };

  const invalidateCreditAccountingDependencies = () => {
    invalidateCreditTransactionDependencies();
    void queryClient.invalidateQueries({ queryKey: ["transactions"], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["receivables"], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["budgets"], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["bank-accounts"], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["receivables-summary"], refetchType: "active" });
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: currentCreditTransactionsKey,
    queryFn: () =>
      fetchJson<CreditTransactionsQueryData>(`/api/credit-transactions?${new URLSearchParams({
        cardId: selectedCardId,
        year: String(selectedYear),
        ...(selectedMonth >= 0 ? { month: String(selectedMonth + 1) } : {}),
      }).toString()}`),
    enabled: Boolean(context.data?.workspaceId) && sortedCards.length > 0,
    refetchInterval: 5 * 60 * 1000,
  });

  const matchesCreditTransactionsFilter = (
    tx: CreditCardTransaction,
    cardId: string,
    year: number,
    month: number,
  ) => {
    if (cardId !== "all" && tx.creditCardId !== cardId) return false;
    if (tx.statementYear !== year) return false;
    if (month >= 0 && tx.statementMonth !== month + 1) return false;
    return true;
  };

  const getCachedCreditTransaction = (id: string) => {
    const cached = queryClient.getQueriesData<CreditTransactionsQueryData>({ queryKey: creditTransactionsKeyPrefix });
    for (const [, value] of cached) {
      const found = value?.transactions.find((tx) => tx.id === id);
      if (found) return found;
    }
    return null;
  };

  const updateCardCounts = (
    cardCounts: CardCount[],
    previousTx: CreditCardTransaction | null,
    nextTx: CreditCardTransaction | null,
    year: number,
    month: number,
  ) => {
    const shouldCount = (tx: CreditCardTransaction | null): tx is CreditCardTransaction =>
      Boolean(
        tx &&
        !tx.isAllocated &&
        tx.statementYear === year &&
        (month < 0 || tx.statementMonth === month + 1),
      );
    const nextCounts = new Map(cardCounts.map((entry) => [entry.creditCardId, entry._count.id]));
    if (shouldCount(previousTx)) {
      nextCounts.set(previousTx.creditCardId, Math.max(0, (nextCounts.get(previousTx.creditCardId) ?? 0) - 1));
    }
    if (shouldCount(nextTx)) {
      nextCounts.set(nextTx.creditCardId, (nextCounts.get(nextTx.creditCardId) ?? 0) + 1);
    }
    return Array.from(nextCounts.entries()).map(([creditCardId, count]) => ({
      creditCardId,
      _count: { id: count },
    }));
  };

  const syncCreditTransactionCaches = ({
    previousTx,
    nextTx,
  }: {
    previousTx: CreditCardTransaction | null;
    nextTx: CreditCardTransaction | null;
  }) => {
    const cached = queryClient.getQueriesData<CreditTransactionsQueryData>({ queryKey: creditTransactionsKeyPrefix });
    for (const [queryKey, value] of cached) {
      if (!value) continue;
      const [, , cardId, year, month] = queryKey as [string, string | null | undefined, string, number, number];
      const withoutPrevious = previousTx ? value.transactions.filter((tx) => tx.id !== previousTx.id) : value.transactions;
      const shouldIncludeNext =
        nextTx && matchesCreditTransactionsFilter(nextTx, cardId, year, month);
      const nextTransactions = shouldIncludeNext
        ? [...withoutPrevious, nextTx].sort(
            (a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime(),
          )
        : withoutPrevious;
      queryClient.setQueryData<CreditTransactionsQueryData>(queryKey, {
        ...value,
        transactions: nextTransactions,
        cardCounts: updateCardCounts(value.cardCounts, previousTx, nextTx, year, month),
      });
    }
  };

  const transactions = data?.transactions || [];
  const cardCounts = data?.cardCounts || [];
  const transactionSummary = data?.summary ?? EMPTY_CREDIT_TRANSACTION_SUMMARY;
  const unaccountedCardCountTotal = useMemo(
    () => cardCounts.reduce((sum, entry) => sum + entry._count.id, 0),
    [cardCounts],
  );
  const selectedCard = useMemo(
    () => sortedCards.find((card) => card.id === selectedCardId) ?? null,
    [selectedCardId, sortedCards],
  );
  const unaccountedTransactionCount = selectedCardId === "all"
    ? unaccountedCardCountTotal
    : cardCounts.find((entry) => entry.creditCardId === selectedCardId)?._count.id ?? 0;
  const selectedCardBank = getSingaporeBankByName(selectedCard?.bankName);
  const selectedCardLogo = getBankLogoUrl(selectedCardBank);
  const mobileCardOptions = useMemo(() => {
    const query = mobileCardQuery.trim().toLowerCase();
    if (!query) return sortedCards;
    return sortedCards.filter((card) =>
      [card.cardName, card.bankName, card.last4Digit]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [mobileCardQuery, sortedCards]);
  const canImportMaybankCsv = selectedCardBank?.code === "MAYBANK";

  useEffect(() => {
    if (!data || unaccountedTransactionCount > 0 || !showUnaccountedOnly) return;
    setShowUnaccountedOnly(false);
  }, [data, setShowUnaccountedOnly, showUnaccountedOnly, unaccountedTransactionCount]);

  const filteredTransactions = useMemo(() => {
    if (!showUnaccountedOnly) return transactions;
    return transactions.filter((t) => !t.isAllocated);
  }, [transactions, showUnaccountedOnly]);

  const transactionDateGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      label: string;
      dateTime: string;
      transactions: CreditCardTransaction[];
    }> = [];
    const groupsByDate = new Map<string, (typeof groups)[number]>();

    filteredTransactions.forEach((transaction) => {
      const date = getDateGroupDetails(transaction.transactionDate);
      const existingGroup = groupsByDate.get(date.key);
      if (existingGroup) {
        existingGroup.transactions.push(transaction);
        return;
      }

      const group = { ...date, transactions: [transaction] };
      groupsByDate.set(date.key, group);
      groups.push(group);
    });

    return groups;
  }, [filteredTransactions]);

  const statementTotalAmountCents = transactionSummary.totalAmountCents;
  const unaccountedAmountCents = transactionSummary.unaccountedAmountCents;
  const totals = useMemo(() => {
    return { total: statementTotalAmountCents, unaccounted: unaccountedAmountCents };
  }, [statementTotalAmountCents, unaccountedAmountCents]);
  const payableAmountCents = statementTotalAmountCents;

  const totalReceivableCents = receivablesSummary.data?.totalCents ?? 0;
  const workspacesForReceivableSource = useMemo(
    () => (context.data?.workspaces ?? []).filter((workspace) => workspace.id !== context.data?.workspaceId),
    [context.data?.workspaces, context.data?.workspaceId],
  );
  const receivableBudgetsById = useMemo(
    () => new Map((receivableSourceBudgets.data ?? []).map((budget) => [budget.id, budget])),
    [receivableSourceBudgets.data],
  );
  const filteredReceivableSourceBudgets = useMemo(
    () => (receivableSourceBudgets.data ?? []).filter((budget) => budget.accountId === receivableSourceAccountId),
    [receivableSourceBudgets.data, receivableSourceAccountId],
  );
  const isBalanced = useMemo(() => {
    const expectedTotal = totalReceivableCents + defaultSubaccountBalance;
    return totals.total === expectedTotal && totals.total !== 0 && unaccountedTransactionCount === 0;
  }, [totals.total, totalReceivableCents, defaultSubaccountBalance, unaccountedTransactionCount]);
  const balanceDelta = useMemo(
    () => totalReceivableCents + defaultSubaccountBalance - totals.total,
    [totalReceivableCents, defaultSubaccountBalance, totals.total],
  );
  const balanceStatus = useMemo(() => {
    if (totals.total === 0 && totalReceivableCents === 0 && defaultSubaccountBalance === 0) return null;
    if (isBalanced) {
      return {
        label: "Perfectly balanced as all things should be",
        className: "cct-balanced-message",
      };
    }
    if (balanceDelta > 0) {
      return {
        label: `Surplus ${formatCurrency(balanceDelta)}`,
        className: "cct-balance-status cct-balance-status-surplus",
      };
    }
    if (balanceDelta === 0 && unaccountedTransactionCount > 0) {
      const transactionLabel = unaccountedTransactionCount === 1 ? "transaction" : "transactions";
      return {
        label: `Totals match — ${unaccountedTransactionCount} ${transactionLabel} still unaccounted`,
        className: "cct-balance-status cct-balance-status-pending",
      };
    }
    const deficitAmount = Math.abs(balanceDelta);
    return {
      label: `Deficit ${formatCurrency(deficitAmount)}`,
      className: "cct-balance-status cct-balance-status-deficit",
    };
  }, [
    totals.total,
    totalReceivableCents,
    defaultSubaccountBalance,
    isBalanced,
    balanceDelta,
    unaccountedTransactionCount,
    formatCurrency,
  ]);

  const earliestPaymentDueDate = transactionSummary.earliestPaymentDueDate;

  const createTransaction = useMutation({
    mutationFn: (payload: {
      creditCardId: string;
      transactionDate: string;
      paymentDueDate?: string;
      statementMonth: number;
      statementYear: number;
      amountCents: number;
      subject: string;
    }) =>
      fetchJson<CreditCardTransaction>("/api/credit-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (transaction: CreditCardTransaction) => {
      syncCreditTransactionCaches({ previousTx: null, nextTx: transaction });
      invalidateCreditTransactionDependencies();
      closeModal();
    },
  });

  const updateTransaction = useMutation({
    mutationFn: ({ id, payload }: {
      id: string;
      payload: {
        creditCardId: string;
        transactionDate: string;
        paymentDueDate?: string | null;
        statementMonth: number;
        statementYear: number;
        amountCents: number;
        subject: string;
      };
    }) =>
      fetchJson<CreditCardTransaction>(`/api/credit-transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onMutate: ({ id }) => ({ previousTx: getCachedCreditTransaction(id) }),
    onSuccess: (transaction: CreditCardTransaction, _variables, context) => {
      syncCreditTransactionCaches({ previousTx: context?.previousTx ?? null, nextTx: transaction });
      invalidateCreditTransactionDependencies();
      closeModal();
    },
  });

  const deleteTransaction = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/credit-transactions/${id}`, { method: "DELETE" }),
    onMutate: (id) => ({ previousTx: getCachedCreditTransaction(id) }),
    onSuccess: (_result, _id, context) => {
      syncCreditTransactionCaches({ previousTx: context?.previousTx ?? null, nextTx: null });
      invalidateCreditTransactionDependencies();
      setDeletingTransactionIds((current) => current.filter((item) => item !== _id));
      if (editingTransactionId === _id) {
        setIsModalOpen(false);
        setEditingTransactionId(null);
      }
    },
    onError: (_error, id) => {
      setDeletingTransactionIds((current) => current.filter((item) => item !== id));
    },
  });

  const toggleAllocated = useMutation({
    mutationFn: ({ id, isAllocated }: { id: string; isAllocated: boolean }) =>
      fetchJson<CreditCardTransaction>(`/api/credit-transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAllocated }),
      }),
    onMutate: ({ id }) => ({ previousTx: getCachedCreditTransaction(id) }),
    onSuccess: (transaction: CreditCardTransaction, _variables, context) => {
      syncCreditTransactionCaches({ previousTx: context?.previousTx ?? null, nextTx: transaction });
      invalidateCreditTransactionDependencies();
    },
  });

  const importMaybankCsv = useMutation({
    mutationFn: async (payload: { creditCardId: string; csvContent: string }) =>
      fetchJson<{
        imported: number;
        skippedDuplicates: number;
        skippedPayments: number;
        totalRows: number;
      }>("/api/credit-transactions/import-maybank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (result, payload) => {
      setImportMessage(
        `Maybank CSV imported: ${result.imported} added, ${result.skippedDuplicates} duplicates skipped, ${result.skippedPayments} payment rows skipped.`,
      );
      invalidateCreditTransactionDependencies();
    },
    onError: (error) => {
      setImportMessage(error instanceof Error ? error.message : "Maybank CSV import failed.");
    },
  });

  useEffect(() => {
    if (!importMaybankCsv.isPending) {
      setImportProgress((current) => (current > 0 ? 100 : 0));
      const timeout = window.setTimeout(() => setImportProgress(0), 500);
      return () => window.clearTimeout(timeout);
    }

    setImportProgress(8);
    const interval = window.setInterval(() => {
      setImportProgress((current) => {
        if (current >= 90) return current;
        if (current < 35) return current + 12;
        if (current < 65) return current + 7;
        return current + 3;
      });
    }, 180);

    return () => window.clearInterval(interval);
  }, [importMaybankCsv.isPending]);

  const accountCreditTxn = useMutation({
    mutationFn: (payload: {
      id: string;
      action: "DEDUCT" | "RECEIVABLE";
      accountId?: string;
      budgetId?: string;
      receivableDate?: string;
      transactionDate?: string;
      amountCents?: number;
      title?: string;
      notes?: string;
    }) =>
      fetchJson(`/api/credit-transactions/${payload.id}/accounting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onMutate: ({ id }) => ({ previousTx: getCachedCreditTransaction(id) }),
    onSuccess: (_result, variables, mutationContext) => {
      setImportMessage(
        variables.action === "DEDUCT"
          ? "Credit transaction deducted and marked accounted."
          : "Receivable created and credit transaction marked accounted.",
      );
      if (mutationContext?.previousTx) {
        syncCreditTransactionCaches({
          previousTx: mutationContext.previousTx,
          nextTx: { ...mutationContext.previousTx, isAllocated: true },
        });
      }
      invalidateCreditAccountingDependencies();
      if (variables.action === "DEDUCT") {
        closeAccountingModal();
      } else {
        closeReceivableModal();
      }
    },
    onError: (error) => {
      setImportMessage(error instanceof Error ? error.message : "Failed to account for credit transaction.");
    },
  });

  const updateSharedPaymentDue = useMutation({
    mutationFn: (payload: {
      cardId?: string;
      statementMonth: number;
      statementYear: number;
      paymentDueDate: string | null;
    }) =>
      fetchJson<{ ok: true; updatedCount: number }>("/api/credit-transactions/payment-due", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (result, payload) => {
      setPaymentDueMessage(
        result.updatedCount > 0
          ? `Payment due updated for ${result.updatedCount} transaction${result.updatedCount === 1 ? "" : "s"}.`
          : "No transactions matched this statement month.",
      );
      const cached = queryClient.getQueriesData<CreditTransactionsQueryData>({ queryKey: creditTransactionsKeyPrefix });
      for (const [queryKey, value] of cached) {
        if (!value) continue;
        const [, , cardId, year, month] = queryKey as [string, string | null | undefined, string, number, number];
        const nextTransactions = value.transactions.map((tx) => {
          const cardMatches = cardId === "all" || tx.creditCardId === cardId;
          const yearMatches = tx.statementYear === year;
          const monthMatches = month < 0 || tx.statementMonth === month + 1;
          if (!cardMatches || !yearMatches || !monthMatches) return tx;
          return {
            ...tx,
            paymentDueDate: payload.paymentDueDate,
          };
        });
        queryClient.setQueryData<CreditTransactionsQueryData>(queryKey, {
          ...value,
          transactions: nextTransactions,
        });
      }
      invalidateCreditTransactionDependencies();
    },
    onError: (error) => {
      setPaymentDueMessage(error instanceof Error ? error.message : "Failed to update payment due date.");
    },
  });

  const makePayment = useMutation({
    mutationFn: (payload: {
      cardId: string;
      statementMonth: number;
      statementYear: number;
      amountCents: number;
    }) =>
      fetchJson<CreditCardPaymentResponse>("/api/credit-transactions/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      setImportMessage(`Payment recorded for ${formatCurrency(result.paidAmountCents)}.`);
      syncCreditTransactionCaches({
        previousTx: null,
        nextTx: result.paymentTransaction,
      });
      invalidateCreditAccountingDependencies();
    },
    onError: (error) => {
      setImportMessage(error instanceof Error ? error.message : "Failed to make payment.");
    },
  });

  const openModal = () => {
    const now = new Date();
    setFormCardId(
      selectedCardId !== "all"
        ? selectedCardId
        : sortedCards[0]?.id || "",
    );
    setEditingTransactionId(null);
    setFormDate(now.toISOString().split("T")[0]);
    setFormPaymentDue("");
    setFormStatementMonth(String(selectedMonth >= 0 ? selectedMonth + 1 : now.getMonth() + 1));
    setFormStatementYear(String(selectedYear || now.getFullYear()));
    setFormSubject("");
    setFormAmount("");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTransactionId(null);
  };

  const openEditModal = (tx: CreditCardTransaction) => {
    setEditingTransactionId(tx.id);
    setFormCardId(tx.creditCardId);
    setFormDate(toDateInputValue(tx.transactionDate));
    setFormPaymentDue(tx.paymentDueDate ? toDateInputValue(tx.paymentDueDate) : "");
    setFormStatementMonth(String(tx.statementMonth));
    setFormStatementYear(String(tx.statementYear));
    setFormSubject(tx.subject);
    setFormAmount((tx.amountCents / 100).toFixed(2));
    setIsModalOpen(true);
  };

  const openDeductModal = (tx: CreditCardTransaction) => {
    setAccountingTarget(tx);
    // Validate that the previously selected account still exists, otherwise use first available
    const validAccountIds = new Set((bankAccounts.data ?? []).map((a) => a.id));
    const validBudgetIds = new Set((budgets.data ?? []).map((b) => b.id));

    const initialAccountId =
      validAccountIds.has(deductAccountId) ? deductAccountId : (bankAccounts.data?.[0]?.id ?? "");
    setDeductAccountId(initialAccountId);

    // Validate that the previously selected budget exists for the selected account
    const budgetsForAccount = (budgets.data ?? []).filter((b) => b.accountId === initialAccountId);
    const initialBudgetId =
      validBudgetIds.has(deductBudgetId) && budgetsForAccount.some((b) => b.id === deductBudgetId)
        ? deductBudgetId
        : (budgetsForAccount[0]?.id ?? "");
    setDeductBudgetId(initialBudgetId);
    setIsAccountingModalOpen(true);
  };

  const closeAccountingModal = () => {
    setIsAccountingModalOpen(false);
    setAccountingTarget(null);
  };

  const openReceivableModal = (tx: CreditCardTransaction) => {
    setReceivableTarget(tx);
    setReceivableDate(toMonthEndDateInputValue(tx.transactionDate));
    setReceivableTxnDate(toDateInputValue(tx.transactionDate));
    setReceivableAmount((tx.amountCents / 100).toFixed(2));
    setReceivableTitle(tx.subject);
    setReceivableNotes("");
    setUseCrossWorkspaceReceivableSource(false);
    setReceivableSourceWorkspaceId("");
    setReceivableSourceAccountId("");
    setReceivableSourceBudgetId("");
    setIsReceivableModalOpen(true);
  };

  const closeReceivableModal = () => {
    setIsReceivableModalOpen(false);
    setReceivableTarget(null);
    setReceivableTitle("");
    setReceivableNotes("");
    setUseCrossWorkspaceReceivableSource(false);
    setReceivableSourceWorkspaceId("");
    setReceivableSourceAccountId("");
    setReceivableSourceBudgetId("");
  };

  const onPickMaybankCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (selectedCardId === "all") {
      setImportMessage("Select a specific card before importing a Maybank CSV.");
      return;
    }

    try {
      const csvContent = await file.text();
      importMaybankCsv.mutate({ creditCardId: selectedCardId, csvContent });
    } catch {
      setImportMessage("Failed to read CSV file.");
    }
  };

  const filteredBudgets = useMemo(
    () => (budgets.data ?? []).filter((budget) => budget.accountId === deductAccountId),
    [budgets.data, deductAccountId],
  );

  const onSubmitDeduct = (event: FormEvent) => {
    event.preventDefault();
    if (!accountingTarget || !deductAccountId || !deductBudgetId) return;
    accountCreditTxn.mutate({
      id: accountingTarget.id,
      action: "DEDUCT",
      accountId: deductAccountId,
      budgetId: deductBudgetId,
    });
  };

  const onSubmitReceivable = (event: FormEvent) => {
    event.preventDefault();
    if (!receivableTarget || !receivableDate || !receivableAmount) return;
    const accountId = useCrossWorkspaceReceivableSource
      ? receivableSourceAccountId || undefined
      : defaultReceivableAccountId || undefined;
    const budgetId = useCrossWorkspaceReceivableSource
      ? receivableSourceBudgetId || undefined
      : defaultReceivableBudgetId || undefined;
    if (useCrossWorkspaceReceivableSource && (!accountId || !budgetId)) return;
    accountCreditTxn.mutate({
      id: receivableTarget.id,
      action: "RECEIVABLE",
      receivableDate: new Date(`${receivableDate}T00:00:00.000Z`).toISOString(),
      transactionDate: receivableTxnDate ? new Date(`${receivableTxnDate}T00:00:00.000Z`).toISOString() : undefined,
      amountCents: Math.round(Number(receivableAmount || "0") * 100),
      title: receivableTitle || receivableTarget.subject,
      notes: receivableNotes || undefined,
      accountId,
      budgetId,
    });
  };

  useEffect(() => {
    if (!isReceivableModalOpen) return;
    if (!receivableTxnDate) return;
    setReceivableDate(toMonthEndDateInputValue(receivableTxnDate));
  }, [isReceivableModalOpen, receivableTxnDate]);

  useEffect(() => {
    if (!useCrossWorkspaceReceivableSource) return;
    if (!receivableSourceAccountId) return;
    if (receivableSourceBudgetId) return;
    const firstMatchingBudget = (receivableSourceBudgets.data ?? []).find(
      (budget) => budget.accountId === receivableSourceAccountId,
    );
    if (firstMatchingBudget) {
      setReceivableSourceBudgetId(firstMatchingBudget.id);
    }
  }, [
    useCrossWorkspaceReceivableSource,
    receivableSourceAccountId,
    receivableSourceBudgetId,
    receivableSourceBudgets.data,
  ]);

  useEffect(() => {
    setSharedPaymentDueDate(earliestPaymentDueDate ? toDateInputValue(earliestPaymentDueDate) : "");
  }, [earliestPaymentDueDate, selectedCardId, selectedMonth, selectedYear]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!formCardId || !formDate || !formSubject || !formAmount || !formStatementMonth || !formStatementYear) return;

    const payload = {
      creditCardId: formCardId,
      transactionDate: new Date(formDate).toISOString(),
      paymentDueDate: formPaymentDue ? new Date(formPaymentDue).toISOString() : null,
      statementMonth: parseInt(formStatementMonth, 10),
      statementYear: parseInt(formStatementYear, 10),
      amountCents: Math.round(parseFloat(formAmount) * 100),
      subject: formSubject,
    };

    if (editingTransactionId) {
      updateTransaction.mutate({
        id: editingTransactionId,
        payload,
      });
      return;
    }

    createTransaction.mutate({
      creditCardId: formCardId,
      transactionDate: payload.transactionDate,
      paymentDueDate: payload.paymentDueDate ?? undefined,
      statementMonth: payload.statementMonth,
      statementYear: payload.statementYear,
      amountCents: payload.amountCents,
      subject: payload.subject,
    });
  };

  const getCardCount = (cardId: string) => {
    return cardCounts.find((c) => c.creditCardId === cardId)?._count.id || 0;
  };

  const closeMobileCardPicker = () => {
    setIsMobileCardPickerOpen(false);
    setMobileCardQuery("");
  };

  const selectMobileCard = (cardId: string) => {
    setSelectedCardId(cardId);
    closeMobileCardPicker();
  };

  const scrollCardRail = (direction: -1 | 1) => {
    const container = cardBarRef.current;
    if (!container) return;
    container.scrollBy({
      left: direction * Math.max(240, container.clientWidth * 0.72),
      behavior: getMotionSafeScrollBehavior(),
    });
  };

  const confirmDeleteTransaction = async (transactionId: string) => {
    if (!(await confirmDestructiveAction("Delete this credit card transaction permanently? This cannot be undone."))) return;
    if (deletingTransactionIds.includes(transactionId)) return;
    setDeletingTransactionIds((current) => [...current, transactionId]);
    window.setTimeout(() => {
      deleteTransaction.mutate(transactionId);
    }, 180);
  };

  const earliestDueDays = earliestPaymentDueDate ? getDaysUntil(earliestPaymentDueDate) : null;
  const earliestDueIsOverdue = earliestDueDays !== null && earliestDueDays < 0;
  const earliestDueIsUrgent = earliestDueDays !== null && earliestDueDays >= 0 && earliestDueDays <= 3;
  const canEditSharedPaymentDue = selectedMonth >= 0;
  const hasMonthlyPaymentBalance =
    selectedCardId !== "all" &&
    selectedMonth >= 0 &&
    payableAmountCents > 0;
  const canMakePayment =
    hasMonthlyPaymentBalance &&
    Boolean(defaultReceivableAccountId) &&
    Boolean(defaultReceivableBudgetId);
  const saveSharedPaymentDue = () => {
    if (!canEditSharedPaymentDue) return;
    updateSharedPaymentDue.mutate({
      ...(selectedCardId !== "all" ? { cardId: selectedCardId } : {}),
      statementMonth: selectedMonth + 1,
      statementYear: selectedYear,
      paymentDueDate: sharedPaymentDueDate ? new Date(`${sharedPaymentDueDate}T00:00:00.000Z`).toISOString() : null,
    });
  };
  const submitPayment = async () => {
    if (!selectedCard || selectedMonth < 0 || payableAmountCents <= 0) return;
    const confirmed = await confirm({
      title: "Confirm Payment",
      message: `Make payment for ${selectedCard.cardName} (${MONTHS[selectedMonth]} ${selectedYear}) for ${formatCurrency(payableAmountCents)}? This will deduct the amount from the Receivable Default Subaccount and create an offsetting payment entry for this credit card statement.`,
      confirmLabel: "Make Payment",
      cancelLabel: "Cancel",
    });
    if (!confirmed) {
      return;
    }
    makePayment.mutate({
      cardId: selectedCard.id,
      statementMonth: selectedMonth + 1,
      statementYear: selectedYear,
      amountCents: payableAmountCents,
    });
  };

  return (
    <div className="cct-container">
      <div className="cct-mobile-card-picker" ref={mobileCardPickerRef}>
        <button
          type="button"
          className="cct-mobile-card-trigger"
          aria-haspopup="listbox"
          aria-expanded={isMobileCardPickerOpen}
          aria-controls="mobile-credit-card-options"
          onClick={() => {
            if (isMobileCardPickerOpen) {
              closeMobileCardPicker();
            } else {
              setIsMobileCardPickerOpen(true);
            }
          }}
        >
          <span className="cct-mobile-card-leading" aria-hidden="true">
            {selectedCard && selectedCardLogo && !failedLogos[selectedCard.id] ? (
              <Image
                src={selectedCardLogo}
                alt=""
                width={32}
                height={22}
                sizes="32px"
                className="cct-mobile-card-logo"
                onError={() => setFailedLogos((current) => ({ ...current, [selectedCard.id]: true }))}
              />
            ) : (
              <span className="cct-mobile-card-fallback">{selectedCard ? "💳" : "📋"}</span>
            )}
          </span>
          <span className="cct-mobile-card-copy">
            <strong>{selectedCard?.cardName ?? "All cards"}</strong>
            <small>
              {selectedCard
                ? `${selectedCard.bankName || "Card"} ••${selectedCard.last4Digit}`
                : `${sortedCards.length} ${sortedCards.length === 1 ? "card" : "cards"}`}
            </small>
          </span>
          {(selectedCard ? getCardCount(selectedCard.id) : unaccountedCardCountTotal) > 0 ? (
            <span className="cct-mobile-card-count">
              {selectedCard ? getCardCount(selectedCard.id) : unaccountedCardCountTotal}
            </span>
          ) : null}
          <ChevronDown size={19} aria-hidden="true" />
        </button>
        {isMobileCardPickerOpen ? (
          <div className="cct-mobile-card-dropdown">
            {sortedCards.length > 6 ? (
              <div className="cct-mobile-card-search">
                <input
                  className="input"
                  type="search"
                  aria-label="Search cards"
                  value={mobileCardQuery}
                  onChange={(event) => setMobileCardQuery(event.target.value)}
                  placeholder="Search cards"
                />
              </div>
            ) : null}
            <div id="mobile-credit-card-options" className="cct-mobile-card-options" role="listbox" aria-label="Credit cards">
              {!mobileCardQuery.trim() ? (
                <button
                  type="button"
                  className={`cct-mobile-card-option${selectedCardId === "all" ? " is-selected" : ""}`}
                  role="option"
                  aria-selected={selectedCardId === "all"}
                  onClick={() => selectMobileCard("all")}
                >
                  <span className="cct-mobile-card-leading" aria-hidden="true">
                    <span className="cct-mobile-card-fallback">📋</span>
                  </span>
                  <span className="cct-mobile-card-copy">
                    <strong>All cards</strong>
                    <small>{sortedCards.length} {sortedCards.length === 1 ? "card" : "cards"}</small>
                  </span>
                  {unaccountedCardCountTotal > 0 ? <span className="cct-mobile-card-count">{unaccountedCardCountTotal}</span> : null}
                  {selectedCardId === "all" ? <Check size={18} aria-hidden="true" /> : <span className="cct-mobile-card-check-space" />}
                </button>
              ) : null}
              {mobileCardOptions.map((card) => {
                const bank = getSingaporeBankByName(card.bankName);
                const logo = getBankLogoUrl(bank);
                const count = getCardCount(card.id);
                const isSelected = selectedCardId === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`cct-mobile-card-option${isSelected ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectMobileCard(card.id)}
                  >
                    <span className="cct-mobile-card-leading" aria-hidden="true">
                      {logo && !failedLogos[card.id] ? (
                        <Image
                          src={logo}
                          alt=""
                          width={28}
                          height={18}
                          sizes="28px"
                          className="cct-mobile-card-logo"
                          loading="lazy"
                          onError={() => setFailedLogos((current) => ({ ...current, [card.id]: true }))}
                        />
                      ) : (
                        <span className="cct-mobile-card-fallback">💳</span>
                      )}
                    </span>
                    <span className="cct-mobile-card-copy">
                      <strong>{card.cardName}</strong>
                      <small>{card.bankName || "Card"} ••{card.last4Digit}</small>
                    </span>
                    {count > 0 ? <span className="cct-mobile-card-count">{count}</span> : null}
                    {isSelected ? <Check size={18} aria-hidden="true" /> : <span className="cct-mobile-card-check-space" />}
                  </button>
                );
              })}
              {mobileCardOptions.length === 0 ? (
                <div className="cct-mobile-card-empty">No matching cards.</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Card Selector Bar */}
      <div className="cct-card-selector">
        <button
          type="button"
          className={`cct-card-chip cct-card-chip-all ${selectedCardId === "all" ? "active" : ""}`}
          onClick={() => setSelectedCardId("all")}
        >
          <span className="cct-card-chip-icon">📋</span>
          <span className="cct-card-chip-name">All Cards</span>
          {unaccountedCardCountTotal > 0 && <span className="cct-card-chip-badge">{unaccountedCardCountTotal}</span>}
        </button>
        <button
          type="button"
          className="cct-card-rail-button"
          onClick={() => scrollCardRail(-1)}
          disabled={!canScrollCardsLeft}
          aria-label="Show previous cards"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div ref={cardBarRef} className="cct-card-bar">
          {sortedCards.map((card) => {
            const bank = getSingaporeBankByName(card.bankName);
            const logo = getBankLogoUrl(bank);
            const count = getCardCount(card.id);
            return (
              <button
                key={card.id}
                type="button"
                data-card-id={card.id}
                className={`cct-card-chip ${selectedCardId === card.id ? "active" : ""}`}
                onClick={() => setSelectedCardId(card.id)}
              >
              {logo && !failedLogos[card.id] ? (
                <Image
                  src={logo}
                  alt={card.bankName || ""}
                  width={24}
                  height={16}
                  sizes="24px"
                  className="cct-card-chip-logo"
                  loading="lazy"
                  onError={() => setFailedLogos((prev) => ({ ...prev, [card.id]: true }))}
                />
              ) : (
                <span className="cct-card-chip-icon">💳</span>
              )}
              <span className="cct-card-chip-name">{card.cardName}</span>
              {count > 0 && <span className="cct-card-chip-badge">{count}</span>}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="cct-card-rail-button"
          onClick={() => scrollCardRail(1)}
          disabled={!canScrollCardsRight}
          aria-label="Show more cards"
        >
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>

      {/* Period Filter */}
      <div className="cct-mobile-period-selectors" aria-label="Statement period filters">
        <label>
          <select
            className="input"
            aria-label="Statement month"
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(Number(event.target.value))}
          >
            <option value={-1}>All months</option>
            {MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
          </select>
        </label>
        <label>
          <select
            className="input"
            aria-label="Statement year"
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
          >
            {Array.from({ length: Math.max(1, new Date().getFullYear() - 2018) }, (_, index) => new Date().getFullYear() + 1 - index).map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="cct-period-bar">
        <div className={`cct-month-tabs-shell${isMonthTabsScrolled ? " is-scrolled" : ""}`}>
          <button
            data-month="-1"
            className={`cct-month-tab cct-month-tab-all ${selectedMonth === -1 ? "active" : ""}`}
            onClick={() => setSelectedMonth(-1)}
          >
            All
          </button>
          <div ref={monthTabsRef} className="cct-month-tabs">
            {MONTHS.map((month, idx) => (
              <button
                key={month}
                data-month={idx}
                className={`cct-month-tab ${selectedMonth === idx ? "active" : ""}`}
                onClick={() => setSelectedMonth(idx)}
              >
                {month}
              </button>
            ))}
          </div>
        </div>
        <div className="cct-year-picker">
          <label className="label" htmlFor="credit-transactions-year">Statement Year</label>
          <NumericCalculatorInput
            id="credit-transactions-year"
            min="2020"
            max="2100"
            allowDecimal={false}
            value={selectedYear}
            onValueChange={(value) => setSelectedYear(parseInt(value || String(new Date().getFullYear()), 10))}
          />
        </div>
      </div>

      {/* Summary Section */}
      <div className="cct-summary">
        <div className="cct-summary-left">
          <div className="cct-summary-item">
            <span className="cct-summary-label">Total Amount</span>
            <span className={`cct-summary-value ${getAmountToneClass(totals.total)}`}>{formatCurrency(totals.total)}</span>
          </div>
          <div className="cct-summary-group">
            <div className="cct-summary-item">
              <span className="cct-summary-label">Total Receivable</span>
              <span className="cct-summary-value">{formatCurrency(receivablesSummary.data?.totalCents ?? 0)}</span>
            </div>
            <div className="cct-summary-item">
              <span className="cct-summary-label">{defaultReceivableSubaccount?.name ?? "Default Subaccount"}</span>
              <span className={`cct-summary-value ${getAmountToneClass(defaultSubaccountBalance)}`}>{formatCurrency(defaultSubaccountBalance)}</span>
            </div>
          </div>
        </div>
        {totals.unaccounted > 0 && (
          <div className="cct-summary-right">
            <div className="cct-summary-item cct-summary-deficit">
              <span className="cct-summary-label">Shortfall</span>
              <span className={`cct-summary-value ${getAmountToneClass(totals.unaccounted)}`}>{formatCurrency(totals.unaccounted)}</span>
            </div>
          </div>
        )}
      </div>

      {balanceStatus ? <div className={balanceStatus.className}>{balanceStatus.label}</div> : null}

      {hasMonthlyPaymentBalance && (
        <div className="cct-due-panel">
          <div className="cct-due-panel-meta">
            <span className="cct-summary-label">Payment Due</span>
            {earliestPaymentDueDate ? (
              <span className={`cct-due-badge ${earliestDueIsOverdue ? "overdue" : earliestDueIsUrgent ? "urgent" : ""}`}>
                {earliestDueIsOverdue ? "⚠️ " : earliestDueIsUrgent ? "⏰ " : ""}
                {formatDate(earliestPaymentDueDate)}
              </span>
            ) : (
              <span className="cct-summary-meta">—</span>
            )}
          </div>
          <div className="cct-due-panel-controls">
            <input
              type="date"
              className="input cct-due-input"
              value={sharedPaymentDueDate}
              onChange={(e) => setSharedPaymentDueDate(e.target.value)}
              disabled={!canEditSharedPaymentDue || updateSharedPaymentDue.isPending}
            />
            <button
              type="button"
              className="btn btn-primary btn-xs cct-due-save-btn"
              onClick={saveSharedPaymentDue}
              disabled={!canEditSharedPaymentDue || updateSharedPaymentDue.isPending}
            >
              {updateSharedPaymentDue.isPending ? "Saving..." : "Save Due Date"}
            </button>
            {hasMonthlyPaymentBalance ? (
              <button
                type="button"
                className="btn btn-primary btn-xs cct-due-save-btn"
                onClick={submitPayment}
                disabled={!canMakePayment || makePayment.isPending}
                title={
                  canMakePayment
                    ? `Make payment of ${formatCurrency(payableAmountCents)}`
                    : "Configure default receivable account and subaccount in Settings"
                }
              >
                {makePayment.isPending ? "Processing..." : "Make Payment"}
              </button>
            ) : null}
          </div>
        </div>
      )}
      {paymentDueMessage ? (
        <div className="cct-inline-note">{paymentDueMessage}</div>
      ) : null}

      {/* Actions */}
      <div className="cct-actions">
        {unaccountedTransactionCount > 0 ? (
          <label className="cct-toggle">
            <input
              type="checkbox"
              checked={showUnaccountedOnly}
              onChange={(e) => setShowUnaccountedOnly(e.target.checked)}
            />
            <span>Unaccounted only</span>
          </label>
        ) : null}
        <button className="btn btn-primary mobile-primary-create" onClick={openModal} aria-label="Add card transaction" title="Add card transaction">
          <Plus size={18} aria-hidden="true" />
          <span className="mobile-primary-create-label">Add Transaction</span>
        </button>
        {canImportMaybankCsv && (
          <button
            type="button"
            className="btn btn-ghost btn-icon cct-import-btn"
            onClick={() => maybankFileInputRef.current?.click()}
            disabled={importMaybankCsv.isPending}
            title={importMaybankCsv.isPending ? "Importing Maybank CSV" : "Import Maybank CSV"}
            aria-label={importMaybankCsv.isPending ? "Importing Maybank CSV" : "Import Maybank CSV"}
          >
            {importMaybankCsv.isPending ? "…" : "📄"}
          </button>
        )}
        <input
          ref={maybankFileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="cct-file-input"
          onChange={onPickMaybankCsv}
          disabled={!canImportMaybankCsv || importMaybankCsv.isPending}
        />
      </div>
      {importMessage ? (
        <div className="cct-import-message">
          {importMessage}
        </div>
      ) : null}
      {importProgress > 0 ? (
        <div className="cct-import-progress" aria-label="CSV import progress" aria-live="polite">
          <progress className="cct-import-progress-track" value={Math.min(importProgress, 100)} max={100} />
          <div className="cct-import-progress-text">
            {importMaybankCsv.isPending ? `Importing CSV ${Math.round(importProgress)}%` : "Import complete"}
          </div>
        </div>
      ) : null}

      {/* Transactions Table */}
      <div className="cct-table-wrapper">
        <table className="cct-table responsive-data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Subject</th>
              <th>Amount</th>
              <th>Card</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <CreditTransactionsTableRowsSkeleton />}

            {isError && (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state cct-load-error">
                    <div className="empty-state-icon">⚠️</div>
                    <h3 className="empty-state-title">Failed to load transactions</h3>
                    <button className="btn btn-primary" onClick={() => refetch()}>
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && !isError && transactionDateGroups.map((group) => (
              <Fragment key={group.key}>
                <tr className="cct-date-group-row">
                  <td colSpan={5}>
                    <time dateTime={group.dateTime || undefined}>{group.label}</time>
                  </td>
                </tr>
                {group.transactions.map((tx) => {
                  const isDeleting = deletingTransactionIds.includes(tx.id);
                  return (
                    <tr
                      key={tx.id}
                      className={`cct-transaction-row ${tx.isAllocated ? "allocated" : "unallocated"}${isDeleting ? " cct-row-deleting" : ""}`}
                    >
                      <td className="cct-tx-date" data-label="Date">
                        <span className="cct-tx-day">{formatDate(tx.transactionDate)}</span>
                      </td>
                      <td className="cct-tx-subject" data-label="Subject">
                        <div className="cct-subject-wrapper">
                          <span>{tx.subject}</span>
                        </div>
                      </td>
                      <td className={`cct-tx-amount ${getAmountToneClass(tx.amountCents)}`} data-label="Amount">{formatCurrency(tx.amountCents)}</td>
                      <td className="cct-tx-card" data-label="Card">
                        <label className="cct-card-checkbox">
                          <input
                            type="checkbox"
                            checked={tx.isAllocated}
                            onChange={() => toggleAllocated.mutate({ id: tx.id, isAllocated: !tx.isAllocated })}
                            disabled={tx.isAllocated}
                            aria-label={`${tx.subject} accounted`}
                          />
                          <span>{tx.creditCard.cardName}</span>
                        </label>
                      </td>
                      <td className="cct-tx-actions" data-label="Actions">
                        {!tx.isAllocated ? (
                          <>
                            <button
                              className="btn btn-ghost btn-icon cct-action-btn cct-action-accounting"
                              onClick={() => openDeductModal(tx)}
                              disabled={accountCreditTxn.isPending || isDeleting}
                              title="Deduct transaction"
                              aria-label="Deduct transaction"
                            >
                              ➖
                            </button>
                            <button
                              className="btn btn-ghost btn-icon cct-action-btn cct-action-accounting"
                              onClick={() => openReceivableModal(tx)}
                              disabled={accountCreditTxn.isPending || isDeleting}
                              title="Create receivable"
                              aria-label="Create receivable"
                            >
                              🧾
                            </button>
                          </>
                        ) : (
                          <span className="cct-action-placeholder" aria-hidden="true" />
                        )}
                        <button
                          className="btn btn-ghost btn-icon cct-action-btn cct-action-edit"
                          onClick={() => openEditModal(tx)}
                          disabled={updateTransaction.isPending || isDeleting}
                          title="Edit transaction"
                          aria-label={`Edit transaction: ${tx.subject}`}
                        >
                          ✏️
                        </button>
                        <button
                          className="btn btn-ghost btn-icon cct-action-btn cct-action-delete"
                          onClick={() => confirmDeleteTransaction(tx.id)}
                          disabled={deleteTransaction.isPending || isDeleting}
                          title="Delete transaction"
                          aria-label={`Delete transaction: ${tx.subject}`}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {!isLoading && !isError && filteredTransactions.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon="🧾"
                    title="No transactions yet"
                    description="Add your first credit card transaction to start tracking your spending and payment due dates."
                    action={
                      <button className="btn btn-primary" onClick={openModal}>
                        + Add Transaction
                      </button>
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Transaction Modal */}
      {isModalOpen && (
        <div className="cct-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeModal)}>
          <div className="cct-modal cct-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="cct-modal-header">
              <h3>{editingTransactionId ? "Edit Credit Card Transaction" : "Add Credit Card Transaction"}</h3>
              <ModalCloseButton onClick={closeModal} label={`Close ${editingTransactionId ? "Edit Credit Card Transaction" : "Add Credit Card Transaction"}`} />
            </div>
            <form className="cct-modal-form" onSubmit={onSubmit}>
              <div className="cct-form-grid">
                <div className="form-group cct-span-2">
                  <label className="label">Credit Card</label>
                  <select className="input" value={formCardId} onChange={(e) => setFormCardId(e.target.value)} required>
                    {sortedCards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.cardName} ••{card.last4Digit}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Transaction Date</label>
                  <input
                    type="date"
                    className="input"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Payment Due Date</label>
                  <input type="date" className="input" value={formPaymentDue} onChange={(e) => setFormPaymentDue(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="label">Statement Month</label>
                  <select
                    className="input"
                    value={formStatementMonth}
                    onChange={(e) => setFormStatementMonth(e.target.value)}
                    required
                  >
                    {MONTHS.map((month, idx) => (
                      <option key={month} value={idx + 1}>
                        {month}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Statement Year</label>
                  <NumericCalculatorInput
                    min="2020"
                    max="2100"
                    allowDecimal={false}
                    value={formStatementYear}
                    onValueChange={setFormStatementYear}
                    required
                  />
                </div>
                <div className="form-group cct-span-2">
                  <label className="label">Subject</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Grocery shopping"
                    value={formSubject}
                    onChange={(e) => setFormSubject(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Amount ($)</label>
                  <NumericCalculatorInput
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={formAmount}
                    onValueChange={setFormAmount}
                    required
                  />
                </div>
              </div>
              <div className="cct-modal-actions">
                {editingTransactionId ? (
                  <button
                    type="button"
                    className="btn btn-danger cct-modal-delete"
                    onClick={() => confirmDeleteTransaction(editingTransactionId)}
                    disabled={deleteTransaction.isPending || updateTransaction.isPending}
                  >
                    {deletingTransactionIds.includes(editingTransactionId) ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createTransaction.isPending || updateTransaction.isPending}
                >
                  {editingTransactionId
                    ? updateTransaction.isPending
                      ? "Saving..."
                      : "Save Changes"
                    : createTransaction.isPending
                      ? "Adding..."
                      : "Add Transaction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAccountingModalOpen && accountingTarget && (
        <div className="cct-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeAccountingModal)}>
          <div className="cct-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cct-modal-header">
              <h3>Deduct Credit Transaction</h3>
              <ModalCloseButton onClick={closeAccountingModal} label="Close Deduct Credit Transaction" />
            </div>
            <form className="cct-modal-form" onSubmit={onSubmitDeduct}>
              <div className="cct-form-grid">
                <div className="form-group cct-span-2">
                  <label className="label">Reference</label>
                  <div className="input cct-reference-input">
                    {accountingTarget.subject} • {formatCurrency(accountingTarget.amountCents)}
                  </div>
                </div>
                <div className="form-group cct-span-2">
                  <label className="label">Bank Account</label>
                  <select
                    className="input"
                    value={deductAccountId}
                    onChange={(e) => {
                      const nextAccountId = e.target.value;
                      setDeductAccountId(nextAccountId);
                      const nextBudgetId = (budgets.data ?? []).find((budget) => budget.accountId === nextAccountId)?.id || "";
                      setDeductBudgetId(nextBudgetId);
                    }}
                    required
                  >
                    <option value="" disabled>Select account</option>
                    {(bankAccounts.data ?? []).map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group cct-span-2">
                  <label className="label">Sub Account</label>
                  <select
                    className="input"
                    value={deductBudgetId}
                    onChange={(e) => setDeductBudgetId(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select sub account</option>
                    {filteredBudgets.map((budget) => (
                      <option key={budget.id} value={budget.id}>
                        {budget.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="cct-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeAccountingModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={accountCreditTxn.isPending}>
                  {accountCreditTxn.isPending ? "Saving..." : "Deduct"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isReceivableModalOpen && receivableTarget && (
        <div className="cct-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeReceivableModal)}>
          <div className="cct-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cct-modal-header">
              <h3>Create Receivable</h3>
              <ModalCloseButton onClick={closeReceivableModal} label="Close Create Receivable" />
            </div>
            <form className="cct-modal-form cct-receivable-form" onSubmit={onSubmitReceivable}>
              <div className="cct-form-grid">
                <div className="form-group cct-span-2">
                  <label className="label">Reference</label>
                  <div className="input cct-reference-input">
                    {receivableTarget.subject}
                  </div>
                </div>
                <div className="form-group cct-span-2">
                  <label className="label">Title</label>
                  <input className="input" type="text" value={receivableTitle} onChange={(e) => setReceivableTitle(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="label">Receivable Date</label>
                  <input className="input" type="date" value={receivableDate} onChange={(e) => setReceivableDate(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="label">Txn Date</label>
                  <input className="input" type="date" value={receivableTxnDate} onChange={(e) => setReceivableTxnDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="label">Amount ($)</label>
                  <NumericCalculatorInput step="0.01" min="0.01" value={receivableAmount} onValueChange={setReceivableAmount} required />
                </div>
                <label className="form-group cct-span-2 cct-cross-workspace-toggle">
                  <input
                    type="checkbox"
                    checked={useCrossWorkspaceReceivableSource}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setUseCrossWorkspaceReceivableSource(checked);
                      if (!checked) {
                        setReceivableSourceWorkspaceId("");
                        setReceivableSourceAccountId("");
                        setReceivableSourceBudgetId("");
                      }
                    }}
                  />
                  Deduct from another workspace
                </label>
                {useCrossWorkspaceReceivableSource && (
                  <>
                    <div className="form-group">
                      <label className="label">Deduction Workspace</label>
                      <select
                        className="input"
                        value={receivableSourceWorkspaceId}
                        onChange={(e) => {
                          setReceivableSourceWorkspaceId(e.target.value);
                          setReceivableSourceAccountId("");
                          setReceivableSourceBudgetId("");
                        }}
                        required
                      >
                        <option value="">Select workspace</option>
                        {workspacesForReceivableSource.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="label">Bank Account</label>
                      <select
                        className="input"
                        value={receivableSourceAccountId}
                        onChange={(e) => {
                          const nextAccountId = e.target.value;
                          setReceivableSourceAccountId(nextAccountId);
                          const nextBudgetId =
                            (receivableSourceBudgets.data ?? []).find((budget) => budget.accountId === nextAccountId)?.id || "";
                          setReceivableSourceBudgetId(nextBudgetId);
                        }}
                        disabled={!receivableSourceWorkspaceId || receivableSourceAccounts.isLoading}
                        required
                      >
                        <option value="">Select account</option>
                        {(receivableSourceAccounts.data ?? []).map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group cct-span-2">
                      <label className="label">Sub Account</label>
                      <select
                        className="input"
                        value={receivableSourceBudgetId}
                        onChange={(e) => {
                          const budgetId = e.target.value;
                          setReceivableSourceBudgetId(budgetId);
                          const selectedBudget = receivableBudgetsById.get(budgetId);
                          if (selectedBudget) {
                            setReceivableSourceAccountId(selectedBudget.accountId);
                          }
                        }}
                        disabled={
                          !receivableSourceWorkspaceId ||
                          !receivableSourceAccountId ||
                          receivableSourceBudgets.isLoading
                        }
                        required
                      >
                        <option value="">Select sub account</option>
                        {filteredReceivableSourceBudgets.map((budget) => (
                          <option key={budget.id} value={budget.id}>
                            {budget.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <MarkdownEditor
                  className="form-group cct-span-2"
                  label="Notes"
                  value={receivableNotes}
                  onChange={setReceivableNotes}
                  placeholder="Write notes in Markdown"
                  calculator
                />
              </div>
              <div className="cct-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeReceivableModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={accountCreditTxn.isPending}>
                  {accountCreditTxn.isPending ? "Saving..." : "Create Receivable"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
