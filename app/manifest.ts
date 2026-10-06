import type { MetadataRoute } from "next";
import { cookies } from "next/headers";
import { APP_ICON_COOKIE, appIconAssets, DEFAULT_APP_ICON, parseAppIcon } from "@/lib/app-icons";

// The icon set follows the user's chosen variant (Settings → App icon), read from a
// cookie on this credentialed request. Reading cookies makes the route dynamic, so each
// device gets its own icons; browsers re-check the manifest and update installed icons.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const iconId = parseAppIcon((await cookies()).get(APP_ICON_COOKIE)?.value);
  const assets = appIconAssets(iconId);
  return {
    // A stable id keeps the installed app the same app when its icons change.
    id: "/",
    name: "Nest",
    short_name: "Nest",
    description: "Nest Personal Finance Companion",
    start_url: "/",
    display: "standalone",
    background_color: "#1E4035",
    theme_color: "#1E4035",
    icons: [
      {
        src: assets.icon192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: assets.icon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: assets.maskable192,
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        // Default: /icons/icon-maskable-512.png
        src: iconId === DEFAULT_APP_ICON ? "/icons/icon-maskable-512.png" : assets.maskable512,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    orientation: "portrait",
    scope: "/",
    lang: "en",
    categories: ["finance", "productivity"],
  };
}
