import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { EMPTY_TRANSACTION_INTENT } from "../lib/ai/transaction-agent-contracts.ts";
import { AiConfigurationError } from "../lib/ai/config.ts";
import { agentToday, shiftAgentDate } from "../lib/ai/transaction-agent-core.ts";
import { defaultAgentConfiguration } from "../lib/ai/agent-catalog.ts";

// Exercise the real draft coordinator and ledger posting/correction service with
// an isolated transactional store. No provider calls or real financial writes.
process.env.DATABASE_URL = "sqlserver://localhost:1433;database=transaction_agent_test;user=test;password=test";
let drafts, budgets, transactions, idempotency, postings, sequence, agentConfiguration;
const clone = (value) => structuredClone(value);
const DRAFT_COLUMNS = new Set(["id", "workspaceId", "userId", "revision", "status", "stateJson", "expiresAt"]);
const strictDraftWhere = (where) => { for (const key of Object.keys(where)) assert.ok(DRAFT_COLUMNS.has(key), `Unknown argument \`${key}\``); return where; };
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR" || key === "creditCardLinks") return true;
    if (key === "AND") return value.every((clause) => matches(row, clause));
    if (value && typeof value === "object") {
      if ("in" in value) return value.in.includes(row[key]);
      if ("contains" in value) return row[key].toLowerCase().includes(value.contains.toLowerCase());
      if ("not" in value) return row[key] !== value.not;
      if ("gte" in value) return row[key] >= value.gte && (!value.lt || row[key] < value.lt);
      return true;
    }
    return row[key] === value;
  });
}
function selected(row, select) {
  if (!row) return null;
  return Object.fromEntries(Object.keys(select).map((key) => [key, clone(row[key])]));
}
function updateDraft(row, data) {
  Object.assign(row, data, { revision: typeof data.revision === "object" ? row.revision + data.revision.increment : row.revision, updatedAt: new Date() });
  return clone(row);
}
const db = {
  aiAgentConfig: { findUnique: async () => agentConfiguration },
  aiAgentExample: { findMany: async () => [] },
  workspace: { findUniqueOrThrow: async () => ({ baseCurrency: "SGD" }) },
  budgetEnvelope: {
    findMany: async ({ where }) => budgets.filter((b) => b.workspaceId === where.workspaceId && b.isActive).map((b) => ({ id: b.id, name: b.name, accountId: b.accountId, availableCents: b.availableCents, account: { name: "DBS" } })),
    findFirst: async ({ where }) => clone(budgets.find((b) => matches(b, where)) ?? null),
    update: async ({ where, data }) => { const row = budgets.find((b) => b.id === where.id); row.availableCents += data.availableCents.increment; return clone(row); },
  },
  transactionAgentDraft: {
    create: async ({ data }) => { assert.equal("role" in data, false, "draft rows have no role column"); const row = { ...data, id: `draft-${++sequence}`, revision: 0, status: "CLARIFY", createdAt: new Date(), updatedAt: new Date() }; drafts.push(row); return clone(row); },
    findFirst: async ({ where }) => clone(drafts.find((d) => matches(d, strictDraftWhere(where))) ?? null),
    updateMany: async ({ where, data }) => { const rows = drafts.filter((d) => matches(d, strictDraftWhere(where))); rows.forEach((d) => updateDraft(d, data)); return { count: rows.length }; },
    update: async ({ where, data }) => updateDraft(drafts.find((d) => d.id === where.id), data),
  },
  transaction: {
    findFirst: async ({ where, select }) => selected(transactions.find((t) => matches(t, where)), select),
    findUnique: async ({ where, select }) => selected(transactions.find((t) => t.id === where.id), select),
    findMany: async ({ where, take, select }) => transactions.filter((t) => matches(t, where)).slice(0, take).map((t) => selected(t, select)),
    create: async ({ data }) => { const row = { id: `tx-${++sequence}`, budgetId: null, groupId: null, details: null, notes: null, externalRef: null, creditCardTransactionId: null, receivableId: null, voidedAt: null, creditCardLinks: [], updatedAt: new Date(), ...data, postingGroup: { operation: postings.find((p) => p.id === data.postingGroupId)?.operation } }; transactions.push(row); return clone(row); },
    updateMany: async ({ where, data }) => { const rows = transactions.filter((t) => matches(t, where)); rows.forEach((t) => Object.assign(t, data)); return { count: rows.length }; },
    groupBy: async ({ where }) => {
      const counts = new Map();
      transactions.filter((t) => matches(t, where)).forEach((t) => counts.set(t.budgetId, (counts.get(t.budgetId) ?? 0) + 1));
      return [...counts].sort((a, b) => b[1] - a[1]).map(([budgetId, all]) => ({ budgetId, _count: { _all: all } }));
    },
  },
  transactionGroup: { findFirst: async () => ({ id: "group" }) },
  $queryRaw: async (query) => {
    const sql = query.strings.join("");
    if (sql.includes("FROM [IdempotencyRecord]")) {
      const [workspaceId, operation, key] = query.values;
      const row = idempotency.find((i) => i.workspaceId === workspaceId && i.operation === operation && i.key === key);
      return row ? [clone(row)] : [];
    }
    if (sql.includes("FROM [TransactionAgentDraft]")) return drafts.filter((d) => d.id === query.values[0]).map((d) => ({ id: d.id }));
    if (sql.includes("FROM [Transaction]")) return transactions.filter((t) => t.id === query.values[0]).map((t) => ({ id: t.id }));
    throw new Error(`Unexpected read: ${sql}`);
  },
  $executeRaw: async (query) => {
    const sql = query.strings.join("");
    if (sql.includes("INSERT INTO [IdempotencyRecord]")) {
      const [id, workspaceId, operation, key, requestHash] = query.values;
      idempotency.push({ id, workspaceId, operation, key, requestHash, status: "IN_PROGRESS" });
    } else if (sql.includes("INSERT INTO [PostingGroup]")) {
      const [id, workspaceId, operation, sourceType, sourceId, actorUserId] = query.values;
      postings.push({ id, workspaceId, operation, sourceType, sourceId, actorUserId });
    } else if (sql.includes("UPDATE [IdempotencyRecord]")) {
      const [postingGroupId, resultJson, id] = query.values;
      Object.assign(idempotency.find((i) => i.id === id), { postingGroupId, resultJson, status: "COMPLETED" });
    } else throw new Error(`Unexpected write: ${sql}`);
    return 1;
  },
  $transaction: async (callback) => {
    const snapshot = clone({ drafts, budgets, transactions, idempotency, postings });
    try { return await callback(db); } catch (error) {
      ({ drafts, budgets, transactions, idempotency, postings } = snapshot);
      throw error;
    }
  },
};
globalThis.prisma = db;
const { advanceTransactionAgent: advance, confirmTransactionAgent: confirm, getTransactionAgentDraft } = await import("../lib/ai/transaction-agent.ts");
// Matches what requireWorkspaceAccess returns. Extra fields must never reach Prisma queries.
const scope = { workspaceId: "workspace", userId: "user", role: "OWNER" };
const interpreted = (overrides) => async () => ({ ...EMPTY_TRANSACTION_INTENT, operation: "CREATE", amount: "10", direction: "DEBIT", ...overrides });
const noModel = async () => { throw new Error("The model must not be called for this reply"); };
const unavailable = async () => { throw new Error("Provider unavailable"); };
const seedTransaction = (data) => db.transaction.create({ data: { workspaceId: scope.workspaceId, accountId: "bank", budgetId: "food", direction: "DEBIT", kind: "EXPENSE", isFromFamily: false, postingGroupId: null, ...data } });
const ref = (draft) => ({ draftId: draft.draftId, revision: draft.revision });
const completeDraft = () => advance(scope, { action: "start", message: "Deduct $10 from Transit for bus fare" }, interpreted({ accountQuery: "Transit", subject: "Bus fare" }));
const setAgentPolicy = (overrides) => {
  const { capabilities, ...configuration } = { ...defaultAgentConfiguration("transaction-assistant"), ...overrides };
  agentConfiguration = { ...configuration, revision: 1, capabilitiesJson: JSON.stringify(capabilities), updatedAt: new Date() };
};
beforeEach(() => {
  agentConfiguration = null;
  drafts = []; transactions = []; idempotency = []; postings = []; sequence = 0;
  budgets = [{ id: "transit", accountId: "bank", name: "Transit", workspaceId: "workspace", availableCents: 10000, isActive: true }, { id: "food", accountId: "bank", name: "Food", workspaceId: "workspace", availableCents: 20000, isActive: true }];
});

