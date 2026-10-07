import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const calls = [];
let state;
const matching = (type) => calls.filter((call) => call.type === type);
function record(type, args) {
  calls.push({ type, args, inTransaction: state.inTransaction });
  if (state.failure?.type === type) throw state.failure.error;
}
const prisma = {
  workspace: {
    async findMany(args) {
      record("workspaces", args);
      return state.workspaces.filter((workspace) => !args.where.id || workspace.id === args.where.id);
    },
  },
  backgroundJob: { async findUnique(args) { record("retry", args); return state.retryJob; } },
  budgetEnvelope: {
    async findMany(args) { record("budgets", args); return state.budgets.filter((budget) => args.where.id.in.includes(budget.id)); },
    async findFirst(args) { record("source-budget", args); return state.sourceBudget; },
  },
  financialAccount: { async findFirst(args) { record("source-account", args); return state.sourceAccount; } },
  creditCardTransaction: {
    async findMany(args) { record("transactions", args); return state.transactions.get(args.where.workspaceId) ?? []; },
    async updateMany(args) { record("allocate", args); return { count: state.claimCounts.get(args.where.id) ?? 1 }; },
  },
  creditCardTxnLink: { async create(args) { record("link", args); return { id: "card-link" }; } },
  receivable: {
    async findFirst(args) { record("receivable-find", args); return state.receivable; },
    async create(args) { record("receivable-create", args); return { id: "receivable" }; },
    async update(args) { record("receivable-update", args); return { id: args.where.id }; },
  },
  async $transaction(callback) {
    record("begin", null);
    state.inTransaction = true;
    try {
      const result = await callback(prisma);
      record("commit", null);
      return result;
    } catch (error) {
      record("rollback", error);
      throw error;
    } finally {
      state.inTransaction = false;
    }
  },
};
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/budget-ledger.ts", { namedExports: { async applyBudgetAvailableDelta(...args) { record("balance", args); } } });
mock.module("../lib/posting-service.ts", { namedExports: {
  async createPostingGroupRecord(...args) { record("group", args); return "posting-group"; },
  async createLedgerTransaction(...args) { record("posting", args); return { id: `posting-${matching("posting").length}` }; },
} });
mock.module("../lib/background-jobs.ts", { namedExports: {
  async enqueueBackgroundJob(args) {
    record("enqueue", args);
    const job = { id: `job-${state.jobs.size}`, workspaceId: args.workspaceId, type: args.type };
    state.jobs.set(job.id, job);
    return { job, created: state.created };
  },
  async claimBackgroundJob(args) {
    record("claim", args);
    if (!state.claimable) return null;
    return { job: state.jobs.get(args.jobId) ?? state.retryJob, leaseToken: "worker-lease" };
  },
  async heartbeatBackgroundJob(...args) { record("heartbeat", args); },
  async completeClaimedBackgroundJob(...args) { record("complete", args); },
  async failClaimedBackgroundJob(...args) { record("fail", args); },
  async throwIfBackgroundJobCancelled(...args) { record("cancel-check", args); },
} });
const { runCreditTxnAutoAccounting: run } = require("../lib/credit-txn-auto-account-runner.ts");
const deduct = { id: "deduct", name: "Everyday spending", enabled: true, action: "DEDUCT_SAME_WORKSPACE", filters: ["coffee", "groceries"], sourceBudgetId: "food", destinationBudgetId: "card" };
const receivable = { id: "shared", name: "Shared groceries", enabled: true, action: "RECEIVABLE_OTHER_WORKSPACE", filters: ["shared"], sourceWorkspaceId: "family", sourceAccountId: "family-bank", sourceBudgetId: "family-food" };
const transaction = (id = "purchase", extra = {}) => ({ id, workspaceId: "home", creditCardId: "visa", transactionDate: new Date("2026-10-06T23:00:00Z"), createdAt: new Date("2026-10-07T01:00:00Z"), amountCents: 1_234, subject: "Coffee shop", creditCard: { cardName: "Travel Visa", last4Digit: "1234" }, ...extra });
function setRules(rules, workspaceId = "home") {
  state.workspaces = [{ id: workspaceId, creditCardAutoRules: JSON.stringify(rules) }];
}
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-07T04:00:00Z") });
  calls.length = 0;
  state = {
    workspaces: [], transactions: new Map([["home", [transaction()]]]), claimCounts: new Map(),
    budgets: [{ id: "food", accountId: "daily-bank", name: "Food" }, { id: "card", accountId: "card-bank", name: "Card settlement" }],
    sourceAccount: { id: "family-bank" }, sourceBudget: { id: "family-food" }, receivable: null,
    retryJob: null, jobs: new Map(), created: true, claimable: true, inTransaction: false, failure: null,
  };
  setRules([deduct]);
});

