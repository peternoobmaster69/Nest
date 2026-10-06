import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { mock } from "node:test";

const require = createRequire(import.meta.url);
let authorized = false;
let diagnostics = { database: { status: "ready" }, jobs: { expiredLeases: 0 } };
const logEvents = [];
mock.module("../lib/observability/health.ts", { namedExports: {
  isDiagnosticsAuthorized: () => authorized,
  collectReadinessDiagnostics: async () => { if (diagnostics instanceof Error) throw diagnostics; return diagnostics; },
} });
mock.module("../lib/observability/logger.ts", { namedExports: { logEvent: (...event) => logEvents.push(event) } });
const live = require("../app/api/health/live/route.ts");
const ready = require("../app/api/health/ready/route.ts");
const request = new Request("https://save.example.test/api/health/ready");

test("liveness is public, minimal, and never cached", async () => {
  const response = live.GET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(body).sort(), ["status", "timestamp"]);
  assert.equal(body.status, "live");
  assert.ok(Number.isFinite(Date.parse(body.timestamp)));
});

test("readiness hides diagnostics until the request is authorized", async () => {
  authorized = false;
  const hidden = await ready.GET(request);
  assert.equal(hidden.status, 404);
  assert.deepEqual(await hidden.json(), { error: "Not found" });
  authorized = true;
  for (const [databaseStatus, leases, expected] of [["ready", 0, 200], ["unavailable", 0, 503], ["ready", 1, 503]]) {
    diagnostics = { database: { status: databaseStatus }, jobs: { expiredLeases: leases } };
    const response = await ready.GET(request);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual((await response.json()).dependencies, diagnostics);
  }
});

test("readiness failures log internally without disclosing error text in the response", async () => {
  authorized = true;
  diagnostics = new Error("private connection information");
  const response = await ready.GET(request);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.doesNotMatch(await response.text(), /private connection/);
  assert.equal(logEvents.at(-1)[1], "health.readiness_failed");
});
