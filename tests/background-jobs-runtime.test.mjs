import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";
import { Prisma } from "@prisma/client";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-07T12:00:00Z");
let current, responses;
const calls = [];
const records = (method) => calls.filter((call) => call.method === method).map((call) => call.args);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const databaseError = (code, meta) => new Prisma.PrismaClientKnownRequestError("private database details", { code, clientVersion: "test", meta });
function job(overrides = {}) {
  return { id: "job-1", type: "SYNC", key: "account-1", status: "PENDING", workspaceId: "workspace", userId: "owner",
    createdAt: now, updatedAt: now, startedAt: null, availableAt: now, leaseExpiresAt: null, cancelRequestedAt: null,
    retryCount: 0, maxAttempts: 5, attempts: 0, progress: 0, current: 0, total: 0, message: null, errorCode: null, ...overrides };
}
const prisma = { backgroundJob: Object.fromEntries(["create", "findUnique", "findUniqueOrThrow", "findFirst", "findMany", "update", "updateMany"].map((method) => [method, async (args) => {
  calls.push({ method, args });
  if (responses.has(method)) {
    const response = responses.get(method);
    if (response instanceof Error) throw response;
    return typeof response === "function" ? response(args) : response;
  }
  if (method === "findMany") return [];
  if (method === "updateMany") return { count: 1 };
  if (method === "create" || method === "update") return { ...current, ...args.data };
  return current;
}])) };
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/observability/logger.ts", { namedExports: { logEvent: (...args) => calls.push({ method: "log", args }) } });
const {
  BackgroundJobError, enqueueBackgroundJob: enqueue, claimBackgroundJob: claim, heartbeatBackgroundJob: heartbeat,
  continueBackgroundJob: continueJob, completeClaimedBackgroundJob: complete, failClaimedBackgroundJob: fail,
  requestBackgroundJobCancellation: cancel, throwIfBackgroundJobCancelled: checkCancellation,
  retryBackgroundJob: retry, findLatestBackgroundJob: latest, backgroundJobToProgress: progress, sanitizeBackgroundJobError: sanitize,
} = require("../lib/background-jobs.ts");
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  current = job(); responses = new Map(); calls.length = 0;
});

test("enqueue persists scoped identities and defaults while bounding attempts and serializing checkpoints", async () => {
  const result = await enqueue({ type: "SYNC", key: "account-1" });
  assert.equal(result.created, true);
  assert.equal(result.duplicateReason, null);
  const initial = records("create")[0].data;
  assert.equal(initial.activeScopeKey, digest("SYNC\0account-1"));
  assert.equal(initial.idempotencyKey, null);
  assert.equal(initial.workspaceId, null);
  assert.equal(initial.userId, null);
  assert.equal(initial.payloadJson, null);
  assert.equal(initial.checkpointJson, null);
  assert.equal(initial.maxAttempts, 5);
  assert.equal(initial.message, "Job queued.");
  assert.deepEqual(initial.availableAt, now);
  const availableAt = new Date(now.getTime() + 10_000);
  await enqueue({ type: "SYNC", key: "", idempotencyKey: "same-request", workspaceId: "workspace", userId: "owner", payload: { page: 1 }, checkpoint: null, message: "Read mail", maxAttempts: 30, availableAt });
  const explicit = records("create")[1].data;
  assert.equal(explicit.activeScopeKey, null);
  assert.equal(explicit.idempotencyKey, digest("SYNC\0same-request"));
  assert.equal(explicit.payloadJson, '{"page":1}');
  assert.equal(explicit.checkpointJson, "null");
  assert.equal(explicit.maxAttempts, 25);
  assert.equal(explicit.message, "Read mail");
  assert.equal(explicit.availableAt, availableAt);
  await enqueue({ type: "SYNC", key: "account-1", maxAttempts: 0 });
  assert.equal(records("create")[2].data.maxAttempts, 1);
});

