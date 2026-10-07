import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-07T04:00:00Z");
const account = { searches_per_month: 250, total_searches_left: 250, plan_renewal_date: "2026-11-01" };
const news = { news_results: [{ title: "Market update", link: "https://publisher.example.test/update", source: "Public publisher", iso_date: "2026-10-06T00:00:00Z", date: "Yesterday" }] };
const web = { organic_results: [{ title: "Official savings data", link: "https://www.mas.gov.sg/data", snippet: "Public data", position: 1 }] };
const calls = [];
let state;
function record(type, args) {
  calls.push({ type, args });
  if (state.fail === type) throw new Error(`Fixture ${type} unavailable`);
}
const transaction = {
  async $queryRaw(parts) { record("lock", parts.join("?")); return state.lock; },
  serpApiQuota: {
    async findUnique(args) { record("quota-read", args); return state.quota; },
    async upsert(args) { record("quota-write", args); state.quota = state.quota ? { ...state.quota, ...args.update } : args.create; return state.quota; },
  },
};
const prisma = {
  serpApiNewsCache: {
    async findUnique(args) { record("cache-read", args); return state.cache.get(args.where.cacheKey) ?? null; },
    async delete(args) { record("cache-delete", args); state.cache.delete(args.where.cacheKey); },
    async upsert(args) { record("cache-write", args); state.cache.set(args.where.cacheKey, args.create); return args.create; },
  },
  async $transaction(run) { record("transaction", null); return run(transaction); },
};
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
const { isSerpApiNewsConfigured, searchSerpApiNews, searchSerpApiFinancialWeb, normalizePublicFinancialQuery, parseSerpApiWebPayload, extractNormalizedFinancialValues } = require("../lib/ai/serpapi-news.ts");
const variants = [
  { search: searchSerpApiNews, query: "Market outlook", collection: "articles", payload: news, ttl: 3_600_000 },
  { search: searchSerpApiFinancialWeb, query: "Savings outlook", collection: "sources", payload: web, ttl: 86_400_000 },
];
const ofType = (type) => calls.filter((call) => call.type === type);
beforeEach((t) => {
  assert.equal(require("../lib/prisma.ts").prisma, prisma);
  const keys = ["SERPAPI_API_KEY", "SERPAPI_BASE_URL", "SERPAPI_MONTHLY_REQUEST_LIMIT"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  for (const key of keys) delete process.env[key];
  process.env.SERPAPI_API_KEY = " fixture-api-key ";
  t.mock.timers.enable({ apis: ["Date"], now });
  t.mock.method(AbortSignal, "timeout", (milliseconds) => { calls.push({ type: "timeout", args: milliseconds }); return new AbortController().signal; });
  state = { cache: new Map(), quota: null, lock: [{ lockResult: 0 }], fail: null, account: () => Response.json(account), response: (url) => Response.json(url.searchParams.get("engine") === "google_news" ? news : web) };
  calls.length = 0;
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    record("fetch", { url, options });
    return url.pathname === "/account.json" ? state.account() : state.response(url);
  });
});

test("public searches reject private data and invalid configuration before consulting a provider or cache", async () => {
  for (const { search } of variants) {
    for (const query of ["SGD 120", "USD -99", "account ending 1234", "card 5678", "record 12345678", "owner@example.test"]) {
      await assert.rejects(search(query), { code: "PRIVATE_QUERY_REJECTED" });
    }
    for (const query of ["", "x", "x".repeat(201)]) await assert.rejects(search(query), { code: "NO_DATA" });
    for (const value of ["", " "]) {
      process.env.SERPAPI_API_KEY = value;
      assert.equal(isSerpApiNewsConfigured(), false);
      await assert.rejects(search("Market outlook"), { code: "NOT_CONFIGURED" });
    }
    process.env.SERPAPI_API_KEY = "fixture-api-key";
    assert.equal(isSerpApiNewsConfigured(), true);
    for (const url of ["invalid", "http://serpapi.com", "https://serpapi.com.example.test", "https://example.test"]) {
      process.env.SERPAPI_BASE_URL = url;
      await assert.rejects(search("Market outlook"), { code: "INVALID_CONFIGURATION" });
    }
    delete process.env.SERPAPI_BASE_URL;
  }
  assert.equal(calls.length, 0);
  for (const query of ["my salary", "our portfolio", "retirement 8,000", "retirement 2026.5", "S$100 savings", "US$50 pension", "A$25 investment"]) {
    assert.throws(() => normalizePublicFinancialQuery(query), { code: "PRIVATE_QUERY_REJECTED" });
  }
  assert.throws(() => normalizePublicFinancialQuery("weather forecast"), { code: "NO_DATA" });
  assert.equal(normalizePublicFinancialQuery("  Ｓａｖｉｎｇｓ\n\t2026  "), "Savings 2026");
  for (const topic of ["retirement", "pension", "cpf", "provident", "investment", "portfolio", "asset", "allocation", "inflation", "cost of living", "household expenditure", "household spending", "living costs", "financial", "finance", "savings", "wealth", "income", "budget", "spending", "expenses", "healthcare costs", "insurance", "taxation", "interest rates", "mortgage", "annuities", "market", "stocks", "bonds", "funds", "etfs", "securities", "exchange rates", "monetary policy"]) {
    assert.equal(normalizePublicFinancialQuery(`${topic} outlook`), `${topic} outlook`);
  }
});

