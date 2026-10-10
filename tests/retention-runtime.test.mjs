import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { afterEach, beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-10T00:00:00Z");
const operations = [
  "DELETE:IntegrationOAuthState", "DELETE:WebAuthnChallenge", "UPDATE:BackgroundJob", "DELETE:BackgroundJob",
  "UPDATE:CardAlertStaging", "DELETE:WorkspaceInvite", "DELETE:InAppNotification", "DELETE:WorkspaceAuditLog",
  "DELETE:LoginSession", "DELETE:MassiveMarketDataCache", "DELETE:SerpApiNewsCache", "DELETE:TransactionAgentDraft", "DELETE:SecurityRateLimit",
];
const envKeys = [
  "ASK_NEST_HISTORY_RETENTION_DAYS", "DATA_RETENTION_BATCH_SIZE", "BACKGROUND_JOB_PAYLOAD_RETENTION_DAYS", "BACKGROUND_JOB_RETENTION_DAYS",
  "CARD_ALERT_BODY_RETENTION_DAYS", "INVITE_RETENTION_DAYS", "READ_NOTIFICATION_RETENTION_DAYS", "NOTIFICATION_RETENTION_DAYS",
  "AUDIT_LOG_RETENTION_DAYS", "LOGIN_SESSION_RETENTION_DAYS",
];
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const calls = [];
let counts, turns, daily, memories, failOperation;
const keyForUsage = ({ day, workspaceId, userId }) => JSON.stringify([day, workspaceId, userId]);
function maybeFail(operation) {
  if (operation === failOperation) throw new Error(`Unavailable ${operation}`);
}
const tx = {
  $queryRaw: async (parts, ...values) => {
    const sql = parts.join("?").replace(/\s+/g, " ").trim();
    calls.push({ operation: "turns.select", sql, values });
    const scheduled = sql.includes("SELECT TOP");
    let selected;
    if (scheduled) {
      assert.match(sql, /WITH \(UPDLOCK, READPAST, ROWLOCK\)/);
      selected = turns.filter((turn) => turn.createdAt < values[1]).slice(0, values[0]);
    } else {
      assert.match(sql, /WITH \(UPDLOCK, HOLDLOCK, ROWLOCK\)/);
      assert.match(sql, /WHERE \[workspaceId\] = \? AND \[userId\] = \?/);
      selected = turns.filter((turn) => turn.workspaceId === values[0] && turn.userId === values[1]);
    }
    return structuredClone(selected);
  },
  askNestUsageDaily: { upsert: async (options) => {
    calls.push({ operation: "usage.upsert", options });
    maybeFail("usage.upsert");
    const key = keyForUsage(options.where.day_workspaceId_userId);
    const existing = daily.get(key);
    if (existing) {
      for (const [field, value] of Object.entries(options.update)) existing[field] += value.increment;
    } else daily.set(key, structuredClone(options.create));
  } },
  askNestMemory: { updateMany: async (options) => {
    calls.push({ operation: "memory.detach", options });
    maybeFail("memory.detach");
    for (const memory of memories) if (options.where.sourceTurnId.in.includes(memory.sourceTurnId)) memory.sourceTurnId = null;
  } },
  askNestTurn: { deleteMany: async (options) => {
    calls.push({ operation: "turns.delete", options });
    maybeFail("turns.delete");
    const ids = new Set(options.where.id.in);
    turns = turns.filter((turn) => !ids.has(turn.id));
  } },
};
mock.module("../lib/prisma.ts", { namedExports: { prisma: {
  $executeRaw: async (query) => {
    const sql = query.sql.replace(/\s+/g, " ").trim();
    const table = /\[dbo\]\.\[([^\]]+)\]/.exec(sql)?.[1];
    const operation = `${sql.split(" ")[0]}:${table}`;
    assert.ok(counts.has(operation), `Unexpected retention query: ${sql}`);
    calls.push({ operation, sql, values: query.values });
    const result = counts.get(operation);
    if (result instanceof Error) throw result;
    if (typeof result === "function") return result(query.values);
    return result.length ? result.shift() : 0;
  },
  $transaction: async (action) => {
    const snapshot = structuredClone({ turns, daily, memories });
    try { return await action(tx); }
    catch (error) { ({ turns, daily, memories } = snapshot); throw error; }
  },
} } });
const { runDataRetention } = require("../lib/data-retention.ts");
const { runAskNestRetention, clearAskNestHistoryPreservingUsage, getAskNestHistoryRetentionDays, getAskNestUsageDayKey } = require("../lib/ai/ask-nest-retention.ts");
const turn = (id, values = {}) => ({ id, workspaceId: "workspace-one", userId: "user-one", createdAt: new Date("2026-01-01T12:00:00Z"),
  inputTokens: 10, outputTokens: 5, totalTokens: 15, toolCallCount: 2, emptyResultCount: 1, durationMs: 100, feedbackRating: null, ...values });
