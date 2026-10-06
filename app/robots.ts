import type { MetadataRoute } from "next";
import { isSearchIndexingEnabled, SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  if (!isSearchIndexingEnabled()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    // Crawlers must be able to read noindex on private pages and API responses.
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