test("news and financial search use their documented query options and share a durable provider allowance", async () => {
  process.env.SERPAPI_BASE_URL = " https://fixture:private@www.serpapi.com/ignored?ignored=yes#ignored ";
  for (const variant of variants) {
    state.quota = null;
    const result = await variant.search(`  ${variant.query}\n\t `);
    assert.equal(result.query, variant.query);
    assert.equal(result.fromCache, false);
    assert.equal(result[variant.collection].length, 1);
    assert.equal(result.fetchedAt.getTime(), now.getTime());
    const requests = ofType("fetch").slice(-2).map(({ args }) => args);
    assert.deepEqual(requests.map(({ url }) => url.pathname), ["/account.json", "/search"]);
    for (const { url, options } of requests) {
      assert.equal(url.origin, "https://serpapi.com");
      assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.hash, "");
      assert.equal(url.searchParams.get("api_key"), "fixture-api-key");
      assert.equal(url.searchParams.has("ignored"), false);
      assert.equal(options.cache, "no-store");
      assert.equal(options.headers.Accept, "application/json");
      assert.ok(options.signal instanceof AbortSignal);
    }
    const params = requests[1].url.searchParams;
    assert.equal(params.get("gl"), "sg"); assert.equal(params.get("hl"), "en");
    if (variant.collection === "articles") {
      assert.equal(params.get("engine"), "google_news");
      assert.equal(params.get("q"), "Market outlook when:7d");
      assert.equal(params.has("so"), false);
    } else {
      assert.equal(params.get("engine"), "google");
      assert.equal(params.get("q"), "Savings outlook");
      assert.equal(params.get("google_domain"), "google.com.sg");
      assert.equal(params.get("num"), "10"); assert.equal(params.get("safe"), "active");
    }
    const write = ofType("cache-write").at(-1).args;
    assert.equal(write.where.cacheKey, write.create.cacheKey);
    assert.equal(write.create.payloadJson, JSON.stringify(variant.payload));
    assert.equal(write.create.expiresAt.getTime() - now.getTime(), variant.ttl);
    assert.deepEqual(write.update, { payloadJson: write.create.payloadJson, fetchedAt: now, expiresAt: write.create.expiresAt });
    const quota = ofType("quota-write").at(-1).args;
    assert.equal(quota.create.requestCount, 1);
    assert.equal(quota.create.windowKey, account.plan_renewal_date);
    assert.equal(quota.create.nextAllowedAt.getTime(), now.getTime() + 5_000);
    assert.equal(quota.where.provider, "serpapi-news");
    assert.match(ofType("lock").at(-1).args, /@LockOwner = 'Transaction'/);
    assert.match(ofType("lock").at(-1).args, /@LockMode = 'Exclusive'/);
  }
  assert.deepEqual(ofType("timeout").map(({ args }) => args), [8_000, 12_000, 8_000, 12_000]);
});