test("pausing the transaction agent blocks new drafts and previously reviewed writes but still allows cancellation", async () => {
  const draft = await completeDraft();
  setAgentPolicy({ enabled: false });
  await assert.rejects(completeDraft(), /paused/);
  assert.equal(drafts.length, 1);
  await assert.rejects(confirm(scope, { action: "confirm", ...ref(draft) }), /paused/);
  assert.equal(transactions.length, 0);
  assert.equal(postings.length, 0);
  assert.equal((await advance(scope, { action: "cancel", ...ref(draft) }, noModel)).status, "CANCELLED");
});

test("revoking creation after review prevents confirmation and preserves balances", async () => {
  const draft = await completeDraft();
  setAgentPolicy({ capabilities: ["correct-transactions"] });
  await assert.rejects(confirm(scope, { action: "confirm", ...ref(draft) }), /disabled/);
  assert.equal(budgets[0].availableCents, 10000);
  assert.equal(transactions.length, 0);
  assert.equal(postings.length, 0);
});

test("revoking corrections after review prevents replacement and reversal postings", async () => {
  await seedTransaction({ id: "lunch", subject: "Lunch", amountCents: 1000, date: new Date("2026-09-29T00:00:00Z") });
  const draft = await advance(scope, { action: "start", message: "Change lunch to $12" }, interpreted({ operation: "UPDATE", amount: "12", direction: null, targetQuery: "Lunch" }));
  assert.equal(draft.status, "REVIEW");
  setAgentPolicy({ capabilities: ["create-transactions"] });
  await assert.rejects(confirm(scope, { action: "confirm", ...ref(draft) }), /disabled/);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].voidedAt, null);
  assert.equal(budgets[1].availableCents, 20000);
  assert.equal(postings.length, 0);
});

