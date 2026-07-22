export const SETTINGS_TAB_COOKIE = "nest-settings-tab";

export type SettingsTab = "settings" | "workspaces";

export function parseSettingsTab(value: string | null | undefined): SettingsTab | null {
  return value === "settings" || value === "workspaces" ? value : null;
}
