# Search engine setup for Nest

The public site is `https://save.htet.info/`. Its initial search focus is personal budgeting and expense tracking, supported by the product's savings, investment, credit card, and shared-workspace features.

## Site configuration

`lib/seo.ts` defines public page titles, descriptions, canonical URLs, social previews, and the WebSite/WebApplication structured data. Set `NEXT_PUBLIC_SITE_URL` to the canonical HTTPS origin when hosting Nest on another domain. It intentionally does not use the incoming host or an automatically generated deployment URL.

The sitemap at `/sitemap.xml` contains the homepage, privacy policy, and terms of service. Add genuinely public content to `PUBLIC_PAGES` and use `publicPageMetadata` for each new page. Sitemap dates are omitted until accurate content modification dates are available.

Application pages inherit `noindex, nofollow`. The proxy also sends `X-Robots-Tag` on private routes, invitation links, APIs, redirects, and authentication query variants. `/robots.txt` permits crawling so search engines can read those directives; authentication still controls access to financial records. Vercel preview deployments prohibit crawling and indexing and publish an empty sitemap.

The social preview is a 1200 × 630 PNG based on the existing Nest icon. Regenerate it with Node 22 or newer after changing the branding:

```sh
node scripts/generate-seo-image.mjs
```

## Connect Google Search Console after deployment

1. Open [Google Search Console](https://search.google.com/search-console). Use an existing verified `htet.info` domain property if available, or add `https://save.htet.info/` as a URL-prefix property.
2. Verify ownership through the offered DNS method or HTML meta tag. For the meta tag method, set `GOOGLE_SITE_VERIFICATION` to the tag's **content value**, deploy, and choose Verify. The root metadata emits the tag on the homepage.
3. Submit `https://save.htet.info/sitemap.xml` under Sitemaps.
4. Inspect `https://save.htet.info/`. Run the live URL test, check that indexing is allowed and the canonical URL is correct, and request indexing.
5. Review Page indexing, Core Web Vitals, and search queries after Google recrawls the site. Use the actual queries and impressions to choose additional product guides and refine page copy.

Search Console submission and ownership verification require access to the site's Google account or DNS. The code changes do not submit a sitemap automatically.

## Validation

Check that the three public pages return HTTP 200, each has its own canonical URL and description, `/robots.txt` and `/sitemap.xml` are accessible, and `/og/nest.png` returns an image. Confirm that sign-in variants and private responses carry `noindex`. Validate the homepage JSON-LD with the [Schema Markup Validator](https://validator.schema.org/).

References:

- [Next.js metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [Next.js JSON-LD](https://nextjs.org/docs/app/guides/json-ld)
- [Google site names](https://developers.google.com/search/docs/appearance/site-names)
- [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
