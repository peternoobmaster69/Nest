import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

const failure = Object.assign(new Error("Interpreter could not start"), { code: "EAGAIN" });
mock.module("node:child_process", { namedExports: { spawnSync: () => ({ error: failure }) } });
const { runPrisma } = await import("../scripts/run-prisma.mjs");

test("Prisma startup errors are propagated without treating a missing exit status as success", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "nest-prisma-startup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.throws(() => runPrisma(["validate"], { projectRoot: directory, env: { DATABASE_URL: "sqlserver://127.0.0.1:1433;database=fixture" }, stdio: "pipe" }), (error) => error === failure);
});
