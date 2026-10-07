import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";
import { ApiRequestError } from "../lib/api/contracts.ts";
import { decodeCursor } from "../lib/api/pagination.ts";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-07T04:00:00Z");
const today = new Date("2026-10-07T00:00:00Z");
const calls = [];
let state;
const matching = (type) => calls.filter((call) => call.type === type);
function record(type, args) {
  calls.push({ type, args });
  if (state.failure?.type === type) throw state.failure.error;
}
const prisma = {
  async $executeRaw(sql) { record("execute", sql); return 1; },
  async $queryRaw(sql) { record("query", sql); return state.existing; },
  workspaceMember: { async findMany(args) { record("members", args); return state.members; } },
  inAppNotification: {
    async findFirst(args) { record("notification", args); return state.notification; },
    async findMany(args) { record("list", args); return state.list; },
    async count(args) { record("count", args); return state.unread; },
  },
};
class JobError extends Error {
  constructor(code, message, retryable) { super(message); this.code = code; this.retryable = retryable; }
}
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/api-security.ts", { namedExports: { ApiRequestError } });
mock.module("../lib/credit-card-statement-balances.ts", { namedExports: {
  async getOutstandingCreditCardStatements(db, options) {
    record("statements-database", db);
    record("statements", options);
    return state.cards.filter((card) => !options.workspaceId || card.workspaceId === options.workspaceId);
  },
} });
mock.module("../lib/web-push.ts", { namedExports: { async sendPushToUser(...args) { record("push", args); return state.delivery; } } });
mock.module("../lib/background-jobs.ts", { namedExports: {
  BackgroundJobError: JobError,
  async claimBackgroundJob(args) { record("claim", args); return state.claimed && { ...state.claimed, job: state.jobs.get(args.jobId) ?? state.claimed.job }; },
  async completeClaimedBackgroundJob(...args) { record("complete", args); },
  async failClaimedBackgroundJob(...args) { record("fail", args); },
  async enqueueBackgroundJob(args) {
    record("enqueue", args);
    const job = { id: `queued-${state.jobs.size}`, userId: args.userId, workspaceId: args.workspaceId, payloadJson: JSON.stringify(args.payload), status: state.queueStatus };
    state.jobs.set(job.id, job);
    return { job };
  },
} });
const { syncCreditCardDueNotificationsForUser: syncUser, syncCreditCardDueNotificationsForAllUsers: syncAll, processReminderPushDeliveryJob: deliver, listInAppNotifications: list, markInAppNotificationRead: markOne, markAllInAppNotificationsRead: markAll } = require("../lib/in-app-notifications.ts");
beforeEach((t) => {
  const fields = ["CREDIT_CARD_REMINDER_CURRENCY", "PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN"];
  const original = new Map(fields.map((key) => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of original) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  for (const key of fields) delete process.env[key];
  t.mock.timers.enable({ apis: ["Date"], now });
  calls.length = 0;
  state = {
    cards: [], members: [], existing: [], jobs: new Map(), queueStatus: "QUEUED", notification: null, list: [], unread: 0,
    delivery: { configured: true, sent: 1, failed: 0 }, failure: null,
    claimed: { job: { id: "delivery", userId: "owner", workspaceId: "home", payloadJson: '{"dedupeKey":"due-card"}' }, leaseToken: "lease" },
  };
});
const card = (days, workspaceId = "home", id = `card-${days}`) => ({
  workspaceId, cardId: id, cardName: "Travel card", last4Digit: "1234", statementYear: 2026, statementMonth: 9,
  paymentDueDate: new Date(today.getTime() + days * 86_400_000), outstandingCents: 2_500n,
});
const keyFor = (row) => `credit-card-due:${row.workspaceId}:${row.cardId}:${row.statementYear}:${row.statementMonth}`;
const sqlText = (sql) => sql.strings.join("?");
const merges = () => matching("execute").filter(({ args }) => sqlText(args).includes("MERGE"));

test("notification sync scopes due statements, formats each due state, and removes only stale user notifications", async () => {
  state.cards = [-2, -1, 0, 1, 2, 3, 4, 5, 6].map((days) => card(days));
  state.cards.push(card(0, "other"));
  state.existing = [{ dedupeKey: keyFor(state.cards[0]) }, { dedupeKey: "settled-statement" }];
  await syncUser("owner", "home");
  assert.equal(matching("statements-database")[0].args, prisma);
  assert.deepEqual(matching("statements")[0].args, { workspaceId: "home", activeOnly: true, dueBefore: new Date("2026-10-13T00:00:00Z") });
  assert.equal(merges().length, 8);
  const labels = ["2 days overdue", "1 day overdue", "due today", "due tomorrow", "due in 2 days", "due in 3 days", "due in 4 days", "due in 5 days"];
  for (const [index, { args: sql }] of merges().entries()) {
    assert.ok(sql.values.includes(`Travel card ending 1234 has $25.00 outstanding and is ${labels[index]}.`));
    assert.ok(sql.values.includes(keyFor(state.cards[index])));
    assert.ok(sql.values.includes("owner")); assert.ok(sql.values.includes("home"));
    const href = new URL(sql.values.find((value) => typeof value === "string" && value.startsWith("/entry?")), "https://nest.example.test");
    assert.equal(href.searchParams.get("workspaceId"), "home");
    const destination = new URL(href.searchParams.get("next"), "https://nest.example.test");
    assert.equal(destination.pathname, "/credit-transactions");
    assert.equal(destination.searchParams.get("cardId"), state.cards[index].cardId);
    assert.equal(destination.searchParams.get("month"), "9");
    assert.equal(destination.searchParams.get("year"), "2026");
    const metadata = JSON.parse(sql.values.find((value) => typeof value === "string" && value.startsWith('{"cardId"')));
    assert.equal(metadata.outstandingCents, 2_500);
    assert.equal(metadata.paymentDueDate, state.cards[index].paymentDueDate.toISOString());
    assert.ok(sql.values.includes([4, 6].includes(index) ? 0 : 1));
    assert.match(sqlText(sql), /ELSE target\.\[readAt\]/);
  }
  const deletions = matching("execute").filter(({ args }) => sqlText(args).includes("DELETE"));
  assert.equal(deletions.length, 1);
  assert.deepEqual(deletions[0].args.values, ["owner", "settled-statement"]);
  assert.equal(matching("enqueue").length, 0);
  assert.equal(matching("push").length, 0);
});

test("scheduled sync queues only reminder days and shares a delivery cap across users and workspaces", async () => {
  state.cards = [card(2), card(3), card(0), card(1, "second")];
  state.members = [{ userId: "owner", workspaceId: "home" }, { userId: "editor", workspaceId: "home" }, { userId: "guest", workspaceId: "second" }, { userId: "empty", workspaceId: "empty" }];
  process.env.PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN = "2";
  process.env.CREDIT_CARD_REMINDER_CURRENCY = "USD";
  await syncAll();
  assert.equal(merges().length, 7);
  assert.equal(matching("enqueue").length, 5);
  assert.equal(matching("push").length, 2);
  assert.ok(matching("push").every(({ args }) => args[0] === "owner"));
  assert.ok(matching("push")[0].args[1].message.includes("US$25.00"));
  for (const { args } of matching("enqueue")) {
    assert.equal(args.type, "CREDIT_CARD_PAYMENT_REMINDER_PUSH");
    assert.equal(args.key, `${today.toISOString()}:${args.userId}:${args.payload.dedupeKey}`);
    assert.equal(args.idempotencyKey, args.key);
    assert.equal(args.maxAttempts, 4);
    assert.ok(args.payload.dedupeKey.includes(args.workspaceId));
  }
  assert.deepEqual(matching("claim").map(({ args }) => args.leaseMs), [120_000, 120_000]);
  assert.equal(matching("query").length, 4);
});

test("completed, skipped, and running push jobs never send again, while invalid caps use the conservative default", async () => {
  state.cards = [card(0)]; state.members = [{ userId: "owner", workspaceId: "home" }];
  for (const status of ["SUCCEEDED", "SKIPPED", "RUNNING"]) {
    state.queueStatus = status;
    await syncAll();
  }
  assert.equal(matching("push").length, 0);
  assert.equal(matching("claim").length, 0);
  state.queueStatus = "FAILED";
  for (const limit of [undefined, "0", "-1", "invalid", "1.5", "999"]) {
    if (limit === undefined) delete process.env.PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN; else process.env.PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN = limit;
    await syncAll();
  }
  assert.equal(matching("push").length, 6);
  for (const [configuredLimit, recipients, sent] of [["invalid", 101, 100], ["999", 501, 500]]) {
    calls.length = 0;
    state.jobs.clear();
    state.members = Array.from({ length: recipients }, (_, index) => ({ userId: `owner-${index}`, workspaceId: "home" }));
    process.env.PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN = configuredLimit;
    await syncAll();
    assert.equal(matching("enqueue").length, recipients);
    assert.equal(matching("push").length, sent);
  }
});

test("claimed push deliveries report configured, unavailable, and partially failed providers without leaking errors", async () => {
  const prepared = { title: "Due today", message: "A payment is due", href: "/credit-transactions", tag: "statement" };
  state.claimed = null;
  assert.deepEqual(await deliver("delivery", prepared), { status: "skipped" });
  state.claimed = { job: { id: "delivery", userId: "owner" }, leaseToken: "lease" };
  for (const [result, status, skipped] of [[{ configured: true, sent: 1 }, "sent", false], [{ configured: true, sent: 0, failed: null }, "sent", false], [{ configured: false, sent: 0 }, "skipped", true]]) {
    state.delivery = result;
    assert.deepEqual(await deliver("delivery", prepared), { status });
    const [id, lease, details] = matching("complete").at(-1).args;
    assert.equal(id, "delivery"); assert.equal(lease, "lease");
    assert.deepEqual(details.result, { configured: result.configured, sent: result.sent });
    assert.equal(details.skipped, skipped);
  }
  state.delivery = { configured: true, sent: 1, failed: 1 };
  assert.deepEqual(await deliver("delivery", prepared), { status: "failed" });
  const error = matching("fail").at(-1).args[2];
  assert.equal(error.code, "PUSH_PROVIDER_UNAVAILABLE"); assert.equal(error.retryable, true);
  state.failure = { type: "push", error: new Error("Fixture provider failure") };
  assert.deepEqual(await deliver("delivery", prepared), { status: "failed" });
  assert.equal(matching("fail").at(-1).args[2], state.failure.error);
});

test("queued deliveries refresh current notifications and skip missing or invalid recipients and settled statements", async () => {
  const base = { id: "delivery", userId: "owner", workspaceId: "home" };
  for (const payloadJson of [undefined, "{", '{"dedupeKey":123}', '{"dedupeKey":"settled"}']) {
    state.claimed.job = { ...base, payloadJson };
    assert.deepEqual(await deliver("delivery"), { status: "skipped" });
    assert.equal(matching("complete").at(-1).args[2].skipped, true);
  }
  for (const job of [{ ...base, userId: null }, { ...base, workspaceId: null }]) {
    state.claimed.job = job;
    assert.deepEqual(await deliver("delivery"), { status: "skipped" });
  }
  assert.equal(matching("push").length, 0);
  state.claimed.job = { ...base, payloadJson: '{"dedupeKey":"current"}' };
  state.notification = { title: "Updated reminder", message: "Current outstanding amount", href: null, dedupeKey: "current" };
  assert.deepEqual(await deliver("delivery"), { status: "sent" });
  assert.deepEqual(matching("notification").at(-1).args.where, { userId: "owner", workspaceId: "home", dedupeKey: "current" });
  assert.deepEqual(matching("push").at(-1).args, ["owner", { title: "Updated reminder", message: "Current outstanding amount", href: "/credit-transactions", tag: "current" }]);
  state.notification.href = "/entry?workspaceId=home";
  await deliver("delivery");
  assert.equal(matching("push").at(-1).args[1].href, state.notification.href);
  state.claimed.job.userId = null;
  assert.deepEqual(await deliver("delivery", { title: "Private", message: "Private", href: "/", tag: "current" }), { status: "skipped" });
});

test("notification pagination rejects malformed cursors, scopes both reads, and preserves stable tie-breaking", async () => {
  for (const cursor of ["invalid", Buffer.from(JSON.stringify({ v: 1, id: "n", sortValue: "invalid-date" })).toString("base64url")]) {
    await assert.rejects(list("owner", "home", { limit: 1, cursor }), { status: 400, message: "Invalid notification cursor" });
  }
  assert.equal(matching("list").length, 0);
  state.list = [{ id: "notification-b", updatedAt: now }, { id: "notification-a", updatedAt: now }]; state.unread = 3;
  const first = await list("owner", "home", { limit: 1 });
  assert.equal(first.unreadCount, 3);
  assert.equal(first.page.items.length, 1);
  assert.equal(first.page.pageInfo.hasMore, true);
  assert.deepEqual(decodeCursor(first.page.pageInfo.nextCursor), { id: "notification-b", sortValue: now.toISOString() });
  const read = matching("list")[0].args;
  assert.deepEqual(read.where, { userId: "owner", workspaceId: "home", type: { in: ["CREDIT_CARD_DUE", "WORKSPACE_INVITATION"] } });
  assert.equal(read.take, 2);
  assert.deepEqual(read.orderBy, [{ updatedAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(matching("count")[0].args.where, { ...read.where, readAt: null });
  state.list = [];
  const next = await list("owner", "home", { limit: 1, cursor: first.page.pageInfo.nextCursor });
  assert.deepEqual(matching("list").at(-1).args.where.OR, [{ updatedAt: { lt: now } }, { updatedAt: now, id: { lt: "notification-b" } }]);
  assert.equal(matching("count").at(-1).args.where.OR, undefined);
  assert.equal(next.page.pageInfo.hasMore, false);
  assert.equal(next.page.pageInfo.nextCursor, null);
});

test("marking notifications read binds identifiers and preserves the first read timestamp", async () => {
  await markOne("owner", "notification-id");
  await markAll("owner", "home");
  const [one, all] = matching("execute").map(({ args }) => args);
  assert.deepEqual(one.values, ["notification-id", "owner", "CREDIT_CARD_DUE", "WORKSPACE_INVITATION"]);
  assert.deepEqual(all.values, ["owner", "home", "CREDIT_CARD_DUE", "WORKSPACE_INVITATION"]);
  assert.match(sqlText(one), /COALESCE\(\[readAt\], CURRENT_TIMESTAMP\)/);
  assert.match(sqlText(all), /AND \[readAt\] IS NULL/);
  assert.ok(!sqlText(one).includes("notification-id"));
});