test("unique conflicts reuse the existing scope or idempotent request and never hide unrelated database failures", async () => {
  const conflict = databaseError("P2002");
  responses.set("create", conflict);
  for (const [input, expected, filters] of [
    [{ type: "SYNC", key: "account-1" }, "active", [{ activeScopeKey: digest("SYNC\0account-1") }]],
    [{ type: "SYNC", key: "", idempotencyKey: "request" }, "idempotent", [{ idempotencyKey: digest("SYNC\0request") }]],
  ]) {
    current = job({ idempotencyKey: digest("SYNC\0request") });
    const result = await enqueue(input);
    assert.equal(result.created, false);
    assert.equal(result.duplicateReason, expected);
    assert.deepEqual(records("findFirst").at(-1).where.OR, filters);
    assert.deepEqual(records("update").at(-1).data, { duplicateCount: { increment: 1 } });
  }
  responses.set("findFirst", null);
  await assert.rejects(enqueue({ type: "SYNC", key: "account-1" }), (error) => error === conflict);
  for (const error of [new Error("network failed"), databaseError("P2003")]) {
    responses.set("create", error);
    await assert.rejects(enqueue({ type: "SYNC", key: "account-1" }), (value) => value === error);
  }
});

test("claim returns only an atomically acquired lease and preserves the initial start date on retries", async () => {
  for (const startedAt of [null, new Date(now.getTime() - 60_000)]) {
    current = job({ startedAt });
    let attempts = 0;
    responses.set("updateMany", () => ({ count: ++attempts === 2 ? 1 : 0 }));
    const result = await claim({ jobId: "job-1", type: "SYNC", leaseMs: 120_000 });
    assert.equal(result.job.id, "job-1");
    assert.match(result.leaseToken, /^[\da-f-]{36}$/);
    const { where, data } = records("updateMany").at(-1);
    assert.deepEqual(where, { id: "job-1", status: "PENDING", availableAt: { lte: now }, cancelRequestedAt: null });
    assert.equal(data.leaseToken, result.leaseToken);
    assert.deepEqual(data.leaseExpiresAt, new Date(now.getTime() + 120_000));
    assert.deepEqual(data.startedAt, startedAt ?? now);
    assert.deepEqual(data.attempts, { increment: 1 });
  }
  responses.set("updateMany", { count: 0 });
  const attemptsBefore = records("updateMany").length;
  assert.equal(await claim({}), null);
  assert.equal(records("updateMany").length - attemptsBefore, 4);
  responses.set("findFirst", null);
  assert.equal(await claim({ type: "OTHER" }), null);
  assert.equal(records("findMany").at(-1).where.type, "OTHER");
});

test("expired workers are cancelled, retried with backoff, or dead-lettered before new work is claimed", async () => {
  responses.set("findMany", [{ id: "job-1" }]);
  responses.set("findFirst", null);
  for (const value of [null, job({ status: "SUCCEEDED" }), job({ status: "RUNNING" }), job({ status: "RUNNING", leaseExpiresAt: new Date(now.getTime() + 1) })]) {
    current = value;
    await claim({});
  }
  assert.equal(records("updateMany").length, 0);
  for (const [overrides, expected] of [
    [{ cancelRequestedAt: now }, "CANCELLED"],
    [{ retryCount: 0 }, "PENDING"],
    [{ retryCount: 4 }, "DEAD_LETTER"],
  ]) {
    current = job({ status: "RUNNING", leaseExpiresAt: now, ...overrides });
    assert.equal(await claim({}), null);
    const update = records("updateMany").at(-1);
    assert.equal(update.data.status, expected);
    assert.deepEqual(update.where, { id: "job-1", status: "RUNNING", leaseExpiresAt: { lte: now } });
    assert.equal(update.data.leaseToken, null);
    if (expected === "PENDING") assert.deepEqual(update.data.availableAt, new Date(now.getTime() + 15_000));
    else assert.equal(update.data.activeScopeKey, null);
  }
});

test("heartbeats extend only the caller's live lease and clamp progress without overwriting omitted fields", async () => {
  await heartbeat("job-1", "lease-1", {});
  const initial = records("updateMany")[0];
  assert.deepEqual(initial.where, { id: "job-1", status: "RUNNING", leaseToken: "lease-1", cancelRequestedAt: null });
  assert.equal(initial.data.progress, undefined);
  assert.equal(initial.data.checkpointJson, undefined);
  assert.deepEqual(initial.data.leaseExpiresAt, new Date(now.getTime() + 300_000));
  await heartbeat("job-1", "lease-1", { progress: 120, checkpoint: { cursor: "next" }, message: "Working", total: 20, current: 3, leaseMs: 1000 });
  assert.equal(records("updateMany").at(-1).data.progress, 100);
  assert.equal(records("updateMany").at(-1).data.checkpointJson, '{"cursor":"next"}');
  responses.set("updateMany", { count: 0 });
  await assert.rejects(heartbeat("job-1", "expired", { progress: -10 }), { code: "LEASE_LOST" });
  assert.equal(records("updateMany").at(-1).data.progress, 0);
});

