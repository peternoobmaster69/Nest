import { PageFrame } from "@/components/page-frame";
import { SettingsPage } from "@/components/settings-page";
import { requireSession } from "@/lib/require-session";

export default async function SettingsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  return (
    <PageFrame title="Settings" current="/settings" userName={userName} userImage={session.user?.image || null}>
      <SettingsPage />
    </PageFrame>
  );
}
