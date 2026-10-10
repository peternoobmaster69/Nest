import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { afterEach, beforeEach, mock } from "node:test";
import { Prisma } from "@prisma/client";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-10T09:00:00Z");
const calls = [];
let jobs, integrations, responses, faults;
const environmentKeys = ["GMAIL_SYNC_MESSAGES_PER_SLICE", "GMAIL_SYNC_SLICES_PER_INVOCATION"];
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
const records = (name) => calls.filter((call) => call.name === name);

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === "OR") return value.some((condition) => matches(row, condition));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("lte" in value) return row[key] !== null && row[key] <= value.lte;
    }
    return row[key] === value;
  });
}
function project(row, select) {
  if (!row) return null;
  return structuredClone(select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row);
}
function update(row, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    row[key] = value && typeof value === "object" && "increment" in value ? (row[key] ?? 0) + value.increment : value;
  }
  row.updatedAt = new Date();
}
function model(name, table) {
  return Object.fromEntries(["create", "findUnique", "findUniqueOrThrow", "findFirst", "findMany", "update", "updateMany"].map((method) => [method, async (args) => {
    const operation = `${name}.${method}`;
    calls.push({ name: operation, args: structuredClone(args) });
    if (faults.has(operation)) await faults.get(operation)(args);
    const rows = table();
    if (method === "create") {
      if (rows.some((row) => row.activeScopeKey && row.activeScopeKey === args.data.activeScopeKey)) {
        throw new Prisma.PrismaClientKnownRequestError("Synthetic duplicate", { code: "P2002", clientVersion: "test" });
      }
      const row = job({ id: `job-${rows.length + 1}`, ...args.data });
      rows.push(row);
      return project(row);
    }
    const found = rows.filter((row) => matches(row, args.where));
    if (method === "findMany") return found.slice(0, args.take ?? found.length).map((row) => project(row, args.select));
    if (method.startsWith("find")) return project(found[0], args.select);
    for (const row of found) update(row, args.data);
    if (method === "updateMany") return { count: found.length };
    assert.ok(found.length, `No row for ${operation}`);
    return project(found[0], args.select);
  }]));
}
const prisma = { backgroundJob: model("job", () => jobs), gmailIntegration: model("integration", () => integrations) };
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/observability/logger.ts", { namedExports: { logEvent: () => {} } });
const { BackgroundJobError } = require("../lib/background-jobs.ts");
class GmailProviderError extends Error {
  constructor(code, safeMessage = code, retryable = false) {
    super(safeMessage);
    Object.assign(this, { code, safeMessage, retryable });
  }
}
function boundary(name) {
  return async (...args) => {
    calls.push({ name, args: structuredClone(args) });
    assert.ok(responses.has(name), `Unexpected boundary ${name}`);
    const response = responses.get(name);
    if (response instanceof Error) throw response;
    return typeof response === "function" ? response(...args) : structuredClone(response);
  };
}
mock.module("../lib/gmail.ts", { namedExports: {
  GmailProviderError,
  ...Object.fromEntries(["ensureActiveGmailAccessToken", "fetchGmailMessage", "fetchGmailMessageMetadata", "getGmailProfile", "listGmailHistoryPage", "listGmailMessagePage"].map((name) => [name, boundary(name)])),
} });
mock.module("../lib/credit-alert-ingest.ts", { namedExports: { ingestCreditAlert: boundary("ingestCreditAlert") } });
const { GMAIL_SYNC_JOB_TYPE, getGmailSyncJobKey, queueGmailSyncForIntegration, processGmailSyncQueue, runScheduledGmailSyncs } = require("../lib/gmail-sync-runner.ts");
function integration(extra = {}) {
  return { id: "inbox", workspaceId: "household", userId: "owner", lastSyncedAt: null, lastHistoryId: null, isActive: true, ...extra };
}
function job(extra = {}) {
  return { id: "job-1", type: "GMAIL_SYNC", key: "gmail:inbox", status: "PENDING", workspaceId: "household", userId: "owner",
    payloadJson: '{"integrationId":"inbox"}', checkpointJson: null, availableAt: now, createdAt: now, updatedAt: now,
    cancelRequestedAt: null, startedAt: null, leaseExpiresAt: null, leaseToken: null, attempts: 0, retryCount: 0,
    total: 0, current: 0, progress: 0, maxAttempts: 5, ...extra };
}
function checkpoint(extra = {}) {
  return { version: 1, mode: "query", pageToken: null, startHistoryId: null, highWaterHistoryId: null,
    scannedMessages: 0, processed: 0, duplicates: 0, ignored: 0, failed: 0, ...extra };
}
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  for (const key of environmentKeys) delete process.env[key];
  calls.length = 0; jobs = [job()]; integrations = [integration()]; faults = new Map();
  responses = new Map([
    ["ensureActiveGmailAccessToken", "synthetic-access"], ["getGmailProfile", { historyId: "100", messagesTotal: 10 }],
    ["listGmailMessagePage", { messages: [], nextPageToken: null }],
    ["listGmailHistoryPage", { messages: [], nextPageToken: null, historyId: "110" }],
    ["fetchGmailMessageMetadata", { subject: "UOB - Transaction Alert" }],
    ["fetchGmailMessage", { subject: "UOB - Transaction Alert", body: "Synthetic bank alert" }],
    ["ingestCreditAlert", { parseStatus: "PROCESSED" }],
  ]);
});
afterEach(() => {
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

test("an expired worker is recovered even when there are no pending Gmail jobs", async (t) => {
  jobs = [job({ status: "RUNNING", leaseToken: "abandoned", leaseExpiresAt: new Date(now.getTime() - 1) })];
  assert.deepEqual(await processGmailSyncQueue(), { processedSlices: 0 });
  assert.equal(jobs[0].status, "PENDING");
  assert.equal(jobs[0].errorCode, "LEASE_EXPIRED");
  assert.equal(jobs[0].retryCount, 1);
  t.mock.timers.tick(15_000);
  assert.deepEqual(await processGmailSyncQueue(), { processedSlices: 1 });
  assert.equal(jobs[0].status, "SUCCEEDED");
  assert.equal(integrations[0].lastHistoryId, "100");
});

test("retries resume a saved page without counting or importing its completed messages again", async (t) => {
  responses.set("listGmailMessagePage", { messages: [{ id: "first" }, { id: "second" }], nextPageToken: null });
  responses.set("fetchGmailMessageMetadata", (token, id) => {
    if (id === "second") throw new GmailProviderError("GMAIL_NETWORK_ERROR", "Retry later", true);
    return { subject: "Card Transaction Alert" };
  });
  await processGmailSyncQueue({ jobId: "job-1" });
  assert.equal(jobs[0].status, "PENDING");
  const stored = JSON.parse(jobs[0].checkpointJson);
  assert.equal(stored.processed, 1);
  assert.equal(stored.scannedMessages, 1);
  responses.set("fetchGmailMessageMetadata", { subject: "Card Transaction Alert" });
  t.mock.timers.tick(15_000);
  await processGmailSyncQueue({ jobId: "job-1" });
  assert.equal(jobs[0].status, "SUCCEEDED");
  assert.equal(JSON.parse(jobs[0].resultJson).scannedMessages, 2);
  assert.equal(JSON.parse(jobs[0].resultJson).processed, 2);
  assert.deepEqual(records("ingestCreditAlert").map(({ args }) => args[0].sourceMessageId), ["first", "second"]);
});

test("history pages containing many messages still respect the per-slice message limit", async () => {
  process.env.GMAIL_SYNC_MESSAGES_PER_SLICE = "2";
  integrations[0].lastHistoryId = "90";
  responses.set("listGmailHistoryPage", { messages: [{ id: "one" }, { id: "two" }, { id: "three" }], nextPageToken: null, historyId: "120" });
  await processGmailSyncQueue({ jobId: "job-1", maxSlices: 1 });
  assert.equal(records("ingestCreditAlert").length, 2);
  assert.equal(jobs[0].status, "PENDING");
  assert.equal(integrations[0].lastHistoryId, "90");
  await processGmailSyncQueue({ jobId: "job-1", maxSlices: 1 });
  assert.equal(records("listGmailHistoryPage").length, 1);
  assert.equal(records("ingestCreditAlert").length, 3);
  assert.equal(jobs[0].status, "SUCCEEDED");
  assert.equal(integrations[0].lastHistoryId, "120");
});

test("enqueue preserves workspace ownership and suppresses an already active inbox job", async () => {
  jobs = [];
  assert.equal(GMAIL_SYNC_JOB_TYPE, "GMAIL_SYNC");
  assert.equal(getGmailSyncJobKey("inbox"), "gmail:inbox");
  const first = await queueGmailSyncForIntegration(integrations[0]);
  const second = await queueGmailSyncForIntegration(integrations[0]);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.job.id, second.job.id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].workspaceId, "household");
  assert.equal(jobs[0].userId, "owner");
  assert.equal(jobs[0].message, "Gmail sync queued.");
  assert.equal(jobs[0].maxAttempts, 5);
  assert.deepEqual(JSON.parse(jobs[0].payloadJson), { integrationId: "inbox" });
});

