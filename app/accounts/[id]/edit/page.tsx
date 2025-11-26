// app/accounts/[id]/edit/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import HideableAccountForm from "../../HideableAccountForm";
import AccountTransactionsSection from "../../AccountTransactionSection";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditAccountPage({ params }: PageProps) {
  const resolvedParams = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const pool = await getDb();

  // Fetch account (ensure it belongs to the logged-in user)
  const accountResult = await pool
    .request()
    .input("id", resolvedParams.id)
    .input("userId", user.Id)
    .query(`
      SELECT TOP 1
        Id,
        UserId,
        Name,
        Type,
        Currency,
        InitialAmount,
        CreatedAt,
        IsActive
      FROM Accounts
      WHERE Id = @id
        AND UserId = @userId;
    `);

  if (accountResult.recordset.length === 0) {
    return (
      <main className="min-h-screen bg-slate-100">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="rounded-2xl bg-white p-6 shadow">
            <h1 className="text-lg font-semibold text-slate-900">
              Account not found
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              We couldn&apos;t find an account with this ID for your user.
              {user.Id}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const acc = accountResult.recordset[0] as {
    Id: string;
    Name: string;
    Type: string;
    Currency: string;
    InitialAmount: number;
    IsActive: boolean;
  };

  // Fetch transactions for this account
  const txResult = await pool
    .request()
    .input("accountId", acc.Id)
    .query(`
      SELECT
        Id,
        AccountId,
        Amount,
        Type,
        Category,
        Date,
        Note,
        CreatedAt
      FROM Transactions
      WHERE AccountId = @accountId
      ORDER BY Date DESC, CreatedAt DESC;
    `);

  const transactions = txResult.recordset as {
    Id: string;
    AccountId: string;
    Amount: number;
    Type: string;
    Category: string;
    Date: string;
    Note: string | null;
    CreatedAt: string;
  }[];

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        {/* Top ~10%: compact account update card */}
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <HideableAccountForm mode="edit" account={acc} defaultVisible={false} />
        </section>

        {/* Bottom: full transaction management */}
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <AccountTransactionsSection
            accountId={acc.Id}
            currency={acc.Currency}
            initialTransactions={transactions}
          />
        </section>
      </div>
    </main>
  );
}
