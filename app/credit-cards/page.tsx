import { PageFrame } from "@/components/page-frame";
import { CreditCardsPage } from "@/components/credit-cards-page";
import { requireSession } from "@/lib/require-session";

export default async function CreditCardsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Credit Cards" current="/credit-cards" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <CreditCardsPage />
    </PageFrame>
  );
}
