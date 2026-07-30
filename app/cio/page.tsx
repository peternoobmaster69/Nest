import { CioPage } from "@/components/cio-page";
import { PageFrame } from "@/components/page-frame";
import { requireSession } from "@/lib/require-session";

export default async function CioRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame
      title="Nest CIO"
      current="/cio"
      userName={userName}
      userEmail={session.user?.email || undefined}
      userImage={session.user?.image || null}
    >
      <CioPage />
    </PageFrame>
  );
}
