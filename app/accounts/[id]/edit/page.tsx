// app/accounts/[id]/edit/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import HideableAccountForm from "../../HideableAccountForm";
import AccountTransactionsSection from "../../AccountTransactionSection";
import { PageFrame } from "@/components/page-frame";

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
      <PageFrame title="Account" current="/accounts" userName={user.Name || user.Email || "User"} userEmail={user.Email}>
          <div className="card state-panel state-panel-error" role="alert">
            <h1>
              Account not found
            </h1>
            <p>
              We couldn&apos;t find this account.
            </p>
          </div>
      </PageFrame>
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
    <PageFrame title={acc.Name} current="/accounts" userName={user.Name || user.Email || "User"} userEmail={user.Email}>
      <div className="page-stack">
        {/* Top ~10%: compact account update card */}
        <section className="card">
          <HideableAccountForm mode="edit" account={acc} defaultVisible={false} />
        </section>

        {/* Bottom: full transaction management */}
        <section className="card">
          <AccountTransactionsSection
            accountId={acc.Id}
            currency={acc.Currency}
            initialTransactions={transactions}
          />
        </section>
      </div>
    </PageFrame>
  );
}
