import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { runSonarScanner } from "../scripts/sonar-scanner.mjs";
import { countSourceLines } from "../scripts/source-lines.mjs";
import { patchArgparseCompatibility } from "../scripts/patch-argparse-compatibility.mjs";

async function fixture(context) {
  const directory = await mkdtemp(path.join(tmpdir(), "nest-ci-runtime-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("build credentials require a disposable hosted runner and never target a real database", async (context) => {
  const directory = await fixture(context);
  const script = path.resolve("scripts/configure-ci-build-env.mjs");
  const envFile = path.join(directory, "github-env");
  const env = { ...process.env, GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_ENV: envFile };
  for (const missing of ["GITHUB_ACTIONS", "RUNNER_ENVIRONMENT", "GITHUB_ENV"]) {
    const denied = spawnSync(process.execPath, [script], { env: { ...env, [missing]: "" }, encoding: "utf8" });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /restricted to disposable/);
  }
  const run = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const settings = Object.fromEntries((await readFile(envFile, "utf8")).trim().split("\n").map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.match(settings.DATABASE_URL, /^sqlserver:\/\/127\.0\.0\.1:1433;database=nest_build;/);
  assert.match(settings.SHADOW_DATABASE_URL, /;database=nest_build_shadow;/);
  assert.notEqual(settings.DATABASE_URL, settings.SHADOW_DATABASE_URL);
  assert.equal(settings.NEXTAUTH_URL, "http://127.0.0.1:3100");
  const password = /;password=([a-f0-9]{64});/.exec(settings.DATABASE_URL)[1];
  assert.notEqual(password, settings.NEXTAUTH_SECRET);
  assert.match(settings.NEXTAUTH_SECRET, /^[a-f0-9]{64}$/);
  for (const secret of [password, settings.NEXTAUTH_SECRET]) {
    assert.ok(run.stdout.includes(`::add-mask::${secret}\n`));
  }
  assert.equal(run.stdout.split("\n").filter(Boolean).length, 2);
});

test("scanner credentials travel only in the environment and strict options reach the CLI", async (context) => {
  const directory = await fixture(context);
  const executable = path.join(directory, "scanner.mjs");
  await writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync('invocation.json', JSON.stringify({args: process.argv.slice(2), token: process.env.SONAR_TOKEN, host: process.env.SONAR_HOST_URL, cwd: process.cwd()}));\n`, { mode: 0o700 });
  await runSonarScanner({ serverUrl: "https://sonar.example.test", token: "fixture-token", projectKey: "nest-fixture", root: directory, executable });
  const invocation = JSON.parse(await readFile(path.join(directory, "invocation.json"), "utf8"));
  assert.equal(invocation.token, "fixture-token");
  assert.equal(invocation.host, "https://sonar.example.test");
  assert.equal(invocation.cwd, await import("node:fs/promises").then((fs) => fs.realpath(directory)));
  assert.ok(invocation.args.includes("-Dsonar.qualitygate.wait=true"));
  assert.ok(invocation.args.includes("-Dsonar.projectKey=nest-fixture"));
  assert.ok(invocation.args.includes(`-Dsonar.javascript.node.executable=${process.execPath}`));
  assert.ok(invocation.args.every((value) => !value.includes("fixture-token")));
});

test("scanner startup errors, failed analysis, and termination cannot report success", async (context) => {
  const directory = await fixture(context);
  const options = { root: directory, token: "fixture", serverUrl: "http://127.0.0.1:9000", projectKey: "fixture" };
  await assert.rejects(runSonarScanner({ ...options, executable: path.join(directory, "missing") }), { code: "ENOENT" });
  for (const [name, statement, expected] of [
    ["failed", "process.exitCode = 7;", /status 7/],
    ["terminated", "process.kill(process.pid, 'SIGTERM');", /status unknown/],
  ]) {
    const executable = path.join(directory, `${name}.mjs`);
    await writeFile(executable, `#!${process.execPath}\n${statement}\n`, { mode: 0o700 });
    await assert.rejects(runSonarScanner({ ...options, executable }), expected);
  }
});

test("source line budgets count physical lines consistently with and without a final newline", () => {
  for (const [source, expected] of [["", 0], ["one", 1], ["one\n", 1], ["one\r\n", 1], ["one\ntwo", 2], ["one\ntwo\n", 2], ["\n", 1], ["one\n\n", 2]]) {
    assert.equal(countSourceLines(source), expected);
  }
});

test("Next's directory glob adapter still resolves configured monorepo apps", async (context) => {
  const directory = await fixture(context);
  await mkdir(path.join(directory, "apps", "first"), { recursive: true });
  await mkdir(path.join(directory, "apps", "second"), { recursive: true });
  await writeFile(path.join(directory, "apps", "not-a-directory.txt"), "fixture");
  const require = createRequire(import.meta.url);
  const { getRootDirs } = require("@next/eslint-plugin-next/dist/utils/get-root-dirs.js");
  assert.deepEqual(getRootDirs({ cwd: directory, settings: {} }), [directory]);
  const expected = [path.join(directory, "apps", "first"), path.join(directory, "apps", "second")];
  assert.deepEqual(getRootDirs({ cwd: directory, settings: { next: { rootDir: `${directory}/apps/*` } } }).map((dir) => path.resolve(dir)).sort(), expected);
  assert.deepEqual(getRootDirs({ cwd: directory, settings: { next: { rootDir: [`${directory}/apps/{first,second}`, null] } } }).map((dir) => path.resolve(dir)).sort(), expected);
});

test("Remarkable's updated argument parser preserves Markdown CLI input and options", async (context) => {
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve("remarkable/package.json")), "bin/remarkable.js");
  const rendered = spawnSync(process.execPath, [cli], { input: '# Nest\n\n"Works" & **safe**\n', encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /<h1>Nest<\/h1>/);
  assert.match(rendered.stdout, /“Works” &amp; <strong>safe<\/strong>/);
  const directory = await fixture(context);
  const file = path.join(directory, "document.md");
  await writeFile(file, "# File input\n");
  const fromFile = spawnSync(process.execPath, [cli, file], { encoding: "utf8" });
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.equal(fromFile.stdout.trim(), "<h1>File input</h1>");
  const version = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.match(`${version.stdout}\n${version.stderr}`, /(?:^|\n)\d+\.\d+\.\d+(?:\n|$)/);
  const invalid = spawnSync(process.execPath, [cli, "--unknown-option"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
});

test("the argparse compatibility patch is idempotent and refuses unexpected dependency code", async (context) => {
  const directory = await fixture(context);
  const require = createRequire(import.meta.url);
  const remarkableRequire = createRequire(require.resolve("remarkable/package.json"));
  const installed = await readFile(remarkableRequire.resolve("argparse"), "utf8");
  const original = installed.replace("default: SUPPRESS,\n                    version,", "default: SUPPRESS,\n                    version: this.version,");
  const file = path.join(directory, "argparse.js");
  await writeFile(file, original);
  assert.equal(await patchArgparseCompatibility(file), true);
  assert.equal(await patchArgparseCompatibility(file), false);
  await writeFile(file, "unexpected release");
  await assert.rejects(patchArgparseCompatibility(file), /review and update/);
  assert.equal(await readFile(file, "utf8"), "unexpected release");
});
