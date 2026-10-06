/**
 * Home-screen / tab icon variants a user can choose in Settings.
 *
 * The default variant keeps the original asset paths (/icons/icon-192.png …,
 * /favicon.svg) so existing installs and contract tests are unaffected. Other
 * variants live under /icons/<id>/ and are produced by scripts/generate-app-icons.mjs.
 *
 * The choice lives in a cookie (not the database): the manifest request is
 * credentialed but runs before any session lookup we would want on that path,
 * and the preference is per device anyway — each installed copy has its own icon.
 */
export const APP_ICON_COOKIE = "nest-app-icon";

export const APP_ICON_VARIANTS = [
  { id: "classic", label: "Forest", description: "Nestling on deep green", tile: ["#25674A", "#143A2C"] },
  { id: "cream", label: "Cream", description: "Soft light tile", tile: ["#FBF8F2", "#EDE6D8"] },
  { id: "midnight", label: "Midnight", description: "Dark tile with a glow", tile: ["#2B2F3A", "#111318"] },
  { id: "sunrise", label: "Sunrise", description: "Warm peach to amber", tile: ["#FFB98A", "#E46F4C"] },
] as const;

export type AppIconId = (typeof APP_ICON_VARIANTS)[number]["id"];

export const DEFAULT_APP_ICON: AppIconId = "classic";

export function parseAppIcon(value: string | null | undefined): AppIconId {
  return APP_ICON_VARIANTS.some((variant) => variant.id === value) ? (value as AppIconId) : DEFAULT_APP_ICON;
}

/** Public paths for one variant's rendered assets. */
export function appIconAssets(id: AppIconId) {
  const base = id === DEFAULT_APP_ICON ? "/icons" : `/icons/${id}`;
  return {
    icon192: `${base}/icon-192.png`,
    icon512: `${base}/icon-512.png`,
    maskable192: `${base}/icon-maskable-192.png`,
    maskable512: `${base}/icon-maskable-512.png`,
    appleTouch: `${base}/apple-touch-icon.png`,
    favicon: id === DEFAULT_APP_ICON ? "/favicon.svg" : `${base}/favicon.svg`,
    preview: `${base}/icon-192.png`,
  };
}
