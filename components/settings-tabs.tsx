"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect } from "react";
import { Settings, UsersRound } from "lucide-react";
import { SETTINGS_TAB_COOKIE, type SettingsTab } from "@/lib/settings-tabs";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const tabs: Array<{
  id: SettingsTab;
  label: string;
  icon: typeof Settings;
}> = [
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
  },
  {
    id: "workspaces",
    label: "Workspaces",
    icon: UsersRound,
  },
];

function rememberTab(tab: SettingsTab) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SETTINGS_TAB_COOKIE}=${tab}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

export function SettingsTabs({
  activeTab,
  children,
}: {
  activeTab: SettingsTab;
  children: ReactNode;
}) {
  const router = useRouter();

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
    router.push(`/settings?tab=${nextTab}`);
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
              href={`/settings?tab=${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => rememberTab(tab.id)}
              onKeyDown={(event) => moveTabFocus(event, tabs.indexOf(tab))}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{tab.label}</span>
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
