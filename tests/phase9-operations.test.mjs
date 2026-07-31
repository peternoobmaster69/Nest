import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { redactTelemetry } from "../lib/observability/logger.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("structured telemetry redacts credentials, email, card data, and SQL parameters", () => {
  const output = JSON.stringify(redactTelemetry({
    authorization: "Bearer live-secret",
    email: "person@example.com",
    cardNumber: "4111111111111111",
    nested: { sqlParams: ["private"], harmless: "ok" },
  }));
  assert.doesNotMatch(output, /live-secret|person@example\.com|4111111111111111|private/);
  assert.match(output, /REDACTED_EMAIL|\[REDACTED\]/);
  assert.match(output, /harmless/);
});

test("health routes separate public liveness from protected diagnostics", async () => {
  const live = await read("app/api/health/live/route.ts");
  const ready = await read("app/api/health/ready/route.ts");
  const health = await read("lib/observability/health.ts");
  assert.match(live, /no-store/);
  assert.doesNotMatch(live, /prisma|DATABASE/);
  assert.match(ready, /isDiagnosticsAuthorized/);
  assert.match(ready, /status: 404/);
  assert.match(health, /timingSafeEqual/);
  assert.doesNotMatch(ready, /error\.message|connectionString|databaseUrl/i);
});

test("CI contains explicit quality, browser, security, migration, and database gates", async () => {
  const ci = await read(".github/workflows/ci.yml");
  const security = await read(".github/workflows/security.yml");
  const codeql = await read(".github/workflows/codeql.yml");
  for (const required of [
    "npm ci", "prisma:validate", "npm run lint", "npm run typecheck", "npm test",
    "npm run test:e2e", "npm run build", "npm run audit:public", "db:bootstrap",
    "prisma:seed", "phase1-concurrency.integration",
  ]) assert.match(ci, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(security, /gitleaks/);
  assert.match(security, /dependency-review/);
  assert.match(codeql, /codeql-action\/analyze/);
});

test("operations runbook defines SLOs, alerts, deployment, restore, and incidents", async () => {
  const docs = await read("docs/operations/phase9-operations.md");
  for (const topic of [
    "Service-level objectives", "Dashboards and alerts", "Deploy and forward-fix",
    "Key rotation and token compromise", "Restore", "Job recovery", "Security incident",
  ]) assert.match(docs, new RegExp(topic, "i"));
});