beforeEach(() => {
  for (const name of envKeys) delete process.env[name];
  calls.length = 0;
  counts = new Map(operations.map((operation) => [operation, []]));
  turns = [];
  daily = new Map();
  memories = [];
  failOperation = null;
});
afterEach(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("cache cleanup continues when both cache tables return a full batch", async () => {
  process.env.DATA_RETENTION_BATCH_SIZE = "2";
  counts.set("DELETE:MassiveMarketDataCache", [2, 1]);
  counts.set("DELETE:SerpApiNewsCache", [2, 0]);
  const result = await runDataRetention({ now });
  assert.deepEqual(result.policies.expiredCaches, { affected: 5, batches: 2, hasMore: false });
  assert.equal(calls.filter(({ operation }) => operation === "DELETE:MassiveMarketDataCache").length, 2);
});

test("chat retention reports completion after draining an exact number of full batches", async () => {
  turns = Array.from({ length: 4 }, (_, index) => turn(String(index)));
  const result = await runAskNestRetention({ now, batchSize: 2 });
  assert.equal(result.processedTurns, 4);
  assert.equal(result.batches, 2);
  assert.equal(result.hasMore, false);
  assert.equal(turns.length, 0);
  assert.equal([...daily.values()][0].turnCount, 4);
});

test("retention queries bind bounded batch sizes and cutoffs while preserving active jobs and rate-limit blocks", async () => {
  const result = await runDataRetention({ now });
  assert.equal(calls.length, operations.length);
  assert.equal(result.config.batchSize, 250);
  assert.equal(result.config.jobPayloadDays, 14);
  assert.equal(result.config.backgroundJobDays, 90);
  assert.equal(result.config.cardAlertBodyDays, 7);
  assert.equal(result.config.inviteDays, 30);
  assert.equal(result.config.readNotificationDays, 90);
  assert.equal(result.config.notificationDays, 365);
  assert.equal(result.config.auditLogDays, 730);
  assert.equal(result.config.loginSessionDays, 90);
  for (const call of calls) {
    assert.equal(call.values[0], 250);
    assert.ok(call.values.slice(1).every((value) => value instanceof Date));
    assert.match(call.sql, /(?:DELETE|UPDATE) TOP \(\?\)/);
  }
  const payload = calls.find(({ operation }) => operation === "UPDATE:BackgroundJob");
  assert.equal(payload.values[1].toISOString(), "2026-09-26T00:00:00.000Z");
  assert.match(payload.sql, /SET \[payloadJson\] = NULL, \[checkpointJson\] = NULL, \[resultJson\] = NULL, \[error\] = NULL/);
  const jobs = calls.find(({ operation }) => operation === "DELETE:BackgroundJob");
  assert.match(jobs.sql, /\[status\] IN \(N'SUCCEEDED', N'SKIPPED', N'FAILED', N'DEAD_LETTER', N'CANCELLED'\)/);
  assert.doesNotMatch(jobs.sql, /N'RUNNING'|N'PENDING'/);
  assert.match(calls.find(({ operation }) => operation === "DELETE:SecurityRateLimit").sql, /\[blockedUntil\] IS NULL OR \[blockedUntil\] < \?/);
  assert.ok(Object.values(result.policies).every((policy) => policy.affected === 0 && policy.batches === 0 && !policy.hasMore));
});

test("retention configuration clamps extreme values and ignores invalid or blank inputs", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  for (const [input, expected] of [[" ", 250], ["2.5", 250], ["250; DROP TABLE users", 250], ["0", 1], ["1001", 1000], [" 4 ", 4]]) {
    process.env.DATA_RETENTION_BATCH_SIZE = input;
    assert.equal((await runDataRetention()).config.batchSize, expected);
  }
  process.env.BACKGROUND_JOB_PAYLOAD_RETENTION_DAYS = "0";
  process.env.BACKGROUND_JOB_RETENTION_DAYS = "99999";
  process.env.AUDIT_LOG_RETENTION_DAYS = "90";
  const result = await runDataRetention();
  assert.equal(result.now.getTime(), now.getTime());
  assert.equal(result.config.jobPayloadDays, 1);
  assert.equal(result.config.backgroundJobDays, 3650);
  assert.equal(result.config.auditLogDays, 90);
});