test("continuation releases the lease with a saved cursor and a controlled retry time", async () => {
  for (const [options, delay, expectedProgress] of [
    [{ checkpoint: { page: 2 }, message: "Next page" }, 0, undefined],
    [{ checkpoint: { page: 3 }, message: "Continue", delayMs: 2000, progress: 33.6, current: 4, total: 12 }, 2000, 34],
  ]) {
    await continueJob("job-1", "lease-1", options);
    const update = records("updateMany").at(-1);
    assert.equal(update.where.leaseToken, "lease-1");
    assert.equal(update.where.cancelRequestedAt, null);
    assert.equal(update.data.status, "PENDING");
    assert.equal(update.data.leaseToken, null);
    assert.equal(update.data.progress, expectedProgress);
    assert.deepEqual(update.data.availableAt, new Date(now.getTime() + delay));
    assert.equal(update.data.checkpointJson, JSON.stringify(options.checkpoint));
  }
  responses.set("updateMany", { count: 0 });
  await assert.rejects(continueJob("job-1", "expired", { checkpoint: {}, message: "Next" }), { code: "LEASE_LOST" });
});

test("completion releases scope ownership, clears errors, and cannot complete another worker's job", async () => {
  for (const [params, status, resultJson] of [[{ message: "Done" }, "SUCCEEDED", undefined], [{ message: "No longer needed", skipped: true, result: { sent: 0 } }, "SKIPPED", '{"sent":0}']]) {
    await complete("job-1", "lease-1", params);
    const update = records("updateMany").at(-1);
    assert.deepEqual(update.where, { id: "job-1", status: "RUNNING", leaseToken: "lease-1" });
    assert.equal(update.data.status, status);
    assert.equal(update.data.resultJson, resultJson);
    for (const field of ["activeScopeKey", "errorCode", "error", "leaseToken", "lockedAt", "leaseExpiresAt"]) assert.equal(update.data[field], null);
  }
  responses.set("updateMany", { count: 0 });
  await assert.rejects(complete("job-1", "expired", { message: "Done" }), { code: "LEASE_LOST" });
});

test("failure handling honors cancellation, bounded exponential backoff, terminal errors, and lost leases", async () => {
  responses.set("findFirst", null);
  assert.equal(await fail("missing", "lease", new Error("private")), null);
  responses.delete("findFirst");
  current = job({ status: "RUNNING", cancelRequestedAt: now });
  assert.equal((await fail("job-1", "lease", new Error("private"))).retrying, false);
  assert.equal(records("updateMany").at(-1).data.status, "CANCELLED");
  responses.set("updateMany", { count: 0 });
  assert.equal(await fail("job-1", "lease", new Error("private")), null);
  responses.delete("updateMany");
  for (const [retryCount, maxAttempts, retryable, status, delay] of [[0, 5, true, "PENDING", 15_000], [20, 25, true, "PENDING", 1_800_000], [4, 5, true, "DEAD_LETTER", null], [0, 5, false, "FAILED", null]]) {
    current = job({ status: "RUNNING", retryCount, maxAttempts });
    const failure = new BackgroundJobError("SAFE_FAILURE", "Safe user message", retryable);
    const result = await fail("job-1", "lease", failure);
    assert.equal(result.retrying, status === "PENDING");
    assert.equal(result.failure.message, "Safe user message");
    const update = records("updateMany").at(-1);
    assert.equal(update.where.leaseToken, "lease");
    assert.equal(update.data.status, status);
    assert.equal(update.data.retryCount, retryCount + 1);
    if (delay !== null) assert.deepEqual(update.data.availableAt, new Date(now.getTime() + delay));
    else assert.equal(update.data.activeScopeKey, null);
  }
  responses.set("updateMany", { count: 0 });
  assert.equal(await fail("job-1", "lease", new Error("private")), null);
});

