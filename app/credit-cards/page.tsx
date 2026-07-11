import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { CreditCardsPage } from "@/components/credit-cards-page";
import { requireSession } from "@/lib/require-session";

export default async function CreditCardsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Credit Cards" current="/credit-cards" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <PageHeader title="Credit Cards" description="Manage card details, statement cycles, and payment dates." />
      <CreditCardsPage />
    </PageFrame>
  );
}
