import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import { Prisma } from "@prisma/client";
import { defaultAgentConfiguration } from "../lib/ai/agent-catalog.ts";
import { LEGACY_AGENT_INSTRUCTIONS, DEFAULT_AGENT_INSTRUCTIONS } from "../lib/ai/agent-instructions.ts";
import { assertMutationAllowed, parseSafetyArgs } from "../scripts/data-script-safety.mjs";

const database = {};
const calls = [];
const messages = [];
let runNumber = 0;
mock.module("@prisma/client", { namedExports: {
  Prisma,
  PrismaClient: class { constructor() { return database; } },
} });
mock.module("../scripts/run-prisma.mjs", { namedExports: {
  loadDotEnv: () => {},
  resolveDatabaseUrl: () => "sqlserver://127.0.0.1:1433;database=script_fixture;user=fixture;password=fixture",
} });
mock.module("../lib/prisma.ts", { namedExports: { prisma: database } });

function operation(action, reply) {
  return async (input) => {
    calls.push({ action, input });
    return typeof reply === "function" ? reply(input) : structuredClone(reply);
  };
}
beforeEach((t) => {
  const environment = { ...process.env };
  const argv = process.argv;
  const exitCode = process.exitCode;
  process.env.ADMIN = "owner@example.test";
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "sqlserver://127.0.0.1:1433;database=script_fixture;user=fixture;password=fixture";
  delete process.env.DATA_SCRIPT_ALLOWED_ENVIRONMENTS;
  process.exitCode = 0;
  calls.length = 0;
  messages.length = 0;
  for (const key of Object.keys(database)) delete database[key];
  database.$disconnect = operation("disconnect");
  database.$transaction = async (callback) => { calls.push({ action: "transaction" }); return callback(database); };
  database.workspace = { findUnique: operation("workspace", { id: "home", name: "Home" }) };
  database.user = { findFirst: operation("user", { id: "admin", email: "owner@example.test" }) };
  database.frequentFlyerAccount = { findFirst: operation("flyer", { id: "flyer", programName: "KrisFlyer" }), updateMany: operation("update-flyer", { count: 1 }) };
  database.mileProgram = { findMany: operation("programs", []), deleteMany: operation("delete-programs", { count: 0 }), updateMany: operation("update-program", { count: 1 }), create: operation("create-program", () => ({ id: `mile-${calls.filter((call) => call.action === "create-program").length}` })) };
  database.mileRedemption = { findMany: operation("redemptions", []), deleteMany: operation("delete-redemptions", { count: 0 }), create: operation("create-redemption", () => ({ id: `redemption-${calls.filter((call) => call.action === "create-redemption").length}` })) };
  database.mileRedemptionDetail = { groupBy: operation("redemption-totals", []), deleteMany: operation("delete-details", { count: 0 }), create: operation("create-detail", { id: "detail" }) };
  database.aiAgentConfig = { findMany: operation("agent-configs", []) };
  for (const level of ["log", "error"]) t.mock.method(console, level, (...values) => {
    messages.push({ level, text: values.map((value) => value instanceof Error ? value.message : String(value)).join(" ") });
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  t.after(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
  });
});
const output = () => messages.map((message) => message.text).join("\n");
const audit = () => messages.filter(({ text }) => text.startsWith('{"event":"data_script"')).map(({ text }) => JSON.parse(text)).at(-1);
const selected = (action) => calls.filter((call) => call.action === action);
async function run(name, args = []) {
  process.argv = [process.execPath, `${name}.mjs`, ...args];
  await import(`../scripts/${name}.mjs?script-test=${++runNumber}`);
}
function preflight({ columns = 4, count = () => 0, wake = [] } = {}) {
  let attempt = 0;
  database.$queryRaw = async (query) => {
    const sql = Array.isArray(query) ? query.join("") : query.sql;
    calls.push({ action: "query", sql });
    if (sql.includes("SELECT 1 AS [ready]")) {
      const failure = wake[attempt++];
      if (failure !== undefined) throw failure;
      return [{ ready: 1 }];
    }
    if (sql.includes("FROM sys.columns")) return Array.from({ length: columns }, () => ({ name: "column" }));
    const value = count(sql);
    return value === undefined ? [] : [{ count: value }];
  };
}

test("maintenance safety defaults to development and requires an exact workspace for live changes", () => {
  delete process.env.NODE_ENV;
  const safety = parseSafetyArgs(["--apply"]);
  assert.equal(safety.environment, "development");
  assert.throws(() => assertMutationAllowed({ safety, workspaceId: "", operation: "fixture" }), /--workspace is required/);
});

test("database preflight checks every retained constraint without writing records", async () => {
  preflight({ count: (sql) => { assert.match(sql, /SELECT/); return undefined; } });
  await run("check-phase4-preflight");
  assert.equal(process.exitCode, 0);
  assert.match(output(), /Phase 4 database preflight passed/);
  assert.ok(selected("query").length > 20);
  assert.ok(selected("query").every(({ sql }) => sql.trimStart().startsWith("SELECT")));
  assert.equal(selected("disconnect").length, 1);
});

test("missing Phase 5 columns defer only the checks that require those columns", async () => {
  preflight({ columns: 0 });
  await run("check-phase4-preflight");
  assert.match(output(), /REPAIR.*Phase 5 key columns are absent/);
  assert.match(output(), /duplicate job\/ingestion keys: 0 \(deferred\)/);
  assert.match(output(), /invalid background job progress: 0 \(deferred\)/);
  assert.match(output(), /invalid workspace member role: 0/);
  assert.equal(process.exitCode, 0);
  assert.equal(selected("disconnect").length, 1);
});

test("repairable aliases are reported separately from integrity blockers", async () => {
  preflight({ count: (sql) => {
    if (sql.includes("WorkspaceMember] WHERE [role]")) return 2n;
    if (sql.includes("CardAlertStaging] s LEFT JOIN [dbo].[CreditCardTransaction]")) return 1;
    return 0;
  } });
  await run("check-phase4-preflight");
  assert.match(output(), /BLOCKED invalid workspace member role: 2/);
  assert.match(output(), /REPAIR\s+orphaned card-alert transaction aliases: 1/);
  assert.match(output(), /found 1 blocking check/);
  assert.doesNotMatch(output(), /preflight passed/);
  assert.equal(process.exitCode, 1);
  assert.equal(selected("disconnect").length, 1);
});

test("database wake retries use the bounded backoff and recover from both Prisma and connection errors", async (t) => {
  const waits = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { waits.push(delay); callback(); return 0; });
  preflight({ wake: [Object.assign(new Error("Resuming"), { code: "P1001" }), { code: "P1002" }, "socket closed", new Error("timeout"), { code: "P2024" }] });
  await run("check-phase4-preflight");
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 10000]);
  assert.equal(process.exitCode, 0);
  assert.match(output(), /preflight passed/);
  assert.equal(selected("disconnect").length, 1);
});

