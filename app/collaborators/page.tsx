import { PageFrame } from "@/components/page-frame";
import { CollaboratorsPage } from "@/components/collaborators-page";
import { requireSession } from "@/lib/require-session";

export default async function CollaboratorsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Workspaces" current="/collaborators" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <CollaboratorsPage />
    </PageFrame>
  );
}
