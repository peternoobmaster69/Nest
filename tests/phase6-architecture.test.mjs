import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  assertMutationAllowed,
  parseSafetyArgs,
} from "../scripts/data-script-safety.mjs";

const root = new URL("..", import.meta.url);
const source = (file) => readFile(new URL(file, root), "utf8");

async function walk(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const child = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  }));
  return nested.flat();
}

function unboundedFindMany(file, code) {
  const findings = [];
  let position = 0;
  while ((position = code.indexOf(".findMany({", position)) >= 0) {
    const start = position;
    let cursor = code.indexOf("{", position);
    let depth = 0;
    for (; cursor < code.length; cursor += 1) {
      if (code[cursor] === "{") depth += 1;
      if (code[cursor] === "}" && --depth === 0) break;
    }
    if (!/\btake\s*:/.test(code.slice(start, cursor + 1))) findings.push(file);
    position = cursor + 1;
  }
  return findings;
}

test("route and domain collection queries are explicitly bounded", async () => {
  const files = [
    ...(await walk("app/api")),
    ...(await walk("lib/domains")),
  ].filter((file) => file.endsWith(".ts"));
  const findings = [];
  for (const file of files) findings.push(...unboundedFindMany(file, await source(file)));
  assert.deepEqual(findings, []);
});

test("components use the shared typed API client", async () => {
  const files = (await walk("components")).filter((file) => file.endsWith(".tsx"));
  for (const file of files) {
    assert.doesNotMatch(await source(file), /async function fetchJson/, file);
  }
  assert.match(await source("lib/api/client.ts"), /401|UNAUTHENTICATED/);
  assert.match(await source("lib/api/client.ts"), /retryAfterSeconds/);
});

test("budget plan transport is thin and schemas live in its domain", async () => {
  const route = await source("app/api/budgets/plan/route.ts");
  const contracts = await source("lib/domains/ledger/budget-plan/contracts.ts");
  assert.ok(route.split(/\r?\n/).length < 60);
  assert.match(route, /lib\/domains\/ledger\/budget-plan\/handlers/);
  for (const action of ["createTemplateItem", "startFromSetup", "confirmMonthly", "updateMonthlySource"]) {
    assert.match(contracts, new RegExp(action));
  }
  for (const service of [
    "query-service.ts",
    "template-service.ts",
    "monthly-draft-service.ts",
    "monthly-entry-service.ts",
    "confirm-service.ts",
  ]) {
    assert.equal(existsSync(new URL(`lib/domains/ledger/budget-plan/${service}`, root)), true);
  }
});

test("OpenAPI is generated, cookie-authenticated, and not public static content", async () => {
  assert.equal(existsSync(new URL("public/openapi.json", root)), false);
  const spec = JSON.parse(await source("generated/openapi.json"));
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.components.securitySchemes.sessionCookie.in, "cookie");
  assert.equal(spec.components.securitySchemes.secureSessionCookie.in, "cookie");
  assert.ok(Object.keys(spec.paths).length >= 80);
  assert.equal(
    spec.paths["/api/transactions/bulk-import"].post.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/BulkImportSchema",
  );
  assert.match(await source("app/api/openapi/route.ts"), /ENABLE_API_DOCS/);
  assert.match(await source("app/api/openapi/route.ts"), /isAdminEmail/);
});

test("dashboard and context emit query telemetry without shared caching", async () => {
  const dashboard = await source("app/api/dashboard/summary/route.ts");
  const context = await source("app/api/context/route.ts");
  assert.match(dashboard, /withQueryTelemetry/);
  assert.match(context, /withQueryTelemetry/);
  assert.match(dashboard, /CACHE_POLICIES\.privateNoStore/);
  assert.doesNotMatch(dashboard, /stale-while-revalidate/);
});

test("data scripts default to dry-run and require all live-write gates", () => {
  const dryRun = parseSafetyArgs([]);
  assert.equal(dryRun.apply, false);
  assert.doesNotThrow(() => assertMutationAllowed({
    safety: dryRun,
    workspaceId: "workspace-1",
    operation: "test",
  }));
  const unsafe = {
    ...parseSafetyArgs(["--apply", "--environment=production", "--confirm=workspace-1"]),
    allowed: ["test"],
  };
  assert.throws(() => assertMutationAllowed({
    safety: unsafe,
    workspaceId: "workspace-1",
    operation: "test",
  }), /not in DATA_SCRIPT_ALLOWED_ENVIRONMENTS/);
  const safe = {
    ...parseSafetyArgs(["--apply", "--environment=test", "--confirm=workspace-1"]),
    allowed: ["test"],
  };
  assert.doesNotThrow(() => assertMutationAllowed({
    safety: safe,
    workspaceId: "workspace-1",
    operation: "test",
  }));
});

test("hard-coded diagnostic record scripts are removed", async () => {
  const files = await walk("scripts");
  for (const removed of [
    "check-ff-48.mjs",
    "check-ff-balance.mjs",
    "diag-mile-insert.mjs",
    "insert-redemption.mjs",
  ]) {
    assert.equal(files.includes(`scripts/${removed}`), false);
  }
  for (const file of files.filter((name) => /\.(?:mjs|ts)$/.test(name))) {
    assert.doesNotMatch(await source(file), /cmm[a-z0-9]{15,}/i, file);
  }
});
