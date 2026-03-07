import { PageFrame } from "@/components/page-frame";
import { TransactionsPage } from "@/components/transactions-page";
import { requireSession } from "@/lib/require-session";

export default async function TransactionsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Transactions" current="/transactions" userName={userName}>
      <TransactionsPage />
    </PageFrame>
  );
}
