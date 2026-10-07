import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const today = new Date("2026-10-07T18:25:00Z");
const calls = [];
let statements, members, jobs, queuedStatus, deniedClaims, providerResult, beginFailure, pollFailure, failureRecorder;
const fields = ["NEXTAUTH_URL", "APP_URL", "CREDIT_CARD_REMINDER_CURRENCY", "PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN", "AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING", "AZURE_EMAIL_SENDER"];
const note = (operation, args) => calls.push({ operation, args });
const operations = (operation) => calls.filter((call) => call.operation === operation).map((call) => call.args);
class JobError extends Error {
  constructor(code, message, retryable = false) { super(message); this.code = code; this.retryable = retryable; }
}
const prisma = { workspaceMember: {
  async findMany(options) { note("members", options); return members; },
  async findFirst(options) { note("membership", options); return members.find((member) => member.workspaceId === options.where.workspaceId && member.user.id === options.where.userId) ?? null; },
} };
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/credit-card-statement-balances.ts", { namedExports: {
  async getOutstandingCreditCardStatements(db, options) { assert.equal(db, prisma); note("statements", options); return statements; },
} });
mock.module("../lib/in-app-notifications.ts", { namedExports: {
  async syncCreditCardDueNotificationsForAllUsers() { note("sync", {}); },
} });
mock.module("../lib/background-jobs.ts", { namedExports: {
  BackgroundJobError: JobError,
  async enqueueBackgroundJob(options) {
    note("enqueue", options);
    const id = `delivery-${jobs.size + 1}`;
    const job = { ...options, id, status: queuedStatus.shift() ?? "PENDING", payloadJson: JSON.stringify(options.payload) };
    jobs.set(id, job);
    return { job };
  },
  async claimBackgroundJob(options) {
    note("claim", options);
    const job = jobs.get(options.jobId);
    return job && !deniedClaims.has(options.jobId) ? { job, leaseToken: `lease-${job.id}` } : null;
  },
  async completeClaimedBackgroundJob(...args) { note("complete", args); },
  async failClaimedBackgroundJob(...args) { note("fail", args); return failureRecorder(args[2]); },
} });
const emailProviderMock = { namedExports: {
  KnownEmailSendStatus: { Succeeded: "Succeeded" },
  EmailClient: class {
    constructor(connectionString) { note("client", connectionString); }
    async beginSend(message, options) {
      note("send", { message, options });
      if (beginFailure) throw beginFailure;
      return { async pollUntilDone() { if (pollFailure) throw pollFailure; return providerResult; } };
    }
  },
} };
mock.module("@azure/communication-email", emailProviderMock);
mock.module(require.resolve("@azure/communication-email"), emailProviderMock);
assert.equal(require("@azure/communication-email").EmailClient, emailProviderMock.namedExports.EmailClient);
const { runCreditCardPaymentReminderJob: run, processReminderEmailDeliveryJob: deliver } = require("../lib/credit-card-payment-reminders.ts");

const member = (workspaceId = "home", email = "owner@example.test", name = "Owner", id = email) => ({ workspaceId, user: { id, email, name } });
const statement = (days = 0, overrides = {}) => ({
  workspaceId: "home", workspaceName: "Household", cardId: `card-${days}`, cardName: "Everyday Card", bankName: "Bank",
  last4Digit: "1234", statementMonth: 9, statementYear: 2026,
  paymentDueDate: new Date(Date.UTC(2026, 9, 7 + days)), outstandingCents: 12_345, ...overrides,
});
function storedJob(overrides = {}) {
  const job = { id: "stored", key: "daily-key", workspaceId: "home", userId: "owner@example.test", payloadJson: JSON.stringify({ reminderDate: today.toISOString() }), ...overrides };
  jobs.set(job.id, job);
  return job;
}

beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now: today });
  const previous = new Map(fields.map((key) => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  for (const key of fields) delete process.env[key];
  process.env.NEXTAUTH_URL = "https://nest.example.test";
  process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING = "fixture-only-provider";
  process.env.AZURE_EMAIL_SENDER = "reminders@example.test";
  statements = [statement()]; members = [member()]; jobs = new Map(); queuedStatus = []; deniedClaims = new Set();
  calls.length = 0;
  providerResult = { status: "Succeeded" }; beginFailure = null; pollFailure = null;
  failureRecorder = (error) => ({ failure: { code: error.code ?? "JOB_FAILED" } });
});