for (const [name, error, retries] of [["exhausted retries", { code: "P1001" }, 5], ["nonretryable error", new Error("outer\nspecific database failure\n"), 0], ["non-Error failure", null, 0]]) {
  test(`preflight ${name} fails and still disconnects`, async (t) => {
    const waits = [];
    t.mock.method(globalThis, "setTimeout", (callback, delay) => { waits.push(delay); callback(); return 0; });
    preflight({ wake: Array(6).fill(error) });
    await run("check-phase4-preflight");
    assert.equal(waits.length, retries);
    assert.equal(process.exitCode, 1);
    assert.match(output(), /preflight could not run/);
    if (error instanceof Error) assert.match(output(), /specific database failure/);
    assert.doesNotMatch(output(), /preflight passed/);
    assert.equal(selected("disconnect").length, 1);
  });
}

test("migration reports distinguish rollback, completion, and unfinished migrations and cap failure logs", async () => {
  const date = new Date("2026-10-08T00:00:00Z");
  database.$queryRaw = operation("query", [
    { migration_name: "reverted", started_at: date, finished_at: date, rolled_back_at: date },
    { migration_name: "complete", started_at: date, finished_at: date },
    { migration_name: "broken", started_at: "legacy timestamp", logs: "x".repeat(4100) },
    { migration_name: "pending" },
  ]);
  await run("report-migration-state");
  assert.match(output(), /ROLLED_BACK reverted started=2026-10-08T00:00:00.000Z/);
  assert.match(output(), /APPLIED\s+complete/);
  assert.match(output(), /FAILED\s+broken started=legacy timestamp/);
  assert.match(output(), /FAILED\s+pending started=undefined/);
  assert.equal(messages.find(({ text }) => text.startsWith("xxx")).text.length, 4000);
  assert.equal(selected("disconnect").length, 1);
});

