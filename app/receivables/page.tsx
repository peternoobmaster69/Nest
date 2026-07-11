import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { ReceivablesPage } from "@/components/receivables-page";
import { requireSession } from "@/lib/require-session";

export default async function ReceivablesRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Receivables" current="/receivables" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <PageHeader title="Receivables" description="Track money owed to you and close items when they are paid." />
      <ReceivablesPage />
    </PageFrame>
  );
}