test("empty or already leased queues do no provider work and report zero processed slices", async () => {
  jobs = [];
  assert.deepEqual(await processGmailSyncQueue(), { processedSlices: 0 });
  jobs = [job({ status: "RUNNING", leaseToken: "another-worker", leaseExpiresAt: new Date(now.getTime() + 60_000) })];
  assert.deepEqual(await processGmailSyncQueue({ jobId: "job-1" }), { processedSlices: 0 });
  assert.equal(records("ensureActiveGmailAccessToken").length, 0);
});

for (const payloadJson of [null, "{broken", "null", '{"integrationId":12}', '{"integrationId":""}']) {
  test(`invalid Gmail payload ${payloadJson} fails safely before reading provider data`, async () => {
    jobs[0].payloadJson = payloadJson;
    assert.deepEqual(await processGmailSyncQueue({ jobId: "job-1" }), { processedSlices: 1 });
    assert.equal(jobs[0].status, "FAILED");
    assert.equal(jobs[0].errorCode, "INVALID_JOB_PAYLOAD");
    assert.equal(records("ensureActiveGmailAccessToken").length, 0);
    assert.equal(records("integration.update").length, 0);
  });
}

for (const state of ["missing", "inactive"]) {
  test(`${state} integrations stop their claimed job without moving a cursor`, async () => {
    if (state === "missing") integrations = [];
    else integrations[0].isActive = false;
    await processGmailSyncQueue({ jobId: "job-1" });
    assert.equal(jobs[0].status, "FAILED");
    assert.equal(jobs[0].errorCode, "GMAIL_INTEGRATION_INACTIVE");
    assert.equal(records("ensureActiveGmailAccessToken").length, 0);
    assert.equal(records("integration.update").length, 0);
  });
}