test("migration reporting propagates database failure after releasing its connection", async () => {
  database.$queryRaw = async () => { throw new Error("Unavailable migration history"); };
  await assert.rejects(run("report-migration-state"), /Unavailable migration history/);
  assert.equal(selected("disconnect").length, 1);
});

for (const script of ["import-kf-miles", "reconcile-ff-balances"]) {
  test(`${script} rejects missing arguments and unsafe writes before looking up a workspace`, async () => {
    for (const args of [[], ["home"], ["home", "flyer", "--apply", "--environment=production", "--confirm=home"], ["home", "flyer", "--apply", "--environment=test", "--confirm=other"]]) {
      await run(script, args);
      assert.equal(process.exitCode, 1);
    }
    assert.equal(selected("disconnect").length, 4);
    assert.equal(selected("workspace").length + selected("flyer").length, 0);
    assert.match(output(), /Usage:/);
    assert.match(output(), /not in DATA_SCRIPT_ALLOWED_ENVIRONMENTS/);
    assert.match(output(), /confirm the exact workspace/);
  });
}

test("legacy import rejects URL credentials and an unknown workspace before contacting its source", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  await run("import-kf-miles", ["home", "https://user:password@legacy.example.test/api"]);
  assert.match(output(), /must not contain credentials/);
  database.workspace.findUnique = operation("workspace", null);
  await run("import-kf-miles", ["home", "https://legacy.example.test/api"]);
  assert.match(output(), /Workspace not found: home/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(selected("workspace")[0].input, { where: { id: "home" }, select: { id: true, name: true } });
  assert.equal(selected("disconnect").length, 2);
});

test("legacy import previews counts, ignores absent collections, and omits URL query credentials from logs", async (t) => {
  for (const payload of [{ KFMiles: [{ Id: 1 }], KFMilesRed: [{ Id: 2 }], KFMilesRedDet: [{ Id: 3 }] }, { KFMiles: "invalid" }, null]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    await run("import-kf-miles", ["home", "https://legacy.example.test/api?token=private-query-token"]);
    assert.equal(process.exitCode, 0);
    assert.equal(audit().mode, "dry-run");
    assert.equal(audit().apiUrl, "https://legacy.example.test/api");
    assert.equal(audit().miles, Array.isArray(payload?.KFMiles) ? 1 : 0);
  }
  assert.ok(calls.every(({ action }) => !action.startsWith("create-") && !action.startsWith("delete-")));
  assert.doesNotMatch(output(), /private-query-token/);
  assert.equal(selected("disconnect").length, 3);
});

