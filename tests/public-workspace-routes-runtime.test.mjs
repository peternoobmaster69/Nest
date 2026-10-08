import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const calls = [];
let state;
const prisma = { workspace: { async findFirst(args) {
  calls.push({ kind: "workspace", args });
  if (state.lookupFailure) throw state.lookupFailure;
  return state.workspace;
} } };
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/database-readiness.ts", { namedExports: { async ensureDatabaseReady() {
  calls.push({ kind: "ready" });
  if (state.readinessFailure) throw state.readinessFailure;
} } });
mock.module("../lib/security-rate-limit.ts", { namedExports: {
  async enforceDistributedRateLimit(request, options) {
    calls.push({ kind: "rate-limit", request, options });
    if (state.rateLimitFailure) throw state.rateLimitFailure;
  },
  rateLimitResponse: (error) => error === state.rateLimitFailure ? state.limitedResponse : null,
} });
const payload = (kind) => async (db, workspaceId) => {
  assert.equal(db, prisma);
  calls.push({ kind, workspaceId });
  if (state.payloadFailure) throw state.payloadFailure;
  return { [kind]: workspaceId };
};
mock.module("../lib/public-card-dues.ts", { namedExports: { getWorkspaceCardsDuePayload: payload("cards") } });
mock.module("../lib/net-worth.ts", { namedExports: { getWorkspaceNetWorthPayload: payload("net-worth") } });
const cards = require("../app/api/public/cards-due/[token]/route.ts");
const worth = require("../app/api/public/net-worth/[token]/route.ts");
const token = "public-share-fixture-token-0123456789";
beforeEach(() => {
  calls.length = 0;
  state = { workspace: { id: "shared-workspace" }, limitedResponse: null };
});

for (const [name, route, dataKey, errorMessage] of [
  ["cards-due", cards, "cards", "Failed to load cards due"],
  ["net-worth", worth, "net-worth", "Failed to load net worth"],
]) {
  const request = new Request(`https://nest.example.test/api/public/${name}/${token}`);
  const get = (value = token) => route.GET(request, { params: Promise.resolve({ token: value }) });

  test(`${name}: invalid tokens and disabled or unknown shares reveal no data`, async () => {
    for (const invalid of ["", "short"]) {
      const response = await get(invalid);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Not found" });
    }
    assert.deepEqual(calls, []);
    state.workspace = null;
    const response = await get();
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found" });
    assert.deepEqual(calls.find(({ kind }) => kind === "workspace").args, {
      where: { publicNetWorthEnabled: true, publicNetWorthToken: token }, select: { id: true },
    });
    assert.equal(calls.some(({ kind }) => kind === dataKey), false);
  });

  test(`${name}: shared results use their resolved workspace, rate limit, and private cache policy`, async () => {
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { [dataKey]: "shared-workspace" });
    assert.deepEqual(calls.map(({ kind }) => kind), ["rate-limit", "ready", "workspace", dataKey]);
    assert.equal(calls[0].request, request);
    assert.deepEqual(calls[0].options, { scope: `public-${name}`, identifier: token, limit: 60, windowMs: 60_000, blockMs: 300_000 });
  });

  test(`${name}: throttling stops database and payload reads and preserves the retry response`, async () => {
    state.rateLimitFailure = new Error("Too many requests");
    state.limitedResponse = Response.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "12" } });
    const response = await get();
    assert.equal(response, state.limitedResponse);
    assert.equal(response.headers.get("retry-after"), "12");
    assert.deepEqual(calls.map(({ kind }) => kind), ["rate-limit"]);
  });

  test(`${name}: parameter, database, and payload failures return a stable public error`, async () => {
    const response = await route.GET(request, { params: Promise.reject(new Error("private parameter failure")) });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: errorMessage });
    for (const failure of ["rateLimitFailure", "readinessFailure", "lookupFailure", "payloadFailure"]) {
      state[failure] = new Error("private diagnostic details");
      const result = await get();
      assert.equal(result.status, 500);
      assert.deepEqual(await result.json(), { error: errorMessage });
      delete state[failure];
    }
  });
}
