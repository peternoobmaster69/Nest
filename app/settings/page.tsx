import { cookies } from "next/headers";
import { PageFrame } from "@/components/page-frame";
import { CollaboratorsPage } from "@/components/collaborators-page";
import { SettingsPage } from "@/components/settings-page";
import { SettingsTabs } from "@/components/settings-tabs";
import { requireSession } from "@/lib/require-session";
import { parseSettingsTab, SETTINGS_TAB_COOKIE } from "@/lib/settings-tabs";

export default async function SettingsRoute({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const [session, params, cookieStore] = await Promise.all([
    requireSession(),
    searchParams ?? Promise.resolve<{ tab?: string }>({}),
    cookies(),
  ]);
  const userName = session.user?.name || session.user?.email || "User";
  const activeTab =
    parseSettingsTab(params.tab) ??
    parseSettingsTab(cookieStore.get(SETTINGS_TAB_COOKIE)?.value) ??
    "settings";

  return (
    <PageFrame title="Settings" current="/settings" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <SettingsTabs activeTab={activeTab}>
        {activeTab === "workspaces" ? (
          <CollaboratorsPage workspaceSettings={<SettingsPage section={activeTab} />} />
        ) : <SettingsPage section={activeTab} />}
      </SettingsTabs>
    </PageFrame>
  );
}