test("legacy imports reject unsuccessful and oversized responses before deleting data", async (t) => {
  for (const response of [new Response("Unavailable", { status: 503 }), Response.json({ KFMiles: Array(10001).fill({}) })]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await run("import-kf-miles", ["home", "https://legacy.example.test/api", "--apply", "--confirm=home"]);
    assert.equal(process.exitCode, 1);
  }
  assert.match(output(), /Failed to fetch legacy API \(503\)/);
  assert.match(output(), /limited to 10,000/);
  assert.equal(selected("delete-details").length, 0);
  assert.equal(selected("disconnect").length, 2);
});

test("an expired legacy request is aborted and cleaned up without terminating the process before disconnect", async (t) => {
  let timeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { assert.equal(delay, 20000); timeout = callback; return 42; });
  const clear = t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    timeout();
    assert.equal(signal.aborted, true);
    throw new DOMException("Legacy request timed out", "AbortError");
  });
  const exit = t.mock.method(process, "exit", () => { throw new Error("Premature process termination"); });
  await run("import-kf-miles", ["home", "https://legacy.example.test/api"]);
  assert.equal(process.exitCode, 1);
  assert.match(output(), /Legacy request timed out/);
  assert.deepEqual(clear.mock.calls[0].arguments, [42]);
  assert.equal(exit.mock.callCount(), 0);
  assert.equal(selected("disconnect").length, 1);
});

test("empty legacy imports finish without clearing unrelated data", async () => {
  await run("import-kf-miles", ["home", "https://legacy.example.test/api", "--apply", "--confirm=home"]);
  assert.equal(process.exitCode, 0);
  assert.equal(audit().mode, "apply");
  assert.equal(audit().importedMiles, 0);
  assert.equal(selected("delete-details").length, 0);
  assert.equal(selected("create-program").length, 0);
  assert.equal(selected("disconnect").length, 1);
});

test("confirmed legacy imports map new IDs, normalize dates, preserve explicit balances, and skip unresolved details", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-08T12:00:00Z") });
  const miles = Array.from({ length: 26 }, (_, index) => ({ Id: index + 1, Miles: 100, BalanceMiles: 75, Title: "Earned", Date: "2026-01-01", ExpiryDate: "2027-01-01", FirstRedeemedDate: "2026-02-01" }));
  miles[1] = { Id: 2, Miles: 200, Date: "invalid" };
  miles[2] = { Id: 3 };
  const details = Array.from({ length: 21 }, () => ({ KFMilesRedemptionId: 10, KFMilesId: 1, MilesRedeemed: 25 }));
  details[0] = { KFMilesRedemptionId: 10, KFMilesId: 2 };
  details[1] = { KFMilesRedemptionId: "missing", KFMilesId: 1 };
  details[2] = { KFMilesRedemptionId: 10, KFMilesId: "missing" };
  t.mock.method(globalThis, "fetch", async () => Response.json({ KFMiles: miles, KFMilesRed: [{ Id: 10, RemeptionTitle: "Flight", TotalMilesRedeemed: 50, DateTime: "2026-03-01" }, { Id: 11 }], KFMilesRedDet: details }));
  database.mileProgram.findMany = operation("programs", [{ id: "old-mile" }]);
  database.mileRedemption.findMany = operation("redemptions", [{ id: "old-redemption" }]);
  await run("import-kf-miles", ["home", "https://legacy.example.test/api", "--apply", "--confirm=home"]);
  assert.equal(process.exitCode, 0);
  assert.deepEqual(selected("delete-details").map(({ input }) => input.where), [{ redemptionId: { in: ["old-redemption"] } }, { milesFileId: { in: ["old-mile"] } }]);
  assert.equal(selected("create-program").length, 26);
  const rows = selected("create-program").map(({ input }) => input.data);
  assert.equal(rows[0].workspaceId, "home");
  assert.equal(rows[0].balanceMiles, 75);
  assert.equal(rows[0].firstRedeemedDate.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.equal(rows[1].balanceMiles, 200);
  assert.equal(rows[1].date.toISOString(), "2026-10-08T12:00:00.000Z");
  assert.equal(rows[2].miles, 0);
  assert.equal(rows[2].balanceMiles, 0);
  assert.equal(rows[2].expiryDate, null);
  assert.equal(rows[2].title, null);
  assert.equal(selected("create-redemption")[1].input.data.redemptionTitle, "Legacy Redemption");
  assert.equal(selected("create-redemption")[1].input.data.totalMilesRedeemed, 0);
  assert.equal(selected("create-detail").length, 19);
  assert.deepEqual(selected("create-detail")[0].input.data, { redemptionId: "redemption-1", milesFileId: "mile-2", milesRedeemed: 0 });
  assert.match(output(), /Mile programs imported: 25\/26/);
  assert.match(output(), /Redemption details imported: 20\/21/);
  assert.equal(audit().workspaceName, "Home");
  assert.equal(audit().importedMiles, 26);
  assert.equal(selected("disconnect").length, 1);
});