test("fresh caches are case-insensitive, require no quota reservation, and keep news separate from web results", async () => {
  await searchSerpApiNews("Savings outlook");
  const previousFetches = ofType("fetch").length;
  const cached = await searchSerpApiNews("SAVINGS OUTLOOK");
  assert.equal(cached.fromCache, true);
  assert.equal(cached.query, "SAVINGS OUTLOOK");
  assert.equal(cached.articles[0].title, "Market update");
  assert.equal(ofType("fetch").length, previousFetches);
  state.quota = null;
  const webResult = await searchSerpApiFinancialWeb("Savings outlook");
  assert.equal(webResult.fromCache, false);
  assert.equal(state.cache.size, 2);
  const webCached = await searchSerpApiFinancialWeb("savings outlook");
  assert.equal(webCached.fromCache, true);
  assert.equal(webCached.sources[0].domain, "mas.gov.sg");
  assert.equal(ofType("quota-write").length, 2);
  state.quota = null;
  await searchSerpApiNews("Market outlook when:1d");
  assert.equal(ofType("fetch").at(-1).args.url.searchParams.get("q"), "Market outlook when:1d");
});

test("expired, malformed, and unavailable caches cannot replace fresh results or make successful searches fail", async () => {
  for (const variant of variants) {
    state.quota = null;
    await variant.search(variant.query);
    const key = ofType("cache-read").at(-1).args.where.cacheKey;
    for (const [payloadJson, expired, failure, deleted] of [
      [JSON.stringify(variant.payload), true, null, false],
      ["null", false, null, true], ["{}", false, null, true], ["{", false, null, false],
      ["{}", false, "cache-delete", true], ["{}", false, "cache-read", false],
      ["{}", false, "cache-write", true],
    ]) {
      state.fail = failure; state.quota = null;
      state.cache.set(key, { payloadJson, fetchedAt: now, expiresAt: new Date(now.getTime() + (expired ? 0 : 60_000)) });
      const before = ofType("cache-delete").length;
      const result = await variant.search(variant.query);
      assert.equal(result.fromCache, false);
      assert.equal(result[variant.collection].length, 1);
      assert.equal(ofType("cache-delete").length - before, Number(deleted));
    }
    state.fail = null;
  }
});

test("account usage must be available, authenticated, and valid before a search can consume allowance", async () => {
  for (const [response, code] of [
    [() => { throw new Error("Network down"); }, "UNAVAILABLE"],
    [() => new Response(null, { status: 401 }), "AUTHENTICATION_FAILED"],
    [() => new Response(null, { status: 403 }), "AUTHENTICATION_FAILED"],
    [() => new Response(null, { status: 500 }), "UNAVAILABLE"],
    [() => new Response("{"), "UNAVAILABLE"],
    ...[null, [], {}, { ...account, searches_per_month: "250" }, { ...account, searches_per_month: 0 }, { ...account, total_searches_left: "200" }, { ...account, total_searches_left: -1 }].map((value) => [() => Response.json(value), "UNAVAILABLE"]),
    [() => new Response('{"searches_per_month":1e999,"total_searches_left":250}'), "UNAVAILABLE"],
    [() => new Response('{"searches_per_month":250,"total_searches_left":1e999}'), "UNAVAILABLE"],
  ]) {
    state.account = response;
    await assert.rejects(searchSerpApiNews("Market outlook"), { code });
  }
  assert.equal(ofType("transaction").length, 0);
  assert.ok(ofType("fetch").every(({ args }) => args.url.pathname === "/account.json"));
});

test("monthly limits honor both the configured cap and upstream reserve before acquiring any lock", async () => {
  for (const [limit, remaining] of [[undefined, 50], ["invalid", 50], ["999", 0], ["0", 249], ["-5", 249], ["100", 150]]) {
    if (limit === undefined) delete process.env.SERPAPI_MONTHLY_REQUEST_LIMIT; else process.env.SERPAPI_MONTHLY_REQUEST_LIMIT = limit;
    state.account = () => Response.json({ ...account, total_searches_left: remaining });
    for (const { search, query } of variants) await assert.rejects(search(query), { code: "MONTHLY_LIMIT_REACHED", retryAfterSeconds: null });
  }
  assert.equal(ofType("transaction").length, 0);
  process.env.SERPAPI_MONTHLY_REQUEST_LIMIT = "200";
  state.account = () => Response.json({ ...account, searches_per_month: 100, total_searches_left: 1 });
  assert.equal((await searchSerpApiNews("Market outlook")).articles.length, 1);
});

