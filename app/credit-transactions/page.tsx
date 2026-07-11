import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { CreditTransactionsPage } from "@/components/credit-transactions-page";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";

export default async function CreditTransactionsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";
  const { workspaceId } = await requireWorkspaceAccess();

  const creditCards = await prisma.creditCardAccount.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, cardName: true, bankName: true, last4Digit: true },
    orderBy: [{ bankName: "asc" }, { cardName: "asc" }],
  });

  return (
    <PageFrame
      title="Credit Card Transactions"
      current="/credit-transactions"
      userName={userName}
      userEmail={session.user?.email || undefined}
      userImage={session.user?.image || null}
    >
      <PageHeader title="Card Transactions" description="Review card activity, allocate spending, import statements, and manage payments." />
      <CreditTransactionsPage initialCards={creditCards} />
    </PageFrame>
  );
}
