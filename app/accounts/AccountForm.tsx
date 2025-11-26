// app/accounts/AccountForm.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type AccountFormProps = {
  mode: "create" | "edit";
  account?: {
    Id: string;
    Name: string;
    Type: string;
    Currency: string;
    InitialAmount: number;
    IsActive: boolean;
  };
};

const ACCOUNT_TYPES = ["bank", "cash", "credit", "investment", "loan"];

export default function AccountForm({ mode, account }: AccountFormProps) {
  const router = useRouter();

  const [name, setName] = useState(account?.Name ?? "");
  const [type, setType] = useState(account?.Type ?? "bank");
  const [currency, setCurrency] = useState(account?.Currency ?? "SGD");
  const [initialAmount, setInitialAmount] = useState(
    account?.InitialAmount ?? 0
  );
  const [isActive, setIsActive] = useState(account?.IsActive ?? true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = {
        name,
        type,
        currency,
        initialAmount: Number(initialAmount) || 0,
        isActive,
      };

      const url =
        mode === "create"
          ? "/api/accounts"
          : `/api/accounts/${account?.Id}`;

      const method = mode === "create" ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to save account");
        setLoading(false);
        return;
      }

      router.push("/accounts");
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg">
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">
        {mode === "create" ? "Add new account" : ""}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label className="mb-1 block text-sm text-slate-700">Name</label>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="e.g. DBS Savings"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        {/* Type + Currency */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-700">Type</label>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value)}
              required
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-700">
              Currency
            </label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={10}
              required
            />
          </div>
        </div>

        {/* Initial Amount */}
        <div>
          <label className="mb-1 block text-sm text-slate-700">
            Initial amount
          </label>
          <input
            type="number"
            step="0.01"
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={initialAmount}
            onChange={(e) => setInitialAmount(Number(e.target.value))}
          />
        </div>

        {/* Active toggle only in edit */}
        {mode === "edit" && (
          <div className="flex items-center gap-2">
            <input
              id="isActive"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="isActive" className="text-sm text-slate-700">
              Active account
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="
              flex-1 rounded-md py-2 text-sm font-medium
              bg-slate-900 text-white
              hover:shadow-[0_0_12px_rgba(15,23,42,0.6)]
              transition disabled:opacity-60
            "
          >
            {loading
              ? mode === "create"
                ? "Creating…"
                : "Saving…"
              : mode === "create"
              ? "Create account"
              : "Save changes"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/accounts")}
            className="
              flex-1 rounded-md py-2 text-sm font-medium
              border border-slate-300 text-slate-700
              hover:bg-slate-100 transition
            "
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
