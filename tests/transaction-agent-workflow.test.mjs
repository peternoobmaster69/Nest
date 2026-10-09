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
const { advanceTransactionAgent: advance, confirmTransactionAgent: confirm, getTransactionAgentDraft, transactionAgentView } = await import("../lib/ai/transaction-agent.ts");
const { PostingConflictError } = await import("../lib/posting-service.ts");
const { AgentPolicyError } = await import("../lib/ai/agent-policy.ts");
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
beforeEach((context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-08T12:00:00Z") });
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

test("draft preparation rejects unsupported workspace currencies and an oversized sub-account context", async (t) => {
  t.mock.method(db.workspace, "findUniqueOrThrow", async ({ where }) => {
    assert.equal(where.id, "workspace");
    return { baseCurrency: "invalid-currency" };
  });
  await assert.rejects(completeDraft(), /valid workspace currency/);
  budgets = Array.from({ length: 501 }, (_, index) => ({ ...budgets[0], id: `budget-${index}` }));
  await assert.rejects(completeDraft(), /too many sub-accounts/);
  assert.equal(transactions.length, 0);
  assert.equal(postings.length, 0);
});

test("expired draft views hide actionable content but preserve saved and cancelled receipts", async () => {
  const draft = await completeDraft();
  const stored = drafts.find(({ id }) => id === draft.draftId);
  stored.expiresAt = new Date(0);
  const expired = transactionAgentView(stored);
  assert.equal(expired.status, "EXPIRED");
  assert.equal(expired.pending, null);
  assert.equal(expired.review, null);
  assert.deepEqual(expired.choices, []);
  assert.match(expired.message, /expired/);
  assert.deepEqual(expired.messages, draft.messages);
  for (const status of ["SAVED", "CANCELLED"]) {
    stored.status = status;
    assert.equal(transactionAgentView(stored).status, status);
  }
});

test("correction searches reject invalid original dates and amounts before selecting a transaction", async () => {
  for (const [change, message] of [[{ targetDate: "2026-13-40" }, /What date was the original/], [{ targetAmount: "0" }, /What was the original amount/]]) {
    const draft = await advance(scope, { action: "start", message: "Correct an old transaction" }, interpreted({ operation: "UPDATE", ...change }));
    assert.equal(draft.pending, "target");
    assert.equal(draft.review, null);
    assert.match(draft.message, message);
  }
  assert.equal(transactions.length, 0);
});

test("unsuccessful correction searches relax useful filters and explain when nothing matches", async () => {
  for (const target of [{ targetQuery: "Missing purchase", targetDate: "2026-09-29", targetAmount: "15" }, { targetDate: "2026-09-29", targetAmount: "15" }]) {
    const draft = await advance(scope, { action: "start", message: "Correct an old transaction" }, interpreted({ operation: "UPDATE", ...target }));
    assert.equal(draft.review, null);
    assert.deepEqual(draft.choices, []);
    assert.match(draft.message, /couldn’t find an ordinary transaction/);
  }
});

test("large correction searches cap choices, normalize legacy credit directions, and label unassigned transactions", async () => {
  for (let index = 0; index < 12; index++) {
    await seedTransaction({ id: `credit-${index}`, subject: `Salary ${index}`, budgetId: index === 0 ? null : "food", direction: index === 0 ? "Incoming" : "CREDIT", amountCents: 1000, date: new Date("2026-09-29T00:00:00Z") });
  }
  const listed = await advance(scope, { action: "start", message: "Correct a salary" }, interpreted({ operation: "UPDATE", targetQuery: "Salary" }));
  assert.equal(listed.choices.length, 10);
  assert.match(listed.message, /10 most recent matches/);
  assert.match(listed.choices[0].detail, /\+SGD\s10\.00 · Unassigned/);
  const selected = await advance(scope, { action: "select", ...ref(listed), selection: { kind: "transaction", id: "credit-1" } }, noModel);
  assert.equal(selected.review.before.direction, "CREDIT");
  assert.equal(selected.review.before.id, "credit-1");
  assert.equal(postings.length, 0);
});

test("selected correction targets that disappear return to target selection without changing money", async () => {
  await seedTransaction({ id: "lunch", subject: "Lunch", amountCents: 1000, date: new Date("2026-09-29T00:00:00Z") });
  const draft = await advance(scope, { action: "start", message: "Change lunch" }, interpreted({ operation: "UPDATE", targetQuery: "Lunch" }));
  transactions = [];
  const refreshed = await advance(scope, { action: "message", ...ref(draft), message: "refresh" }, noModel);
  assert.equal(refreshed.review, null);
  assert.equal(refreshed.pending, "target");
  assert.match(refreshed.message, /can’t be corrected here any more/);
  assert.equal(postings.length, 0);
});

test("last-saved context handles removed budgets and deleted transactions without choosing another user's data", async () => {
  const saved = await confirm(scope, { action: "confirm", ...ref(await completeDraft()) });
  budgets[0].isActive = false;
  let seen;
  const inspect = async (_message, state) => {
    seen = state.lastSaved;
    return { ...EMPTY_TRANSACTION_INTENT, clarification: "Describe a new request." };
  };
  await advance(scope, { action: "start", previousDraftId: saved.draftId, message: "What did I save?" }, inspect);
  assert.equal(seen.transactionId, saved.savedTransactionId);
  assert.equal(seen.budgetName, null);
  transactions = [];
  await advance(scope, { action: "start", previousDraftId: saved.draftId, message: "What did I save?" }, inspect);
  assert.equal(seen, null);
});

test("exact choice labels are handled locally, and a vague yes does not choose between multiple accounts", async () => {
  const initial = await advance(scope, { action: "start", message: "Deduct $10" }, interpreted({}));
  const selected = await advance(scope, { action: "message", ...ref(initial), message: "Food" }, noModel);
  assert.equal(selected.pending, "subject");
  assert.equal(JSON.parse(drafts.find(({ id }) => id === selected.draftId).stateJson).budgetId, "food");
  let providerCalls = 0;
  const ambiguous = await advance(scope, { action: "start", message: "Deduct $10" }, interpreted({}));
  const stillChoosing = await advance(scope, { action: "message", ...ref(ambiguous), message: "yes" }, async () => {
    providerCalls++;
    return { ...EMPTY_TRANSACTION_INTENT, clarification: "Choose which sub-account." };
  });
  assert.equal(providerCalls, 1);
  assert.equal(stillChoosing.review, null);
  assert.equal(transactions.length, 0);
});

test("removed sub-accounts cannot be selected from an earlier draft", async () => {
  const draft = await advance(scope, { action: "start", message: "Deduct $10" }, interpreted({}));
  budgets[0].isActive = false;
  await assert.rejects(advance(scope, { action: "select", ...ref(draft), selection: { kind: "budget", id: "transit" } }, noModel), /sub-account is no longer available/);
  assert.equal(transactions.length, 0);
});

test("agent hints discard invented account names and inline edits describe both direction changes", async () => {
  let draft = await advance(scope, { action: "start", message: "Deduct $10 for bus fare" }, interpreted({ subject: "Bus fare", accountCandidates: ["Transit", "Invented account"] }));
  const state = JSON.parse(drafts.find(({ id }) => id === draft.draftId).stateJson);
  assert.deepEqual(state.intent.accountCandidates, ["Transit"]);
  draft = await advance(scope, { action: "select", ...ref(draft), selection: { kind: "budget", id: "transit" } }, noModel);
  for (const [field, value, expected] of [["subject", "Train fare", "Change description to Train fare"], ["direction", "CREDIT", "Change direction to add"], ["direction", "DEBIT", "Change direction to deduct"]]) {
    draft = await advance(scope, { action: "edit", ...ref(draft), field, value }, noModel);
    assert.ok(draft.messages.some(({ role, content }) => role === "user" && content === expected));
  }
  assert.equal(draft.review.after.subject, "Train fare");
  assert.equal(draft.review.after.direction, "DEBIT");
  assert.equal(transactions.length, 0);
});

test("unexpected edit-planning failures propagate after invalidating the earlier review", async (t) => {
  const draft = await completeDraft();
  t.mock.method(db.transaction, "groupBy", async ({ where }) => {
    assert.equal(where.workspaceId, "workspace");
    throw new Error("Database unavailable");
  });
  await assert.rejects(advance(scope, { action: "edit", ...ref(draft), field: "amount", value: "12" }, noModel), /Database unavailable/);
  const stored = drafts.find(({ id }) => id === draft.draftId);
  assert.equal(stored.status, "CLARIFY");
  assert.equal(JSON.parse(stored.stateJson).review, null);
  assert.equal(transactions.length, 0);
});

test("policy and posting errors are never replaced with an AI fallback", async () => {
  for (const error of [new AgentPolicyError("Capability denied"), new PostingConflictError("Invalid posting context")]) {
    await assert.rejects(advance(scope, { action: "start", message: "Deduct $10 from Transit for bus fare" }, async () => { throw error; }), (actual) => actual === error);
  }
  assert.equal(transactions.length, 0);
  assert.equal(postings.length, 0);
});

test("unconfigured and non-Error provider failures preserve a useful clarification", async () => {
  const named = Object.assign(new Error("Module boundary"), { name: "AiConfigurationError" });
  const unavailableDraft = await advance(scope, { action: "start", message: "What about my purchase?" }, async () => { throw named; });
  assert.match(unavailableDraft.message, /until the Azure AI workload is configured/);
  const failed = await advance(scope, { action: "start", message: "What about my purchase?" }, async () => Promise.reject({ reason: "provider failure" }));
  assert.match(failed.message, /couldn’t interpret/);
  assert.equal(failed.review, null);
});

test("disabled create and correction capabilities prevent review even when the interpreter returns a valid intent", async () => {
  setAgentPolicy({ capabilities: [] });
  const creating = await completeDraft();
  assert.equal(creating.review, null);
  assert.match(creating.message, /Creating transactions is disabled/);
  await seedTransaction({ id: "lunch", subject: "Lunch", amountCents: 1000, date: new Date("2026-09-29T00:00:00Z") });
  const correcting = await advance(scope, { action: "start", message: "Change lunch to $12" }, interpreted({ operation: "UPDATE", amount: "12", targetQuery: "Lunch" }));
  assert.equal(correcting.review, null);
  assert.deepEqual(correcting.choices, []);
  assert.match(correcting.message, /Correcting transactions is disabled/);
  assert.equal(postings.length, 0);
});

test("revision reservation conflicts stop interpretation before any financial write", async (t) => {
  const initial = await completeDraft();
  let providerCalls = 0;
  t.mock.method(db.transactionAgentDraft, "updateMany", async ({ data }) => {
    assert.deepEqual(data.revision, { increment: 1 });
    return { count: 0 };
  });
  await assert.rejects(advance(scope, { action: "message", ...ref(initial), message: "Change the amount" }, async () => { providerCalls++; return EMPTY_TRANSACTION_INTENT; }), /This draft changed/);
  assert.equal(providerCalls, 0);
  assert.equal(transactions.length, 0);
});

test("a draft revision changed during interpretation cannot be overwritten", async (t) => {
  const initial = await completeDraft();
  const update = db.transactionAgentDraft.updateMany;
  t.mock.method(db.transactionAgentDraft, "updateMany", async (args) => args.data.revision ? update(args) : { count: 0 });
  await assert.rejects(advance(scope, { action: "message", ...ref(initial), message: "Change the amount" }, interpreted({ accountQuery: "Transit", subject: "Bus fare", amount: "12" })), /This draft changed/);
  const stored = drafts.find(({ id }) => id === initial.draftId);
  assert.equal(stored.revision, initial.revision + 1);
  assert.equal(stored.status, "CLARIFY");
  assert.equal(JSON.parse(stored.stateJson).review, null);
  assert.equal(transactions.length, 0);
});

test("credit receipts describe added money, and legacy reviews without balance labels still record a receipt", async () => {
  const draft = await advance(scope, { action: "start", message: "Add $10 to Food for refund" }, interpreted({ direction: "CREDIT", accountQuery: "Food", subject: "Refund" }));
  const stored = drafts.find(({ id }) => id === draft.draftId);
  const state = JSON.parse(stored.stateJson);
  state.review.balances = [];
  stored.stateJson = JSON.stringify(state);
  const saved = await confirm(scope, { action: "confirm", ...ref(draft) });
  assert.match(saved.message, /Added SGD\s10\.00 to the sub-account\./);
  assert.equal(budgets[1].availableCents, 21000);
  assert.equal(transactions.length, 1);
});

for (const invalidation of ["status", "review"]) {
  test(`confirmation rechecks ${invalidation} after acquiring the draft lock`, async (t) => {
    const draft = await completeDraft();
    const query = db.$queryRaw;
    t.mock.method(db, "$queryRaw", async (statement) => {
      if (statement.strings.join("").includes("FROM [TransactionAgentDraft]")) {
        const stored = drafts.find(({ id }) => id === draft.draftId);
        if (invalidation === "status") stored.status = "CLARIFY";
        else {
          const state = JSON.parse(stored.stateJson);
          state.review = null;
          stored.stateJson = JSON.stringify(state);
        }
      }
      return query(statement);
    });
    await assert.rejects(confirm(scope, { action: "confirm", ...ref(draft) }), /review is no longer available/);
    assert.equal(transactions.length, 0);
    assert.equal(postings.length, 0);
    assert.equal(budgets[0].availableCents, 10000);
  });
}

for (const change of ["deleted", "changed"]) {
  test(`correction confirmation rejects a ${change} original without a reversal`, async () => {
    await seedTransaction({ id: "lunch", subject: "Lunch", amountCents: 1000, date: new Date("2026-09-29T00:00:00Z") });
    const draft = await advance(scope, { action: "start", message: "Change lunch to $12" }, interpreted({ operation: "UPDATE", amount: "12", targetQuery: "Lunch" }));
    if (change === "deleted") transactions = [];
    else transactions[0].subject = "Lunch with a colleague";
    await assert.rejects(confirm(scope, { action: "confirm", ...ref(draft) }), /transaction changed since you reviewed it/);
    assert.equal(postings.length, 0);
    assert.ok(transactions.every(({ voidedAt }) => voidedAt === null));
    assert.equal(budgets[1].availableCents, 20000);
  });
}