for (const saved of ["{broken", "null", JSON.stringify({ version: 2, mode: "query" }), JSON.stringify({ version: 1, mode: "legacy" })]) {
  test(`unreadable checkpoint ${saved} resumes from the integration's durable history cursor`, async () => {
    jobs[0].checkpointJson = saved;
    integrations[0].lastHistoryId = "50";
    await processGmailSyncQueue({ jobId: "job-1" });
    assert.equal(jobs[0].status, "SUCCEEDED");
    assert.equal(records("listGmailHistoryPage")[0].args[0].startHistoryId, "50");
    const result = JSON.parse(jobs[0].resultJson);
    assert.equal(result.scannedMessages, 0);
    assert.equal(result.highWaterHistoryId, "110");
    assert.equal(records("listGmailMessagePage").length, 0);
  });
}

for (const ignored of [undefined, -1, 4]) {
  test(`legacy checkpoints normalize ignored count ${ignored} without resetting valid cursor progress`, async () => {
    jobs[0].checkpointJson = JSON.stringify(checkpoint({ mode: "history", startHistoryId: "70", pageToken: "page-two", highWaterHistoryId: "90", ignored }));
    responses.set("listGmailHistoryPage", { messages: [], nextPageToken: null, historyId: null });
    await processGmailSyncQueue({ jobId: "job-1" });
    assert.equal(records("getGmailProfile").length, 0);
    assert.equal(records("listGmailHistoryPage")[0].args[0].pageToken, "page-two");
    const result = JSON.parse(jobs[0].resultJson);
    assert.equal(result.ignored, ignored === 4 ? 4 : 0);
    assert.equal(integrations[0].lastHistoryId, "90");
  });
}

