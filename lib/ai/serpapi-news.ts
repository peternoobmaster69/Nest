import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const SERPAPI_PROVIDER = "serpapi-news";
const SERPAPI_CACHE_TTL_MS = 60 * 60 * 1_000;
const SERPAPI_WEB_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const SERPAPI_MIN_REQUEST_INTERVAL_MS = 5_000;
const SERPAPI_DEFAULT_MONTHLY_LIMIT = 200;
const SERPAPI_MAX_MONTHLY_LIMIT = 250;
const SERPAPI_MAX_RESULTS = 8;
const SERPAPI_MAX_PARSED_RESULTS = 50;

type SerpApiNewsArticle = {
  title: string;
  source: string | null;
  publishedAt: string | null;
  publishedLabel: string | null;
  link: string;
};

export type SerpApiNewsResult = {
  query: string;
  articles: SerpApiNewsArticle[];
  fetchedAt: Date;
  fromCache: boolean;
};

export type SerpApiWebSource = {
  title: string;
  link: string;
  domain: string;
  snippet: string | null;
  publishedLabel: string | null;
  position: number | null;
  authority: "OFFICIAL_GOVERNMENT" | "ACADEMIC_OR_MULTILATERAL" | "REGULATED_OR_PRIMARY" | "OTHER_PUBLIC_SOURCE";
  normalizedFinancialValues: string[];
};

export type SerpApiWebResult = {
  query: string;
  sources: SerpApiWebSource[];
  fetchedAt: Date;
  fromCache: boolean;
};

export type SerpApiNewsFailureCode =
  | "NOT_CONFIGURED"
  | "INVALID_CONFIGURATION"
  | "PRIVATE_QUERY_REJECTED"
  | "RATE_LIMITED"
  | "MONTHLY_LIMIT_REACHED"
  | "AUTHENTICATION_FAILED"
  | "NO_DATA"
  | "UNAVAILABLE";

export class SerpApiNewsError extends Error {
  code: SerpApiNewsFailureCode;
  retryAfterSeconds: number | null;

  constructor(code: SerpApiNewsFailureCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "SerpApiNewsError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type SerpApiPayload = {
  news_results?: unknown;
  organic_results?: unknown;
  error?: unknown;
  search_metadata?: unknown;
};

type SerpApiAccountStatus = {
  windowKey: string;
  searchesPerMonth: number;
  totalSearchesLeft: number;
};

function configuredApiKey() {
  return (process.env.SERPAPI_API_KEY || "").trim();
}

export function isSerpApiNewsConfigured() {
  return Boolean(configuredApiKey());
}

function getSerpApiConfig() {
  const apiKey = configuredApiKey();
  if (!apiKey) {
    throw new SerpApiNewsError("NOT_CONFIGURED", "SerpApi news search is not configured.");
  }

  const configuredUrl = (process.env.SERPAPI_BASE_URL || "https://serpapi.com").trim();
  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredUrl);
  } catch {
    throw new SerpApiNewsError("INVALID_CONFIGURATION", "SERPAPI_BASE_URL must be a valid URL.");
  }
  if (baseUrl.protocol !== "https:" || !["serpapi.com", "www.serpapi.com"].includes(baseUrl.hostname)) {
    throw new SerpApiNewsError(
      "INVALID_CONFIGURATION",
      "SERPAPI_BASE_URL must use the official https://serpapi.com endpoint.",
    );
  }
  baseUrl.hostname = "serpapi.com";
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";
  baseUrl.username = "";
  baseUrl.password = "";

  const configuredLimit = Number.parseInt(process.env.SERPAPI_MONTHLY_REQUEST_LIMIT || "", 10);
  const monthlyLimit = Number.isFinite(configuredLimit)
    ? Math.max(1, Math.min(configuredLimit, SERPAPI_MAX_MONTHLY_LIMIT))
    : SERPAPI_DEFAULT_MONTHLY_LIMIT;
  return { apiKey, baseUrl, monthlyLimit };
}

