import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { isAuthoritativeFinancialHostname } from "../lib/ai/public-financial-source.ts";
import {
  extractNormalizedFinancialValues,
  normalizePublicFinancialQuery,
  parseSerpApiWebPayload,
} from "../lib/ai/serpapi-news.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("SerpApi financial research is bounded, cached, and privacy filtered", async () => {
  const client = await source("lib/ai/serpapi-news.ts");

  assert.match(client, /searchSerpApiFinancialWeb/);
  assert.match(client, /requestUrl\.searchParams\.set\("engine", "google"\)/);
  assert.match(client, /organic_results/);
  assert.match(client, /SERPAPI_WEB_CACHE_TTL_MS = 24 \* 60 \* 60 \* 1_000/);
  assert.match(client, /Public financial searches cannot include personal amounts/);
  assert.match(client, /containsLikelyPersonalAmount/);
  assert.match(client, /google_web:sg:en/);
  assert.match(client, /authority: sourceAuthority\(domain\)/);
  assert.doesNotMatch(client, /NEXT_PUBLIC_SERPAPI/);

  assert.deepEqual(
    extractNormalizedFinancialValues("The values were S$5,931, US$2,000 and SGD 800."),
    ["SGD 800", "SGD 5,931", "USD 2,000"],
  );
  assert.equal(
    normalizePublicFinancialQuery("Singapore retired couple monthly living costs 2023"),
    "Singapore retired couple monthly living costs 2023",
  );
  assert.throws(
    () => normalizePublicFinancialQuery("Is 8000 per month enough for my retirement?"),
    /cannot include personal amounts/,
  );
  assert.deepEqual(parseSerpApiWebPayload({
    organic_results: [{
      position: 1,
      title: "Household Expenditure Survey",
      link: "https://www.singstat.gov.sg/example",
      snippet: "Average spending was S$5,931.",
      date: "Jan 2025",
    }],
  })?.sources[0], {
    title: "Household Expenditure Survey",
    link: "https://www.singstat.gov.sg/example",
    domain: "singstat.gov.sg",
    snippet: "Average spending was S$5,931.",
    publishedLabel: "Jan 2025",
    position: 1,
    authority: "OFFICIAL_GOVERNMENT",
    normalizedFinancialValues: ["SGD 5,931"],
  });
});

test("authoritative source reading is HTTPS-only and protected against SSRF and oversized pages", async () => {
  const reader = await source("lib/ai/public-financial-source.ts");

  assert.equal(isAuthoritativeFinancialHostname("www.singstat.gov.sg"), true);
  assert.equal(isAuthoritativeFinancialHostname("cpf.gov.sg"), true);
  assert.equal(isAuthoritativeFinancialHostname("www.imf.org"), true);
  assert.equal(isAuthoritativeFinancialHostname("example.com"), false);
  assert.match(reader, /url\.protocol !== "https:"/);
  assert.match(reader, /lookup\(url\.hostname, \{ all: true, verbatim: true \}\)/);
  assert.match(reader, /PRIVATE_ADDRESS_REJECTED/);
  assert.match(reader, /redirect: "manual"/);
  assert.match(reader, /MAX_SOURCE_BYTES = 750_000/);
  assert.match(reader, /SOURCE_TOO_LARGE/);
  assert.match(reader, /text\/html/);
  assert.match(reader, /UNSUPPORTED_CONTENT/);
});

test("Ask Nest exposes public financial search and authoritative source citations", async () => {
  const [tools, orchestration, intent, readme, packageJson, nextRunner] = await Promise.all([
    source("lib/ai/ask-nest-tools.ts"),
    source("lib/ai/ask-nest.ts"),
    source("lib/ai/ask-nest-intent.mjs"),
    source("README.md"),
    source("package.json"),
    source("scripts/run-next-with-system-ca.mjs"),
  ]);

  for (const tool of ["search_public_financial_sources", "read_authoritative_financial_source"]) {
    assert.match(tools, new RegExp(`name: "${tool}"`));
    assert.match(tools, new RegExp(`case "${tool}":`));
  }
  assert.match(tools, /domain: "PUBLIC_FINANCIAL_RESEARCH"/);
  assert.match(tools, /normalizedFinancialValues/);
  assert.match(orchestration, /search_public_financial_sources: "Public financial research"/);
  assert.match(orchestration, /Keep recorded Nest facts, deterministic Nest projections, user-proposed inputs, and public benchmarks visibly separate/);
  assert.match(orchestration, /const groundingText = \[[\s\S]*?\.\.\.toolOutputs,[\s\S]*?\.\.\.userSuppliedNumericContext,[\s\S]*?\.\.\.referencedConversationContext,[\s\S]*?\.\.\.normalizedUserCurrencyContext,[\s\S]*?\];/);
  assert.match(intent, /intent: "cio_public_financial_benchmark"[\s\S]*?search_public_financial_sources/);
  assert.match(readme, /cited public financial research/);
  assert.match(packageJson, /run-next-with-system-ca\.mjs dev/);
  assert.match(packageJson, /run-next-with-system-ca\.mjs start/);
  assert.match(nextRunner, /process\.allowedNodeEnvironmentFlags\.has\("--use-system-ca"\)/);
  assert.match(nextRunner, /NODE_USE_SYSTEM_CA: "1"/);
  assert.doesNotMatch(nextRunner, /NODE_TLS_REJECT_UNAUTHORIZED/);
});
