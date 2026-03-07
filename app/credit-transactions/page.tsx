import { PageFrame } from "@/components/page-frame";
import { CreditTransactionsPage } from "@/components/credit-transactions-page";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";

export default async function CreditTransactionsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  const workspace = await prisma.workspace.findFirst({
    orderBy: { createdAt: "asc" },
  });

  const creditCards = workspace
    ? await prisma.creditCardAccount.findMany({
        where: { workspaceId: workspace.id, isActive: true },
        select: { id: true, cardName: true, bankName: true, last4Digit: true },
        orderBy: { cardName: "asc" },
      })
    : [];

  return (
    <PageFrame
      title="Credit Card Transactions"
      current="/credit-transactions"
      userName={userName}
    >
      <CreditTransactionsPage initialCards={creditCards} />
    </PageFrame>
  );
}