test("malformed saved message lists are reloaded from their page cursor", async () => {
  jobs[0].checkpointJson = JSON.stringify(checkpoint({ pendingMessageIds: [12], pageToken: "saved-page" }));
  await processGmailSyncQueue({ jobId: "job-1" });
  assert.equal(records("listGmailMessagePage")[0].args[0].pageToken, "saved-page");
  assert.equal(jobs[0].status, "SUCCEEDED");
});

test("expired Gmail history falls back to a bounded subject query and replaces the obsolete page token", async () => {
  const lastSyncedAt = new Date(now.getTime() - 600_000);
  integrations[0].lastSyncedAt = lastSyncedAt;
  jobs[0].checkpointJson = JSON.stringify(checkpoint({ mode: "history", startHistoryId: "old", pageToken: "obsolete-page" }));
  responses.set("listGmailHistoryPage", new GmailProviderError("GMAIL_HISTORY_EXPIRED"));
  await processGmailSyncQueue({ jobId: "job-1", origin: "https://nest.example.test" });
  assert.deepEqual(records("ensureActiveGmailAccessToken")[0].args, ["inbox", "https://nest.example.test"]);
  const query = records("listGmailMessagePage")[0].args[0];
  assert.equal(query.pageToken, null);
  assert.equal(query.maxResults, 50);
  assert.ok(query.q.includes(`after:${Math.floor((lastSyncedAt.getTime() - 900_000) / 1000)}`));
  assert.match(query.q, /subject:"Card Transaction Alert"/);
  assert.equal(JSON.parse(jobs[0].resultJson).mode, "query");
  assert.equal(integrations[0].lastHistoryId, "100");
});

test("a history checkpoint without a start cursor uses the safe query fallback", async () => {
  jobs[0].checkpointJson = JSON.stringify(checkpoint({ mode: "history" }));
  await processGmailSyncQueue({ jobId: "job-1" });
  assert.equal(records("listGmailHistoryPage").length, 0);
  assert.match(records("listGmailMessagePage")[0].args[0].q, /^newer_than:30d /);
});

test("metadata filtering, parse failures and both duplicate responses produce accurate progress without reading unrelated mail", async () => {
  const ids = ["newsletter", "processed", "source-duplicate", "content-duplicate", "unparsed", "no-result", "gone"];
  responses.set("listGmailMessagePage", { messages: ids.map((id) => ({ id })), nextPageToken: null });
  responses.set("fetchGmailMessageMetadata", (token, id) => {
    if (id === "gone") throw new GmailProviderError("GMAIL_MESSAGE_GONE");
    return { subject: id === "newsletter" ? "Unrelated weekly newsletter" : "Card Transaction Alert" };
  });
  responses.set("ingestCreditAlert", ({ sourceMessageId }) => ({
    processed: { parseStatus: "PROCESSED" }, "source-duplicate": { duplicate: true },
    "content-duplicate": { duplicate: false, parseStatus: "DUPLICATE" }, unparsed: { parseStatus: "FAILED" }, "no-result": {},
  })[sourceMessageId]);
  await processGmailSyncQueue({ jobId: "job-1" });
  assert.equal(jobs[0].status, "SUCCEEDED");
  assert.deepEqual(records("fetchGmailMessage").map(({ args }) => args[1]), ids.slice(1, -1));
  assert.equal(records("ingestCreditAlert").length, 5);
  for (const { args: [payload] } of records("ingestCreditAlert")) {
    assert.equal(payload.workspaceId, "household");
    assert.equal(payload.source, "GMAIL");
    assert.equal(payload.rawBody, "Synthetic bank alert");
    assert.equal(payload.rawSubject, "UOB - Transaction Alert");
  }
  const summary = JSON.parse(jobs[0].resultJson);
  assert.deepEqual([summary.scannedMessages, summary.processed, summary.duplicates, summary.ignored, summary.failed], [7, 1, 2, 1, 3]);
  assert.equal(jobs[0].current, 7);
  assert.equal(jobs[0].total, 7);
  assert.match(jobs[0].message, /completed with issues/);
});

