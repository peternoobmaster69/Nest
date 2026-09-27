import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans } from "next/font/google";
import { headers } from "next/headers";
import { Providers } from "@/app/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nest Personal Finance Companion",
  description: "Manage bank cash, virtual budgets, credit-card payables, receivables, savings, and investments with full visibility.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icon.svg",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Nest",
    // black-translucent lets the app draw its own solid background under the
    // status bar; iOS 26's Liquid Glass blur over a flat color is invisible,
    // whereas "default" renders a black bar with a blur fade into the topbar.
    statusBarStyle: "black-translucent",
  },
  applicationName: "Nest",
  manifest: "/manifest.webmanifest",
};

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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
