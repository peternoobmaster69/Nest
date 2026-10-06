import { headers } from "next/headers";
import { serializeJsonLd, SITE_STRUCTURED_DATA } from "@/lib/seo";

export async function SiteStructuredData() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <script
      id="nest-structured-data"
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(SITE_STRUCTURED_DATA) }}
    />
  );
}
