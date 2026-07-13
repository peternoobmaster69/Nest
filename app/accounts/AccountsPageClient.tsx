// app/accounts/AccountsPageClient.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AccountsGridSkeleton } from "@/components/skeletons/AccountsSkeleton";
import { Plus } from "lucide-react";
import { formatCurrencyAmount } from "@/lib/presentation";

type Account = {
  Id: string;
  Name: string;
  Type: string;
  Currency: string;
  InitialAmount: number;
  CurrentAmount: number;
  CreatedAt: string;
};

export default function AccountsPageClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalsByCurrency = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.Currency] = (acc[a.Currency] ?? 0) + Number(a.CurrentAmount || 0);
    return acc;
  }, {});

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
    <div className="page-stack">
      <section className="card">
        {loading || error || accounts.length > 0 ? (
          <div className="account-summary-row">
            {accounts.length > 0 ? (
              <div className="account-summary-main">
                <span className="section-label">Total balance</span>
                <div className="account-total-list">
                  {Object.entries(totalsByCurrency).map(([currency, total]) => (
                    <strong key={currency} className="account-total">
                      {formatCurrencyAmount(total, currency)}
                    </strong>
                  ))}
                </div>
              </div>
            ) : null}
            <Link href="/accounts/create" className="btn btn-primary btn-md account-add-btn mobile-primary-create" aria-label="Add account" title="Add account">
              <Plus size={16} aria-hidden="true" />
              <span className="mobile-primary-create-label">Add account</span>
            </Link>
          </div>
        ) : null}

        {loading ? <AccountsGridSkeleton /> : null}
        {error && !loading ? <div className="state-panel state-panel-error" role="alert">{error}</div> : null}

        {!loading && !error && accounts.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-desc">You haven&apos;t added any accounts yet.</p>
            <Link href="/accounts/create" className="btn btn-primary btn-md">Add your first account</Link>
          </div>
        ) : null}

        {!loading && !error && accounts.length > 0 ? (
          <div className="account-grid">
            {accounts.map((account) => (
              <Link key={account.Id} href={`/accounts/${account.Id}/edit`} className="card card-interactive account-card">
                <div className="account-card-head">
                  <h2 className="account-card-title">{account.Name}</h2>
                  <span className="badge badge-neutral">{account.Type}</span>
                </div>
                <p className={`account-card-balance ${Number(account.CurrentAmount) <= 0 ? "negative" : "positive"}`}>
                  {formatCurrencyAmount(Number(account.CurrentAmount), account.Currency)}
                </p>
                <div className="account-card-footer">View activity <span aria-hidden="true">→</span></div>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
