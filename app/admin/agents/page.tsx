import { AdminAgentsPage } from "@/components/admin-agents-page";
import { PageFrame } from "@/components/page-frame";
import { requireAdminPage } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
export default async function AgentsPage() {
  const session = await requireAdminPage();
  return <PageFrame title="Agents" current="/admin/agents" userName={session.user?.name || session.user?.email || "Administrator"} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}><AdminAgentsPage /></PageFrame>;
}