test("deduction rules atomically claim a purchase, create balanced postings, and link its original card transaction", async () => {
  setRules([deduct, { ...receivable, filters: ["coffee"] }]);
  state.transactions.set("home", [transaction(), transaction("unmatched", { subject: "Bookstore" })]);
  const result = await run(prisma, { workspaceId: "home" });
  assert.deepEqual(result, { scanned: 2, matched: 1, accounted: 1, skipped: 0, jobId: "job-0" });
  assert.deepEqual(matching("enqueue")[0].args, { type: "CREDIT_TXN_AUTO_ACCOUNT", key: "workspace:home", workspaceId: "home", message: "Credit transaction auto-accounting queued.", maxAttempts: 4 });
  assert.deepEqual(matching("claim")[0].args, { jobId: "job-0", leaseMs: 600_000 });
  const query = matching("transactions")[0].args;
  assert.deepEqual(query.where, { workspaceId: "home", isAllocated: false });
  assert.deepEqual(query.orderBy, [{ transactionDate: "asc" }, { createdAt: "asc" }]);
  assert.deepEqual(matching("budgets")[0].args.where, { workspaceId: "home", id: { in: ["food", "card"] }, isActive: true, account: { kind: "BANK", isActive: true } });
  assert.deepEqual(matching("allocate")[0].args, { where: { id: "purchase", isAllocated: false }, data: { isAllocated: true } });
  assert.deepEqual(matching("group")[0].args[1], { workspaceId: "home", operation: "CREDIT_TRANSACTION_AUTO_ACCOUNT", idempotencyKey: "credit-auto:purchase:deduct", sourceType: "CREDIT_CARD_TRANSACTION", sourceId: "purchase" });
  const postings = matching("posting").map(({ args }) => args[2]);
  assert.deepEqual(postings.map(({ accountId, budgetId, direction, amountCents }) => ({ accountId, budgetId, direction, amountCents })), [
    { accountId: "daily-bank", budgetId: "food", direction: "DEBIT", amountCents: 1_234 },
    { accountId: "card-bank", budgetId: "card", direction: "CREDIT", amountCents: 1_234 },
  ]);
  for (const posting of postings) {
    assert.equal(posting.externalRef, "credit-auto:purchase:deduct");
    assert.equal(posting.creditCardTransactionId, "purchase");
    assert.equal(posting.kind, "CREDIT_CARD_PAYMENT");
    assert.equal(posting.isSynced, false); assert.equal(posting.isFromFamily, false);
    assert.equal(posting.date.toISOString(), "2026-10-06T23:00:00.000Z");
  }
  assert.deepEqual(matching("balance").map(({ args }) => args.slice(1)), [["food", -1_234], ["card", 1_234]]);
  const link = matching("link")[0].args.data;
  assert.equal(link.transactionId, "posting-1");
  assert.equal(link.creditCardId, "visa"); assert.equal(link.creditCardTransactionId, "purchase");
  assert.equal(link.cardNameSnapshot, "Travel Visa"); assert.equal(link.cardNoEnding, "1234");
  assert.equal(link.isProcessed, true);
  assert.ok(matching("allocate").concat(matching("group"), matching("posting"), matching("balance"), matching("link")).every(({ inTransaction }) => inTransaction));
  assert.equal(matching("source-account").length, 0, "Only the first matching rule applies");
  assert.equal(matching("cancel-check").length, 2);
  assert.equal(matching("heartbeat").at(-1).args[2].progress, 95);
  assert.deepEqual(matching("complete")[0].args, ["job-0", "worker-lease", { message: "Auto-accounting complete: 1 accounted, 0 skipped.", result }]);
});

test("a same-budget deduction records one debit and never manufactures an offsetting credit", async () => {
  setRules([{ ...deduct, destinationBudgetId: "food" }]);
  const result = await run(prisma, { workspaceId: "home" });
  assert.equal(result.accounted, 1);
  assert.equal(matching("posting").length, 1);
  assert.equal(matching("posting")[0].args[2].direction, "DEBIT");
  assert.deepEqual(matching("balance").map(({ args }) => args.slice(1)), [["food", -1_234]]);
});