test("saved transaction receipts remain replayable after the agent is paused", async () => {
  const draft = await completeDraft();
  const saved = await confirm(scope, { action: "confirm", ...ref(draft) });
  setAgentPolicy({ enabled: false });
  const replay = await confirm(scope, { action: "confirm", ...ref(draft) });
  assert.equal(replay.savedTransactionId, saved.savedTransactionId);
  assert.equal(transactions.length, 1);
});

test("deduct -> choose account -> supply description -> review -> confirm, with exactly one posting on retry", async () => {
  let draft = await advance(scope, { action: "start", message: "Deduct $10" }, interpreted({}));
  assert.equal(draft.status, "CLARIFY");
  assert.equal(draft.choices.length, 2);
  assert.equal(transactions.length, 0);
  await assert.rejects(confirm(scope, { action: "confirm", ...ref(draft) }), /Complete the draft/);
  draft = await advance(scope, { action: "select", ...ref(draft), selection: { kind: "budget", id: "transit" } });
  assert.match(draft.message, /What was it for/);
  assert.equal(draft.pending, "subject");
  draft = await advance(scope, { action: "message", ...ref(draft), message: "Bus fare" }, noModel);
  assert.equal(draft.status, "REVIEW");
  assert.equal(transactions.length, 0);
  const saved = await confirm(scope, { action: "confirm", ...ref(draft) });
  const replay = await confirm(scope, { action: "confirm", ...ref(draft) });
  assert.equal(saved.status, "SAVED");
  assert.equal(saved.savedTransactionId, replay.savedTransactionId);
  assert.equal(transactions.length, 1);
  assert.equal(budgets[0].availableCents, 9000);
  assert.equal(postings[0].actorUserId, "user");
});

