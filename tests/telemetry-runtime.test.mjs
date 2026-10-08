import assert from "node:assert/strict";
import test from "node:test";
import { redactTelemetry, logEvent, observeDuration } from "../lib/observability/logger.ts";
import { withQueryTelemetry } from "../lib/observability/query-telemetry.ts";

test("telemetry redacts sensitive fields even when their names are mixed-case or nested", () => {
  const names = [
    "Authorization", "cookie", "refreshToken", "clientSecret", "password", "passphrase",
    "CVV", "cvc", "PAN", "card", "cardNumber", "rawBody", "rawEmail", "sql",
    "query", "param", "params", "p256dh", "endpoint", "credential",
  ];
  const context = Object.fromEntries(names.map((name) => [name, "private value"]));
  const result = redactTelemetry({ metadata: context, label: "Safe label" });
  assert.equal(result.label, "Safe label");
  assert.deepEqual(result.metadata, Object.fromEntries(names.map((name) => [name, "[REDACTED]"])));
});

test("telemetry preserves safe types while bounding strings, collections, cycles, and executable values", () => {
  const shared = { safe: true };
  const input = { count: 2, enabled: false, absent: null, missing: undefined, large: 123n, date: new Date("2026-10-07T00:00:00Z"), first: shared, second: shared };
  const result = redactTelemetry(input);
  assert.equal(result.count, 2); assert.equal(result.enabled, false); assert.equal(result.absent, null);
  assert.equal(result.large, "123"); assert.equal(result.date, "2026-10-07T00:00:00.000Z");
  assert.deepEqual(result.first, { safe: true }); assert.equal(result.second, "[CIRCULAR]");
  assert.equal(redactTelemetry(() => "private@example.test"), "[FUNCTION]");
  assert.equal(redactTelemetry(Symbol("private@example.test")), "Symbol([REDACTED_EMAIL])");
  assert.equal(redactTelemetry("a".repeat(2000)).length, 1000);
  assert.equal(redactTelemetry(Array.from({ length: 70 }, (_, index) => index)).length, 50);
  assert.equal(Object.keys(redactTelemetry(Object.fromEntries(Array.from({ length: 130 }, (_, index) => [`field${index}`, index])))).length, 100);
  const error = Object.assign(new Error("Bearer fixture-value; user@example.test; 4111 1111 1111 1111"), { code: "SAFE" });
  assert.deepEqual(redactTelemetry(error), { name: "Error", message: "[REDACTED_BEARER]; [REDACTED_EMAIL]; [REDACTED_CARD]", code: "SAFE" });
  assert.equal(redactTelemetry(new Error("safe")).code, undefined);
});

function capture(t) {
  const records = [];
  for (const level of ["info", "warn", "error"]) t.mock.method(console, level, (entry) => records.push({ level, ...JSON.parse(entry) }));
  return records;
}

test("structured logging honors debug settings and preserves severity with redacted context", (t) => {
  const records = capture(t);
  const fields = ["LOG_LEVEL", "VERCEL_ENV", "NODE_ENV"];
  const before = new Map(fields.map((key) => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  for (const key of fields) delete process.env[key];
  logEvent("debug", "hidden");
  assert.equal(records.length, 0);
  logEvent("info", "started");
  assert.equal(records[0].environment, "development");
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "debug";
  logEvent("debug", "details", { credential: "private", label: "user@example.test" });
  assert.equal(records[1].environment, "test"); assert.equal(records[1].credential, "[REDACTED]");
  assert.equal(records[1].label, "[REDACTED_EMAIL]");
  process.env.VERCEL_ENV = "preview";
  logEvent("warn", "slow"); logEvent("error", "failed");
  assert.deepEqual(records.map((record) => record.level), ["info", "debug", "warn", "error"]);
  assert.equal(records.at(-1).environment, "preview");
  assert.ok(records.every((record) => record.service === "nest-web" && !Number.isNaN(Date.parse(record.timestamp))));
});

test("query timing estimates row groups, respects explicit counts, and rethrows errors without copying query data", async (t) => {
  const records = capture(t);
  let time = 10;
  t.mock.method(performance, "now", () => time);
  for (const [result, expected] of [[[1, [2, 3], null, undefined], 3], [{ private: "body" }, undefined]]) {
    const output = await withQueryTelemetry({ domain: "ledger", operation: "read", workspaceId: null }, async () => { time += 1.25; return result; });
    assert.equal(output, result);
    assert.equal(records.at(-1).rowCount, expected);
    assert.equal(records.at(-1).durationMs, 1.3);
    assert.equal(records.at(-1).event, "database.query_group");
    assert.equal(records.at(-1).workspaceId, undefined);
  }
  await withQueryTelemetry({ domain: "ledger", operation: "read", rowCount: 9, workspaceId: "home", requestId: "request" }, async () => []);
  assert.equal(records.at(-1).rowCount, 9);
  assert.equal(records.at(-1).workspaceId, "home");
  const error = new Error("private SQL data");
  await assert.rejects(withQueryTelemetry({ domain: "ledger", operation: "read" }, async () => { throw error; }), (value) => value === error);
  assert.equal(records.at(-1).outcome, "error");
  assert.ok(!JSON.stringify(records).includes("private"));
  observeDuration("request", time - 5, { outcome: "success" });
  assert.equal(records.at(-1).durationMs, 5);
  observeDuration("request", time - 7, { outcome: "error" });
  assert.equal(records.at(-1).level, "error");
});