test("empty statements and missing email addresses never queue a reminder", async () => {
  statements = [];
  assert.deepEqual(await run(), { ok: true, dryRun: false, dueItemCount: 0, emailCount: 0, sentCount: 0, skippedCount: 0, errors: [] });
  assert.equal(operations("members").length, 0);
  assert.equal(operations("sync").length, 1);
  statements = [statement()]; members = [member("home", null)];
  assert.equal((await run()).emailCount, 0);
  members = [member("another-workspace")];
  assert.equal((await run()).emailCount, 0);
  assert.equal(operations("enqueue").length, 0);
  assert.equal(operations("send").length, 0);
});

test("dry runs count only scheduled statements and their workspace recipients without writes or delivery", async () => {
  statements = [-2, -1, 0, 1, 2, 3, 4, 5, 6].map((days) => statement(days));
  members.push(member("home", "partner@example.test"));
  const result = await run({ dryRun: true });
  assert.deepEqual(result, { ok: true, dryRun: true, dueItemCount: 6, emailCount: 2, sentCount: 0, skippedCount: 2, errors: [] });
  assert.deepEqual(operations("statements")[0], { activeOnly: true, dueBefore: new Date("2026-10-13T00:00:00Z") });
  assert.deepEqual(operations("members")[0].where.workspaceId, { in: ["home"] });
  for (const operation of ["sync", "enqueue", "client", "send"]) assert.equal(operations(operation).length, 0);
});

