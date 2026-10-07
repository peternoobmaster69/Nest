import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadDotEnv, resolveDatabaseUrl, runPrisma } from "../scripts/run-prisma.mjs";
import { resolveDatabaseUrl as applicationDatabaseUrl } from "../lib/database-url.ts";

const settings = { AZURE_SQL_SERVER: "database.example.test", AZURE_SQL_DATABASE: "nest_fixture", AZURE_SQL_USER: "fixture", AZURE_SQL_PASSWORD: "test-only" };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "nest-database-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("application, seed and Prisma configuration share SQL Server URL precedence and secure defaults", () => {
  const result = resolveDatabaseUrl(settings);
  assert.equal(applicationDatabaseUrl(settings), result);
  assert.equal(result, "sqlserver://database.example.test:1433;database=nest_fixture;user=fixture;password=test-only;encrypt=true;trustServerCertificate=false");
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: `  ${result}  ` }), result);
  assert.equal(applicationDatabaseUrl({ DATABASE_URL: `  ${result}  ` }), result);
  assert.ok(resolveDatabaseUrl({ ...settings, DATABASE_URL: " direct.example.test:1555 " }).startsWith("sqlserver://direct.example.test:1555;"));
  assert.ok(resolveDatabaseUrl({ ...settings, AZURE_SQL_SERVER: " existing.example.test:1444 " }).startsWith("sqlserver://existing.example.test:1444;"));
  for (const value of ["false", " FALSE ", "0"]) {
    const url = resolveDatabaseUrl({ ...settings, AZURE_SQL_ENCRYPT: value, AZURE_SQL_TRUST_SERVER_CERTIFICATE: value });
    assert.ok(url.endsWith("encrypt=false;trustServerCertificate=false"));
  }
  for (const value of ["true", "1", "yes"]) {
    assert.ok(resolveDatabaseUrl({ ...settings, AZURE_SQL_TRUST_SERVER_CERTIFICATE: value }).endsWith("trustServerCertificate=true"));
  }
  assert.equal(resolveDatabaseUrl({ ...settings, DATABASE_URL: " ", AZURE_SQL_ENCRYPT: "" }), result);
});

test("missing SQL Server settings fail before any process or database access without echoing credentials", () => {
  for (const [field, label] of [["AZURE_SQL_SERVER", "DATABASE_URL or AZURE_SQL_SERVER"], ["AZURE_SQL_DATABASE", "AZURE_SQL_DATABASE"], ["AZURE_SQL_USER", "AZURE_SQL_USER"], ["AZURE_SQL_PASSWORD", "AZURE_SQL_PASSWORD"]]) {
    for (const value of [undefined, "", "  "]) {
      assert.throws(() => resolveDatabaseUrl({ ...settings, [field]: value }), { message: `Missing required environment variable: ${label}` });
    }
  }
});

test("the application resolver reads the process environment when no explicit settings are supplied", (t) => {
  const saved = process.env.DATABASE_URL;
  t.after(() => { if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved; });
  process.env.DATABASE_URL = "sqlserver://127.0.0.1:1433;database=fixture";
  assert.equal(applicationDatabaseUrl(), process.env.DATABASE_URL);
});

test("dotenv loading preserves explicit values and accepts quotes, empty values, CRLF and embedded equals", async (t) => {
  const directory = await fixture(t);
  const file = path.join(directory, ".env");
  const env = { KEEP: "explicit", EMPTY: "" };
  loadDotEnv(file, env);
  assert.deepEqual(env, { KEEP: "explicit", EMPTY: "" });
  await writeFile(file, ["# comment", " ", "no separator", "=ignored", "KEEP=replaced", "EMPTY=replaced", " SPACE = value ", 'DOUBLE="quoted value"', "SINGLE='quoted value'", 'UNFINISHED="unclosed', "EQUALS=a=b=c", "BLANK="].join("\r\n"));
  loadDotEnv(file, env);
  assert.deepEqual(env, { KEEP: "explicit", EMPTY: "", SPACE: "value", DOUBLE: "quoted value", SINGLE: "quoted value", UNFINISHED: '"unclosed', EQUALS: "a=b=c", BLANK: "" });
  const variable = "NEST_TEST_DOTENV_DEFAULT";
  const original = process.env[variable];
  t.after(() => { if (original === undefined) delete process.env[variable]; else process.env[variable] = original; });
  delete process.env[variable];
  await writeFile(file, `${variable}=fixture\n`);
  loadDotEnv(file);
  assert.equal(process.env[variable], "fixture");
});

async function prismaFixture(t) {
  const directory = await fixture(t);
  const cli = path.join(directory, "node_modules", "prisma", "build");
  await mkdir(cli, { recursive: true });
  await writeFile(path.join(cli, "index.js"), `
const args = process.argv.slice(2);
if (args.includes("--fail")) process.exit(17);
if (args.includes("--signal")) process.kill(process.pid, "SIGTERM");
process.stdout.write(JSON.stringify({ args, url: process.env.DATABASE_URL, marker: process.env.NEST_TEST_MARKER }));
`);
  await writeFile(path.join(directory, ".env"), "DATABASE_URL=sqlserver://127.0.0.1:1433;database=dotenv_fixture\nNEST_TEST_MARKER=from-file\n");
  return directory;
}

test("the Prisma launcher forwards arguments and isolated configuration and propagates failures", async (t) => {
  const directory = await prismaFixture(t);
  const env = { DATABASE_URL: "sqlserver://127.0.0.1:1433;database=explicit_fixture", NEST_TEST_MARKER: "explicit" };
  const options = { projectRoot: directory, env, stdio: "pipe" };
  const result = runPrisma(["validate", "--schema", "schema.prisma"], options);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { args: ["validate", "--schema", "schema.prisma"], url: env.DATABASE_URL, marker: "explicit" });
  assert.throws(() => runPrisma(["--fail"], options), /Prisma exited with status 17/);
  assert.throws(() => runPrisma(["--signal"], options), /Prisma exited with status unknown/);
});

test("the real Prisma wrapper entry point loads its working directory and reports CLI failure", async (t) => {
  const directory = await prismaFixture(t);
  const script = path.resolve("scripts/run-prisma.mjs");
  const env = { PATH: process.env.PATH };
  if (process.env.NODE_V8_COVERAGE) env.NODE_V8_COVERAGE = process.env.NODE_V8_COVERAGE;
  const result = spawnSync(process.execPath, [script, "generate"], { cwd: directory, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: ["generate"], url: "sqlserver://127.0.0.1:1433;database=dotenv_fixture", marker: "from-file" });
  const failed = spawnSync(process.execPath, [script, "--fail"], { cwd: directory, env, encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Prisma exited with status 17/);
});
