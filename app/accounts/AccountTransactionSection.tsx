// app/accounts/AccountTransactionsSection.tsx
"use client";

import { useState } from "react";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { formatCurrencyAmount, formatLocalDate } from "@/lib/presentation";
import { useToast } from "@/components/toast-provider";

type Transaction = {
  Id: string;
  AccountId: string;
  Amount: number;
  Type: string;
  Category: string;
  Date: string;
  Note: string | null;
  CreatedAt: string;
};

type Props = {
  accountId: string;
  currency: string;
  initialTransactions: Transaction[];
};

export default function AccountTransactionsSection({
  accountId,
  currency,
  initialTransactions,
}: Props) {
  const toast = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>(
    initialTransactions
  );

  // ADD form state
  const [amount, setAmount] = useState<string>("");
  const [type, setType] = useState<string>("expense");
  const [category, setCategory] = useState<string>("");
  const [date, setDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [note, setNote] = useState<string>("");

  const [loadingAdd, setLoadingAdd] = useState(false);
  const [loadingDeleteId, setLoadingDeleteId] = useState<string | null>(null);

  // EDIT state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>("");
  const [editType, setEditType] = useState<string>("expense");
  const [editCategory, setEditCategory] = useState<string>("");
  const [editDate, setEditDate] = useState<string>("");
  const [editNote, setEditNote] = useState<string>("");

  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // ---------- ADD ----------
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const numericAmount = Number(amount);
    if (!numericAmount || isNaN(numericAmount)) {
      setError("Amount must be a number");
      return;
    }
    if (!category.trim()) {
      setError("Category is required");
      return;
    }

    setLoadingAdd(true);

    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          amount: numericAmount,
          type,
          category,
          date,
          note: note || null,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to add transaction");
        setLoadingAdd(false);
        return;
      }

      // API returns created tx
      setTransactions((prev) => [data, ...prev]);

      setAmount("");
      setCategory("");
      setNote("");
    } catch (err) {
      console.error(err);
      setError("Something went wrong");
    } finally {
      setLoadingAdd(false);
    }
  }

  // ---------- DELETE ----------
  async function handleDelete(id: string) {
    if (!(await confirmDestructiveAction("Delete this transaction?"))) return;

    setLoadingDeleteId(id);
    setError(null);

    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to delete transaction");
        setLoadingDeleteId(null);
        return;
      }

      setTransactions((prev) => prev.filter((t) => t.Id !== id));
      toast.success("Transaction deleted");
    } catch (err) {
      console.error(err);
      setError("Something went wrong");
    } finally {
      setLoadingDeleteId(null);
    }
  }

  // ---------- EDIT ----------
  function handleEditClick(tx: Transaction) {
    setEditingId(tx.Id);
    setEditAmount(String(tx.Amount));
    setEditType(tx.Type);
    setEditCategory(tx.Category);
    setEditDate(tx.Date.slice(0, 10)); // yyyy-mm-dd
    setEditNote(tx.Note ?? "");
    setError(null);
  }

  function handleEditCancel() {
    setEditingId(null);
    setLoadingEditId(null);
    setError(null);
  }

  async function handleEditSave(id: string) {
    setError(null);

    const numericAmount = Number(editAmount);
    if (!numericAmount || isNaN(numericAmount)) {
      setError("Amount must be a number");
      return;
    }
    if (!editCategory.trim()) {
      setError("Category is required");
      return;
    }
    if (!editDate) {
      setError("Date is required");
      return;
    }

    setLoadingEditId(id);

    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: numericAmount,
          type: editType,
          category: editCategory,
          date: editDate,
          note: editNote || null,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to update transaction");
        setLoadingEditId(null);
        return;
      }

      // API returns updated tx
      setTransactions((prev) =>
        prev.map((t) => (t.Id === id ? data : t))
      );

      setEditingId(null);
    } catch (err) {
      console.error(err);
      setError("Something went wrong");
    } finally {
      setLoadingEditId(null);
    }
  }

  return (
    <div className="page-stack">
      {/* Header + add form */}
      <div className="section-header">
        <h2 className="section-title">
          Transactions
        </h2>
        <p className="page-header-description">
          Add, edit, or delete transactions for this account.
        </p>
      </div>

      <form
        onSubmit={handleAdd}
        className="form-grid account-transaction-form"
      >
        <div className="sm:col-span-1">
          <label className="label">Amount</label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input"
            placeholder="0.00"
            required
          />
        </div>

        <div className="sm:col-span-1">
          <label className="label">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="input"
          >
            <option value="expense">Expense (-)</option>
            <option value="income">Income (+)</option>
            <option value="transfer">Transfer</option>
          </select>
        </div>

        <div className="sm:col-span-1">
          <label className="label">
            Category
          </label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input"
            placeholder="Food, Salary, etc."
            required
          />
        </div>

        <div className="sm:col-span-1">
          <label className="label">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            required
          />
        </div>

        <div className="sm:col-span-1">
          <label className="label">Note</label>
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input"
              placeholder="Optional"
            />
            <button
              type="submit"
              disabled={loadingAdd}
              className="btn btn-primary btn-md"
            >
              {loadingAdd ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {/* Transactions list */}
      {transactions.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">No transactions yet for this account.</p></div>
      ) : (
        <div className="cct-table-wrapper">
          <table className="cct-table responsive-data-table">
            <thead>
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const isEditing = editingId === t.Id;
                const isNegative = t.Amount < 0;

                return (
                  <tr
                    key={t.Id}
                    className="account-transaction-row"
                  >
                    {/* DATE */}
                    <td data-label="Date">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="input"
                        />
                      ) : (
                        formatLocalDate(t.Date)
                      )}
                    </td>

                    {/* CATEGORY */}
                    <td data-label="Category">
                      {isEditing ? (
                        <input
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          className="input"
                        />
                      ) : (
                        t.Category
                      )}
                    </td>

                    {/* NOTE */}
                    <td data-label="Note">
                      {isEditing ? (
                        <input
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          className="input"
                        />
                      ) : (
                        t.Note || "\u2014"
                      )}
                    </td>

                    {/* AMOUNT */}
                    <td data-label="Amount" className={isNegative ? "negative" : "positive"}>
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                            className="input"
                          >
                            <option value="expense">Expense (-)</option>
                            <option value="income">Income (+)</option>
                            <option value="transfer">Transfer</option>
                          </select>
                          <input
                            type="number"
                            step="0.01"
                            value={editAmount}
                            onChange={(e) =>
                              setEditAmount(e.target.value)
                            }
                            className="input"
                          />
                        </div>
                      ) : (
                        <>
                          {isNegative ? "−" : "+"}{formatCurrencyAmount(Math.abs(t.Amount), currency)}
                        </>
                      )}
                    </td>

                    {/* ACTIONS */}
                    <td data-label="Actions" className="cct-tx-actions">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditSave(t.Id)}
                            disabled={loadingEditId === t.Id}
                            className="btn btn-primary btn-sm"
                          >
                            {loadingEditId === t.Id
                              ? "Saving…"
                              : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={handleEditCancel}
                            className="btn btn-ghost btn-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditClick(t)}
                            className="btn btn-ghost btn-sm"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(t.Id)}
                            disabled={loadingDeleteId === t.Id}
                            className="btn btn-destructive btn-sm"
                          >
                            {loadingDeleteId === t.Id
                              ? "Deleting…"
                              : "Delete"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
