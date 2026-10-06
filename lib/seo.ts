import type { Metadata } from "next";

export const SITE_NAME = "Nest";
export const SITE_URL = new URL(
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://save.htet.info",
).origin;
export const SITE_TITLE = "Nest | Personal Budgeting & Expense Tracker";
export const SITE_DESCRIPTION =
  "Plan budgets, track expenses, manage credit cards, and monitor savings and investments with Nest, your personal finance app.";

export const NO_INDEX_ROBOTS = { index: false, follow: false } satisfies Metadata["robots"];

export const PUBLIC_PAGES = {
  home: { path: "/", title: SITE_TITLE, description: SITE_DESCRIPTION },
  privacy: {
    path: "/privacy-policy",
    title: "Privacy Policy | Nest",
    description: "Learn how Nest collects, uses, and protects your personal and financial data, and how to manage your privacy choices.",
  },
  terms: {
    path: "/terms-of-service",
    title: "Terms of Service | Nest",
    description: "Read the terms for using Nest, including account responsibilities, optional integrations, and the scope of its personal finance tools.",
  },
} as const;

const SOCIAL_IMAGE = {
  url: `${SITE_URL}/og/nest.png`,
  width: 1200,
  height: 630,
  alt: "Nest personal finance: budgeting, expenses, savings, and investments in one place.",
};

const PRIVATE_PATHS = [
  "/api", "/api-docs", "/w", "/entry", "/invitations", "/offline",
  "/login", "/signin", "/register", "/accounts", "/admin", "/budgets",
  "/cio", "/collaborators", "/credit-alerts", "/credit-cards",
  "/credit-transactions", "/investments", "/profile", "/receivables",
  "/rewards", "/settings", "/transactions",
];
const SIGN_IN_QUERY_KEYS = new Set(["login", "error", "callbackUrl"]);

export function isSearchIndexingEnabled() {
  return process.env.VERCEL_ENV !== "preview";
}

export function hasSignInQuery(keys: Iterable<string>) {
  for (const key of keys) {
    if (SIGN_IN_QUERY_KEYS.has(key)) return true;
  }
  return false;
}

export function shouldNoIndexRequest(pathname: string, queryKeys: Iterable<string>) {
  return !isSearchIndexingEnabled()
    || PRIVATE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
    || hasSignInQuery(queryKeys);
}

export function publicPageMetadata(page: (typeof PUBLIC_PAGES)[keyof typeof PUBLIC_PAGES]): Metadata {
  const url = new URL(page.path, SITE_URL).href;
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    robots: isSearchIndexingEnabled()
      ? { index: true, follow: true, "max-image-preview": "large" }
      : NO_INDEX_ROBOTS,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: page.title,
      description: page.description,
      url,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [{ url: SOCIAL_IMAGE.url, alt: SOCIAL_IMAGE.alt }],
    },
  };
}

export const SITE_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      alternateName: "Nest Personal Finance",
      description: SITE_DESCRIPTION,
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#application`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      description: SITE_DESCRIPTION,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      image: SOCIAL_IMAGE.url,
      sameAs: "https://github.com/peternoobmaster69/Nest",
      featureList: [
        "Monthly budget planning",
        "Expense tracking and virtual sub-accounts",
        "Credit card payments and receivables",
        "Savings and investment tracking",
        "Shared finance workspaces",
      ],
    },
  ],
};

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
