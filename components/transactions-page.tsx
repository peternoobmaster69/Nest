"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { getBrowserCookie, setBrowserCookie } from "@/lib/browser-cookies";
import { MarkdownEditor } from "@/components/markdown-editor";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { SkeletonMiniCard, SkeletonList, EmptyState, LoadingDots } from "@/components/ui-skeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";

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
  subject: string;
  details?: string | null;
  notes?: string | null;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  kind: string;
  date: string;
};

type Receivable = {
  id: string;
  title: string;
  amountCents: number;
  date: string;
  status: "OPEN" | "PARTIAL" | "PAID" | "VOID";
  budgetId?: string | null;
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
  const [operation, setOperation] = useState<"DEDUCT" | "ADD">("ADD");
  const [selectedBankId, setSelectedBankId] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [bankFilterHydrated, setBankFilterHydrated] = useState(false);
  const [activeBudgetFilterId, setActiveBudgetFilterId] = useState<string>("ALL");
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
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);

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

  const transactions = useQuery({
    queryKey: ["transactions", workspaceId],
    queryFn: () => fetchJson<Transaction[]>(`/api/transactions?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const receivables = useQuery({
    queryKey: ["receivables", workspaceId],
    queryFn: () => fetchJson<Receivable[]>(`/api/receivables?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const isRefreshing =
    (bankAccounts.isFetching && !bankAccounts.isLoading) ||
    (budgets.isFetching && !budgets.isLoading) ||
    (transactions.isFetching && !transactions.isLoading);

  useEffect(() => {
    if (!txBankStorageKey) return;
    const saved = getBrowserCookie(txBankStorageKey);
    if (saved) {
      setSelectedBankId(saved);
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
    if (!txBankStorageKey || !selectedBankId || !bankFilterHydrated) return;
    setBrowserCookie(txBankStorageKey, selectedBankId);
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
          budgetOperation: payload.budgetOperation,
        }),
      }),
    onSuccess: async () => {
      setSubject("");
      setNotes("");
      setAmount("");
      setBudgetId("");
      setOperation("ADD");
      setTransactionDate("");
      setIsCreateModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
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
      void queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
    },
  });

  const updateTx = useMutation({
    mutationFn: (payload: { id: string; subject: string; notes?: string | null; amountCents: number; operation: "DEDUCT" | "ADD"; date: string; budgetId: string }) =>
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
      void queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
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
      await queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId], refetchType: "active" });
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
      budgetOperation: operation,
    });
  };

  const visibleBudgets = useMemo(() => {
    if (!budgets.data?.length) return [];
    if (!selectedBankId) return budgets.data;
    return budgets.data.filter((b) => b.accountId === selectedBankId);
  }, [budgets.data, selectedBankId]);
  const editingTransaction = useMemo(
    () => (transactions.data ?? []).find((tx) => tx.id === editingTxId) ?? null,
    [transactions.data, editingTxId],
  );
  const editableBudgets = useMemo(() => {
    if (!budgets.data?.length) return [];
    if (!editingTransaction) return budgets.data;
    return budgets.data.filter((budget) => budget.accountId === editingTransaction.accountId);
  }, [budgets.data, editingTransaction]);

  const filteredTransactions = useMemo(() => {
    const all = transactions.data ?? [];
    return all.filter((tx) => {
      if (selectedBankId && tx.accountId !== selectedBankId) return false;
      if (activeBudgetFilterId !== "ALL" && tx.budgetId !== activeBudgetFilterId) return false;
      return true;
    });
  }, [transactions.data, selectedBankId, activeBudgetFilterId]);

  const bankScopedTransactions = useMemo(() => {
    const all = transactions.data ?? [];
    return all.filter((tx) => (selectedBankId ? tx.accountId === selectedBankId : true));
  }, [transactions.data, selectedBankId]);

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
      (receivables.data ?? [])
        .filter(
          (receivable) =>
            receivable.budgetId === receivableInfoBudgetId &&
            (receivable.status === "OPEN" || receivable.status === "PARTIAL"),
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [receivables.data, receivableInfoBudgetId],
  );
  const receivableInfoTotalCents = useMemo(
    () => receivableInfoItems.reduce((sum, receivable) => sum + receivable.amountCents, 0),
    [receivableInfoItems],
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
  };

  useEffect(() => {
    if (!isCreateModalOpen) return;
    if (!visibleBudgets.length) return;
    if (!budgetId || !visibleBudgets.some((budget) => budget.id === budgetId)) {
      setBudgetId(visibleBudgets[0].id);
    }
  }, [isCreateModalOpen, visibleBudgets, budgetId]);

  useEffect(() => {
    if (!editingTxId) return;
    if (!editableBudgets.length) return;
    if (!editBudgetId || !editableBudgets.some((budget) => budget.id === editBudgetId)) {
      setEditBudgetId(editableBudgets[0].id);
    }
  }, [editingTxId, editableBudgets, editBudgetId]);

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
    });
  };

  const openCreateModal = () => {
    createTx.reset();
    setSubject("");
    setNotes("");
    setAmount("");
    setOperation("ADD");
    setBudgetId(activeBudgetFilterId !== "ALL" ? activeBudgetFilterId : visibleBudgets[0]?.id ?? "");
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

  const confirmDeleteTx = (transactionId: string) => {
    if (!confirmDestructiveAction("Delete this transaction?")) return;
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

  const syncSelectedBankBalance = () => {
    if (!selectedBank) return;
    if (!confirmDestructiveAction(`Update ${selectedBank.name} balance to match the sub-account total?`)) return;
    updateBankBalance.mutate({
      id: selectedBank.id,
      startingCents: displayedLinkedBudgetCents,
    });
  };

  return (
    <div className="txn-page" style={{ display: "grid", gap: "14px" }}>
      {isRefreshing ? (
        <div className="tx-refresh-indicator" aria-live="polite">
          <LoadingDots className="tx-refresh-dots" />
          <span className="tx-refresh-label">Refreshing</span>
        </div>
      ) : null}

      {/* Compact Bank Selector */}
      {bankAccounts.isLoading ? (
        <SkeletonMiniCard />
      ) : (
        <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
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
      )}

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={openTransferModal} disabled={(budgets.data?.length ?? 0) < 2}>
          Transfer
        </button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={openCreateModal}>
          Add Transaction
        </button>
      </div>

      <section ref={subAccountsRef} className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
            <span aria-hidden="true">📁</span>
            <span>Sub-Accounts</span>
          </div>
          <div
            style={{
              fontSize: "12px",
              color: hasDisplayedDiscrepancy ? "var(--warning)" : "var(--text-secondary)",
              fontWeight: hasDisplayedDiscrepancy ? 600 : 500,
            }}
          >
            📊 {formatCents(visibleBudgetTotalCents)}&emsp;&emsp;🏦 {formatCents(displayedBankBalanceCents)}&emsp;
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
                <div className="bm-name">{b.name}</div>
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

      <section ref={recentTransactionsRef} className="card">
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "10px" }}>Recent Transactions</div>
        <div className="simple-list">
          {transactions.isLoading && <SkeletonList count={5} type="transaction" />}

          {transactions.isError && (
            <div className="empty-state" style={{ padding: "40px 20px" }}>
              <div className="empty-state-icon">⚠️</div>
              <h3 className="empty-state-title">Failed to load transactions</h3>
              <button className="btn btn-primary" onClick={() => transactions.refetch()}>
                Retry
              </button>
            </div>
          )}

          {!transactions.isLoading && !transactions.isError && filteredTransactions.map((tx) => {
            const isDeleting = deletingTransactionIds.includes(tx.id);
            return (
            <div
              key={tx.id}
              className={`crud-row tx-recent-row${isDeleting ? " crud-row-deleting" : ""}`}
              onClick={() => !isDeleting && beginEdit(tx)}
              onKeyDown={(event) => {
                if (isDeleting) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  beginEdit(tx);
                }
              }}
              role="button"
              tabIndex={isDeleting ? -1 : 0}
              aria-label={`Edit transaction ${tx.subject}`}
            >
              <div className="tx-recent-main">
                <span className="tx-recent-head">
                  <span className="tx-recent-subject">{tx.subject}</span>
                  <span className={`tx-recent-amount ${getAmountToneClass(tx.direction === "DEBIT" ? -tx.amountCents : tx.amountCents)}`}>
                    {formatCents(tx.amountCents)}
                  </span>
                </span>
                <span className="tx-recent-date">{new Date(tx.date).toLocaleString()}</span>
              </div>
            </div>
          )})}
          {!transactions.isLoading && !transactions.isError && filteredTransactions.length === 0 && (
            <EmptyState
              icon="📑"
              title="No transactions yet"
              description={selectedBankId ? "Add your first transaction for this bank account." : "Add your first transaction to start tracking your spending."}
              action={
                <button className="btn btn-primary" onClick={openCreateModal}>
                  + Add Transaction
                </button>
              }
            />
          )}
        </div>
      </section>

      {isCreateModalOpen && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
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
                    <select className="input" value={budgetId} onChange={(e) => setBudgetId(e.target.value)} required>
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
        <div className="profile-modal-overlay" onClick={closeEditModal}>
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
                <select className="input" value={editBudgetId} onChange={(e) => setEditBudgetId(e.target.value)} required>
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
        <div className="profile-modal-overlay" onClick={closeEditBankBalance}>
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
        <div className="profile-modal-overlay" onClick={closeTransferModal}>
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
        <div className="profile-modal-overlay" onClick={() => setReceivableInfoBudgetId(null)}>
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
                {receivables.isLoading ? (
                  <SkeletonList count={3} type="transaction" />
                ) : receivableInfoItems.length ? (
                  receivableInfoItems.map((receivable) => (
                    <div key={receivable.id} className="crud-row">
                      <div style={{ display: "grid", gap: "3px" }}>
                        <div style={{ fontWeight: 600 }}>{receivable.title || "Receivable"}</div>
                        <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {new Date(receivable.date).toLocaleDateString()} · {receivable.status}
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
    </div>
  );
}