test("near-match requires choice; a yes to the suggestion still does not save", async () => {
  let draft = await advance(scope, { action: "start", message: "Deduct $10 from transport for bus fare" }, interpreted({ accountQuery: "transport", subject: "Bus fare" }));
  assert.equal(draft.status, "CLARIFY");
  assert.match(draft.message, /Did you mean “Transit”/);
  draft = await advance(scope, { action: "message", ...ref(draft), message: "yes" }, noModel);
  assert.equal(draft.status, "REVIEW");
  assert.equal(draft.review.after.budgetId, "transit");
  assert.equal(transactions.length, 0);
});

test("cancelled, expired, cross-user, cross-workspace and revised drafts cannot be confirmed", async () => {
  const draft = await completeDraft();
  await assert.rejects(confirm({ ...scope, userId: "other" }, { action: "confirm", ...ref(draft) }), /not found/);
  await assert.rejects(confirm({ ...scope, workspaceId: "other" }, { action: "confirm", ...ref(draft) }), /not found/);
  const revised = await advance(scope, { action: "message", ...ref(draft), message: "Actually $12" }, interpreted({ accountQuery: "Transit", subject: "Bus fare", amount: "12" }));
  await assert.rejects(confirm(scope, { action: "confirm", ...ref(draft) }), /changed/);
  const cancelled = await advance(scope, { action: "cancel", ...ref(revised) });
  await assert.rejects(confirm(scope, { action: "confirm", ...ref(cancelled) }), /cancelled/);
  const expiring = await completeDraft();
  drafts.find((d) => d.id === expiring.draftId).expiresAt = new Date(0);
  await assert.rejects(confirm(scope, { action: "confirm", ...ref(expiring) }), /expired/);
  assert.equal(transactions.length, 0);
});

test("changes invalidate review before interpretation completes, even if provider fails", async () => {
  const draft = await completeDraft();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const pending = advance(scope, { action: "message", ...ref(draft), message: "Actually $12" }, async () => { entered(); await gate; throw new Error("Provider unavailable"); });
  await ready;
  await assert.rejects(confirm(scope, { action: "confirm", ...ref(draft) }), /changed/);
  release();
  const failed = await pending;
  assert.equal(failed.status, "CLARIFY");
  assert.equal(failed.review, null);
  assert.equal(transactions.length, 0);
});

test("stale balances roll back posting and return a refreshed review to confirm again", async () => {
  const draft = await completeDraft();
  budgets[0].availableCents = 5000;
  const fresh = await confirm(scope, { action: "confirm", ...ref(draft) });
  assert.equal(fresh.status, "REVIEW");
  assert.match(fresh.message, /nothing was saved yet/);
  assert.equal(fresh.review.balances[0].availableCents, 5000);
  assert.equal(postings.length, 0);
  assert.equal(transactions.length, 0);
  await assert.rejects(confirm(scope, { action: "confirm", ...ref(draft) }), /changed/, "the old revision cannot be replayed");
  await confirm(scope, { action: "confirm", ...ref(fresh) });
  assert.equal(budgets[0].availableCents, 4000);
  const manual = await completeDraft();
  const refreshed = await advance(scope, { action: "message", ...ref(manual), message: "refresh" }, noModel);
  assert.equal(refreshed.review.balances[0].availableCents, 4000);
});

