"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { MarkdownEditor } from "@/components/markdown-editor";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { SkeletonTableRow, EmptyState } from "@/components/ui-skeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";

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

type AppContext = {
  workspaceId: string | null;
  baseCurrency?: string | null;
  defaultAccountId?: string | null;
  defaultBudgetId?: string | null;
};

type BankAccount = {
  id: string;
  name: string;
  isActive: boolean;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  isActive: boolean;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CREDIT_TX_MONTH_COOKIE = "nest_credit_tx_month";
const CREDIT_TX_CARD_COOKIE = "nest_credit_tx_card";

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function toDateInputValue(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
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

export function CreditTransactionsPage({ initialCards }: { initialCards: CreditCard[] }) {
  const queryClient = useQueryClient();
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
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [showUnaccountedOnly, setShowUnaccountedOnly] = useState(false);
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
  const [sharedPaymentDueDate, setSharedPaymentDueDate] = useState("");
  const [deletingTransactionIds, setDeletingTransactionIds] = useState<string[]>([]);

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
    const savedMonth = readCookie(CREDIT_TX_MONTH_COOKIE);
    const savedCard = readCookie(CREDIT_TX_CARD_COOKIE);

    if (savedMonth !== null) {
      const parsedMonth = parseInt(savedMonth, 10);
      if (parsedMonth >= -1 && parsedMonth <= 11) {
        setSelectedMonth(parsedMonth);
      }
    }

    if (savedCard) {
      setSelectedCardId(savedCard);
    }

    setFiltersReady(true);
  }, []);

  useEffect(() => {
    if (!filtersReady) return;
    writeCookie(CREDIT_TX_MONTH_COOKIE, String(selectedMonth));
  }, [filtersReady, selectedMonth]);

  useEffect(() => {
    if (!filtersReady) return;
    if (selectedCardId !== "all" && !sortedCards.some((card) => card.id === selectedCardId)) {
      setSelectedCardId("all");
      return;
    }
    writeCookie(CREDIT_TX_CARD_COOKIE, selectedCardId);
  }, [filtersReady, selectedCardId, sortedCards]);

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

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["credit-transactions", selectedCardId, selectedYear, selectedMonth],
    queryFn: () =>
      fetchJson<{
        transactions: CreditCardTransaction[];
        cardCounts: CardCount[];
      }>(`/api/credit-transactions?${new URLSearchParams({
        cardId: selectedCardId,
        year: String(selectedYear),
        ...(selectedMonth >= 0 ? { month: String(selectedMonth + 1) } : {}),
      }).toString()}`),
    enabled: sortedCards.length > 0,
  });

  const transactions = data?.transactions || [];
  const cardCounts = data?.cardCounts || [];
  const selectedCard = useMemo(
    () => sortedCards.find((card) => card.id === selectedCardId) ?? null,
    [selectedCardId, sortedCards],
  );
  const selectedCardBank = getSingaporeBankByName(selectedCard?.bankName);
  const canImportMaybankCsv = selectedCardBank?.code === "MAYBANK";

  const filteredTransactions = useMemo(() => {
    if (!showUnaccountedOnly) return transactions;
    return transactions.filter((t) => !t.isAllocated);
  }, [transactions, showUnaccountedOnly]);

  const totals = useMemo(() => {
    const total = filteredTransactions.reduce((sum, t) => sum + t.amountCents, 0);
    const unaccounted = filteredTransactions.filter((t) => !t.isAllocated).reduce((sum, t) => sum + t.amountCents, 0);
    return { total, unaccounted };
  }, [filteredTransactions]);

  const earliestPaymentDue = useMemo(() => {
    const dueTransactions = transactions.filter((t) => t.paymentDueDate);
    if (dueTransactions.length === 0) return null;

    return dueTransactions.reduce((earliest, tx) => {
      if (!earliest.paymentDueDate) return tx;
      return new Date(tx.paymentDueDate!).getTime() < new Date(earliest.paymentDueDate).getTime() ? tx : earliest;
    });
  }, [transactions]);

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
      fetchJson("/api/credit-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
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
      fetchJson(`/api/credit-transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
      closeModal();
    },
  });

  const deleteTransaction = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/credit-transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credit-transactions"] }),
    onError: (_error, id) => {
      setDeletingTransactionIds((current) => current.filter((item) => item !== id));
    },
  });

  const toggleAllocated = useMutation({
    mutationFn: ({ id, isAllocated }: { id: string; isAllocated: boolean }) =>
      fetchJson(`/api/credit-transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAllocated }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credit-transactions"] }),
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
    onSuccess: (result) => {
      setImportMessage(
        `Maybank CSV imported: ${result.imported} added, ${result.skippedDuplicates} duplicates skipped, ${result.skippedPayments} payment rows skipped.`,
      );
      queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
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
    onSuccess: (_result, variables) => {
      setImportMessage(
        variables.action === "DEDUCT"
          ? "Credit transaction deducted and marked accounted."
          : "Receivable created and credit transaction marked accounted.",
      );
      queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["receivables"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
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
    onSuccess: (result) => {
      setPaymentDueMessage(
        result.updatedCount > 0
          ? `Payment due updated for ${result.updatedCount} transaction${result.updatedCount === 1 ? "" : "s"}.`
          : "No transactions matched this statement month.",
      );
      queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
    },
    onError: (error) => {
      setPaymentDueMessage(error instanceof Error ? error.message : "Failed to update payment due date.");
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
    const initialAccountId = deductAccountId || bankAccounts.data?.[0]?.id || "";
    setDeductAccountId(initialAccountId);
    const firstBudgetForAccount =
      budgets.data?.find((budget) => budget.accountId === initialAccountId)?.id || "";
    setDeductBudgetId(firstBudgetForAccount);
    setIsAccountingModalOpen(true);
  };

  const closeAccountingModal = () => {
    setIsAccountingModalOpen(false);
    setAccountingTarget(null);
  };

  const openReceivableModal = (tx: CreditCardTransaction) => {
    setReceivableTarget(tx);
    setReceivableDate(toDateInputValue(tx.transactionDate));
    setReceivableTxnDate(toDateInputValue(tx.transactionDate));
    setReceivableAmount((tx.amountCents / 100).toFixed(2));
    setReceivableTitle(tx.subject);
    setReceivableNotes("");
    setIsReceivableModalOpen(true);
  };

  const closeReceivableModal = () => {
    setIsReceivableModalOpen(false);
    setReceivableTarget(null);
    setReceivableTitle("");
    setReceivableNotes("");
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
    accountCreditTxn.mutate({
      id: receivableTarget.id,
      action: "RECEIVABLE",
      receivableDate: new Date(`${receivableDate}T00:00:00.000Z`).toISOString(),
      transactionDate: receivableTxnDate ? new Date(`${receivableTxnDate}T00:00:00.000Z`).toISOString() : undefined,
      amountCents: Math.round(Number(receivableAmount || "0") * 100),
      title: receivableTitle || receivableTarget.subject,
      notes: receivableNotes || undefined,
      accountId: defaultReceivableAccountId || undefined,
      budgetId: defaultReceivableBudgetId || undefined,
    });
  };

  useEffect(() => {
    setSharedPaymentDueDate(earliestPaymentDue?.paymentDueDate ? toDateInputValue(earliestPaymentDue.paymentDueDate) : "");
  }, [earliestPaymentDue?.paymentDueDate, selectedCardId, selectedMonth, selectedYear]);

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

  const confirmDeleteTransaction = (transactionId: string) => {
    if (!confirmDestructiveAction("Delete this credit card transaction permanently? This cannot be undone.")) return;
    if (deletingTransactionIds.includes(transactionId)) return;
    setDeletingTransactionIds((current) => [...current, transactionId]);
    window.setTimeout(() => {
      deleteTransaction.mutate(transactionId);
    }, 180);
  };

  const earliestDueDays = earliestPaymentDue?.paymentDueDate ? getDaysUntil(earliestPaymentDue.paymentDueDate) : null;
  const earliestDueIsOverdue = earliestDueDays !== null && earliestDueDays < 0;
  const earliestDueIsUrgent = earliestDueDays !== null && earliestDueDays >= 0 && earliestDueDays <= 3;
  const canEditSharedPaymentDue = selectedMonth >= 0;
  const saveSharedPaymentDue = () => {
    if (!canEditSharedPaymentDue) return;
    updateSharedPaymentDue.mutate({
      ...(selectedCardId !== "all" ? { cardId: selectedCardId } : {}),
      statementMonth: selectedMonth + 1,
      statementYear: selectedYear,
      paymentDueDate: sharedPaymentDueDate ? new Date(`${sharedPaymentDueDate}T00:00:00.000Z`).toISOString() : null,
    });
  };

  return (
    <div className="cct-container">
      {/* Card Selector Bar */}
      <div className="cct-card-bar">
        <button
          className={`cct-card-chip ${selectedCardId === "all" ? "active" : ""}`}
          onClick={() => setSelectedCardId("all")}
        >
          <span className="cct-card-chip-icon">📋</span>
          <span className="cct-card-chip-name">All Cards</span>
          {transactions.length > 0 && <span className="cct-card-chip-badge">{transactions.length}</span>}
        </button>
        {sortedCards.map((card) => {
          const bank = getSingaporeBankByName(card.bankName);
          const logo = getBankLogoUrl(bank);
          const count = getCardCount(card.id);
          return (
            <button
              key={card.id}
              className={`cct-card-chip ${selectedCardId === card.id ? "active" : ""}`}
              onClick={() => setSelectedCardId(card.id)}
            >
              {logo && !failedLogos[card.id] ? (
                <img
                  src={logo}
                  alt={card.bankName || ""}
                  className="cct-card-chip-logo"
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

      {/* Period Filter */}
      <div className="cct-period-bar">
        <div className="cct-month-tabs">
          <button
            className={`cct-month-tab ${selectedMonth === -1 ? "active" : ""}`}
            onClick={() => setSelectedMonth(-1)}
          >
            All
          </button>
          {MONTHS.map((month, idx) => (
            <button
              key={month}
              className={`cct-month-tab ${selectedMonth === idx ? "active" : ""}`}
              onClick={() => setSelectedMonth(idx)}
            >
              {month}
            </button>
          ))}
        </div>
        <div className="cct-year-picker">
          <label className="label" htmlFor="credit-transactions-year">Statement Year</label>
          <input
            id="credit-transactions-year"
            type="number"
            min="2020"
            max="2100"
            className="input"
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value || String(new Date().getFullYear()), 10))}
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
          <label className="cct-toggle">
            <input
              type="checkbox"
              checked={showUnaccountedOnly}
              onChange={(e) => setShowUnaccountedOnly(e.target.checked)}
            />
            <span>Unaccounted only</span>
          </label>
        </div>
        <div className="cct-summary-right">
          <div className="cct-summary-item cct-summary-deficit">
            <span className="cct-summary-label">Unallocated</span>
            <span className={`cct-summary-value ${getAmountToneClass(totals.unaccounted)}`}>{formatCurrency(totals.unaccounted)}</span>
          </div>
        </div>
      </div>

      <div className="cct-due-panel">
        <div className="cct-due-panel-meta">
          <span className="cct-summary-label">Payment Due</span>
          {earliestPaymentDue?.paymentDueDate ? (
            <span className={`cct-due-badge ${earliestDueIsOverdue ? "overdue" : earliestDueIsUrgent ? "urgent" : ""}`}>
              {earliestDueIsOverdue ? "⚠️ " : earliestDueIsUrgent ? "⏰ " : ""}
              {formatDate(earliestPaymentDue.paymentDueDate)}
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
        </div>
      </div>
      {selectedMonth < 0 ? (
        <div className="cct-inline-note">Select a statement month to update the shared payment due date.</div>
      ) : null}
      {paymentDueMessage ? (
        <div className="cct-inline-note">{paymentDueMessage}</div>
      ) : null}

      {/* Actions */}
      <div className="cct-actions">
        <button className="btn btn-primary" onClick={openModal}>
          + Add Transaction
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
          style={{ display: "none" }}
          onChange={onPickMaybankCsv}
          disabled={!canImportMaybankCsv || importMaybankCsv.isPending}
        />
      </div>
      {importMessage ? (
        <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--text-secondary)" }}>
          {importMessage}
        </div>
      ) : null}
      {importProgress > 0 ? (
        <div className="cct-import-progress" aria-label="CSV import progress" aria-live="polite">
          <div className="cct-import-progress-track">
            <div
              className="cct-import-progress-bar"
              style={{ width: `${Math.min(importProgress, 100)}%` }}
            />
          </div>
          <div className="cct-import-progress-text">
            {importMaybankCsv.isPending ? `Importing CSV ${Math.round(importProgress)}%` : "Import complete"}
          </div>
        </div>
      ) : null}

      {/* Transactions Table */}
      <div className="cct-table-wrapper">
        <table className="cct-table">
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
            {isLoading && (
              <>
                <SkeletonTableRow cols={5} />
                <SkeletonTableRow cols={5} />
                <SkeletonTableRow cols={5} />
                <SkeletonTableRow cols={5} />
                <SkeletonTableRow cols={5} />
              </>
            )}

            {isError && (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state" style={{ padding: "40px 20px" }}>
                    <div className="empty-state-icon">⚠️</div>
                    <h3 className="empty-state-title">Failed to load transactions</h3>
                    <button className="btn btn-primary" onClick={() => refetch()}>
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && !isError && filteredTransactions.map((tx) => {
              const isDeleting = deletingTransactionIds.includes(tx.id);
              return (
                <tr
                  key={tx.id}
                  className={`${tx.isAllocated ? "allocated" : "unallocated"}${isDeleting ? " cct-row-deleting" : ""}`}
                >
                  <td className="cct-tx-date">
                    <span className="cct-tx-day">{formatDate(tx.transactionDate)}</span>
                  </td>
                  <td className="cct-tx-subject">
                    <div className="cct-subject-wrapper">
                      <span className="cct-subject-icon">🛒</span>
                      <span>{tx.subject}</span>
                    </div>
                  </td>
                  <td className={`cct-tx-amount ${getAmountToneClass(tx.amountCents)}`}>{formatCurrency(tx.amountCents)}</td>
                  <td className="cct-tx-card">
                    <label className="cct-card-checkbox">
                      <input
                        type="checkbox"
                        checked={tx.isAllocated}
                        onChange={() => toggleAllocated.mutate({ id: tx.id, isAllocated: !tx.isAllocated })}
                        disabled={tx.isAllocated}
                      />
                      <span>{tx.creditCard.cardName}</span>
                    </label>
                  </td>
                  <td className="cct-tx-actions">
                    {!tx.isAllocated && (
                      <>
                        <button
                          className="btn btn-ghost btn-icon cct-action-btn"
                          onClick={() => openDeductModal(tx)}
                          disabled={accountCreditTxn.isPending || isDeleting}
                          title="Deduct transaction"
                          aria-label="Deduct transaction"
                        >
                          ➖
                        </button>
                        <button
                          className="btn btn-ghost btn-icon cct-action-btn"
                          onClick={() => openReceivableModal(tx)}
                          disabled={accountCreditTxn.isPending || isDeleting}
                          title="Create receivable"
                          aria-label="Create receivable"
                        >
                          🧾
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn-ghost btn-icon cct-action-btn"
                      onClick={() => openEditModal(tx)}
                      disabled={updateTransaction.isPending || isDeleting}
                      title="Edit transaction"
                      aria-label="Edit transaction"
                    >
                      ✏️
                    </button>
                    <button
                      className="btn btn-ghost btn-icon cct-action-btn cct-action-delete"
                      onClick={() => confirmDeleteTransaction(tx.id)}
                      disabled={deleteTransaction.isPending || isDeleting}
                      title="Delete transaction"
                      aria-label="Delete transaction"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              );
            })}
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
        <div className="cct-modal-overlay" onClick={closeModal}>
          <div className="cct-modal cct-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="cct-modal-header">
              <h3>{editingTransactionId ? "Edit Credit Card Transaction" : "Add Credit Card Transaction"}</h3>
              <button className="cct-close-btn" onClick={closeModal}>
                ✕
              </button>
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
                  <input
                    type="number"
                    min="2020"
                    max="2100"
                    className="input"
                    value={formStatementYear}
                    onChange={(e) => setFormStatementYear(e.target.value)}
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
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    placeholder="0.00"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="cct-modal-actions">
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
        <div className="cct-modal-overlay" onClick={closeAccountingModal}>
          <div className="cct-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cct-modal-header">
              <h3>Deduct Credit Transaction</h3>
              <button className="cct-close-btn" onClick={closeAccountingModal}>✕</button>
            </div>
            <form className="cct-modal-form" onSubmit={onSubmitDeduct}>
              <div className="cct-form-grid">
                <div className="form-group cct-span-2">
                  <label className="label">Reference</label>
                  <div className="input" style={{ display: "flex", alignItems: "center" }}>
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
        <div className="cct-modal-overlay" onClick={closeReceivableModal}>
          <div className="cct-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cct-modal-header">
              <h3>Create Receivable</h3>
              <button className="cct-close-btn" onClick={closeReceivableModal}>✕</button>
            </div>
            <form className="cct-modal-form cct-receivable-form" onSubmit={onSubmitReceivable}>
              <div className="cct-form-grid">
                <div className="form-group cct-span-2">
                  <label className="label">Reference</label>
                  <div className="input" style={{ display: "flex", alignItems: "center" }}>
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
                  <input className="input" type="number" step="0.01" min="0.01" value={receivableAmount} onChange={(e) => setReceivableAmount(e.target.value)} required />
                </div>
                <MarkdownEditor
                  className="form-group cct-span-2"
                  label="Notes"
                  value={receivableNotes}
                  onChange={setReceivableNotes}
                  placeholder="Write notes in Markdown"
                  rows={12}
                  minHeight={300}
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
