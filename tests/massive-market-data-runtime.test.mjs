import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { calls, dataCalls, given, require, state } from "./finance-route-harness.mjs";

const { MassiveMarketDataError, getMassiveDailyMarketHistory, isMassiveMarketDataConfigured } = require("../lib/ai/massive-market-data.ts");
const now = new Date("2026-10-10T12:00:00Z");
const params = { ticker: "SPY", from: "2026-10-01", to: "2026-10-09" };
const bar = { c: 501, h: 505, l: 499, o: 500, t: 1790899200000, v: 25000 };
const payload = (overrides = {}) => ({ status: "OK", results: [bar], ...overrides });
const cache = (overrides = {}) => ({ payloadJson: JSON.stringify(payload()), fetchedAt: new Date("2026-10-10T11:30:00Z"), expiresAt: new Date("2026-10-10T12:30:00Z"), ...overrides });
const environment = ["MASSIVE_API_KEY", "MASSIVE_APIKEY", "MASSIVE_API_BASE_URL", "MASSIVE_API_URL", "MASSIVE_URL"];
let fetchCalls, fetchResponse;

function miss() {
  given("massiveMarketDataCache.findUnique", null);
  given("$queryRaw", [{ lockResult: 0 }]);
  given("massiveApiThrottle.findUnique", null);
  given("massiveApiThrottle.upsert", {});
  given("massiveMarketDataCache.upsert", {});
}

beforeEach(t => {
  const saved = environment.map(key => [key, process.env[key]]);
  for (const key of environment) delete process.env[key];
  process.env.MASSIVE_API_KEY = "test-market-token";
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.timers.enable({ apis: ["Date"], now });
  fetchCalls = [];
  fetchResponse = () => Response.json(payload());
  t.mock.method(globalThis, "fetch", async (input, options) => {
    assert.equal(state.inTransaction, false, "the shared throttle lock must be released before the external request");
    fetchCalls.push({ url: new URL(input), options });
    return fetchResponse();
  });
  miss();
});

