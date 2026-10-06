import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans } from "next/font/google";
import { cookies, headers } from "next/headers";
import { APP_ICON_COOKIE, appIconAssets, DEFAULT_APP_ICON, parseAppIcon } from "@/lib/app-icons";
import { Providers } from "@/app/providers";
import "./globals.css";

const baseMetadata: Metadata = {
  title: "Nest Personal Finance Companion",
  description: "Manage bank cash, virtual budgets, credit-card payables, receivables, savings, and investments with full visibility.",
  appleWebApp: {
    capable: true,
    title: "Nest",
    // Let iOS reserve the status area so the fixed theme surface below can
    // supply its colour without a native scroll-edge blur over the header.
    statusBarStyle: "default",
  },
  applicationName: "Nest",
  manifest: "/manifest.webmanifest",
};

// Icons follow the device's chosen variant (Settings → App icon). iOS reads the
// apple-touch-icon once, at "Add to Home Screen", so it must be right on every page.
// Default paths: /favicon.svg and /icons/apple-touch-icon.png.
export async function generateMetadata(): Promise<Metadata> {
  const iconId = parseAppIcon((await cookies()).get(APP_ICON_COOKIE)?.value);
  const assets = appIconAssets(iconId);
  return {
    ...baseMetadata,
    // Tab icon uses its own file names (not the in-app /icon.svg logo) so browsers
    // drop any cached copy of the previous favicon.
    icons: {
      icon: [
        ...(iconId === DEFAULT_APP_ICON ? [{ url: "/favicon.ico", sizes: "16x16 32x32 48x48" }] : []),
        { url: assets.favicon, type: "image/svg+xml" },
        { url: assets.icon192, sizes: "192x192", type: "image/png" },
      ],
      shortcut: iconId === DEFAULT_APP_ICON ? "/favicon.ico" : assets.favicon,
      apple: [{ url: iconId === DEFAULT_APP_ICON ? "/icons/apple-touch-icon.png" : assets.appleTouch, sizes: "180x180", type: "image/png" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  // Matches --bg-elevated (topbar background) per theme; theme-provider keeps
  // these in sync when the user overrides the system theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#2a2723" },
  ],
};

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${dmSans.variable} ${dmMono.variable}`}>
      <head>
        {/* This must run before paint; use the native element so nonce hiding does not confuse hydration. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          src="/theme-init.js"
          nonce={nonce}
          suppressHydrationWarning
        />
      </head>
      <body className="antialiased">
        <div className="pwa-status-bar-surface" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
