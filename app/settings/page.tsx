import { PageFrame } from "@/components/page-frame";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsPage } from "@/components/settings-page";
import { requireSession } from "@/lib/require-session";

export default async function SettingsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Settings" current="/settings" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <PageHeader title="Settings" description="Configure workspace defaults, integrations, accounts, and automation." />
      <SettingsPage />
    </PageFrame>
  );
}
