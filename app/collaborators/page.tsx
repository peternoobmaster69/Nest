import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { CollaboratorsPage } from "@/components/collaborators-page";
import { requireSession } from "@/lib/require-session";

export default async function CollaboratorsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Workspaces" current="/collaborators" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <PageHeader title="Workspaces" description="Manage workspace details, members, invitations, and page visibility." />
      <CollaboratorsPage />
    </PageFrame>
  );
}
