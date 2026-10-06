"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect } from "react";
import { Bot, HardDrive, ShieldCheck, UsersRound } from "lucide-react";
import { SETTINGS_TAB_COOKIE, type SettingsTab } from "@/lib/settings-tabs";
import { useWorkspaceId } from "@/components/workspace-provider";
import { buildWorkspacePath } from "@/lib/workspace-entry";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const tabs: Array<{
  id: SettingsTab;
  label: string;
  mobileLabel: string;
  icon: typeof ShieldCheck;
}> = [
  {
    id: "settings",
    label: "Privacy & Security",
    mobileLabel: "Privacy",
    icon: ShieldCheck,
  },
  {
    id: "automation",
    label: "Automation",
    mobileLabel: "Automation",
    icon: Bot,
  },
  {
    id: "workspaces",
    label: "Workspace",
    mobileLabel: "Workspace",
    icon: UsersRound,
  },
  {
    id: "data",
    label: "Data",
    mobileLabel: "Data",
    icon: HardDrive,
  },
];

function rememberTab(tab: SettingsTab) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SETTINGS_TAB_COOKIE}=${tab}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

export function SettingsTabs({
  activeTab,
  children,
}: Readonly<{
  activeTab: SettingsTab;
  children: ReactNode;
}>) {
  const router = useRouter();
  const workspaceId = useWorkspaceId();
  const settingsHref = (tab: SettingsTab) =>
    workspaceId
      ? buildWorkspacePath(workspaceId, `/settings?tab=${tab}`)
      : `/settings?tab=${tab}`;

  useEffect(() => {
    rememberTab(activeTab);
  }, [activeTab]);

  const moveTabFocus = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex].id;
    rememberTab(nextTab);
    document.getElementById(`settings-tab-${nextTab}`)?.focus();
    router.push(settingsHref(nextTab));
  };

  return (
    <div className="settings-hub">
      <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              id={`settings-tab-${tab.id}`}
              className={`settings-tab${isActive ? " is-active" : ""}`}
              href={settingsHref(tab.id)}
              role="tab"
              aria-selected={isActive}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => rememberTab(tab.id)}
              onKeyDown={(event) => moveTabFocus(event, tabs.indexOf(tab))}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="settings-tab-label">{tab.label}</span>
              <span className="settings-tab-mobile-label">{tab.mobileLabel}</span>
            </Link>
          );
        })}
      </nav>
      <section
        className="settings-tab-panel"
        id={`settings-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeTab}`}
      >
        {children}
      </section>
    </div>
  );
}
