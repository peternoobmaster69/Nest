import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { analysisFailures, checkLcov, configurePolicy, coverageFailures, createClient, gateDrift, policy, readToken } from "../scripts/sonar-policy.mjs";
import { checkSarif } from "../scripts/check-codeql-results.mjs";

test("quality gate detects relaxed, missing, and unexpected conditions regardless of order", () => {
  const strict = [
    { metric: "violations", op: "GT", error: "0" },
    { metric: "coverage", op: "LT", error: "100" },
  ];
  assert.deepEqual(gateDrift([...strict].reverse(), strict), []);
  assert.equal(gateDrift([strict[0]], strict).length, 1);
  assert.equal(gateDrift([strict[0], { ...strict[1], error: "80" }], strict).length, 2);
  assert.equal(gateDrift([...strict, { metric: "new_coverage", op: "GT", error: "50" }], strict).length, 1);
});

test("coverage cannot hide unloaded source files or pass on an empty LCOV report", () => {
  const directory = path.join(tmpdir(), "nest-coverage-fixture");
  const report = "SF:lib/executed.ts\nDA:1,1\nend_of_record\n";
  assert.doesNotThrow(() => checkLcov(report, ["lib/executed.ts"], directory));
  assert.throws(() => checkLcov(report, ["lib/executed.ts", "lib/unloaded.ts"], directory), /omits 1 source/);
  assert.throws(() => checkLcov("", [], directory), /empty or invalid/);
  assert.throws(() => checkLcov("SF:lib/executed.ts\n", ["lib/executed.ts"], directory), /empty or invalid/);
});

test("coverage thresholds use exact counts, including branches, and reject ignored coverage", () => {
  const total = Object.fromEntries(["lines", "statements", "functions", "branches"].map((metric) => [metric, { total: 10, covered: 10, skipped: 0, pct: 100 }]));
  assert.deepEqual(coverageFailures({ total }), []);
  assert.equal(coverageFailures({}).length, 4);
  assert.equal(coverageFailures({ total: { ...total, branches: { total: 100_000, covered: 99_999, skipped: 0, pct: 100 } } }).length, 1);
  assert.equal(coverageFailures({ total: { ...total, lines: { ...total.lines, skipped: 1 } } }).length, 1);
});

test("only a completed analysis with a passing, non-exempt quality gate can pass", () => {
  const task = { status: "SUCCESS", analysisId: "analysis-1" };
  const passed = { status: "OK", conditions: [{ status: "OK" }], ignoredConditions: false };
  assert.deepEqual(analysisFailures(task, passed), []);
  for (const status of ["PENDING", "IN_PROGRESS", "FAILED", "CANCELED"]) assert.ok(analysisFailures({ status }, passed).length);
  for (const status of ["ERROR", "WARN", "NONE", undefined]) assert.ok(analysisFailures(task, { status }).length);
  assert.ok(analysisFailures(task, { ...passed, ignoredConditions: true }).length);
  assert.ok(analysisFailures(task, { ...passed, conditions: [] }).length);
  assert.ok(analysisFailures(task, { ...passed, conditions: [{ status: "ERROR", metricKey: "coverage", actualValue: "99" }] }).length);
});

test("SonarQube API refuses insecure remote URLs, redirects, and credential-bearing error bodies", async () => {
  assert.throws(() => createClient({ serverUrl: "http://sonar.example.com", token: "fixture" }), /HTTPS/);
  assert.throws(() => createClient({ serverUrl: "https://user:fixture@sonar.example.com", token: "fixture" }), /embedded credentials/);
  let request;
  const api = createClient({ serverUrl: "http://127.0.0.1:9000", token: "fixture", fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ token: "never-print-this" }), { status: 403 });
  } });
  await assert.rejects(api("api/settings/set", { key: "x", value: "y" }, "POST"), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.doesNotMatch(error.message, /never-print-this/);
    return true;
  });
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers.Authorization, "Bearer fixture");
  assert.equal(request.url.search, "");
  assert.equal(request.options.body.get("value"), "y");
});