test("each data-retention policy stops after twenty batches and signals unfinished work", async () => {
  process.env.DATA_RETENTION_BATCH_SIZE = "2";
  counts.set("DELETE:IntegrationOAuthState", () => 2);
  counts.set("DELETE:WebAuthnChallenge", [2, 0]);
  const result = await runDataRetention({ now });
  assert.deepEqual(result.policies.oauthStates, { affected: 40, batches: 20, hasMore: true });
  assert.deepEqual(result.policies.webAuthnChallenges, { affected: 2, batches: 1, hasMore: false });
  assert.equal(calls.filter(({ operation }) => operation === "DELETE:IntegrationOAuthState").length, 20);
});

test("cleanup failures propagate without attempting later policies", async () => {
  const error = new Error("Database unavailable");
  counts.set("DELETE:WebAuthnChallenge", error);
  await assert.rejects(runDataRetention({ now }), (caught) => caught === error);
  assert.deepEqual(calls.map(({ operation }) => operation), ["DELETE:IntegrationOAuthState", "DELETE:WebAuthnChallenge"]);
});

test("chat retention configuration and Singapore day boundaries remain deterministic", () => {
  assert.equal(getAskNestHistoryRetentionDays(), 90);
  for (const [value, days] of [[" ", 90], ["1.5", 90], ["invalid", 90], ["-1", 30], ["99999", 3650], [" 60 ", 60]]) {
    process.env.ASK_NEST_HISTORY_RETENTION_DAYS = value;
    assert.equal(getAskNestHistoryRetentionDays(), days);
  }
  assert.equal(getAskNestUsageDayKey(new Date("2026-01-01T15:59:59Z")), "2026-01-01");
  assert.equal(getAskNestUsageDayKey(new Date("2026-01-01T16:00:00Z")), "2026-01-02");
  assert.throws(() => getAskNestUsageDayKey(new Date("invalid")), RangeError);
});

