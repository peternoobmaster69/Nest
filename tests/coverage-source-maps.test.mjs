import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const execute = promisify(execFile);
const c8 = require.resolve("c8/bin/c8.js");
const tsx = require.resolve("tsx");
const reporter = fileURLToPath(new URL("../scripts/report-coverage.mjs", import.meta.url));
const collector = fileURLToPath(new URL("../scripts/collect-coverage-sources.mjs", import.meta.url));

test("coverage maps original TypeScript branches, retains untouched files, and excludes generated module wrappers", async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "nest-coverage-map-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "nested", "[id]"), { recursive: true });
  const sample = [
    "type Options = { label?: string };",
    "export function choose(enabled: boolean) {",
    "  if (enabled) return 'ready';",
    "  return 'waiting';",
    "}",
    "export function label(options?: Options) {",
    "  return options?.label ?? 'Unnamed';",
    "}",
    "export function delayed(enabled: boolean) {",
    "  if (!enabled) return 0;",
    "  const doubled = 2;",
    "  return doubled;",
    "}",
  ].join("\n");
  await Promise.all([
    writeFile(path.join(directory, "sample.ts"), sample),
    writeFile(path.join(directory, "nested", "untouched.ts"), "export function twice(value: number) {\n  return value * 2;\n}\n"),
    writeFile(path.join(directory, "plain.mjs"), "export function plain() { return 'plain'; }\n"),
    writeFile(path.join(directory, "nested", "[id]", "panel.tsx"), [
      "/** @jsxRuntime classic */",
      "/** @jsx element */",
      "function element(type: string, props: unknown, child: string) { return { type, child }; }",
      "export function Panel({ label }: { label: string }) { return <aside>{label}</aside>; }",
    ].join("\n")),
    writeFile(path.join(directory, "runner.mjs"), `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
test("source behavior", () => {
  if (process.env.NEST_COVERAGE_FIXTURE_MODE === "untested") return;
  const { choose, label, delayed } = require("./sample.ts");
  assert.equal(choose(true), "ready");
  assert.equal(label({ label: "Named" }), "Named");
  if (process.env.NEST_COVERAGE_FIXTURE_MODE === "complete") {
    assert.equal(choose(false), "waiting");
    assert.equal(label(), "Unnamed");
    assert.equal(label({}), "Unnamed");
    assert.equal(label({ label: "" }), "");
    assert.equal(delayed(true), 2);
    assert.equal(delayed(false), 0);
    assert.equal(require("./nested/untouched.ts").twice(3), 6);
    assert.equal(require("./plain.mjs").plain(), "plain");
    assert.deepEqual(require("./nested/[id]/panel.tsx").Panel({ label: "Ready" }), { type: "aside", child: "Ready" });
  }
});
`),
  ]);
  const sourceTotals = [];
  for (const mode of ["untested", "partial", "complete"]) {
    const reports = path.join(directory, mode);
    await writeFile(path.join(directory, ".c8rc.json"), JSON.stringify({
      all: true,
      include: ["**/*.ts", "**/*.tsx", "plain.mjs"],
      exclude: [],
      extension: [".ts", ".tsx", ".mjs"],
      "exclude-after-remap": true,
      "reports-dir": reports,
      reporter: ["json-summary", "json"],
    }));
    const environment = { ...process.env, NEST_COVERAGE_FIXTURE_MODE: mode };
    delete environment.NODE_TEST_CONTEXT;
    delete environment.NODE_V8_COVERAGE;
    const { stdout } = await execute(process.execPath, [
      c8, "--config", path.join(directory, ".c8rc.json"), "--reporter=none",
      "--temp-directory", path.join(reports, "tmp"),
      process.execPath, "--import", tsx, "--import", collector, "--test", path.join(directory, "runner.mjs"),
    ], { cwd: directory, env: environment, timeout: 45_000 });
    assert.match(stdout, /ok 1 - source behavior/);
    const rawDirectory = path.join(reports, "tmp");
    const rawFiles = await readdir(rawDirectory);
    const collectedData = await Promise.all(rawFiles.map((file) => readFile(path.join(rawDirectory, file), "utf8")));
    const reportEnvironment = { ...process.env };
    delete reportEnvironment.NODE_TEST_CONTEXT;
    const reportArguments = mode === "untested" ? [reporter] : [reporter, ".c8rc.json"];
    const output = await execute(process.execPath, reportArguments, { cwd: directory, env: reportEnvironment, timeout: 45_000 });
    assert.doesNotMatch(output.stdout + output.stderr, /Unparsable source/);
    for (const [index, file] of rawFiles.entries()) {
      assert.ok(collectedData[index] === await readFile(path.join(rawDirectory, file), "utf8"), `Native coverage must remain unchanged: ${file}`);
    }
    const report = JSON.parse(await readFile(path.join(reports, "coverage-summary.json"), "utf8"));
    const details = JSON.parse(await readFile(path.join(reports, "coverage-final.json"), "utf8"));
    sourceTotals.push(report["sample.ts"].lines.total);
    const sampleStatements = Object.entries(details["sample.ts"].statementMap);
    for (const line of [3, 4, 7, 10, 11, 12]) {
      assert.ok(sampleStatements.some(([, location]) => location.start.line === line), `Executable source line ${line} must be represented in ${mode}`);
    }
    for (const line of [2, 6, 9]) {
      assert.ok(Object.values(details["sample.ts"].fnMap).some((fn) => fn.line === line), `Function on source line ${line} must be represented in ${mode}`);
    }
    if (mode !== "complete") {
      for (const [id, location] of sampleStatements.filter(([, location]) => location.start.line >= 10)) {
        assert.equal(details["sample.ts"].s[id], 0, `Uncalled source line ${location.start.line} must be uncovered`);
      }
      const delayed = Object.entries(details["sample.ts"].fnMap).find(([, fn]) => fn.name === "delayed");
      assert.equal(details["sample.ts"].f[delayed[0]], 0, "An initialized function must remain uncovered until it is called");
    }
    const sources = Object.keys(report).filter((key) => key !== "total");
    assert.deepEqual(sources.map((file) => file.replaceAll("\\", "/")).sort(), ["nested/[id]/panel.tsx", "nested/untouched.ts", "plain.mjs", "sample.ts"]);
    assert.ok(report.total.functions.total >= 6, "Every source function should count");
    if (mode === "complete") {
      const missedBranches = Object.entries(details).flatMap(([file, coverage]) => Object.entries(coverage.b)
        .filter(([, hits]) => hits.some((count) => count === 0))
        .map(([id, hits]) => ({ file, hits, location: coverage.branchMap[id] })));
      for (const metric of ["lines", "statements", "functions", "branches"]) assert.equal(report.total[metric].pct, 100, `${metric}: ${JSON.stringify(missedBranches)}`);
    } else {
      for (const metric of ["lines", "statements", "functions", "branches"]) assert.ok(report.total[metric].pct < 100, `${metric}: ${JSON.stringify(report)}`);
      const untouched = sources.find((file) => file.endsWith("untouched.ts"));
      assert.equal(report[untouched].lines.covered, 0);
      assert.equal(report[untouched].functions.covered, 0);
      assert.ok(report[untouched].lines.total > 0);
      assert.ok(report[untouched].functions.total > 0);
      if (mode === "untested") {
        for (const source of sources) {
          assert.ok(report[source].lines.total > 0, source);
          assert.equal(report[source].lines.covered, 0, source);
          assert.equal(report[source].functions.covered, 0, source);
        }
      }
    }
  }
  assert.equal(sourceTotals[1], sourceTotals[2], "Executing branches must not change the source line denominator");
  await writeFile(path.join(directory, ".c8rc.json"), JSON.stringify({ all: false }));
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  await assert.rejects(execute(process.execPath, [reporter], { cwd: directory, env: environment }), /Coverage must include untested production sources/);
});

