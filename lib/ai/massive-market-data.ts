import { z } from "zod";
import { prisma } from "@/lib/prisma";

const MASSIVE_PROVIDER = "massive";
const MASSIVE_MIN_REQUEST_INTERVAL_MS = 15_000;
const MASSIVE_CACHE_TTL_MS = 60 * 60 * 1_000;
const MASSIVE_MAX_HISTORY_DAYS = 731;
const MASSIVE_DOCS_URL = "https://massive.com/docs/rest/stocks/aggregates/custom-bars";

const MassiveBarSchema = z.object({
  c: z.number(),
  h: z.number(),
  l: z.number(),
  n: z.number().optional(),
  o: z.number(),
  otc: z.boolean().optional(),
  t: z.number(),
  v: z.number(),
  vw: z.number().optional(),
}).passthrough();

const MassiveAggregateResponseSchema = z.object({
  adjusted: z.boolean().optional(),
  queryCount: z.number().optional(),
  request_id: z.string().optional(),
  results: z.array(MassiveBarSchema).optional().default([]),
  resultsCount: z.number().optional(),
  status: z.string(),
  ticker: z.string().optional(),
}).passthrough();

export type MassiveDailyBar = z.infer<typeof MassiveBarSchema>;

export type MassiveMarketHistoryResult = {
  ticker: string;
  adjusted: boolean;
  bars: MassiveDailyBar[];
  fetchedAt: Date;
  fromCache: boolean;
  sourceUrl: string;
};

export type MassiveMarketDataFailureCode =
  | "NOT_CONFIGURED"
  | "INVALID_CONFIGURATION"
  | "RATE_LIMITED"
  | "AUTHENTICATION_FAILED"
  | "NO_DATA"
  | "UNAVAILABLE";

export class MassiveMarketDataError extends Error {
  code: MassiveMarketDataFailureCode;
  retryAfterSeconds: number | null;

  constructor(code: MassiveMarketDataFailureCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "MassiveMarketDataError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function configuredApiKey() {
  return (process.env.MASSIVE_API_KEY || process.env.MASSIVE_APIKEY || "").trim();
}

export function isMassiveMarketDataConfigured() {
  return Boolean(configuredApiKey());
}

function getMassiveConfig() {
  const apiKey = configuredApiKey();
  if (!apiKey) {
    throw new MassiveMarketDataError("NOT_CONFIGURED", "Massive market data is not configured.");
  }

  const configuredUrl = (
    process.env.MASSIVE_API_BASE_URL ||
    process.env.MASSIVE_API_URL ||
    process.env.MASSIVE_URL ||
    "https://api.massive.com"
  ).trim();
  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredUrl);
  } catch {
    throw new MassiveMarketDataError("INVALID_CONFIGURATION", "MASSIVE_API_URL must be a valid URL.");
  }
  if (baseUrl.protocol !== "https:" || !["api.massive.com", "massive.com"].includes(baseUrl.hostname)) {
    throw new MassiveMarketDataError(
      "INVALID_CONFIGURATION",
      "MASSIVE_API_URL must use the official api.massive.com HTTPS endpoint.",
    );
  }
  baseUrl.hostname = "api.massive.com";
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";
  baseUrl.username = "";
  baseUrl.password = "";
  return { apiKey, baseUrl };
}

function parseIsoDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new MassiveMarketDataError("NO_DATA", `${label} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new MassiveMarketDataError("NO_DATA", `${label} is not a valid date.`);
  }
  return date;
}

function validateHistoryRange(from: string, to: string) {
  const start = parseIsoDate(from, "Start date");
  const end = parseIsoDate(to, "End date");
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days < 1 || days > MASSIVE_MAX_HISTORY_DAYS) {
    throw new MassiveMarketDataError("NO_DATA", "Massive history requests must cover between 1 day and 2 years.");
  }
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toLocaleUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker)) {
    throw new MassiveMarketDataError("NO_DATA", "Ticker must be a valid US market symbol.");
  }
  return ticker;
}

async function readCachedHistory(cacheKey: string, now: Date) {
  const cached = await prisma.massiveMarketDataCache.findUnique({ where: { cacheKey } });
  if (!cached || cached.expiresAt <= now) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(cached.payloadJson);
  } catch {
    payload = null;
  }
  const parsed = MassiveAggregateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    await prisma.massiveMarketDataCache.delete({ where: { cacheKey } }).catch(() => undefined);
    return null;
  }
  return { payload: parsed.data, fetchedAt: cached.fetchedAt };
}

async function reserveMassiveRequest() {
  return prisma.$transaction(async (transaction) => {
    const lockRows = await transaction.$queryRaw<Array<{ lockResult: number }>>`
      DECLARE @lockResult INT;
      EXEC @lockResult = sp_getapplock
        @Resource = 'nest:massive-api-throttle',
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 2000;
      SELECT @lockResult AS [lockResult];
    `;
    if ((lockRows[0]?.lockResult ?? -1) < 0) {
      return { allowed: false, retryAfterSeconds: 15 };
    }

    const now = new Date();
    const throttle = await transaction.massiveApiThrottle.findUnique({
      where: { provider: MASSIVE_PROVIDER },
    });
    if (throttle && throttle.nextAllowedAt > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((throttle.nextAllowedAt.getTime() - now.getTime()) / 1_000)),
      };
    }

    await transaction.massiveApiThrottle.upsert({
      where: { provider: MASSIVE_PROVIDER },
      create: {
        provider: MASSIVE_PROVIDER,
        nextAllowedAt: new Date(now.getTime() + MASSIVE_MIN_REQUEST_INTERVAL_MS),
      },
      update: {
        nextAllowedAt: new Date(now.getTime() + MASSIVE_MIN_REQUEST_INTERVAL_MS),
      },
    });
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export async function getMassiveDailyMarketHistory(params: {
  ticker: string;
  from: string;
  to: string;
}): Promise<MassiveMarketHistoryResult> {
  const ticker = normalizeTicker(params.ticker);
  validateHistoryRange(params.from, params.to);
  const config = getMassiveConfig();
  const cacheKey = `${ticker}:${params.from}:${params.to}:adjusted`;
  const now = new Date();
  const cached = await readCachedHistory(cacheKey, now);
  if (cached) {
    return {
      ticker,
      adjusted: cached.payload.adjusted ?? true,
      bars: cached.payload.results,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
      sourceUrl: MASSIVE_DOCS_URL,
    };
  }

  const reservation = await reserveMassiveRequest();
  if (!reservation.allowed) {
    throw new MassiveMarketDataError(
      "RATE_LIMITED",
      "Massive's free-plan request budget is temporarily reserved. Try again shortly.",
      reservation.retryAfterSeconds,
    );
  }

  const requestUrl = new URL(
    `v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${params.from}/${params.to}`,
    config.baseUrl,
  );
  requestUrl.searchParams.set("adjusted", "true");
  requestUrl.searchParams.set("sort", "asc");
  requestUrl.searchParams.set("limit", String(MASSIVE_MAX_HISTORY_DAYS));

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new MassiveMarketDataError("UNAVAILABLE", "Massive market data could not be reached.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new MassiveMarketDataError("AUTHENTICATION_FAILED", "Massive rejected the configured API credentials.");
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get("retry-after") || "15", 10);
    throw new MassiveMarketDataError("RATE_LIMITED", "Massive's API rate limit was reached.", retryAfter || 15);
  }
  if (!response.ok) {
    throw new MassiveMarketDataError("UNAVAILABLE", `Massive returned HTTP ${response.status}.`);
  }

  const parsed = MassiveAggregateResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.status.toLocaleUpperCase() !== "OK") {
    throw new MassiveMarketDataError("UNAVAILABLE", "Massive returned an invalid market-data response.");
  }
  if (!parsed.data.results.length) {
    throw new MassiveMarketDataError("NO_DATA", `Massive found no end-of-day data for ${ticker} in that period.`);
  }

  const fetchedAt = new Date();
  await prisma.massiveMarketDataCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      payloadJson: JSON.stringify(parsed.data),
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + MASSIVE_CACHE_TTL_MS),
    },
    update: {
      payloadJson: JSON.stringify(parsed.data),
      fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + MASSIVE_CACHE_TTL_MS),
    },
  });

  return {
    ticker,
    adjusted: parsed.data.adjusted ?? true,
    bars: parsed.data.results,
    fetchedAt,
    fromCache: false,
    sourceUrl: MASSIVE_DOCS_URL,
  };
}
