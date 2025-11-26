// app/accounts/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Account = {
  Id: string;
  Name: string;
  Type: string;
  Currency: string;
  InitialAmount: number;
  CurrentAmount: number;
  CreatedAt: string;
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const totalsByCurrency = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.Currency] = (acc[a.Currency] ?? 0) + Number(a.CurrentAmount || 0);
    return acc;
  }, {});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/accounts", { cache: "no-store" });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("Failed /api/accounts", res.status, data);
          throw new Error(data.error || "Failed to load accounts");
        }

        const data = (await res.json()) as Account[];
        setAccounts(data);
      } catch (err) {
        console.error(err);
        const message =
          err instanceof Error
            ? err.message
            : String(err) || "Failed to load accounts";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Accounts</h1>
            
            {/* Totals */}
            {accounts.length > 0 && (
              <div className="text-2xl text-emerald-600 mt-1 flex flex-wrap gap-2">
                {Object.entries(totalsByCurrency).map(([currency, total]) => (
                  <div
                    key={currency}
                    className="inline-flex items-center rounded-full bg-slate-100"
                  >
                    <span className="font-semibold">
                      {currency}{" "}
                      {total.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Link
            href="/accounts/create"
            className="
              inline-flex items-center gap-2 rounded-xl
              bg-slate-900 px-4 py-2 text-sm font-medium text-white
              shadow-md shadow-slate-400/40
              transition
              hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-500/50
              active:translate-y-0 active:shadow-md
            "
          >
            <span className="text-lg leading-none">+</span>
            <span>Add account</span>
          </Link>
        </div>

        {/* Loading / error */}
        {loading && (
          <div className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">
            Loading accounts…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && accounts.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-12">
            <p className="mb-3 text-sm text-slate-500">
              You haven&apos;t added any accounts yet.
            </p>
            <Link
              href="/accounts/create"
              className="
                inline-flex items-center gap-2 rounded-xl
                bg-slate-900 px-4 py-2 text-sm font-medium text-white
                shadow-md shadow-slate-400/40
                transition
                hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-500/50
              "
            >
              <span className="text-lg leading-none">+</span>
              <span>Add your first account</span>
            </Link>
          </div>
        )}

        {/* Grid */}
        {!loading && !error && accounts.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {accounts.map((acc) => (
              <Link
                key={acc.Id}
                href={`/accounts/${acc.Id}/edit`}
                className="
                  group flex flex-col justify-between rounded-2xl border
                  border-slate-200 bg-white p-4
                  shadow-sm shadow-slate-200
                  transition
                  hover:-translate-y-1 hover:border-slate-300
                  hover:shadow-lg hover:shadow-slate-300/70
                "
              >
                {/* Top: name + type + date */}
                <div className="mb-3 flex items-start justify-between">
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-slate-900 group-hover:text-slate-950">
                      {acc.Name}
                    </h2>
                  </div>
                  <span className="text-xs rounded-full bg-slate-100 px-2 py-0.5 text-slate-400">
                    {acc.Type}
                  </span>
                </div>

                <div className="mb-3">
                  <p
                    className={`text-2xl font-semibold ${
                      Number(acc.CurrentAmount) <= 0 ? "text-rose-600" : "text-emerald-600"
                    }`}
                  >
                    {acc.Currency}{" "}
                    {Number(acc.CurrentAmount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>

                {/* Bottom: placeholder for future stats */}
                <div className="mt-auto flex items-center justify-between text-xs text-slate-500">
                  <span>Tap to view activity</span>
                  <span className="text-slate-400"></span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