test("reminders group statements by workspace, escape untrusted text, and include exact statement links", async () => {
  const special = '<Owner & "family"\'s>';
  members = [member("home", "family@example.test", special), member("office", "office@example.test", null)];
  statements = [-2, -1, 0, 1, 3, 5].map((days) => statement(days, { workspaceName: special, cardName: special, outstandingCents: 100n }));
  statements.push(statement(1, { workspaceId: "office", workspaceName: "", bankName: null, outstandingCents: 3_250 }));
  const result = await run();
  assert.equal(result.sentCount, 2);
  const [home, office] = operations("send");
  assert.equal(home.message.senderAddress, "reminders@example.test");
  assert.deepEqual(home.message.recipients.to, [{ address: "family@example.test" }]);
  assert.match(home.message.content.subject, /6\.00 due$/);
  assert.match(home.message.content.html, /&lt;Owner &amp; &quot;family&quot;&#39;s&gt;/);
  assert.ok(!home.message.content.html.includes(special));
  for (const copy of ["overdue by 2 days", "overdue by 1 day", "due today", "due tomorrow", "due in 3 days", "due in 5 days"]) {
    assert.ok(home.message.content.plainText.includes(copy));
    assert.ok(home.message.content.html.includes(copy));
  }
  const links = [...home.message.content.plainText.matchAll(/https:\/\/[^\s]+/g)].map(([href]) => new URL(href));
  assert.equal(links.length, 7);
  assert.ok(links.every((link) => link.origin === "https://nest.example.test" && link.searchParams.get("workspaceId") === "home"));
  assert.equal(links.at(-1).searchParams.get("next"), "/credit-transactions");
  assert.match(office.message.content.plainText, /^Hi,/);
  assert.match(office.message.content.plainText, /your workspace/);
  assert.doesNotMatch(office.message.content.plainText, /Household|family|Bank/);
  const officeLink = new URL(/Manage payments: (.+)/.exec(office.message.content.plainText)[1]);
  assert.equal(officeLink.searchParams.get("workspaceId"), "office");
  assert.equal(officeLink.searchParams.get("next"), "/credit-transactions?cardId=card-1&month=9&year=2026");
  assert.match(home.options.operationId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.ok(operations("claim").every(({ leaseMs }) => leaseMs === 300_000));
  assert.ok(operations("complete").every(([, token, details]) => token.startsWith("lease-") && details.result.provider === "AZURE_COMMUNICATION_EMAIL"));
});

test("optional app URL and currency settings preserve readable emails and normalized delivery identities", async () => {
  delete process.env.NEXTAUTH_URL;
  process.env.APP_URL = "https://fallback.example.test/";
  process.env.CREDIT_CARD_REMINDER_CURRENCY = "USD";
  await run();
  assert.match(operations("send")[0].message.content.plainText, /https:\/\/fallback\.example\.test\/entry/);
  assert.match(operations("send")[0].message.content.subject, /US\$123\.45/);
  const first = operations("enqueue")[0];
  assert.equal(first.key, first.idempotencyKey);
  assert.match(first.key, /^2026-10-07:home:[\da-f]{20}$/);
  assert.ok(!first.key.includes("owner@example.test"));
  members = [member("home", " OWNER@EXAMPLE.TEST ")];
  delete process.env.APP_URL;
  await run();
  assert.equal(operations("enqueue")[1].key, first.key);
  assert.equal(operations("send")[1].options.operationId, operations("send")[0].options.operationId);
  const content = operations("send")[1].message.content;
  assert.doesNotMatch(content.html, /<a /);
  assert.doesNotMatch(content.plainText, /Manage payments:|View statement:/);
});

test("settled, running, and unclaimed deliveries are skipped without contacting the provider", async () => {
  members = ["done", "skipped", "running", "leased"].map((name) => member("home", `${name}@example.test`));
  queuedStatus = ["SUCCEEDED", "SKIPPED", "RUNNING", "PENDING"];
  deniedClaims.add("delivery-4");
  const result = await run();
  assert.equal(result.skippedCount, 4);
  assert.equal(result.sentCount, 0);
  assert.equal(operations("claim").length, 1);
  assert.equal(operations("send").length, 0);
  assert.deepEqual(await deliver("missing"), { status: "skipped" });
});

test("delivery limits queue remaining recipients for later runs and cap work at 500", async () => {
  for (const [setting, limit] of [["1", 1], ["0", 100], ["-1", 100], ["invalid", 100], ["1000", 500]]) {
    process.env.PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN = setting;
    members = Array.from({ length: limit + 1 }, (_, index) => member("home", `recipient-${index}@example.test`));
    const before = operations("send").length;
    const result = await run();
    assert.equal(result.emailCount, limit + 1);
    assert.equal(result.sentCount, limit);
    assert.equal(result.skippedCount, 1);
    assert.equal(operations("send").length - before, limit);
  }
});

test("missing email configuration and provider rejection return safe failure codes", async () => {
  for (const missing of ["AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING", "AZURE_EMAIL_SENDER"]) {
    const value = process.env[missing];
    delete process.env[missing];
    assert.deepEqual((await run()).errors, [{ code: "EMAIL_NOT_CONFIGURED", count: 1 }]);
    process.env[missing] = value;
  }
  providerResult = { status: "Failed" };
  assert.deepEqual((await run()).errors, [{ code: "EMAIL_PROVIDER_REJECTED", count: 1 }]);
  assert.equal(operations("fail").at(-1)[2].retryable, false);
  members.push(member("home", "second@example.test"));
  beginFailure = new Error("provider detail that must not reach the user");
  const failed = await run();
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.errors, [{ code: "EMAIL_PROVIDER_UNAVAILABLE", count: 2 }]);
  assert.equal(operations("fail").at(-1)[2].retryable, true);
  assert.doesNotMatch(JSON.stringify(failed), /provider detail/);
  beginFailure = null;
  pollFailure = new Error("poll failed");
  assert.equal((await run()).errors[0].code, "EMAIL_PROVIDER_UNAVAILABLE");
});

test("delivery failure remains a failure if recording it loses the lease or the database is unavailable", async () => {
  beginFailure = new Error("Unavailable");
  const job = storedJob();
  for (const recorder of [() => null, () => { throw new Error("Database unavailable"); }]) {
    failureRecorder = recorder;
    assert.deepEqual(await deliver(job.id), { status: "failed", code: "EMAIL_DELIVERY_FAILED" });
  }
});

test("queued reminders are rebuilt from current membership and outstanding balances before delivery", async () => {
  const job = storedJob();
  assert.deepEqual(await deliver(job.id), { status: "sent" });
  assert.deepEqual(operations("membership")[0].where, { workspaceId: "home", userId: "owner@example.test", user: { email: { not: null } } });
  assert.equal(operations("send").length, 1);
  members = [];
  assert.deepEqual(await deliver(job.id), { status: "skipped" });
  members = [member("home", null, "Owner", "owner@example.test")];
  assert.deepEqual(await deliver(job.id), { status: "skipped" });
  members = [member()]; statements = [statement(0, { workspaceId: "another-workspace" })];
  assert.deepEqual(await deliver(job.id), { status: "skipped" });
  assert.equal(operations("send").length, 1);
  assert.ok(operations("complete").slice(1).every(([, , result]) => result.skipped === true));
});

test("missing identity, delivery keys, and corrupt saved dates are skipped without delivery", async () => {
  for (const overrides of [
    { workspaceId: null }, { userId: null }, { key: null }, { payloadJson: null },
    { payloadJson: "{invalid" }, { payloadJson: JSON.stringify({ reminderDate: "not-a-date" }) },
    { payloadJson: JSON.stringify({ reminderDate: {} }) },
  ]) {
    const job = storedJob(overrides);
    assert.deepEqual(await deliver(job.id), { status: "skipped" });
  }
  assert.equal(operations("send").length, 0);
});
