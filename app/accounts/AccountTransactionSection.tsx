// app/accounts/AccountTransactionsSection.tsx
"use client";

import { useState } from "react";

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
    if (!confirm("Delete this transaction?")) return;

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
    <div className="space-y-4">
      {/* Header + add form */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          Transactions
        </h2>
        <p className="text-xs text-slate-500">
          Add, edit, or delete transactions for this account.
        </p>
      </div>

      <form
        onSubmit={handleAdd}
        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm sm:grid-cols-5"
      >
        <div className="sm:col-span-1">
          <label className="mb-1 block text-xs text-slate-600">Amount</label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-md border px-2 py-1"
            placeholder="0.00"
            required
          />
        </div>

        <div className="sm:col-span-1">
          <label className="mb-1 block text-xs text-slate-600">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-md border px-2 py-1"
          >
            <option value="expense">Expense (-)</option>
            <option value="income">Income (+)</option>
            <option value="transfer">Transfer</option>
          </select>
        </div>

        <div className="sm:col-span-1">
          <label className="mb-1 block text-xs text-slate-600">
            Category
          </label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border px-2 py-1"
            placeholder="Food, Salary, etc."
            required
          />
        </div>

        <div className="sm:col-span-1">
          <label className="mb-1 block text-xs text-slate-600">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border px-2 py-1"
            required
          />
        </div>

        <div className="sm:col-span-1">
          <label className="mb-1 block text-xs text-slate-600">Note</label>
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-md border px-2 py-1"
              placeholder="Optional"
            />
            <button
              type="submit"
              disabled={loadingAdd}
              className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:shadow-[0_0_10px_rgba(15,23,42,0.6)] transition disabled:opacity-60"
            >
              {loadingAdd ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <p className="text-xs text-red-600">
          {error}
        </p>
      )}

      {/* Transactions list */}
      {transactions.length === 0 ? (
        <p className="text-sm text-slate-500">
          No transactions yet for this account.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
                    className="border-t border-slate-100 hover:bg-slate-50/70"
                  >
                    {/* DATE */}
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="rounded-md border px-2 py-1 text-xs"
                        />
                      ) : (
                        new Date(t.Date).toLocaleDateString()
                      )}
                    </td>

                    {/* CATEGORY */}
                    <td className="px-3 py-2 text-xs text-slate-800">
                      {isEditing ? (
                        <input
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          className="w-full rounded-md border px-2 py-1 text-xs"
                        />
                      ) : (
                        t.Category
                      )}
                    </td>

                    {/* NOTE */}
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {isEditing ? (
                        <input
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          className="w-full rounded-md border px-2 py-1 text-xs"
                        />
                      ) : (
                        t.Note || "\u2014"
                      )}
                    </td>

                    {/* AMOUNT */}
                    <td
                      className={`px-3 py-2 text-right text-xs font-semibold ${
                        isNegative ? "text-red-600" : "text-emerald-600"
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                            className="rounded-md border px-2 py-1 text-[11px]"
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
                            className="w-24 rounded-md border px-2 py-1 text-xs text-right"
                          />
                        </div>
                      ) : (
                        <>
                          {isNegative ? "-" : "+"}{" "}
                          {currency}{" "}
                          {Math.abs(t.Amount).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </>
                      )}
                    </td>

                    {/* ACTIONS */}
                    <td className="px-3 py-2 text-right text-xs">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditSave(t.Id)}
                            disabled={loadingEditId === t.Id}
                            className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 transition disabled:opacity-60"
                          >
                            {loadingEditId === t.Id
                              ? "Saving…"
                              : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={handleEditCancel}
                            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditClick(t)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 transition"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(t.Id)}
                            disabled={loadingDeleteId === t.Id}
                            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition disabled:opacity-60"
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