test("transaction-owned locks serialize reservations, apply five-second spacing, and reset changed renewal windows", async (t) => {
  for (const lock of [[], [{ lockResult: -1 }]]) {
    state.lock = lock;
    await assert.rejects(searchSerpApiNews("Market outlook"), { code: "RATE_LIMITED", retryAfterSeconds: 5 });
  }
  assert.equal(ofType("quota-read").length, 0);
  state.lock = [{ lockResult: 0 }];
  state.quota = { windowKey: account.plan_renewal_date, requestCount: 200, nextAllowedAt: now };
  await assert.rejects(searchSerpApiNews("Market outlook"), { code: "MONTHLY_LIMIT_REACHED" });
  state.quota.requestCount = 3;
  state.quota.nextAllowedAt = new Date(now.getTime() + 1_001);
  await assert.rejects(searchSerpApiNews("Market outlook"), { code: "RATE_LIMITED", retryAfterSeconds: 2 });
  t.mock.timers.setTime(now.getTime() + 1_001);
  await searchSerpApiNews("Market outlook");
  assert.equal(state.quota.requestCount, 4);
  state.quota = { windowKey: "previous-cycle", requestCount: 999, nextAllowedAt: new Date(now.getTime() + 100_000) };
  state.account = () => Response.json({ ...account, plan_renewal_date: " " });
  await searchSerpApiFinancialWeb("Savings outlook");
  assert.equal(state.quota.requestCount, 1);
  assert.equal(state.quota.windowKey, "2026-10");
  state.fail = "transaction";
  await assert.rejects(searchSerpApiNews("Another market outlook"), /Fixture transaction unavailable/);
});

test("failed upstream searches preserve safe typed errors and retain their quota reservation", async () => {
  for (const { search, query } of variants) {
    for (const [response, code, retryAfterSeconds] of [
      [() => { throw new Error("Network down with private details"); }, "UNAVAILABLE", null],
      [() => new Response(null, { status: 401 }), "AUTHENTICATION_FAILED", null],
      [() => new Response(null, { status: 403 }), "AUTHENTICATION_FAILED", null],
      [() => new Response(null, { status: 500 }), "UNAVAILABLE", null],
      ...[null, "9", "invalid", "0"].map((retry) => [() => new Response(null, { status: 429, headers: retry === null ? {} : { "retry-after": retry } }), "RATE_LIMITED", retry === "9" ? 9 : 5]),
      [() => new Response("{"), "UNAVAILABLE", null], [() => Response.json(null), "UNAVAILABLE", null],
      [() => Response.json({ error: "Invalid API key: private details" }), "AUTHENTICATION_FAILED", null],
      [() => Response.json({ error: "Provider error: private details" }), "UNAVAILABLE", null],
      [() => Response.json({}), "NO_DATA", null],
    ]) {
      state.quota = null; state.response = response;
      await assert.rejects(search(query), (error) => {
        assert.equal(error.code, code); assert.equal(error.name, "SerpApiNewsError");
        assert.equal(error.retryAfterSeconds, retryAfterSeconds);
        assert.ok(!error.message.includes("private details"));
        return true;
      });
      assert.equal(state.quota.requestCount, 1);
    }
  }
  assert.equal(ofType("cache-write").length, 0);
});

test("news parsing traverses provider groups, strips URL credentials, deduplicates, and returns the eight newest collected stories", async () => {
  state.response = () => Response.json({ news_results: [
    null, "unexpected", { title: "No link" }, { title: "Unsafe", link: "javascript:alert(1)" },
    { title: "Malformed", link: "not-a-link" },
    { title: " " },
    { title: "Undated", link: "http://user:pass@publisher.example.test/undated", source: { title: "Publisher title" }, iso_date: "invalid" },
    { title: "Undated duplicate", link: "http://publisher.example.test/undated" },
    { title: "No timestamp", link: "https://publisher.example.test/no-date", source: [] },
    { stories: [{ title: "Old story", link: "https://publisher.example.test/old", source: { name: "Named publisher" }, iso_date: "2020-01-01" }], highlight: { title: "Highlighted", link: "https://publisher.example.test/highlight", source: 4 }, news_results: [{ title: "Nested", link: "https://publisher.example.test/nested" }] },
    ...Array.from({ length: 60 }, (_, index) => ({ title: `${"Long title ".repeat(30)} ${index}`, link: `https://publisher.example.test/${index}`, iso_date: new Date(Date.UTC(2026, 8, index + 1)).toISOString() })),
  ] });
  const result = await searchSerpApiNews("Market outlook");
  assert.equal(result.articles.length, 8);
  assert.deepEqual(result.articles.map(({ link }) => Number(new URL(link).pathname.slice(1))), [44, 43, 42, 41, 40, 39, 38, 37]);
  assert.ok(result.articles.every(({ title }) => title.length === 300));
  state.quota = null;
  state.response = () => Response.json({ news_results: [{ title: "Only story", link: "http://user:pass@publisher.example.test/one", source: { title: "Publisher title" } }] });
  const single = await searchSerpApiNews("Other market outlook");
  assert.deepEqual(single.articles[0], { title: "Only story", link: "http://publisher.example.test/one", source: "Publisher title", publishedAt: null, publishedLabel: null });
});