test("chat cleanup groups usage by workspace, user, and Singapore day and detaches only deleted source turns", async () => {
  turns = [
    turn("first", { createdAt: new Date("2026-01-01T15:59:59Z"), feedbackRating: "HELPFUL" }),
    turn("second", { inputTokens: null, outputTokens: null, totalTokens: null, durationMs: null, feedbackRating: "NOT_HELPFUL" }),
    turn("zero", { inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCallCount: 0, emptyResultCount: 0, durationMs: 0 }),
    turn("next-day", { createdAt: new Date("2026-01-01T16:00:00Z") }),
    turn("other-workspace", { workspaceId: "workspace-two" }),
    turn("other-user", { userId: "user-two" }),
    turn("recent", { createdAt: now }),
  ];
  memories = [{ id: "old", sourceTurnId: "first" }, { id: "kept", sourceTurnId: "recent" }];
  const result = await runAskNestRetention({ now });
  assert.equal(result.processedTurns, 6);
  assert.equal(result.summarizedDays, 4);
  assert.equal(result.hasMore, false);
  assert.deepEqual(turns.map(({ id }) => id), ["recent"]);
  assert.deepEqual(memories, [{ id: "old", sourceTurnId: null }, { id: "kept", sourceTurnId: "recent" }]);
  const usage = daily.get(keyForUsage({ day: "2026-01-01", workspaceId: "workspace-one", userId: "user-one" }));
  assert.deepEqual(usage, { day: "2026-01-01", workspaceId: "workspace-one", userId: "user-one", turnCount: 3, trackedTurnCount: 2,
    inputTokens: 10, outputTokens: 5, totalTokens: 15, toolCallCount: 4, emptyResultCount: 2, totalDurationMs: 100,
    feedbackCount: 2, helpfulCount: 1, notHelpfulCount: 1 });
  const sequence = calls.map(({ operation }) => operation);
  assert.ok(sequence.indexOf("usage.upsert") < sequence.indexOf("memory.detach"));
  assert.ok(sequence.indexOf("memory.detach") < sequence.indexOf("turns.delete"));
});

test("explicit history clearing is scoped and archives batches atomically without dropping usage", async () => {
  turns = Array.from({ length: 501 }, (_, index) => turn(`turn-${index}`, { createdAt: now }));
  turns.push(turn("other-user", { userId: "user-two" }), turn("other-workspace", { workspaceId: "workspace-two" }));
  const result = await clearAskNestHistoryPreservingUsage({ workspaceId: "workspace-one", userId: "user-one" });
  assert.deepEqual(result, { processed: 501, summaries: 3 });
  assert.deepEqual(calls.filter(({ operation }) => operation === "turns.delete").map(({ options }) => options.where.id.in.length), [250, 250, 1]);
  assert.deepEqual(turns.map(({ id }) => id), ["other-user", "other-workspace"]);
  assert.equal([...daily.values()][0].turnCount, 501);
  assert.deepEqual(await clearAskNestHistoryPreservingUsage({ workspaceId: "workspace-one", userId: "user-one" }), { processed: 0, summaries: 0 });
  assert.equal([...daily.values()][0].turnCount, 501);
});

test("chat cleanup rolls back summaries and memory detachment when deletion fails", async () => {
  turns = [turn("one")];
  memories = [{ id: "memory", sourceTurnId: "one" }];
  failOperation = "turns.delete";
  await assert.rejects(runAskNestRetention({ now }), /Unavailable turns.delete/);
  assert.equal(turns.length, 1);
  assert.equal(daily.size, 0);
  assert.equal(memories[0].sourceTurnId, "one");
  failOperation = null;
  assert.equal((await runAskNestRetention({ now })).processedTurns, 1);
  assert.equal([...daily.values()][0].turnCount, 1);
});

test("scheduled chat cleanup enforces twenty transactions per run and resumes without double counting", async () => {
  turns = Array.from({ length: 41 }, (_, index) => turn(String(index)));
  const first = await runAskNestRetention({ now, batchSize: 2 });
  assert.deepEqual([first.batches, first.processedTurns, first.hasMore], [20, 40, true]);
  assert.equal(turns.length, 1);
  const second = await runAskNestRetention({ now, batchSize: 2 });
  assert.deepEqual([second.batches, second.processedTurns, second.hasMore], [1, 1, false]);
  assert.equal([...daily.values()][0].turnCount, 41);
});

test("chat batch sizes are bounded for finite, fractional, and non-finite inputs", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  for (const [batchSize, expected] of [[undefined, 250], [0, 1], [-2, 1], [1.8, 1], [1000, 250], [Number.NaN, 250], [Infinity, 250]]) {
    calls.length = 0;
    const result = await runAskNestRetention({ batchSize });
    assert.equal(calls[0].values[0], expected);
    assert.equal(result.cutoff.toISOString(), "2026-07-12T00:00:00.000Z");
    assert.equal(result.processedTurns, 0);
    assert.equal(result.hasMore, false);
  }
});