test("cancellation is immediate for queued work and cooperative for a running worker", async () => {
  for (const value of [null, job({ status: "SUCCEEDED" })]) { current = value; assert.equal(await cancel("job-1"), value); }
  assert.equal(records("update").length, 0);
  current = job();
  await cancel("job-1");
  assert.equal(records("update").at(-1).data.status, "CANCELLED");
  assert.equal(records("update").at(-1).data.activeScopeKey, null);
  current = job({ status: "RUNNING" });
  await cancel("job-1");
  assert.deepEqual(records("update").at(-1).data, { cancelRequestedAt: now, message: "Cancellation requested." });
  await checkCancellation("job-1", "lease");
  responses.set("findFirst", null);
  await assert.rejects(checkCancellation("job-1", "lease"), { code: "LEASE_LOST" });
  responses.delete("findFirst");
  current.cancelRequestedAt = now;
  await assert.rejects(checkCancellation("job-1", "lease"), { code: "JOB_CANCELLED" });
  assert.equal(records("updateMany").at(-1).data.status, "CANCELLED");
});

test("manual retries clear terminal state, retain the scope, and report a competing owner", async () => {
  for (const value of [null, job()]) { current = value; assert.equal(await retry("job-1"), null); }
  for (const status of ["FAILED", "DEAD_LETTER", "CANCELLED"]) {
    current = job({ status });
    assert.equal((await retry("job-1")).status, "PENDING");
    const data = records("update").at(-1).data;
    assert.equal(data.activeScopeKey, digest("SYNC\0account-1"));
    assert.equal(data.retryCount, 0);
    for (const field of ["leaseToken", "lockedAt", "leaseExpiresAt", "cancelRequestedAt", "deadLetteredAt", "finishedAt", "errorCode", "error"]) assert.equal(data[field], null);
  }
  responses.set("update", databaseError("P2002"));
  await assert.rejects(retry("job-1"), { code: "SCOPE_BUSY" });
  const error = databaseError("P2003"); responses.set("update", error);
  await assert.rejects(retry("job-1"), (value) => value === error);
});

test("progress covers terminal and unknown states and reports lease expiry without exposing raw errors", async () => {
  assert.equal(progress(null), null);
  for (const [status, phase] of [["SUCCEEDED", "complete"], ["SKIPPED", "complete"], ["FAILED", "error"], ["DEAD_LETTER", "error"], ["CANCELLED", "cancelled"], ["PENDING", "queued"], ["RUNNING", "writing"], ["UNKNOWN", "idle"]]) {
    assert.equal(progress(job({ status, total: null, current: null, progress: 200 })).phase, phase);
  }
  const expired = progress(job({ leaseExpiresAt: now, errorCode: "EXPIRED", total: null, current: null }));
  assert.equal(expired.errorCode, "EXPIRED"); assert.equal(expired.total, 0); assert.equal(expired.current, 0);
  assert.equal(progress(job({ leaseExpiresAt: new Date(now.getTime() + 1), message: "Working" })).message, "Working");
  assert.equal((await latest("SYNC", "account-1")).id, "job-1");
  assert.deepEqual(records("findFirst").at(-1), { where: { type: "SYNC", key: "account-1" }, orderBy: { updatedAt: "desc" } });
});

test("error sanitization retains only validated codes and deliberate safe messages", () => {
  for (const value of [undefined, null, new Error("private message"), { code: "spaces and secrets" }]) {
    assert.deepEqual(sanitize(value), { code: "JOB_FAILED", message: "The background job could not be completed.", retryable: false });
  }
  assert.deepEqual(sanitize({ code: "SAFE:123", safeMessage: "Retry later", retryable: true }), { code: "SAFE:123", message: "Retry later", retryable: true });
  for (const meta of [undefined, { constraint: "contains secret data" }, { constraint: {} }]) assert.equal(sanitize(databaseError("P2003", meta)).code, "P2003");
  assert.equal(sanitize(databaseError("P2003", { field_name: "safe_constraint" })).code, "P2003:safe_constraint");
  assert.equal(sanitize(databaseError("P2002")).code, "P2002");
  assert.equal(new BackgroundJobError("SAFE", "Safe").retryable, false);
});