test("native ESM and compiled CommonJS share JavaScript hits without losing unexecuted branches or function bodies", async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "nest-coverage-js-formats-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "source.mjs"), [
    "export const API = 'v1';",
    "export function choose(enabled) {",
    "  if (enabled) return 'ready';",
    "  return 'waiting';",
    "}",
    "export function uncalled() {",
    "  const result = 'not executed';",
    "  return result;",
    "}",
  ].join("\n"));
  await writeFile(path.join(directory, "native.test.mjs"), `
import assert from "node:assert/strict";
import { API, choose } from "./source.mjs";
assert.equal(API, "v1");
assert.equal(choose(true), "ready");
`);
  await writeFile(path.join(directory, "compiled.test.mjs"), `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { API, choose } = createRequire(import.meta.url)("./source.mjs");
assert.equal(API, "v1");
if (process.env.NEST_COVERAGE_FIXTURE_MODE === "complete") assert.equal(choose(false), "waiting");
`);
  for (const mode of ["partial", "complete"]) {
    const reports = path.join(directory, mode);
    await writeFile(path.join(directory, ".c8rc.json"), JSON.stringify({
      all: true, include: ["source.mjs"], exclude: [], extension: [".mjs"],
      "reports-dir": reports, reporter: ["json-summary", "json"],
    }));
    const environment = { ...process.env, NEST_COVERAGE_FIXTURE_MODE: mode };
    delete environment.NODE_TEST_CONTEXT;
    delete environment.NODE_V8_COVERAGE;
    await execute(process.execPath, [
      c8, "--config", path.join(directory, ".c8rc.json"), "--reporter=none", "--temp-directory", path.join(reports, "tmp"),
      process.execPath, "--import", tsx, "--import", collector, "--test", "native.test.mjs", "compiled.test.mjs",
    ], { cwd: directory, env: environment, timeout: 45_000 });
    await execute(process.execPath, [reporter], { cwd: directory, env: environment, timeout: 45_000 });
    const details = JSON.parse(await readFile(path.join(reports, "coverage-final.json"), "utf8"))["source.mjs"];
    const branch = Object.entries(details.branchMap).find(([, location]) => location.line === 3);
    assert.ok(branch);
    assert.equal(details.b[branch[0]][0], 1);
    assert.equal(details.b[branch[0]][1], mode === "complete" ? 1 : 0);
    const choose = Object.entries(details.fnMap).find(([, fn]) => fn.name === "choose");
    const uncalled = Object.entries(details.fnMap).find(([, fn]) => fn.name === "uncalled");
    assert.equal(details.f[choose[0]], mode === "complete" ? 2 : 1);
    assert.equal(details.f[uncalled[0]], 0);
    for (const line of [7, 8]) {
      const statement = Object.entries(details.statementMap).find(([, location]) => location.start.line === line);
      assert.ok(statement);
      assert.equal(details.s[statement[0]], 0);
    }
  }
});

