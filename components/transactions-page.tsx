"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { MarkdownEditor } from "@/components/markdown-editor";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { FormEvent, useEffect, useMemo, useState } from "react";
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
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
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
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccount | null>(null);
  const [editBankBalance, setEditBankBalance] = useState("");
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferTitle, setTransferTitle] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferSourceBudgetId, setTransferSourceBudgetId] = useState("");
  const [transferDestinationBudgetId, setTransferDestinationBudgetId] = useState("");

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
  });

  const isRefreshing =
    (bankAccounts.isFetching && !bankAccounts.isLoading) ||
    (budgets.isFetching && !budgets.isLoading) ||
    (transactions.isFetching && !transactions.isLoading);

  useEffect(() => {
    if (!txBankStorageKey || typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(txBankStorageKey);
    if (saved) {
      setSelectedBankId(saved);
    }
    setBankFilterHydrated(true);
  }, [txBankStorageKey]);

  useEffect(() => {
    const firstBankId = bankAccounts.data?.[0]?.id;
    if (!selectedBankId && firstBankId) {
      setSelectedBankId(firstBankId);
    }
  }, [bankAccounts.data, selectedBankId]);

  useEffect(() => {
    if (!selectedBankId || !bankAccounts.data?.length) return;
    if (!bankAccounts.data.some((b) => b.id === selectedBankId)) {
      setSelectedBankId(bankAccounts.data[0].id);
    }
  }, [bankAccounts.data, selectedBankId]);

  useEffect(() => {
    if (!txBankStorageKey || typeof window === "undefined" || !selectedBankId || !bankFilterHydrated) return;
    window.sessionStorage.setItem(txBankStorageKey, selectedBankId);
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

  const createTx = useMutation({
    mutationFn: (payload: {
      subject: string;
      notes?: string;
      amountCents: number;
      accountId: string;
      operation: "DEDUCT" | "ADD";
      date: string;
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
          notes: payload.notes,
          amountCents: payload.amountCents,
          direction: payload.operation === "ADD" ? "CREDIT" : "DEBIT",
          kind: payload.operation === "ADD" ? "ADJUSTMENT" : "EXPENSE",
          date: new Date(payload.date).toISOString(),
          budgetId: payload.budgetId,
          budgetOperation: payload.budgetOperation,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] });
      setSubject("");
      setNotes("");
      setAmount("");
      setBudgetId("");
      setOperation("ADD");
      setTransactionDate("");
      setIsCreateModalOpen(false);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      setIsTransferModalOpen(false);
      setTransferTitle("");
      setTransferAmount("");
      setTransferSourceBudgetId("");
      setTransferDestinationBudgetId("");
    },
  });

  const updateTx = useMutation({
    mutationFn: (payload: { id: string; subject: string; notes?: string | null; amountCents: number; operation: "DEDUCT" | "ADD"; date: string }) =>
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
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] });
      setEditingTxId(null);
      setEditSubject("");
      setEditNotes("");
      setEditAmount("");
      setEditOperation("DEDUCT");
      setEditTransactionDate("");
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
      await queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
      await queryClient.refetchQueries({ queryKey: ["transactions", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
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
    if (!workspaceId || !accountId || !subject || !amount || !transactionDate) return;
    createTx.mutate({
      subject,
      notes: notes || undefined,
      amountCents: Math.round(Number(amount) * 100),
      accountId,
      operation,
      date: transactionDate,
      budgetId: budgetId || undefined,
      budgetOperation: budgetId ? operation : undefined,
    });
  };

  const visibleBudgets = useMemo(() => {
    if (!budgets.data?.length) return [];
    if (!selectedBankId) return budgets.data;
    return budgets.data.filter((b) => b.accountId === selectedBankId);
  }, [budgets.data, selectedBankId]);

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

  const beginEdit = (tx: Transaction) => {
    setEditingTxId(tx.id);
    setEditSubject(tx.subject);
    setEditNotes(tx.notes || tx.details || "");
    setEditAmount((tx.amountCents / 100).toFixed(2));
    setEditOperation(tx.direction === "CREDIT" ? "ADD" : "DEDUCT");
    setEditTransactionDate(new Date(tx.date).toISOString().split("T")[0]);
  };

  const closeEditModal = () => {
    setEditingTxId(null);
    setEditSubject("");
    setEditNotes("");
    setEditAmount("");
    setEditOperation("DEDUCT");
  };

  const onSubmitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingTxId || !editSubject || !editAmount || !editTransactionDate) return;
    updateTx.mutate({
      id: editingTxId,
      subject: editSubject,
      notes: editNotes || null,
      amountCents: Math.round(Number(editAmount) * 100),
      operation: editOperation,
      date: editTransactionDate,
    });
  };

  const openCreateModal = () => {
    setSubject("");
    setNotes("");
    setAmount("");
    setOperation("ADD");
    setBudgetId(activeBudgetFilterId !== "ALL" ? activeBudgetFilterId : "");
    setTransactionDate(new Date().toISOString().split("T")[0]);
    setIsCreateModalOpen(true);
  };

  const openTransferModal = () => {
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

  const openEditBankBalance = (bank: BankAccount) => {
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

  return (
    <div className="txn-page" style={{ display: "grid", gap: "14px" }}>
      {isRefreshing ? (
        <div className="tx-refresh-banner" aria-live="polite">
          <LoadingDots className="tx-refresh-dots" />
          <span>Refreshing data...</span>
        </div>
      ) : null}

      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600 }}>Bank Accounts</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
            {isRefreshing ? (
              <span className="tx-inline-refresh">
                <LoadingDots />
              </span>
            ) : null}
            <button className="btn btn-ghost" onClick={openTransferModal} disabled={(budgets.data?.length ?? 0) < 2}>
              Transfer
            </button>
            <button className="btn btn-primary" onClick={openCreateModal}>
              Add Transaction
            </button>
          </div>
        </div>
        <div className="account-cards-grid">
          {bankAccounts.isLoading && (
            <>
              <SkeletonMiniCard />
              <SkeletonMiniCard />
              <SkeletonMiniCard />
              <SkeletonMiniCard />
            </>
          )}

          {!bankAccounts.isLoading && (
            <>
              <div
                className="budget-mini budget-mini-compact tx-bank-card"
                onClick={() => setSelectedBankId("")}
                style={{
                  borderColor: !selectedBankId ? "var(--brand-500)" : displayedBankBalanceCents !== totalLinkedBudgetCents ? "var(--warning)" : undefined,
                  boxShadow: !selectedBankId ? "var(--shadow-sm)" : undefined,
                }}
              >
                <div className="bm-name">All banks</div>
                <div className={`bm-amount ${getAmountToneClass(totalBankBalanceCents)}`}>{formatCents(totalBankBalanceCents)}</div>
                {displayedBankBalanceCents !== totalLinkedBudgetCents ? (
                  <div className="bm-target tx-discrepancy-note">
                    Discrepancy {displayedDiscrepancyCents > 0 ? "+" : ""}{formatCents(displayedDiscrepancyCents)}
                  </div>
                ) : null}
              </div>
              {(bankAccounts.data ?? []).map((bank) => (
                <div
                  key={bank.id}
                  className="budget-mini budget-mini-compact tx-bank-card"
                  onClick={() => setSelectedBankId(bank.id)}
                  style={{
                    borderColor:
                      selectedBankId === bank.id
                        ? "var(--brand-500)"
                        : bank.currentBalanceCents !== (bank.linkedBudgetTotalCents ?? 0)
                          ? "var(--warning)"
                          : undefined,
                    boxShadow: selectedBankId === bank.id ? "var(--shadow-sm)" : undefined,
                  }}
                >
                  <div className="bm-top" style={{ marginBottom: "4px" }}>
                    <div className="bm-name" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: 0 }}>
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
                    <button
                      type="button"
                      className="bm-edit-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditBankBalance(bank);
                      }}
                      aria-label={`Edit ${bank.name} balance`}
                      title="Edit balance"
                    >
                      ✎
                    </button>
                  </div>
                  <div className={`bm-amount ${getAmountToneClass(bank.currentBalanceCents)}`}>{formatCents(bank.currentBalanceCents)}</div>
                  {bank.currentBalanceCents !== (bank.linkedBudgetTotalCents ?? 0) ? (
                    <div className="bm-target tx-discrepancy-note">
                      Discrepancy {bank.currentBalanceCents - (bank.linkedBudgetTotalCents ?? 0) > 0 ? "+" : ""}
                      {formatCents(bank.currentBalanceCents - (bank.linkedBudgetTotalCents ?? 0))}
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      <section className="card">
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
            Total {formatCents(visibleBudgetTotalCents)} / Bank {formatCents(displayedBankBalanceCents)}
            {hasDisplayedDiscrepancy ? ` · Discrepancy ${displayedDiscrepancyCents > 0 ? "+" : ""}${formatCents(displayedDiscrepancyCents)}` : ""}
          </div>
        </div>
        {hasDisplayedDiscrepancy ? (
          <div className="tx-discrepancy-banner">
            Sub-Accounts total {formatCents(displayedLinkedBudgetCents)} does not match the selected bank balance {formatCents(displayedBankBalanceCents)}.
            Current discrepancy: {displayedDiscrepancyCents > 0 ? "+" : ""}{formatCents(displayedDiscrepancyCents)}.
          </div>
        ) : null}
        <div className="account-cards-grid tx-account-grid">
          {/*
            Transactions page: compact account chips with only name + amount.
          */}
          <div
            className="budget-mini budget-mini-compact tx-account-card"
            onClick={() => setActiveBudgetFilterId("ALL")}
            style={{
              borderColor: activeBudgetFilterId === "ALL" ? "var(--brand-500)" : hasDisplayedDiscrepancy ? "var(--warning)" : undefined,
              boxShadow: activeBudgetFilterId === "ALL" ? "var(--shadow-sm)" : undefined,
            }}
          >
            <div className="bm-name" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span aria-hidden="true">📁</span>
              <span>All accounts</span>
            </div>
            <div className={`bm-amount ${getAmountToneClass(visibleBudgetTotalCents)}`}>
              {formatCents(visibleBudgetTotalCents)}
            </div>
            {hasDisplayedDiscrepancy ? <div className="bm-target tx-discrepancy-note">⚠️</div> : null}
          </div>
          {visibleBudgets.map((b) => (
            <div
              key={b.id}
              className="budget-mini budget-mini-compact tx-account-card"
              onClick={() => setActiveBudgetFilterId(b.id)}
              style={{
                borderColor: activeBudgetFilterId === b.id ? "var(--brand-500)" : undefined,
                boxShadow: activeBudgetFilterId === b.id ? "var(--shadow-sm)" : undefined,
                position: "relative",
              }}
            >
              <div className="bm-name">{b.name}</div>
              <div className={`bm-amount ${getAmountToneClass(b.availableCents)}`}>{formatCents(b.availableCents)}</div>
              {b.receivableReservedCents && b.availableCents > 0 ? (
                <div className="bm-target" style={{ marginTop: "4px" }}>
                  ({formatCents(b.receivableReservedCents)} receivable)
                </div>
              ) : null}
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  bottom: "4px",
                  right: "4px",
                  fontSize: "24px",
                  lineHeight: 1,
                  opacity: 0.5,
                  pointerEvents: "none",
                }}
              >
                {getBudgetIcon(b.name, b.icon)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
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
            <div key={tx.id} className={`crud-row${isDeleting ? " crud-row-deleting" : ""}`}>
              <div style={{ display: "grid", gap: "3px" }}>
                <span className={getAmountToneClass(tx.direction === "DEBIT" ? -tx.amountCents : tx.amountCents)}>
                  {tx.subject} {formatCents(tx.amountCents)}
                </span>
                <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{new Date(tx.date).toLocaleString()}</span>
                {tx.notes || tx.details ? (
                  <span style={{ color: "var(--text-tertiary)", fontSize: "11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.notes || tx.details}</span>
                ) : null}
              </div>
              <div className="crud-actions" style={{ display: "flex", flexDirection: "column", gap: "4px", marginLeft: "auto" }}>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: "32px", height: "32px" }}
                  onClick={() => beginEdit(tx)}
                  title="Edit"
                  aria-label="Edit transaction"
                >
                  ✎
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: "32px", height: "32px", color: "var(--danger)" }}
                  onClick={() => confirmDeleteTx(tx.id)}
                  disabled={isDeleting}
                  title={isDeleting ? "Deleting..." : "Delete"}
                  aria-label="Delete transaction"
                >
                  {isDeleting ? "…" : "🗑"}
                </button>
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
                    <select className="input" value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
                      <option value="">No account</option>
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
              <div className="modal-grid-span-2" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button className="btn btn-ghost" type="button" onClick={closeEditModal}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={updateTx.isPending}>
                  {updateTx.isPending ? <LoadingDots /> : "Save"}
                </button>
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
                <div className="modal-grid-span-2" style={{ color: "var(--danger)", fontSize: "12px" }}>
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
    </div>
  );
}
