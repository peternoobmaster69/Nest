import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { analysisFailures, checkLcov, configurePolicy, coverageFailures, createClient, gateDrift, policy, readToken, root, verifyPolicy } from "../scripts/sonar-policy.mjs";
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

test("credentials come from the environment without opening arbitrary local files", async () => {
  assert.equal(await readToken("SONAR_TOKEN", { SONAR_TOKEN: " fixture-only\n" }), "fixture-only");
  await assert.rejects(readToken("SONAR_TOKEN", { SONAR_TOKEN_FILE: "/private-token" }), /Set SONAR_TOKEN/);
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

test("server verification detects changed assignment, small-change exemptions, and weakened profiles", async () => {
  let tampered = false;
  const parents = policy.languages.map((language) => ({ language, key: `${language}-base`, name: "Sonar way", isBuiltIn: true }));
  const profiles = parents.map((parent) => ({ language: parent.language, key: `${parent.language}-custom`, parentKey: parent.key, name: policy.profileName }));
  const api = async (endpoint, params = {}) => {
    switch (endpoint) {
      case "api/qualitygates/get_by_project": return { qualityGate: { name: tampered ? "Relaxed gate" : policy.gateName } };
      case "api/qualitygates/show": return { conditions: policy.conditions };
      case "api/settings/values": return { settings: [{ key: "sonar.qualitygate.ignoreSmallChanges", value: String(tampered) }] };
      case "api/qualityprofiles/search": return { profiles: params.project ? profiles : parents };
      case "api/qualityprofiles/compare": return { inLeft: tampered ? [{ key: "removed-rule" }] : [], modified: [] };
      case "api/rules/search": return { total: params.activation === "false" ? Number(tampered) : 1 };
      default: throw new Error(`Unexpected verification request: ${endpoint}`);
    }
  };
  assert.deepEqual(await verifyPolicy(api), []);
  tampered = true;
  const failures = (await verifyPolicy(api)).join("\n");
  assert.match(failures, /Assigned gate is Relaxed gate/);
  assert.match(failures, /ignoreSmallChanges must be false/);
  assert.match(failures, /missing or modified comprehensive rules/);
  assert.match(failures, /missing 1 required security or reliability rules/);
});

test("SQL bootstrap generates masked per-run credentials without exposing them in Docker arguments", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "nest-sql-ci-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, "github-env");
  const argsFile = path.join(directory, "docker-args");
  await writeFile(path.join(directory, "docker"), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$NEST_DOCKER_ARGS"\nexit 0\n', { mode: 0o700 });
  const script = path.join(root, "scripts/start-ci-sqlserver.sh");
  const denied = spawnSync("bash", [script], { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 5_000 });
  assert.equal(denied.status, 1);
  const run = spawnSync("bash", [script], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_ENV: envFile, NEST_DOCKER_ARGS: argsFile },
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const settings = Object.fromEntries((await readFile(envFile, "utf8")).trim().split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const password = /;password=([^;]+);/.exec(settings.DATABASE_URL)?.[1];
  assert.ok(password?.length >= 64);
  assert.notEqual(settings.DATABASE_URL, settings.SHADOW_DATABASE_URL);
  assert.match(settings.DATABASE_URL, /;database=nest_ci;/);
  assert.match(settings.SHADOW_DATABASE_URL, /;database=nest_ci_shadow;/);
  assert.notEqual(password, settings.NEXTAUTH_SECRET);
  const args = await readFile(argsFile, "utf8");
  assert.match(args, /127\.0\.0\.1:1433:1433/);
  assert.match(args, /-b[\s\S]*CREATE DATABASE \[nest_ci\]/);
  assert.match(args, /-b[\s\S]*CREATE DATABASE \[nest_ci_shadow\]/);
  for (const secret of [password, settings.NEXTAUTH_SECRET]) {
    assert.ok(run.stdout.includes(`::add-mask::${secret}`));
    assert.ok(!args.includes(secret));
  }
});