test("pagination saves the next query cursor and advances the integration only after the final page", async () => {
  jobs[0].total = 20;
  responses.set("listGmailMessagePage", ({ pageToken }) => ({ messages: [{ id: pageToken ?? "first" }], nextPageToken: pageToken ? null : "second" }));
  assert.deepEqual(await processGmailSyncQueue({ jobId: "job-1", maxSlices: 1 }), { processedSlices: 1 });
  assert.equal(jobs[0].status, "PENDING");
  assert.equal(integrations[0].lastHistoryId, null);
  assert.equal(JSON.parse(jobs[0].checkpointJson).pageToken, "second");
  assert.equal(jobs[0].current, 1);
  assert.equal(jobs[0].total, 20);
  assert.deepEqual(await processGmailSyncQueue({ jobId: "job-1" }), { processedSlices: 1 });
  assert.equal(jobs[0].status, "SUCCEEDED");
  assert.equal(records("getGmailProfile").length, 1);
  assert.equal(records("listGmailMessagePage")[1].args[0].pageToken, "second");
  assert.equal(jobs[0].current, 2);
  assert.equal(jobs[0].total, 20);
  assert.equal(JSON.parse(jobs[0].resultJson).processed, 2);
});

test("the next provider page survives a retry partway through the current page", async (t) => {
  responses.set("listGmailMessagePage", ({ pageToken }) => pageToken === "second-page"
    ? { messages: [{ id: "third" }], nextPageToken: null }
    : { messages: [{ id: "first" }, { id: "second" }], nextPageToken: "second-page" });
  responses.set("fetchGmailMessageMetadata", (token, id) => {
    if (id === "second") throw new GmailProviderError("GMAIL_NETWORK_ERROR", "Retry later", true);
    return { subject: "Card Transaction Alert" };
  });
  await processGmailSyncQueue({ jobId: "job-1" });
  assert.equal(JSON.parse(jobs[0].checkpointJson).nextPageToken, "second-page");
  responses.set("fetchGmailMessageMetadata", { subject: "Card Transaction Alert" });
  t.mock.timers.tick(15_000);
  assert.deepEqual(await processGmailSyncQueue({ jobId: "job-1" }), { processedSlices: 2 });
  assert.deepEqual(records("listGmailMessagePage").map(({ args }) => args[0].pageToken), [null, "second-page"]);
  assert.deepEqual(records("ingestCreditAlert").map(({ args }) => args[0].sourceMessageId), ["first", "second", "third"]);
});

for (const [boundaryName, error, status, code] of [
  ["listGmailHistoryPage", new Error("Private provider response"), "FAILED", "JOB_FAILED"],
  ["listGmailHistoryPage", new GmailProviderError("GMAIL_RECONNECT_REQUIRED", "Reconnect Gmail"), "FAILED", "GMAIL_RECONNECT_REQUIRED"],
  ["fetchGmailMessage", new Error("Private provider response"), "FAILED", "JOB_FAILED"],
  ["fetchGmailMessage", new GmailProviderError("GMAIL_TEMPORARILY_UNAVAILABLE", "Retry later", true), "PENDING", "GMAIL_TEMPORARILY_UNAVAILABLE"],
  ["ingestCreditAlert", new BackgroundJobError("INGEST_FAILED", "Could not import alert"), "FAILED", "INGEST_FAILED"],
]) {
  test(`${boundaryName} failure ${code} preserves the durable integration cursor and respects retryability`, async () => {
    integrations[0].lastHistoryId = "old-history";
    responses.set("listGmailHistoryPage", { messages: [{ id: "alert" }], nextPageToken: null, historyId: "new-history" });
    responses.set(boundaryName, error);
    await processGmailSyncQueue({ jobId: "job-1" });
    assert.equal(jobs[0].status, status);
    assert.equal(jobs[0].errorCode, code);
    assert.doesNotMatch(jobs[0].message, /Private provider response/);
    assert.equal(integrations[0].lastHistoryId, "old-history");
    assert.equal(records("integration.update").length, 0);
  });
}