function normalizePublicNewsQuery(value: string) {
  const query = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (query.length < 2 || query.length > 160) {
    throw new SerpApiNewsError("NO_DATA", "News queries must contain between 2 and 160 characters.");
  }

  const containsPrivateFinancialData =
    /\b(?:sgd|usd|eur|gbp|aud|jpy)\s*[-+]?\d/i.test(query) ||
    /\b(?:account|card)\s+(?:ending\s+)?\d{3,}\b/i.test(query) ||
    /\b\d{8,}\b/.test(query) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(query);
  if (containsPrivateFinancialData) {
    throw new SerpApiNewsError(
      "PRIVATE_QUERY_REJECTED",
      "News searches cannot include private financial, card, or contact details.",
    );
  }
  return query;
}

export function normalizePublicFinancialQuery(value: string) {
  const query = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (query.length < 3 || query.length > 200) {
    throw new SerpApiNewsError("NO_DATA", "Financial research queries must contain between 3 and 200 characters.");
  }

  const containsLikelyPersonalAmount = [...query.matchAll(/\b(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,6})(?:\.\d+)?\b/g)]
    .some((match) => {
      const numeric = Number(match[0].replaceAll(",", ""));
      return !Number.isInteger(numeric) || numeric < 1900 || numeric > 2100;
    });
  const containsPrivateFinancialData =
    /\b(?:sgd|usd|eur|gbp|aud|jpy)\s*[-+]?\d/i.test(query) ||
    /\b(?:s|us|a)\$\s*[-+]?\d/i.test(query) ||
    /\b(?:account|card)\s+(?:ending\s+)?\d{3,}\b/i.test(query) ||
    /\b\d{8,}\b/.test(query) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(query) ||
    containsLikelyPersonalAmount ||
    /\b(?:my|our)\s+(?:account|balance|card|portfolio|salary|income|spending|budget)\b/i.test(query);
  if (containsPrivateFinancialData) {
    throw new SerpApiNewsError(
      "PRIVATE_QUERY_REJECTED",
      "Public financial searches cannot include personal amounts, balances, account details, card details, or contact details. Search for the public benchmark without the user's value.",
    );
  }

  const isFinancialTopic = /\b(?:retir\w*|pension|cpf|provident|invest\w*|portfolio|asset|allocation|inflation|cost of living|household expenditure|household spending|living costs?|financial|finance|savings?|wealth|income|budget|spending|expenses?|healthcare costs?|insurance|tax(?:es|ation)?|interest rates?|mortgage|annuit\w*|market|stocks?|bonds?|funds?|etfs?|securit(?:y|ies)|exchange rates?|monetary policy)\b/i.test(query);
  if (!isFinancialTopic) {
    throw new SerpApiNewsError(
      "NO_DATA",
      "Public research is limited to financial, retirement, market, and cost-of-living topics.",
    );
  }
  return query;
}

function cacheKeyForQuery(query: string) {
  return createHash("sha256").update(`google_news:sg:en:when7d:${query.toLocaleLowerCase()}`).digest("hex");
}