test("updates select an actual transaction then reverse and replace while preserving details", async () => {
  await seedTransaction({ id: "lunch", subject: "Lunch", amountCents: 1000, date: new Date("2026-09-29T00:00:00Z"), notes: "Receipt 1", details: "Cafe", groupId: "group" });
  await seedTransaction({ id: "dinner", subject: "Dinner", amountCents: 1000, date: new Date("2026-09-29T00:00:00Z") });
  const draft = await advance(scope, { action: "start", message: "Change yesterday's lunch to $12" }, interpreted({ operation: "UPDATE", amount: "12", direction: null, targetQuery: "Lunch", targetDate: "2026-09-29" }));
  assert.equal(draft.status, "REVIEW", "a single exact match goes straight to a review that shows the original");
  assert.equal(draft.review.before.id, "lunch");
  assert.equal(draft.review.after.subject, "Lunch");
  const saved = await confirm(scope, { action: "confirm", ...ref(draft) });
  assert.equal(transactions.length, 4, "two seeded, plus a reversal and a replacement");
  assert.ok(transactions.find((t) => t.id === "lunch").voidedAt);
  assert.equal(transactions.find((t) => t.kind === "REVERSAL").reversalOfId, "lunch");
  const replacement = transactions.find((t) => t.id === saved.savedTransactionId);
  assert.equal(replacement.notes, "Receipt 1");
  assert.equal(replacement.details, "Cafe");
  assert.equal(replacement.groupId, "group");
  assert.equal(replacement.amountCents, 1200);
  assert.equal(budgets[1].availableCents, 19800);
  assert.equal(postings[0].sourceId, "lunch");
  assert.equal(postings[0].sourceType, "TRANSACTION", "correction lineage follows TRANSACTION sources");
  await confirm(scope, { action: "confirm", ...ref(draft) });
  assert.equal(transactions.length, 4, "replaying the confirmation posts nothing new");
});

test("fabricated option IDs are rejected and draft reads are scoped", async () => {
  const draft = await advance(scope, { action: "start", message: "Deduct $10" }, interpreted({}));
  await assert.rejects(advance(scope, { action: "select", ...ref(draft), selection: { kind: "budget", id: "foreign" } }), /no longer available/);
  await assert.rejects(getTransactionAgentDraft({ ...scope, userId: "other" }, draft.draftId), /not found/);
});

test("several matching transactions are listed; a misremembered date is relaxed and still asks", async () => {
  await seedTransaction({ id: "lunch1", subject: "Lunch", amountCents: 1000, date: new Date("2026-09-29T00:00:00Z") });
  await seedTransaction({ id: "lunch2", subject: "Lunch with team", amountCents: 2500, date: new Date("2026-09-29T00:00:00Z") });
  const many = await advance(scope, { action: "start", message: "Change yesterday's lunch to $12" }, interpreted({ operation: "UPDATE", amount: "12", direction: null, targetQuery: "Lunch", targetDate: "2026-09-29" }));
  assert.equal(many.status, "CLARIFY");
  assert.deepEqual(many.choices.map((c) => c.id).sort(), ["lunch1", "lunch2"]);
  assert.equal(many.pending, "target");
  const relaxed = await advance(scope, { action: "start", message: "Change Monday's $25 lunch" }, interpreted({ operation: "UPDATE", amount: "12", direction: null, targetQuery: "Lunch", targetDate: "2026-09-21", targetAmount: "25" }));
  assert.equal(relaxed.status, "CLARIFY", "a relaxed match is never auto-selected");
  assert.match(relaxed.message, /couldn’t find an exact match/);
  assert.deepEqual(relaxed.choices.map((c) => c.id), ["lunch2"]);
  const picked = await advance(scope, { action: "message", ...ref(relaxed), message: "1" }, noModel);
  assert.equal(picked.review.before.id, "lunch2");
});

