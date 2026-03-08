"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { FormEvent, useMemo, useState } from "react";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { SkeletonTableRow, EmptyState } from "@/components/ui-skeleton";

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
  isInstallment: boolean;
  installmentNo: number | null;
  totalInstallments: number | null;
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
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function getDaysUntil(dateStr: string): number {
  const date = new Date(dateStr);
  const today = new Date();
  const diff = date.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function CreditTransactionsPage({ initialCards }: { initialCards: CreditCard[] }) {
  const queryClient = useQueryClient();
  const [selectedCardId, setSelectedCardId] = useState<string>("all");
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [showUnaccountedOnly, setShowUnaccountedOnly] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});

  // Form state
  const [formCardId, setFormCardId] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formPaymentDue, setFormPaymentDue] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formIsInstallment, setFormIsInstallment] = useState(false);
  const [formInstallmentNo, setFormInstallmentNo] = useState("");
  const [formTotalInstallments, setFormTotalInstallments] = useState("");

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const formatCurrency = (cents: number) => formatMoney(cents, baseCurrency);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["credit-transactions", selectedCardId, selectedYear, selectedMonth],
    queryFn: () =>
      fetchJson<{
        transactions: CreditCardTransaction[];
        cardCounts: CardCount[];
      }>(
        `/api/credit-transactions?cardId=${selectedCardId}&year=${selectedYear}&month=${selectedMonth + 1}`
      ),
    enabled: initialCards.length > 0,
  });

  const transactions = data?.transactions || [];
  const cardCounts = data?.cardCounts || [];

  const filteredTransactions = useMemo(() => {
    if (!showUnaccountedOnly) return transactions;
    return transactions.filter((t) => !t.isAllocated);
  }, [transactions, showUnaccountedOnly]);

  const totals = useMemo(() => {
    const total = filteredTransactions.reduce((sum, t) => sum + t.amountCents, 0);
    const unaccounted = filteredTransactions.filter((t) => !t.isAllocated).reduce((sum, t) => sum + t.amountCents, 0);
    return { total, unaccounted };
  }, [filteredTransactions]);

  const createTransaction = useMutation({
    mutationFn: (payload: {
      creditCardId: string;
      transactionDate: string;
      paymentDueDate?: string;
      statementMonth: number;
      statementYear: number;
      amountCents: number;
      subject: string;
      isInstallment: boolean;
      installmentNo?: number;
      totalInstallments?: number;
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

  const deleteTransaction = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/credit-transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credit-transactions"] }),
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

  const openModal = () => {
    setFormCardId(initialCards[0]?.id || "");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormPaymentDue("");
    setFormSubject("");
    setFormAmount("");
    setFormIsInstallment(false);
    setFormInstallmentNo("");
    setFormTotalInstallments("");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!formCardId || !formDate || !formSubject || !formAmount) return;

    createTransaction.mutate({
      creditCardId: formCardId,
      transactionDate: new Date(formDate).toISOString(),
      paymentDueDate: formPaymentDue ? new Date(formPaymentDue).toISOString() : undefined,
      statementMonth: selectedMonth + 1,
      statementYear: selectedYear,
      amountCents: Math.round(parseFloat(formAmount) * 100),
      subject: formSubject,
      isInstallment: formIsInstallment,
      installmentNo: formIsInstallment && formInstallmentNo ? parseInt(formInstallmentNo) : undefined,
      totalInstallments: formIsInstallment && formTotalInstallments ? parseInt(formTotalInstallments) : undefined,
    });
  };

  const getCardCount = (cardId: string) => {
    return cardCounts.find((c) => c.creditCardId === cardId)?._count.id || 0;
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
        {initialCards.map((card) => {
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

      {/* Month Tabs */}
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

      {/* Actions */}
      <div className="cct-actions">
        <button className="btn btn-primary" onClick={openModal}>
          + Add Transaction
        </button>
      </div>

      {/* Transactions Table */}
      <div className="cct-table-wrapper">
        <table className="cct-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Payment Due</th>
              <th>Subject</th>
              <th>Amount</th>
              <th>Card</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <>
                <SkeletonTableRow cols={6} />
                <SkeletonTableRow cols={6} />
                <SkeletonTableRow cols={6} />
                <SkeletonTableRow cols={6} />
                <SkeletonTableRow cols={6} />
              </>
            )}

            {isError && (
              <tr>
                <td colSpan={6}>
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
              const daysUntil = tx.paymentDueDate ? getDaysUntil(tx.paymentDueDate) : null;
              const isOverdue = daysUntil !== null && daysUntil < 0;
              const isUrgent = daysUntil !== null && daysUntil >= 0 && daysUntil <= 3;

              return (
                <tr key={tx.id} className={tx.isAllocated ? "allocated" : "unallocated"}>
                  <td className="cct-tx-date">
                    <span className="cct-tx-day">{formatDate(tx.transactionDate)}</span>
                  </td>
                  <td className="cct-tx-due">
                    {tx.paymentDueDate ? (
                      <span className={`cct-due-badge ${isOverdue ? "overdue" : isUrgent ? "urgent" : ""}`}>
                        {isOverdue ? "⚠️ " : isUrgent ? "⏰ " : ""}
                        {formatDate(tx.paymentDueDate)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="cct-tx-subject">
                    <div className="cct-subject-wrapper">
                      <span className="cct-subject-icon">🛒</span>
                      <span>{tx.subject}</span>
                      {tx.isInstallment && tx.totalInstallments && (
                        <span className="cct-installment-badge">
                          {tx.installmentNo}/{tx.totalInstallments}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`cct-tx-amount ${getAmountToneClass(tx.amountCents)}`}>{formatCurrency(tx.amountCents)}</td>
                  <td className="cct-tx-card">
                    <label className="cct-card-checkbox">
                      <input
                        type="checkbox"
                        checked={tx.isAllocated}
                        onChange={() => toggleAllocated.mutate({ id: tx.id, isAllocated: !tx.isAllocated })}
                      />
                      <span>{tx.creditCard.cardName}</span>
                    </label>
                  </td>
                  <td className="cct-tx-actions">
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => deleteTransaction.mutate(tx.id)}
                      disabled={deleteTransaction.isPending}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {!isLoading && !isError && filteredTransactions.length === 0 && (
              <tr>
                <td colSpan={6}>
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
          <div className="cct-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cct-modal-header">
              <h3>Add Credit Card Transaction</h3>
              <button className="cct-close-btn" onClick={closeModal}>
                ✕
              </button>
            </div>
            <form className="cct-modal-form" onSubmit={onSubmit}>
              <div className="cct-form-grid">
                <div className="form-group cct-span-2">
                  <label className="label">Credit Card</label>
                  <select className="input" value={formCardId} onChange={(e) => setFormCardId(e.target.value)} required>
                    {initialCards.map((card) => (
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
                <div className="form-group">
                  <label className="label">
                    <input
                      type="checkbox"
                      checked={formIsInstallment}
                      onChange={(e) => setFormIsInstallment(e.target.checked)}
                    />
                    Installment
                  </label>
                </div>
                {formIsInstallment && (
                  <>
                    <div className="form-group">
                      <label className="label">Installment #</label>
                      <input
                        type="number"
                        min="1"
                        className="input"
                        value={formInstallmentNo}
                        onChange={(e) => setFormInstallmentNo(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="label">Total Installments</label>
                      <input
                        type="number"
                        min="1"
                        className="input"
                        value={formTotalInstallments}
                        onChange={(e) => setFormTotalInstallments(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="cct-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createTransaction.isPending}>
                  {createTransaction.isPending ? "Adding..." : "Add Transaction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