test("missing active budgets and lost allocation claims skip purchases without posting or changing balances", async () => {
  for (const missing of ["food", "card"]) {
    state.budgets = [{ id: missing === "food" ? "card" : "food", accountId: "bank", name: "Remaining" }];
    assert.equal((await run(prisma, { workspaceId: "home" })).skipped, 1);
  }
  assert.equal(matching("begin").length, 0);
  state.budgets = [{ id: "food", accountId: "bank" }, { id: "card", accountId: "bank" }];
  for (const count of [0, 2]) {
    state.claimCounts.set("purchase", count);
    const result = await run(prisma, { workspaceId: "home" });
    assert.equal(result.matched, 1); assert.equal(result.accounted, 0); assert.equal(result.skipped, 1);
  }
  for (const type of ["group", "posting", "balance", "link"]) assert.equal(matching(type).length, 0, type);
});

test("receivable rules validate the source account and budget before claiming any purchase", async () => {
  setRules([receivable]); state.transactions.set("home", [transaction("shared", { subject: "Shared groceries" })]);
  state.sourceAccount = null;
  assert.equal((await run(prisma, { workspaceId: "home" })).skipped, 1);
  assert.equal(matching("source-budget").length, 0);
  state.sourceAccount = { id: "family-bank" }; state.sourceBudget = null;
  assert.equal((await run(prisma, { workspaceId: "home" })).skipped, 1);
  assert.equal(matching("begin").length, 0);
  assert.deepEqual(matching("source-account")[0].args.where, { id: "family-bank", workspaceId: "family", kind: "BANK", isActive: true });
  assert.deepEqual(matching("source-budget")[0].args.where, { id: "family-food", workspaceId: "family", accountId: "family-bank", isActive: true });
  state.sourceBudget = { id: "family-food" }; state.claimCounts.set("shared", 0);
  assert.equal((await run(prisma, { workspaceId: "home" })).skipped, 1);
  assert.equal(matching("group").length, 0);
  assert.equal(matching("receivable-create").length, 0);
});

test("cross-workspace receivables group by the UTC month and retain the original purchase date and source", async () => {
  setRules([receivable]);
  const purchase = transaction("shared", { subject: "Shared groceries", transactionDate: new Date("2026-12-31T23:00:00Z") });
  state.transactions.set("home", [purchase]);
  const result = await run(prisma, { workspaceId: "home" });
  assert.equal(result.accounted, 1);
  assert.deepEqual(matching("group")[0].args[1], { workspaceId: "home", operation: "CREDIT_TRANSACTION_AUTO_RECEIVABLE", idempotencyKey: "credit-auto-receivable:shared:shared", sourceType: "CREDIT_CARD_TRANSACTION", sourceId: "shared" });
  const criteria = matching("receivable-find")[0].args;
  assert.deepEqual(criteria.where, {
    workspaceId: "home", title: "Shared groceries (Dec 2026)", sourceWorkspaceId: "family", sourceAccountId: "family-bank", sourceBudgetId: "family-food",
    status: { in: ["OPEN", "PARTIAL"] }, date: { gte: new Date("2026-12-01T00:00:00Z"), lt: new Date("2027-01-01T00:00:00Z") },
  });
  assert.deepEqual(criteria.orderBy, { createdAt: "asc" });
  assert.deepEqual(matching("receivable-create")[0].args.data, {
    workspaceId: "home", title: "Shared groceries (Dec 2026)", amountCents: 1_234, date: purchase.transactionDate, transactionDate: purchase.transactionDate,
    remarkTogether: 'Auto-accounted by rule "Shared groceries"', notes: "2026-12-31 - Travel Visa ending 1234 - Shared groceries - 12.34",
    sourceWorkspaceId: "family", sourceAccountId: "family-bank", sourceBudgetId: "family-food", status: "OPEN",
  });
  assert.equal(matching("posting").length, 0);
  assert.equal(matching("balance").length, 0);
  assert.ok(matching("receivable-create")[0].inTransaction);
});