test("coverage retains missed source branches and refuses missing compiled or native evidence", async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "nest-coverage-evidence-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reports = path.join(directory, "coverage");
  await writeFile(path.join(directory, ".c8rc.json"), JSON.stringify({
    all: true, include: ["source.ts"], exclude: [], extension: [".ts"],
    "reports-dir": reports, reporter: ["json-summary", "json"],
  }));
  await writeFile(path.join(directory, "source.ts"), [
    "export function value(enabled: boolean) {",
    "  enabled && (module.exports = {});",
    "  return 'available';",
    "}",
  ].join("\n"));
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_V8_COVERAGE;
  const result = await execute(process.execPath, [
    c8, "--config", path.join(directory, ".c8rc.json"), "--reporter=none", "--temp-directory", path.join(reports, "tmp"),
    process.execPath, "--import", tsx, "--import", collector, "--eval", 'console.log(require("./source.ts").value(false))',
  ], { cwd: directory, env: environment, timeout: 45_000 });
  assert.equal(result.stdout.trim(), "available");
  const reportEnvironment = { ...process.env };
  delete reportEnvironment.NODE_TEST_CONTEXT;
  const output = await execute(process.execPath, [reporter], { cwd: directory, env: reportEnvironment, timeout: 45_000 });
  assert.doesNotMatch(output.stdout + output.stderr, /Unparsable source/);
  const coverage = JSON.parse(await readFile(path.join(reports, "coverage-final.json"), "utf8"))["source.ts"];
  const originalBranch = Object.entries(coverage.branchMap).find(([, branch]) => branch.line === 2);
  assert.ok(originalBranch, "A branch written in the source must remain measurable");
  assert.deepEqual(coverage.b[originalBranch[0]], [1, 0]);
  const rawFiles = await readdir(path.join(reports, "tmp"));
  for (const file of rawFiles.filter((file) => file.startsWith("source-"))) await rm(path.join(reports, "tmp", file));
  await assert.rejects(execute(process.execPath, [reporter], { cwd: directory, env: reportEnvironment, timeout: 45_000 }), /Missing compiled coverage source/);
  for (const file of await readdir(path.join(reports, "tmp"))) await rm(path.join(reports, "tmp", file));
  await assert.rejects(execute(process.execPath, [reporter], { cwd: directory, env: reportEnvironment, timeout: 45_000 }), /No V8 coverage was collected/);
});

test("named ESM imports and CommonJS requires both contribute their actual TypeScript execution", async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "nest-coverage-imports-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reports = path.join(directory, "coverage");
  await writeFile(path.join(directory, ".c8rc.json"), JSON.stringify({
    all: true, include: ["source.ts"], exclude: [], extension: [".ts"],
    "reports-dir": reports, reporter: ["json-summary", "json"],
  }));
  await writeFile(path.join(directory, "source.ts"), [
    "export function choose(enabled: boolean) {",
    "  if (enabled) return 'ready';",
    "  return 'waiting';",
    "}",
  ].join("\n"));
  await writeFile(path.join(directory, "runner.mjs"), `
import assert from "node:assert/strict";
import { choose } from "./source.ts";
import { createRequire } from "node:module";
assert.equal(choose(true), "ready");
assert.equal(createRequire(import.meta.url)("./source.ts").choose(false), "waiting");
console.log("Both module paths executed");
`);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_V8_COVERAGE;
  const run = await execute(process.execPath, [
    c8, "--config", path.join(directory, ".c8rc.json"), "--reporter=none", "--temp-directory", path.join(reports, "tmp"),
    process.execPath, "--import", tsx, "--import", collector, path.join(directory, "runner.mjs"),
  ], { cwd: directory, env: environment, timeout: 45_000 });
  assert.match(run.stdout, /Both module paths executed/);
  const reportEnvironment = { ...process.env };
  delete reportEnvironment.NODE_TEST_CONTEXT;
  const output = await execute(process.execPath, [reporter], { cwd: directory, env: reportEnvironment, timeout: 45_000 });
  assert.doesNotMatch(output.stdout + output.stderr, /Unparsable source/);
  const report = JSON.parse(await readFile(path.join(reports, "coverage-summary.json"), "utf8"));
  assert.deepEqual(Object.keys(report), ["total", "source.ts"]);
  for (const metric of ["lines", "statements", "functions", "branches"]) assert.equal(report.total[metric].pct, 100, metric);
});
