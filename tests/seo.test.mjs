import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { proxy } from "../proxy.ts";
import robotsModule from "../app/robots.ts";
import sitemapModule from "../app/sitemap.ts";
import {
  hasSignInQuery,
  NO_INDEX_ROBOTS,
  publicPageMetadata,
  PUBLIC_PAGES,
  serializeJsonLd,
  SITE_URL,
} from "../lib/seo.ts";

const robots = robotsModule.default ?? robotsModule;
const sitemap = sitemapModule.default ?? sitemapModule;

test("private financial URLs carry noindex, including API errors and redirects", () => {
  const paths = [
    "/api/public/net-worth/shared-token",
    "/api/public/cards-due/shared-token",
    "/api/auth/session",
    "/api-docs",
    "/w/workspace-a",
    "/w/workspace-a/transactions",
    "/invitations/invite-token",
    "/entry",
    "/transactions",
    "/settings",
    "/cio",
    "/offline",
  ];
  for (const path of paths) {
    const response = proxy(new NextRequest(`${SITE_URL}${path}`));
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", path);
  }
  const denied = proxy(new NextRequest(`${SITE_URL}/api/transactions`, {
    method: "POST",
    headers: { origin: "https://unrelated.example" },
  }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(proxy(new NextRequest(`${SITE_URL}/transactions`)).status, 307);
});

test("authentication query variants are noindexed while campaign links remain indexable", () => {
  for (const query of ["login=1", "login=", "error=OAuthCallback", "callbackUrl=%2Fw%2Fworkspace-a"]) {
    const url = new URL(`/?${query}`, SITE_URL);
    assert.equal(hasSignInQuery(url.searchParams.keys()), true);
    assert.equal(proxy(new NextRequest(url)).headers.get("x-robots-tag"), "noindex, nofollow");
  }
  for (const path of ["/", "/?utm_source=newsletter", "/privacy-policy", "/terms-of-service", "/og/nest.png"]) {
    const url = new URL(path, SITE_URL);
    assert.equal(hasSignInQuery(url.searchParams.keys()), false);
    assert.equal(proxy(new NextRequest(url)).headers.get("x-robots-tag"), null, path);
  }
});

test("discovery exposes only canonical public pages and lets crawlers read noindex", () => {
  assert.deepEqual(sitemap().map((entry) => entry.url), [
    `${SITE_URL}/`, `${SITE_URL}/privacy-policy`, `${SITE_URL}/terms-of-service`,
  ]);
  assert.deepEqual(robots().rules, { userAgent: "*", allow: "/" });
  assert.equal(robots().sitemap, `${SITE_URL}/sitemap.xml`);
  for (const page of Object.values(PUBLIC_PAGES)) {
    const metadata = publicPageMetadata(page);
    assert.equal(metadata.alternates.canonical, new URL(page.path, SITE_URL).href);
    assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
    assert.equal(metadata.robots.index, true);
  }
});

test("preview deployments opt out of indexing and sitemap discovery", () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    assert.deepEqual(robots().rules, { userAgent: "*", disallow: "/" });
    assert.deepEqual(sitemap(), []);
    assert.deepEqual(publicPageMetadata(PUBLIC_PAGES.home).robots, NO_INDEX_ROBOTS);
    assert.equal(proxy(new NextRequest(`${SITE_URL}/`)).headers.get("x-robots-tag"), "noindex, nofollow");
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("structured data cannot break out of its HTML script element", () => {
  const payload = { description: '</script><script>alert("unexpected")</script>' };
  const serialized = serializeJsonLd(payload);
  assert.equal(serialized.includes("<"), false);
  assert.deepEqual(JSON.parse(serialized), payload);
});