test("existing monthly receivables increment their amount and append a readable audit note", async () => {
  setRules([receivable]); state.transactions.set("home", [transaction("shared", { subject: "Shared groceries" })]);
  for (const notes of [null, "   ", " Earlier note "]) {
    state.receivable = { id: "open-receivable", notes };
    assert.equal((await run(prisma, { workspaceId: "home" })).accounted, 1);
    const update = matching("receivable-update").at(-1).args;
    assert.deepEqual(update.where, { id: "open-receivable" });
    assert.deepEqual(update.data.amountCents, { increment: 1_234 });
    const prefix = notes?.trim() ? "Earlier note\n" : "";
    assert.equal(update.data.notes, `${prefix}2026-10-06 - Travel Visa ending 1234 - Shared groceries - 12.34`);
    assert.equal(update.data.transactionDate.toISOString(), "2026-10-06T23:00:00.000Z");
  }
  assert.equal(matching("receivable-create").length, 0);
});

test("disabled or malformed rules complete without scanning transactions", async () => {
  for (const raw of [null, "{", "[]", JSON.stringify([{ ...deduct, enabled: false }])]) {
    state.workspaces = [{ id: "home", creditCardAutoRules: raw }];
    const result = await run(prisma, { workspaceId: "home" });
    assert.equal(result.scanned, 0); assert.equal(result.matched, 0); assert.equal(result.accounted, 0); assert.equal(result.skipped, 0);
  }
  assert.equal(matching("transactions").length, 0);
  assert.equal(matching("complete").length, 4);
});

test("duplicate queues and unavailable leases return an already-running result without executing rules", async () => {
  state.created = false;
  assert.deepEqual(await run(prisma, { workspaceId: "home" }), { scanned: 0, matched: 0, accounted: 0, skipped: 0, jobId: "job-0", alreadyRunning: true });
  assert.equal(matching("claim").length, 0);
  state.created = true; state.claimable = false;
  const result = await run(prisma, { workspaceId: "home" });
  assert.equal(result.alreadyRunning, true);
  assert.equal(matching("workspaces").length, 0);
  assert.equal(matching("heartbeat").length, 0);
});

test("retries validate the persisted job type and retain its tenant scope", async () => {
  for (const job of [{ id: "retry", type: "GMAIL_SYNC", workspaceId: "home" }, { id: "retry", type: "CREDIT_TXN_AUTO_ACCOUNT", workspaceId: null }]) {
    state.retryJob = job;
    await assert.rejects(run(prisma, { jobId: "retry", workspaceId: "other" }), /Invalid auto-accounting job/);
  }
  assert.equal(matching("enqueue").length, 0);
  state.retryJob = { id: "retry", type: "CREDIT_TXN_AUTO_ACCOUNT", workspaceId: "home" };
  assert.equal((await run(prisma, { jobId: "retry", workspaceId: "other" })).accounted, 1);
  assert.equal(matching("enqueue").length, 0);
  assert.equal(matching("workspaces")[0].args.where.id, "home");
  assert.equal(matching("complete")[0].args[0], "retry");
  state.retryJob = null; state.created = false;
  assert.equal((await run(prisma, { jobId: "missing", workspaceId: "home" })).accounted, 1);
});

test("scheduled runs combine independently claimed workspace results and return an empty summary when there are no rules", async () => {
  state.workspaces.push({ id: "other", creditCardAutoRules: JSON.stringify([receivable]) });
  state.transactions.set("other", [transaction("shared", { workspaceId: "other", subject: "Shared food" }), transaction("none", { workspaceId: "other", subject: "No match" })]);
  state.claimCounts.set("shared", 0);
  assert.deepEqual(await run(), { scanned: 3, matched: 2, accounted: 1, skipped: 1 });
  assert.equal(matching("claim").length, 2);
  assert.deepEqual(matching("enqueue").map(({ args }) => args.workspaceId), ["home", "other"]);
  state.workspaces = [];
  assert.deepEqual(await run(), { scanned: 0, matched: 0, accounted: 0, skipped: 0 });
});

test("cancellation and posting failures fail the claimed job and never complete a partial operation", async () => {
  for (const type of ["cancel-check", "posting"]) {
    calls.length = 0;
    const error = new Error(`Fixture ${type} failure`);
    state.failure = { type, error };
    await assert.rejects(run(prisma, { workspaceId: "home" }), (value) => value === error);
    assert.equal(matching("fail").length, 1);
    assert.equal(matching("fail")[0].args[1], "worker-lease");
    assert.equal(matching("fail")[0].args[2], error);
    assert.equal(matching("complete").length, 0);
    assert.equal(matching("commit").length, 0);
    assert.equal(matching("rollback").length, type === "posting" ? 1 : 0);
    assert.equal(matching("balance").length, 0);
  }
});
