import { InvestmentsPage } from "@/components/investments-page";
import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/lib/require-session";

export default async function InvestmentsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Investments" current="/investments" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <PageHeader title="Investments" description="Monitor portfolio value, contributions, liquidity, and history." />
      <InvestmentsPage />
    </PageFrame>
  );
}
