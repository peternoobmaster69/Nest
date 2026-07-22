export const SETTINGS_TAB_COOKIE = "nest-settings-tab";

export type SettingsTab = "settings" | "automation" | "workspaces" | "data";

export function parseSettingsTab(value: string | null | undefined): SettingsTab | null {
  return value === "settings" || value === "automation" || value === "workspaces" || value === "data"
    ? value
    : null;
}