function cacheKeyForWebQuery(query: string) {
  return createHash("sha256").update(`google_web:sg:en:${query.toLocaleLowerCase()}`).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeArticleUrl(value: unknown) {
  const link = nonEmptyString(value);
  if (!link) return null;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sourceDomain(link: string) {
  try {
    return new URL(link).hostname.toLocaleLowerCase().replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function sourceAuthority(domain: string): SerpApiWebSource["authority"] {
  if (domain === "gov.sg" || domain.endsWith(".gov.sg") || domain.endsWith(".go.jp") || domain.endsWith(".gov.uk") || domain.endsWith(".gov.au")) {
    return "OFFICIAL_GOVERNMENT";
  }
  if (
    domain.endsWith(".edu") || domain.endsWith(".edu.sg") || domain.endsWith(".ac.uk") ||
    ["imf.org", "oecd.org", "worldbank.org", "bis.org"].some((value) => domain === value || domain.endsWith(`.${value}`))
  ) {
    return "ACADEMIC_OR_MULTILATERAL";
  }
  if (
    domain === "sgx.com" || domain.endsWith(".sgx.com") ||
    domain === "morningstar.com" || domain.endsWith(".morningstar.com")
  ) {
    return "REGULATED_OR_PRIMARY";
  }
  return "OTHER_PUBLIC_SOURCE";
}

export function extractNormalizedFinancialValues(value: string) {
  const values = new Set<string>();
  for (const match of value.matchAll(/\b(SGD|USD|EUR|GBP|AUD|JPY)\s*([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/gi)) {
    values.add(`${match[1].toLocaleUpperCase()} ${match[2]}`);
  }
  for (const match of value.matchAll(/\b(S|US|A)\$\s*([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/gi)) {
    const currency = match[1].toLocaleUpperCase() === "S" ? "SGD" : match[1].toLocaleUpperCase() === "US" ? "USD" : "AUD";
    values.add(`${currency} ${match[2]}`);
  }
  return [...values].slice(0, 20);
}

function articleSource(value: unknown) {
  const direct = nonEmptyString(value);
  if (direct) return direct;
  const source = asRecord(value);
  return source ? nonEmptyString(source.name) || nonEmptyString(source.title) : null;
}

function collectNewsArticles(value: unknown, output: SerpApiNewsArticle[]) {
  if (output.length >= SERPAPI_MAX_PARSED_RESULTS) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNewsArticles(item, output);
      if (output.length >= SERPAPI_MAX_PARSED_RESULTS) break;
    }
    return;
  }
  const item = asRecord(value);
  if (!item) return;

  const title = nonEmptyString(item.title);
  const link = safeArticleUrl(item.link);
  if (title && link && !output.some((article) => article.link === link)) {
    output.push({
      title: title.slice(0, 300),
      source: articleSource(item.source),
      publishedAt: nonEmptyString(item.iso_date),
      publishedLabel: nonEmptyString(item.date),
      link,
    });
  }

  for (const key of ["stories", "highlight", "news_results"]) {
    collectNewsArticles(item[key], output);
    if (output.length >= SERPAPI_MAX_PARSED_RESULTS) break;
  }
}

function articlePublishedTime(article: SerpApiNewsArticle) {
  if (!article.publishedAt) return 0;
  const timestamp = Date.parse(article.publishedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function parsePayload(value: unknown) {
  const payload = asRecord(value) as SerpApiPayload | null;
  if (!payload) return null;
  const articles: SerpApiNewsArticle[] = [];
  collectNewsArticles(payload.news_results, articles);
  return {
    payload,
    articles: articles
      .sort((a, b) => articlePublishedTime(b) - articlePublishedTime(a))
      .slice(0, SERPAPI_MAX_RESULTS),
  };
}

export function parseSerpApiWebPayload(value: unknown) {
  const payload = asRecord(value) as SerpApiPayload | null;
  if (!payload) return null;
  const rawResults = Array.isArray(payload.organic_results) ? payload.organic_results : [];
  const sources: SerpApiWebSource[] = [];
  for (const rawResult of rawResults) {
    const item = asRecord(rawResult);
    if (!item) continue;
    const title = nonEmptyString(item.title);
    const link = safeArticleUrl(item.link);
    if (!title || !link || sources.some((source) => source.link === link)) continue;
    const snippet = nonEmptyString(item.snippet)?.replace(/\s+/g, " ").slice(0, 1_200) ?? null;
    const domain = sourceDomain(link);
    sources.push({
      title: title.slice(0, 300),
      link,
      domain,
      snippet,
      publishedLabel: nonEmptyString(item.date),
      position: typeof item.position === "number" && Number.isFinite(item.position) ? item.position : null,
      authority: sourceAuthority(domain),
      normalizedFinancialValues: extractNormalizedFinancialValues(`${title} ${snippet ?? ""}`),
    });
    if (sources.length >= SERPAPI_MAX_RESULTS) break;
  }
  return { payload, sources };
}

async function readCachedNews(cacheKey: string, now: Date) {
  const cached = await prisma.serpApiNewsCache.findUnique({ where: { cacheKey } });
  if (!cached || cached.expiresAt <= now) return null;
  const parsed = parsePayload(JSON.parse(cached.payloadJson) as unknown);
  if (!parsed?.articles.length) {
    await prisma.serpApiNewsCache.delete({ where: { cacheKey } }).catch(() => undefined);
    return null;
  }
  return { articles: parsed.articles, fetchedAt: cached.fetchedAt };
}

async function readCachedWeb(cacheKey: string, now: Date) {
  const cached = await prisma.serpApiNewsCache.findUnique({ where: { cacheKey } });
  if (!cached || cached.expiresAt <= now) return null;
  const parsed = parseSerpApiWebPayload(JSON.parse(cached.payloadJson) as unknown);
  if (!parsed?.sources.length) {
    await prisma.serpApiNewsCache.delete({ where: { cacheKey } }).catch(() => undefined);
    return null;
  }
  return { sources: parsed.sources, fetchedAt: cached.fetchedAt };
}

function utcMonthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

async function getSerpApiAccountStatus(config: ReturnType<typeof getSerpApiConfig>): Promise<SerpApiAccountStatus> {
  const requestUrl = new URL("account.json", config.baseUrl);
  requestUrl.searchParams.set("api_key", config.apiKey);

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new SerpApiNewsError("UNAVAILABLE", "SerpApi account usage could not be checked.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new SerpApiNewsError("AUTHENTICATION_FAILED", "SerpApi rejected the configured API credentials.");
  }
  if (!response.ok) {
    throw new SerpApiNewsError("UNAVAILABLE", `SerpApi account usage returned HTTP ${response.status}.`);
  }

  const account = asRecord(await response.json().catch(() => null));
  const searchesPerMonth = account?.searches_per_month;
  const totalSearchesLeft = account?.total_searches_left;
  if (
    typeof searchesPerMonth !== "number" || !Number.isFinite(searchesPerMonth) || searchesPerMonth < 1 ||
    typeof totalSearchesLeft !== "number" || !Number.isFinite(totalSearchesLeft) || totalSearchesLeft < 0
  ) {
    throw new SerpApiNewsError("UNAVAILABLE", "SerpApi returned invalid account usage data.");
  }
  return {
    windowKey: nonEmptyString(account?.plan_renewal_date) || utcMonthKey(new Date()),
    searchesPerMonth,
    totalSearchesLeft,
  };
}

async function reserveSerpApiRequest(params: {
  monthlyLimit: number;
  account: SerpApiAccountStatus;
}) {
  const effectiveLimit = Math.min(params.monthlyLimit, params.account.searchesPerMonth);
  const upstreamReserve = Math.max(0, params.account.searchesPerMonth - effectiveLimit);
  if (params.account.totalSearchesLeft <= upstreamReserve) {
    return { allowed: false as const, code: "MONTHLY_LIMIT_REACHED" as const, retryAfterSeconds: null };
  }

  return prisma.$transaction(async (transaction) => {
    const lockRows = await transaction.$queryRaw<Array<{ lockResult: number }>>`
      DECLARE @lockResult INT;
      EXEC @lockResult = sp_getapplock
        @Resource = 'nest:serpapi-news-quota',
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 2000;
      SELECT @lockResult AS [lockResult];
    `;
    if ((lockRows[0]?.lockResult ?? -1) < 0) {
      return { allowed: false as const, code: "RATE_LIMITED" as const, retryAfterSeconds: 5 };
    }

    const now = new Date();
    const quota = await transaction.serpApiQuota.findUnique({ where: { provider: SERPAPI_PROVIDER } });
    const requestCount = quota?.windowKey === params.account.windowKey ? quota.requestCount : 0;
    if (requestCount >= effectiveLimit) {
      return { allowed: false as const, code: "MONTHLY_LIMIT_REACHED" as const, retryAfterSeconds: null };
    }
    if (quota?.windowKey === params.account.windowKey && quota.nextAllowedAt > now) {
      return {
        allowed: false as const,
        code: "RATE_LIMITED" as const,
        retryAfterSeconds: Math.max(1, Math.ceil((quota.nextAllowedAt.getTime() - now.getTime()) / 1_000)),
      };
    }

    await transaction.serpApiQuota.upsert({
      where: { provider: SERPAPI_PROVIDER },
      create: {
        provider: SERPAPI_PROVIDER,
        windowKey: params.account.windowKey,
        requestCount: 1,
        nextAllowedAt: new Date(now.getTime() + SERPAPI_MIN_REQUEST_INTERVAL_MS),
      },
      update: {
        windowKey: params.account.windowKey,
        requestCount: requestCount + 1,
        nextAllowedAt: new Date(now.getTime() + SERPAPI_MIN_REQUEST_INTERVAL_MS),
      },
    });
    return { allowed: true as const, code: null, retryAfterSeconds: 0 };
  });
}

export async function searchSerpApiNews(rawQuery: string): Promise<SerpApiNewsResult> {
  const query = normalizePublicNewsQuery(rawQuery);
  const config = getSerpApiConfig();
  const cacheKey = cacheKeyForQuery(query);
  const now = new Date();
  const cached = await readCachedNews(cacheKey, now).catch(() => null);
  if (cached) {
    return { query, articles: cached.articles, fetchedAt: cached.fetchedAt, fromCache: true };
  }

  const account = await getSerpApiAccountStatus(config);
  const reservation = await reserveSerpApiRequest({ monthlyLimit: config.monthlyLimit, account });
  if (!reservation.allowed) {
    const message = reservation.code === "MONTHLY_LIMIT_REACHED"
      ? "Ask Nest's SerpApi monthly search allowance has been reached."
      : "SerpApi news search is temporarily rate limited. Try again shortly.";
    throw new SerpApiNewsError(reservation.code, message, reservation.retryAfterSeconds);
  }

  const requestUrl = new URL("search", config.baseUrl);
  requestUrl.searchParams.set("engine", "google_news");
  requestUrl.searchParams.set("q", /\bwhen:\S+/i.test(query) ? query : `${query} when:7d`);
  requestUrl.searchParams.set("gl", "sg");
  requestUrl.searchParams.set("hl", "en");
  requestUrl.searchParams.set("api_key", config.apiKey);

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new SerpApiNewsError("UNAVAILABLE", "SerpApi news search could not be reached.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new SerpApiNewsError("AUTHENTICATION_FAILED", "SerpApi rejected the configured API credentials.");
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get("retry-after") || "5", 10);
    throw new SerpApiNewsError("RATE_LIMITED", "SerpApi's API rate limit was reached.", retryAfter || 5);
  }
  if (!response.ok) {
    throw new SerpApiNewsError("UNAVAILABLE", `SerpApi returned HTTP ${response.status}.`);
  }

  const body = await response.json().catch(() => null);
  const parsed = parsePayload(body);
  if (!parsed) {
    throw new SerpApiNewsError("UNAVAILABLE", "SerpApi returned an invalid news response.");
  }
  if (typeof parsed.payload.error === "string") {
    const isAuthError = /api key|account|unauthorized/i.test(parsed.payload.error);
    throw new SerpApiNewsError(
      isAuthError ? "AUTHENTICATION_FAILED" : "UNAVAILABLE",
      isAuthError ? "SerpApi rejected the configured API credentials." : "SerpApi could not complete the news search.",
    );
  }
  if (!parsed.articles.length) {
    throw new SerpApiNewsError("NO_DATA", `SerpApi found no recent news for “${query}”.`);
  }

  const fetchedAt = new Date();
  await prisma.serpApiNewsCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      payloadJson: JSON.stringify(body),
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + SERPAPI_CACHE_TTL_MS),
    },
    update: {
      payloadJson: JSON.stringify(body),
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + SERPAPI_CACHE_TTL_MS),
    },
  }).catch(() => undefined);

  return { query, articles: parsed.articles, fetchedAt, fromCache: false };
}

export async function searchSerpApiFinancialWeb(rawQuery: string): Promise<SerpApiWebResult> {
  const query = normalizePublicFinancialQuery(rawQuery);
  const config = getSerpApiConfig();
  const cacheKey = cacheKeyForWebQuery(query);
  const now = new Date();
  const cached = await readCachedWeb(cacheKey, now).catch(() => null);
  if (cached) {
    return { query, sources: cached.sources, fetchedAt: cached.fetchedAt, fromCache: true };
  }

  const account = await getSerpApiAccountStatus(config);
  const reservation = await reserveSerpApiRequest({ monthlyLimit: config.monthlyLimit, account });
  if (!reservation.allowed) {
    const message = reservation.code === "MONTHLY_LIMIT_REACHED"
      ? "Ask Nest's SerpApi monthly search allowance has been reached."
      : "SerpApi public financial search is temporarily rate limited. Try again shortly.";
    throw new SerpApiNewsError(reservation.code, message, reservation.retryAfterSeconds);
  }

  const requestUrl = new URL("search", config.baseUrl);
  requestUrl.searchParams.set("engine", "google");
  requestUrl.searchParams.set("q", query);
  requestUrl.searchParams.set("google_domain", "google.com.sg");
  requestUrl.searchParams.set("gl", "sg");
  requestUrl.searchParams.set("hl", "en");
  requestUrl.searchParams.set("num", "10");
  requestUrl.searchParams.set("safe", "active");
  requestUrl.searchParams.set("api_key", config.apiKey);

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new SerpApiNewsError("UNAVAILABLE", "SerpApi public financial search could not be reached.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new SerpApiNewsError("AUTHENTICATION_FAILED", "SerpApi rejected the configured API credentials.");
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get("retry-after") || "5", 10);
    throw new SerpApiNewsError("RATE_LIMITED", "SerpApi's API rate limit was reached.", retryAfter || 5);
  }
  if (!response.ok) {
    throw new SerpApiNewsError("UNAVAILABLE", `SerpApi returned HTTP ${response.status}.`);
  }

  const body = await response.json().catch(() => null);
  const parsed = parseSerpApiWebPayload(body);
  if (!parsed) {
    throw new SerpApiNewsError("UNAVAILABLE", "SerpApi returned an invalid public search response.");
  }
  if (typeof parsed.payload.error === "string") {
    const isAuthError = /api key|account|unauthorized/i.test(parsed.payload.error);
    throw new SerpApiNewsError(
      isAuthError ? "AUTHENTICATION_FAILED" : "UNAVAILABLE",
      isAuthError ? "SerpApi rejected the configured API credentials." : "SerpApi could not complete the public financial search.",
    );
  }
  if (!parsed.sources.length) {
    throw new SerpApiNewsError("NO_DATA", `SerpApi found no public financial sources for “${query}”.`);
  }

  const fetchedAt = new Date();
  await prisma.serpApiNewsCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      payloadJson: JSON.stringify(body),
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + SERPAPI_WEB_CACHE_TTL_MS),
    },
    update: {
      payloadJson: JSON.stringify(body),
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + SERPAPI_WEB_CACHE_TTL_MS),
    },
  }).catch(() => undefined);

  return { query, sources: parsed.sources, fetchedAt, fromCache: false };
}
