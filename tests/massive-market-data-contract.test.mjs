import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("Massive credentials remain server-side and the endpoint is constrained", async () => {
  const [client, readme] = await Promise.all([
    source("lib/ai/massive-market-data.ts"),
    source("README.md"),
  ]);

  assert.match(client, /process\.env\.MASSIVE_API_KEY/);
  assert.match(client, /process\.env\.MASSIVE_API_BASE_URL/);
  assert.match(client, /\["api\.massive\.com", "massive\.com"\]\.includes\(baseUrl\.hostname\)/);
  assert.match(client, /Authorization: `Bearer \$\{config\.apiKey\}`/);
  assert.doesNotMatch(client, /NEXT_PUBLIC_MASSIVE/);
  assert.match(readme, /MASSIVE_API_BASE_URL="https:\/\/api\.massive\.com"/);
  assert.match(readme, /MASSIVE_API_KEY="\*\*\*"/);
});

test("Massive requests use durable caching and a cross-instance free-plan throttle", async () => {
  const [client, schema, migration] = await Promise.all([
    source("lib/ai/massive-market-data.ts"),
    source("prisma/schema.prisma"),
    source("prisma/migrations/add_massive_market_data/migration.sql"),
  ]);

  assert.match(client, /MASSIVE_MIN_REQUEST_INTERVAL_MS = 15_000/);
  assert.match(client, /MASSIVE_CACHE_TTL_MS = 60 \* 60 \* 1_000/);
  assert.match(client, /sp_getapplock/);
  assert.match(client, /@LockOwner = 'Transaction'/);
  assert.match(client, /massiveApiThrottle\.upsert/);
  assert.match(client, /massiveMarketDataCache\.findUnique/);
  assert.match(client, /massiveMarketDataCache\.upsert/);
  assert.match(client, /cache: "no-store"/);
  assert.match(client, /AbortSignal\.timeout\(12_000\)/);
  assert.match(schema, /model MassiveMarketDataCache/);
  assert.match(schema, /model MassiveApiThrottle/);
  assert.match(migration, /CREATE TABLE \[dbo\]\.\[MassiveMarketDataCache\]/);
  assert.match(migration, /CREATE TABLE \[dbo\]\.\[MassiveApiThrottle\]/);
});

test("Ask Nest exposes bounded end-of-day Massive history without turning it into advice", async () => {
  const [tools, orchestration, intent, panel] = await Promise.all([
    source("lib/ai/ask-nest-tools.ts"),
    source("lib/ai/ask-nest.ts"),
    source("lib/ai/ask-nest-intent.mjs"),
    source("components/ask-nest.tsx"),
  ]);

  assert.match(tools, /name: "get_market_history"/);
  assert.match(tools, /isMassiveMarketDataConfigured\(\) \? \[ASK_NEST_MARKET_HISTORY_TOOL\]/);
  assert.match(tools, /case "get_market_history":/);
  assert.match(tools, /dataRecency: "END_OF_DAY"/);
  assert.match(tools, /recentBars: result\.bars\.slice\(-10\)/);
  assert.match(orchestration, /get_market_history: "Massive end-of-day market data"/);
  assert.match(orchestration, /Do not turn market history into a buy, sell, or hold recommendation/);
  assert.match(intent, /intent: "market_data"[\s\S]*?tools: \["get_market_history"\]/);
  assert.match(panel, /item\.href\.startsWith\("https:\/\/"\)/);
  assert.match(panel, /target="_blank" rel="noreferrer"/);
});
