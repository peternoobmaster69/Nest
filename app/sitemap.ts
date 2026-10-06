import type { MetadataRoute } from "next";
import { isSearchIndexingEnabled, PUBLIC_PAGES, SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!isSearchIndexingEnabled()) return [];
  return Object.values(PUBLIC_PAGES).map((page) => ({
    url: new URL(page.path, SITE_URL).href,
  }));
}