test("after saving, “make that $12” corrects the transaction that was just saved", async () => {
  const saved = await confirm(scope, { action: "confirm", ...ref(await completeDraft()) });
  let seen;
  const next = await advance(scope, { action: "start", message: "make that $12", previousDraftId: saved.draftId }, async (_message, state) => {
    seen = state.lastSaved;
    return { ...EMPTY_TRANSACTION_INTENT, operation: "UPDATE", amount: "12", targetLastSaved: true };
  });
  assert.equal(seen.transactionId, saved.savedTransactionId);
  assert.equal(seen.budgetName, "Transit");
  assert.equal(next.status, "REVIEW");
  assert.equal(next.review.operation, "UPDATE");
  assert.equal(next.review.before.id, saved.savedTransactionId);
  assert.equal(next.review.after.amountCents, 1200);
  const foreign = await advance({ ...scope, userId: "other" }, { action: "start", message: "make that $12", previousDraftId: saved.draftId }, async (_m, state) => {
    assert.equal(state.lastSaved, null, "another user's draft is never used as context");
    return { ...EMPTY_TRANSACTION_INTENT, operation: "UPDATE", amount: "12", targetLastSaved: true };
  });
  assert.equal(foreign.review, null, "without a described target, nothing is auto-selected");
  assert.match(foreign.message, /most recent/);
});

test("inline edits change the review without a model call and never save", async () => {
  let draft = await completeDraft();
  draft = await advance(scope, { action: "edit", ...ref(draft), field: "amount", value: "12.50" }, noModel);
  assert.equal(draft.review.after.amountCents, 1250);
  draft = await advance(scope, { action: "edit", ...ref(draft), field: "date", value: "yesterday" }, noModel);
  assert.equal(draft.review.after.date.slice(0, 10), shiftAgentDate(agentToday(), -1));
  const bad = await advance(scope, { action: "edit", ...ref(draft), field: "amount", value: "0" }, noModel);
  assert.match(bad.message, /positive amount/);
  assert.equal(bad.review.after.amountCents, 1250, "an invalid edit keeps the previous values");
  draft = await advance(scope, { action: "edit", ...ref(bad), field: "budget" }, noModel);
  assert.equal(draft.review, null);
  assert.equal(draft.choices.length, 2);
  draft = await advance(scope, { action: "select", ...ref(draft), selection: { kind: "budget", id: "food" } });
  assert.equal(draft.review.after.budgetId, "food");
  assert.equal(draft.review.after.amountCents, 1250);
  assert.equal(transactions.length, 0);
  await assert.rejects(advance(scope, { action: "edit", ...ref(bad), field: "amount", value: "9" }, noModel), /changed/, "edits are revision-checked");
});

test("when the AI is unavailable, simple commands still reach review and others explain", async () => {
  const simple = await advance(scope, { action: "start", message: "Deduct $10 from Transit for bus fare" }, unavailable);
  assert.equal(simple.status, "REVIEW");
  assert.equal(simple.review.after.subject, "Bus fare");
  assert.equal(transactions.length, 0);
  const complex = await advance(scope, { action: "start", message: "fix the thing from last week" }, async () => { throw new AiConfigurationError("missing"); });
  assert.equal(complex.status, "CLARIFY");
  assert.match(complex.message, /Simple commands/);
});

test("pending answers and skip are handled locally; a second request is offered after saving", async () => {
  let draft = await advance(scope, { action: "start", message: "Deduct $10 from Transit, then add $50 to food" }, interpreted({ accountQuery: "Transit", deferred: "add $50 to food" }));
  assert.equal(draft.pending, "subject");
  assert.match(draft.message, /after this one I’ll help with “add \$50 to food”/);
  draft = await advance(scope, { action: "message", ...ref(draft), message: "skip" }, noModel);
  assert.equal(draft.review.after.subject, "Transit");
  const saved = await confirm(scope, { action: "confirm", ...ref(draft) });
  assert.equal(saved.nextRequest, "add $50 to food");
  assert.match(saved.message, /Next, you asked me to/);
});

test("choices are ordered by how this workspace used them for similar descriptions", async () => {
  for (let i = 0; i < 3; i += 1) await seedTransaction({ subject: "Grab ride home", amountCents: 1500, budgetId: "transit", date: new Date() });
  const draft = await advance(scope, { action: "start", message: "Deduct $15 for grab" }, interpreted({ amount: "15", subject: "Grab ride" }));
  assert.equal(draft.choices[0].id, "transit");
  assert.equal(draft.choices[0].suggested, true);
  assert.equal(draft.review, null, "history never selects on its own");
});