for (const apply of [false, true]) {
  test(`mile reconciliation ${apply ? "applies" : "previews"} only scoped balance corrections and totals unexpired programs`, async () => {
    database.mileProgram.findMany = async (input) => {
      calls.push({ action: "programs", input });
      if (input.where.OR) return [{ id: "adjusted", balanceMiles: 80 }, { id: "same", balanceMiles: 50 }];
      return [{ id: "adjusted", miles: 100, balanceMiles: 80 }, { id: "overdrawn", miles: 100, balanceMiles: 5 }, { id: "same", miles: 50, balanceMiles: 50 }];
    };
    database.mileRedemptionDetail.groupBy = operation("redemption-totals", [{ milesFileId: "adjusted", _sum: { milesRedeemed: 30 } }, { milesFileId: "overdrawn", _sum: { milesRedeemed: 200 } }, { milesFileId: "unused", _sum: { milesRedeemed: null } }]);
    const args = ["home", "flyer"];
    if (apply) args.push("--apply", "--confirm=home");
    await run("reconcile-ff-balances", args);
    assert.equal(process.exitCode, 0);
    assert.deepEqual(selected("flyer")[0].input.where, { id: "flyer", workspaceId: "home" });
    assert.equal(audit().changedPrograms, 2);
    assert.equal(audit().currentMiles, 120);
    assert.equal(audit().mode, apply ? "apply" : "dry-run");
    const activeQuery = selected("programs")[1].input.where;
    assert.deepEqual(activeQuery.OR[0], { expiryDate: null });
    assert.equal(activeQuery.OR[1].expiryDate.gte.getUTCHours(), 0);
    assert.equal(selected("transaction").length, Number(apply));
    if (apply) {
      assert.deepEqual(selected("update-program").map(({ input }) => input), [
        { where: { id: "adjusted", workspaceId: "home", frequentFlyerId: "flyer", balanceMiles: 80 }, data: { balanceMiles: 70 } },
        { where: { id: "overdrawn", workspaceId: "home", frequentFlyerId: "flyer", balanceMiles: 5 }, data: { balanceMiles: 0 } },
      ]);
      assert.deepEqual(selected("update-flyer")[0].input, { where: { id: "flyer", workspaceId: "home" }, data: { currentMiles: 120 } });
    } else assert.equal(selected("update-program").length, 0);
    assert.equal(selected("disconnect").length, 1);
  });
}

test("reconciliation refuses missing accounts and releases a failed database connection", async () => {
  database.frequentFlyerAccount.findFirst = operation("flyer", null);
  await run("reconcile-ff-balances", ["home", "missing"]);
  assert.equal(process.exitCode, 1);
  assert.match(output(), /not found in the selected workspace/);
  database.frequentFlyerAccount.findFirst = async () => { throw new Error("Database unavailable"); };
  await run("reconcile-ff-balances", ["home", "flyer"]);
  assert.match(output(), /Database unavailable/);
  assert.equal(selected("disconnect").length, 2);
});