async function rejected(input, code, message) {
  await assert.rejects(getMassiveDailyMarketHistory(input), error => {
    assert.ok(error instanceof MassiveMarketDataError);
    assert.equal(error.name, "MassiveMarketDataError");
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("market-data configuration accepts both key names and refuses an empty key before database access", async () => {
  assert.equal(isMassiveMarketDataConfigured(), true);
  delete process.env.MASSIVE_API_KEY;
  assert.equal(isMassiveMarketDataConfigured(), false);
  await rejected(params, "NOT_CONFIGURED", /not configured/);
  process.env.MASSIVE_APIKEY = " legacy-token ";
  assert.equal(isMassiveMarketDataConfigured(), true);
  await getMassiveDailyMarketHistory(params);
  assert.equal(fetchCalls[0].options.headers.Authorization, "Bearer legacy-token");
});

test("market-data requests validate symbols, exact calendar dates and the history range before any I/O", async () => {
  for (const input of [
    { ...params, ticker: "" }, { ...params, ticker: "1ST" }, { ...params, ticker: "A/B" }, { ...params, ticker: "ABCDEFGHIJKLMNOP" },
    { ...params, from: "2026-1-01" }, { ...params, from: "2026-13-01" }, { ...params, from: "2026-02-30" },
    { ...params, to: "October 9" }, { ...params, to: "2026-01-00" }, { ...params, to: "2026-02-29" },
    { ...params, from: "2026-10-10" }, { ...params, from: "2024-01-01", to: "2026-01-01" },
  ]) await rejected(input, "NO_DATA");
  assert.deepEqual(calls, []);
  assert.deepEqual(fetchCalls, []);
});

test("market history permits one day and exactly 731 days, including leap days and dotted tickers", async () => {
  for (const input of [
    { ticker: " brk.b ", from: "2024-02-29", to: "2024-02-29" },
    { ticker: " spy ", from: "2024-01-01", to: "2025-12-31" },
  ]) {
    given("massiveMarketDataCache.findUnique", cache());
    const result = await getMassiveDailyMarketHistory(input);
    assert.equal(result.ticker, input.ticker.trim().toUpperCase());
    assert.equal(result.fromCache, true);
    assert.equal(dataCalls("massiveMarketDataCache.findUnique").at(-1).where.cacheKey, `${result.ticker}:${input.from}:${input.to}:adjusted`);
  }
  assert.deepEqual(fetchCalls, []);
});

test("invalid or unofficial provider endpoints are rejected before credentials can be sent", async () => {
  for (const value of ["not a URL", "http://api.massive.com", "https://api.massive.com.attacker.test", "https://attacker.test"]) {
    process.env.MASSIVE_API_BASE_URL = value;
    await rejected(params, "INVALID_CONFIGURATION");
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(fetchCalls, []);
});

for (const variable of ["MASSIVE_API_BASE_URL", "MASSIVE_API_URL", "MASSIVE_URL"]) {
  test(`${variable} is normalized to the official aggregate endpoint without retaining URL credentials or query parameters`, async () => {
    process.env[variable] = " https://old-user:old-password@massive.com/obsolete?apiKey=obsolete#old ";
    const result = await getMassiveDailyMarketHistory(params);
    const { url, options } = fetchCalls[0];
    assert.equal(url.origin, "https://api.massive.com");
    assert.equal(url.pathname, "/v2/aggs/ticker/SPY/range/1/day/2026-10-01/2026-10-09");
    assert.deepEqual(Object.fromEntries(url.searchParams), { adjusted: "true", sort: "asc", limit: "731" });
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.equal(url.hash, "");
    assert.equal(options.headers.Authorization, "Bearer test-market-token");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(result.sourceUrl, "https://massive.com/docs/rest/stocks/aggregates/custom-bars");
    assert.deepEqual(result.bars, [bar]);
    assert.equal(result.adjusted, true);
    assert.equal(result.fromCache, false);
  });
}

for (const adjusted of [undefined, false, true]) {
  test(`fresh cached history preserves adjusted=${adjusted} without reserving an external request`, async () => {
    given("massiveMarketDataCache.findUnique", cache({ payloadJson: JSON.stringify(payload({ adjusted })) }));
    const result = await getMassiveDailyMarketHistory(params);
    assert.equal(result.adjusted, adjusted ?? true);
    assert.equal(result.fromCache, true);
    assert.deepEqual(result.bars, [bar]);
    assert.equal(result.fetchedAt.toISOString(), "2026-10-10T11:30:00.000Z");
    assert.deepEqual(calls.map(({ name }) => name), ["massiveMarketDataCache.findUnique"]);
    assert.deepEqual(fetchCalls, []);
  });
}

test("expired cache entries are refreshed and store a one-hour expiry for both insert and update", async () => {
  given("massiveMarketDataCache.findUnique", cache({ expiresAt: now }));
  fetchResponse = () => Response.json(payload({ adjusted: false }));
  const result = await getMassiveDailyMarketHistory(params);
  assert.equal(result.fromCache, false);
  assert.equal(result.adjusted, false);
  assert.equal(result.fetchedAt.toISOString(), now.toISOString());
  const [write] = dataCalls("massiveMarketDataCache.upsert");
  assert.equal(write.where.cacheKey, "SPY:2026-10-01:2026-10-09:adjusted");
  assert.equal(write.create.cacheKey, write.where.cacheKey);
  for (const data of [write.create, write.update]) {
    assert.deepEqual(JSON.parse(data.payloadJson), payload({ adjusted: false }));
    assert.equal(data.fetchedAt.toISOString(), now.toISOString());
    assert.equal(data.expiresAt.toISOString(), "2026-10-10T13:00:00.000Z");
  }
});

for (const [description, payloadJson, deletion] of [
  ["invalid JSON", "{", {}], ["invalid schema", JSON.stringify({ status: 12 }), {}],
  ["a failed corrupt-entry cleanup", "null", new Error("Cache cleanup unavailable")],
]) {
  test(`market history recovers from ${description} by fetching fresh data`, async () => {
    given("massiveMarketDataCache.findUnique", cache({ payloadJson }));
    given("massiveMarketDataCache.delete", deletion);
    const result = await getMassiveDailyMarketHistory(params);
    assert.equal(result.fromCache, false);
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(dataCalls("massiveMarketDataCache.delete"), [{ where: { cacheKey: "SPY:2026-10-01:2026-10-09:adjusted" } }]);
  });
}

for (const rows of [[], [{ lockResult: -1 }], [{ lockResult: -3 }]]) {
  test(`an unavailable shared database lock refuses a request (${JSON.stringify(rows)})`, async () => {
    given("$queryRaw", rows);
    await assert.rejects(getMassiveDailyMarketHistory(params), error => error.code === "RATE_LIMITED" && error.retryAfterSeconds === 15);
    assert.deepEqual(fetchCalls, []);
    assert.deepEqual(dataCalls("massiveApiThrottle.upsert"), []);
  });
}

test("the global provider throttle rounds up its retry window and never sends a request early", async () => {
  given("massiveApiThrottle.findUnique", { nextAllowedAt: new Date(now.getTime() + 1001) });
  await assert.rejects(getMassiveDailyMarketHistory(params), error => error.code === "RATE_LIMITED" && error.retryAfterSeconds === 2);
  assert.deepEqual(fetchCalls, []);
  assert.deepEqual(dataCalls("massiveApiThrottle.upsert"), []);
  assert.ok(calls.filter(({ name }) => name === "$queryRaw" || name === "massiveApiThrottle.findUnique").every(({ inTransaction }) => inTransaction));
});

test("an elapsed provider throttle reserves the next 15 seconds atomically before fetching", async () => {
  given("massiveApiThrottle.findUnique", { nextAllowedAt: now });
  await getMassiveDailyMarketHistory(params);
  const [write] = dataCalls("massiveApiThrottle.upsert");
  assert.deepEqual(write.where, { provider: "massive" });
  assert.equal(write.create.provider, "massive");
  assert.equal(write.create.nextAllowedAt.toISOString(), "2026-10-10T12:00:15.000Z");
  assert.deepEqual(write.create.nextAllowedAt, write.update.nextAllowedAt);
  assert.ok(calls.find(({ name }) => name === "massiveApiThrottle.upsert").inTransaction);
});

for (const [label, response, code] of [
  ["network errors", () => Promise.reject(new Error("provider unavailable")), "UNAVAILABLE"],
  ["invalid credentials", () => new Response(null, { status: 401 }), "AUTHENTICATION_FAILED"],
  ["forbidden credentials", () => new Response(null, { status: 403 }), "AUTHENTICATION_FAILED"],
  ["server errors", () => new Response(null, { status: 502 }), "UNAVAILABLE"],
  ["invalid JSON", () => new Response("{"), "UNAVAILABLE"],
  ["invalid bars", () => Response.json(payload({ results: [{ c: "bad" }] })), "UNAVAILABLE"],
  ["provider error payloads", () => Response.json(payload({ status: "ERROR" })), "UNAVAILABLE"],
  ["empty results", () => Response.json({ status: "OK" }), "NO_DATA"],
]) {
  test(`market history reports ${label} without caching a successful result`, async () => {
    fetchResponse = response;
    await rejected(params, code);
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(dataCalls("massiveMarketDataCache.upsert"), []);
  });
}

for (const [header, seconds] of [[null, 15], ["42", 42], ["nonsense", 15], ["0", 15]]) {
  test(`provider rate-limit responses use a safe retry window for ${header}`, async () => {
    fetchResponse = () => new Response(null, { status: 429, headers: header === null ? {} : { "retry-after": header } });
    await assert.rejects(getMassiveDailyMarketHistory(params), error => error.code === "RATE_LIMITED" && error.retryAfterSeconds === seconds);
    assert.deepEqual(dataCalls("massiveMarketDataCache.upsert"), []);
  });
}