test("SonarQube handles successful empty mutation responses while rejecting empty reads", async () => {
  const api = createClient({ token: "fixture", fetchImpl: async () => new Response("", { status: 200 }) });
  assert.deepEqual(await api("api/new_code_periods/set", { type: "NUMBER_OF_DAYS", value: "30" }, "POST"), {});
  await assert.rejects(api("api/system/status"), /did not return valid JSON/);
});

test("credentials load from a local file without becoming command arguments", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "nest-token-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "token");
  await writeFile(file, "fixture-only\n", { mode: 0o600 });
  assert.equal(await readToken("SONAR_TOKEN", { SONAR_TOKEN_FILE: file }), "fixture-only");
  await assert.rejects(readToken("SONAR_TOKEN", {}), /Set SONAR_TOKEN/);
  await assert.rejects(readToken("SONAR_TOKEN", { SONAR_TOKEN: "two tokens" }), /valid token/);
});

test("policy configuration is idempotent and never mutates another project's gate or global defaults", async () => {
  const writes = [];
  const profiles = policy.languages.map((language) => ({ language, name: "Sonar way", isBuiltIn: true, key: `${language}-base` }));
  const gates = [{ name: "Unrelated gate" }];
  const conditions = [];
  const projects = [];
  let sequence = 0;
  const api = async (endpoint, params = {}, method = "GET") => {
    if (method === "POST") writes.push({ endpoint, params });
    switch (endpoint) {
      case "api/qualitygates/list": return { actions: { create: true }, qualitygates: gates };
      case "api/projects/search": return { components: projects };
      case "api/projects/create": projects.push({ key: params.project }); return {};
      case "api/qualitygates/create": gates.push({ name: params.name }); return {};
      case "api/qualitygates/show": return { conditions };
      case "api/qualitygates/create_condition": conditions.push({ ...params, id: String(++sequence) }); return {};
      case "api/qualityprofiles/search": return { profiles };
      case "api/qualityprofiles/create": {
        const profile = { ...params, key: `${params.language}-custom` };
        profiles.push(profile);
        return { profile };
      }
      case "api/qualityprofiles/activate_rules": return { succeeded: 1, failed: 0 };
      default: return {};
    }
  };
  await configurePolicy(api);
  const created = writes.filter(({ endpoint }) => endpoint.endsWith("/create") || endpoint.endsWith("/create_condition")).length;
  await configurePolicy(api);
  assert.equal(writes.filter(({ endpoint }) => endpoint.endsWith("/create") || endpoint.endsWith("/create_condition")).length, created);
  assert.deepEqual(gateDrift(conditions), []);
  assert.ok(writes.filter(({ endpoint }) => endpoint === "api/settings/set").every(({ params }) => params.component === policy.projectKey));
  assert.ok(writes.filter(({ endpoint }) => endpoint.startsWith("api/qualitygates/")).every(({ params }) => params.name === policy.gateName || params.gateName === policy.gateName));
  assert.ok(writes.every(({ endpoint }) => !endpoint.includes("set_as_default")));
  assert.equal(writes.at(-1).endpoint, "api/qualitygates/select");
  let mutated = false;
  await assert.rejects(configurePolicy(async (_endpoint, _params, method) => {
    if (method === "POST") mutated = true;
    return { actions: { create: false } };
  }), /administrator/);
  assert.equal(mutated, false);
});

test("CodeQL gate rejects missing or failed reports and counts even suppressed low-severity findings", () => {
  assert.equal(checkSarif({ version: "2.1.0", runs: [{ results: [] }] }), 0);
  assert.equal(checkSarif({ version: "2.1.0", runs: [{ results: [{ level: "note", suppressions: [{ status: "accepted" }] }] }] }), 1);
  assert.throws(() => checkSarif({ version: "2.1.0", runs: [] }), /valid SARIF/);
  assert.throws(() => checkSarif({ version: "2.1.0", runs: [{}] }), /results are missing/);
  assert.throws(() => checkSarif({ version: "2.1.0", runs: [{ results: [], invocations: [{ executionSuccessful: false }] }] }), /incomplete or failed/);
});