test("prompt upgrades validate arguments and the configured administrator before loading saved prompts", async () => {
  await run("upgrade-agent-prompts", ["--unknown"]);
  assert.match(output(), /Use --apply/);
  delete process.env.ADMIN;
  await run("upgrade-agent-prompts");
  assert.match(output(), /Configure ADMIN/);
  process.env.ADMIN = "owner@example.test";
  for (const actor of [null, { id: "other", email: "other@example.test" }]) {
    database.user.findFirst = operation("user", actor);
    await run("upgrade-agent-prompts");
    assert.equal(process.exitCode, 1);
  }
  assert.match(output(), /must have a Nest user account/);
  assert.equal(selected("agent-configs").length, 0);
  assert.equal(selected("disconnect").length, 4);
});

test("prompt upgrade previews preserve data while confirmed upgrades record the administrator identity", async () => {
  process.env.ADMIN = " OWNER@EXAMPLE.TEST ";
  const { capabilities, ...settings } = defaultAgentConfiguration("ask-nest");
  let row = { ...settings, capabilitiesJson: JSON.stringify(capabilities), revision: 1, updatedAt: new Date(), instructions: LEGACY_AGENT_INSTRUCTIONS["ask-nest"] };
  database.aiAgentConfig.findMany = operation("agent-configs", () => [row]);
  database.aiAgentConfig.findUnique = operation("agent-current", () => row);
  database.aiAgentConfig.findUniqueOrThrow = operation("agent-saved", () => row);
  database.aiAgentConfig.updateMany = operation("agent-save", ({ data }) => { row = { ...row, ...data }; return { count: 1 }; });
  database.aiAgentRevision = { create: operation("agent-revision", {}) };
  await run("upgrade-agent-prompts");
  assert.equal(process.exitCode, 0);
  assert.deepEqual(selected("user")[0].input.where, { email: "owner@example.test" });
  assert.match(output(), /"status": "pending"/);
  assert.equal(selected("agent-save").length, 0);
  await run("upgrade-agent-prompts", ["--apply"]);
  assert.equal(process.exitCode, 0);
  assert.equal(row.instructions, DEFAULT_AGENT_INSTRUCTIONS["ask-nest"]);
  assert.equal(row.revision, 2);
  assert.equal(selected("agent-save")[0].input.data.updatedByUserId, "admin");
  assert.equal(selected("agent-revision")[0].input.data.actorUserId, "admin");
  assert.match(output(), /"status": "updated"/);
  assert.equal(selected("disconnect").length, 2);
});

test("prompt upgrade conflicts fail without overwriting a newer saved configuration", async () => {
  const { capabilities, ...settings } = defaultAgentConfiguration("ask-nest");
  const row = { ...settings, capabilitiesJson: JSON.stringify(capabilities), revision: 1, updatedAt: new Date(), instructions: LEGACY_AGENT_INSTRUCTIONS["ask-nest"] };
  database.aiAgentConfig.findMany = operation("agent-configs", [row]);
  database.aiAgentConfig.findUnique = operation("agent-current", { ...row, revision: 2 });
  await run("upgrade-agent-prompts", ["--apply"]);
  assert.equal(process.exitCode, 1);
  assert.match(output(), /"status": "conflict"/);
  assert.equal(selected("agent-save").length, 0);
  assert.equal(selected("disconnect").length, 1);
});

for (const error of [new Error("Prompt store unavailable"), "failed"]) {
  test(`prompt upgrades report ${error instanceof Error ? "a provider error" : "a fallback error"} and always disconnect`, async () => {
    database.aiAgentConfig.findMany = async () => { throw error; };
    await run("upgrade-agent-prompts");
    assert.equal(process.exitCode, 1);
    assert.match(output(), error instanceof Error ? /Prompt store unavailable/ : /Prompt upgrade failed/);
    assert.equal(selected("disconnect").length, 1);
  });
}