test("cancellation arriving during an empty provider page is honored before advancing the cursor", async () => {
  responses.set("listGmailMessagePage", () => {
    jobs[0].cancelRequestedAt = now;
    return { messages: [], nextPageToken: null };
  });
  await processGmailSyncQueue({ jobId: "job-1" });
  assert.equal(records("integration.update").length, 0);
  assert.equal(records("ingestCreditAlert").length, 0);
  assert.equal(jobs[0].status, "CANCELLED");
  assert.ok(jobs[0].cancelRequestedAt);
});

test("cooperative cancellation stops the job before reading the next message", async () => {
  responses.set("listGmailMessagePage", { messages: [{ id: "first" }, { id: "second" }], nextPageToken: null });
  faults.set("job.findFirst", (args) => {
    if (args.select?.cancelRequestedAt) jobs[0].cancelRequestedAt = now;
  });
  await processGmailSyncQueue({ jobId: "job-1" });
  assert.equal(jobs[0].status, "CANCELLED");
  assert.equal(records("fetchGmailMessageMetadata").length, 0);
  assert.equal(records("integration.update").length, 0);
});

test("a lost lease cannot mark another worker's job failed or overwrite its integration cursor", async () => {
  responses.set("ensureActiveGmailAccessToken", () => { jobs[0].leaseToken = "replacement-worker"; return "synthetic-access"; });
  await processGmailSyncQueue({ jobId: "job-1" });
  assert.equal(jobs[0].status, "RUNNING");
  assert.equal(jobs[0].leaseToken, "replacement-worker");
  assert.equal(jobs[0].retryCount, 0);
  assert.equal(records("integration.update").length, 0);
});

test("scheduled syncs skip recent or inactive inboxes, suppress active work, and process newly queued work", async () => {
  jobs = [];
  integrations = [integration(), integration({ id: "new-inbox" }), integration({ id: "recent", lastSyncedAt: now }), integration({ id: "inactive", isActive: false })];
  await queueGmailSyncForIntegration(integrations[0]);
  Object.assign(jobs[0], { status: "RUNNING", leaseToken: "other", leaseExpiresAt: new Date(now.getTime() + 300_000) });
  assert.deepEqual(await runScheduledGmailSyncs(), { queued: 1, suppressed: 1, processedSlices: 1 });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].status, "RUNNING");
  assert.equal(jobs[1].status, "SUCCEEDED");
  assert.deepEqual(records("ensureActiveGmailAccessToken").map(({ args }) => args[0]), ["new-inbox"]);
});

for (const [value, expected] of [[undefined, 50], ["bad", 50], ["0", 50], ["2.5", 50], ["500", 100], ["3", 3]]) {
  test(`message limit configuration ${value} produces a bounded provider request`, async () => {
    if (value !== undefined) process.env.GMAIL_SYNC_MESSAGES_PER_SLICE = value;
    await processGmailSyncQueue({ jobId: "job-1" });
    assert.equal(records("listGmailMessagePage")[0].args[0].maxResults, expected);
  });
}

for (const [options, configured, expected] of [[{}, undefined, 4], [{}, "2", 2], [{}, "100", 10], [{ maxSlices: 20 }, "1", 10], [{ maxSlices: 0 }, undefined, 1]]) {
  test(`queue processing observes its invocation limit ${JSON.stringify(options)} and configuration ${configured}`, async () => {
    if (configured !== undefined) process.env.GMAIL_SYNC_SLICES_PER_INVOCATION = configured;
    responses.set("listGmailMessagePage", { messages: [], nextPageToken: "another-page" });
    assert.deepEqual(await processGmailSyncQueue(options), { processedSlices: expected });
    assert.equal(jobs[0].attempts, expected);
    assert.equal(jobs[0].status, "PENDING");
    assert.equal(records("integration.update").length, 0);
  });
}