test("financial parsing classifies trusted domains, bounds display values, and discards invalid or duplicate sources", () => {
  assert.equal(parseSerpApiWebPayload(null), null);
  assert.deepEqual(parseSerpApiWebPayload({ organic_results: "invalid" }).sources, []);
  const authorities = new Map([
    ["gov.sg", "OFFICIAL_GOVERNMENT"], ["mas.gov.sg", "OFFICIAL_GOVERNMENT"], ["mof.go.jp", "OFFICIAL_GOVERNMENT"], ["data.gov.uk", "OFFICIAL_GOVERNMENT"], ["data.gov.au", "OFFICIAL_GOVERNMENT"],
    ["university.edu", "ACADEMIC_OR_MULTILATERAL"], ["school.edu.sg", "ACADEMIC_OR_MULTILATERAL"], ["school.ac.uk", "ACADEMIC_OR_MULTILATERAL"], ["imf.org", "ACADEMIC_OR_MULTILATERAL"], ["data.oecd.org", "ACADEMIC_OR_MULTILATERAL"], ["worldbank.org", "ACADEMIC_OR_MULTILATERAL"], ["bis.org", "ACADEMIC_OR_MULTILATERAL"],
    ["sgx.com", "REGULATED_OR_PRIMARY"], ["data.sgx.com", "REGULATED_OR_PRIMARY"], ["morningstar.com", "REGULATED_OR_PRIMARY"], ["data.morningstar.com", "REGULATED_OR_PRIMARY"], ["mas.gov.sg.example.test", "OTHER_PUBLIC_SOURCE"],
  ]);
  for (const [domain, authority] of authorities) {
    const result = parseSerpApiWebPayload({ organic_results: [{ title: "Savings", link: `https://www.${domain}/` }] });
    assert.equal(result.sources[0].domain, domain);
    assert.equal(result.sources[0].authority, authority);
    assert.equal(result.sources[0].position, null);
  }
  const source = { title: "s".repeat(350), link: "https://user:private@www.mas.gov.sg/data", snippet: `S$100 ${"line\n".repeat(400)}`, position: Infinity };
  const result = parseSerpApiWebPayload({ organic_results: [null, [], 1, { title: "Missing" }, { ...source, link: "ftp://mas.gov.sg/data" }, source, source, ...Array.from({ length: 10 }, (_, index) => ({ ...source, link: `https://mas.gov.sg/${index}` }))] });
  assert.equal(result.sources.length, 8);
  assert.equal(result.sources[0].title.length, 300);
  assert.equal(result.sources[0].snippet.length, 1_200);
  assert.ok(!result.sources[0].snippet.includes("\n"));
  assert.equal(result.sources[0].link, "https://www.mas.gov.sg/data");
  assert.equal(result.sources[0].position, null);
  assert.deepEqual(result.sources[0].normalizedFinancialValues, ["SGD 100"]);
  assert.deepEqual(extractNormalizedFinancialValues("AUD 1.25 A$1.25 US$+20 S$-3 GBP 1,000.50 EUR 5 JPY 100"), ["AUD 1.25", "GBP 1,000.50", "EUR 5", "JPY 100", "USD +20", "SGD -3"]);
  assert.deepEqual(extractNormalizedFinancialValues("ABC 100 NOK 500 USD 20 not 100"), ["USD 20"]);
  assert.equal(extractNormalizedFinancialValues(Array.from({ length: 25 }, (_, index) => `USD ${index}`).join(" ")).length, 20);
});
