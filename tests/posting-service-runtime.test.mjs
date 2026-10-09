import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PostingConflictError, PostingValidationError, dataCalls, given, invocations, prisma, request, require } from "./finance-route-harness.mjs";

const posting = require("../lib/posting-service.ts");
const { Prisma } = require("@prisma/client");
const operation = { workspaceId: "home", operation: "TRANSFER", idempotencyKey: "transfer-once", request: { amountCents: 400 } };
const stored = { requestHash: createHash("sha256").update(JSON.stringify(operation.request)).digest("hex"), status: "COMPLETED", resultJson: '{"transactionId":"earlier"}', postingGroupId: "earlier-group" };
const knownError = (code, meta) => new Prisma.PrismaClientKnownRequestError("Database failure", { code, meta, clientVersion: "6.16.3" });

test("idempotency keys honor trimmed caller keys, stable server fallbacks, and generated IDs", () => {
  assert.equal(posting.getIdempotencyKey(request("POST", {}, { headers: { "idempotency-key": "  caller-key  " } }), "fallback"), "caller-key");
  const empty = request("POST", {}, { headers: { "idempotency-key": "" } });
  assert.equal(posting.getIdempotencyKey(empty, "fallback"), "fallback");
  empty.headers.delete("idempotency-key");
  assert.match(posting.getIdempotencyKey(empty), /^[a-f\d-]{36}$/);
  assert.equal(posting.getIdempotencyKey(empty, "x".repeat(191)), "x".repeat(191));
  assert.throws(() => posting.getIdempotencyKey(empty, "x".repeat(192)), PostingConflictError);
});

for (const extra of [{}, { actorUserId: "editor", sourceType: "TRANSACTION", sourceId: "source", reversalOfId: "original", reason: "Correction" }]) {
  test(`new postings atomically persist their fingerprint, attribution, and result with ${Object.keys(extra).length} optional fields`, async () => {
    given("$queryRaw", []);
    given("$executeRaw", 1, 1, 1);
    let groupId;
    const result = await posting.executePosting({ ...operation, ...extra }, async (db, id) => {
      assert.equal(db, prisma);
      groupId = id;
      return { transactionId: "created" };
    });
    assert.deepEqual(result, { result: { transactionId: "created" }, postingGroupId: groupId, replayed: false });
    assert.match(groupId, /^[a-f\d-]{36}$/);
    assert.deepEqual(dataCalls("$transaction"), [{ isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 }]);
    const sql = dataCalls("$executeRaw");
    assert.match(sql[0].sql, /INSERT INTO \[IdempotencyRecord\]/);
    assert.deepEqual(sql[0].values.slice(1), ["home", "TRANSFER", "transfer-once", stored.requestHash]);
    assert.deepEqual(sql[1].values, [groupId, "home", "TRANSFER", extra.sourceType ?? null, extra.sourceId ?? null, extra.actorUserId ?? null, "transfer-once", extra.reversalOfId ?? null, extra.reason ?? null]);
    assert.deepEqual(sql[2].values, [groupId, '{"transactionId":"created"}', sql[0].values[0]]);
    assert.ok(invocations("$executeRaw").every((call) => call.inTransaction));
    assert.deepEqual(dataCalls("$queryRaw")[0].values, ["home", "TRANSFER", "transfer-once"]);
  });
}

test("completed postings replay only the matching request without opening a transaction", async () => {
  given("$queryRaw", [stored]);
  let executed = false;
  const result = await posting.executePosting(operation, async () => { executed = true; });
  assert.deepEqual(result, { result: { transactionId: "earlier" }, postingGroupId: "earlier-group", replayed: true });
  assert.equal(executed, false);
  assert.equal(invocations("$transaction").length, 0);
});

for (const [label, change, message] of [
  ["different request", { requestHash: "another-hash" }, /different request/],
  ["incomplete status", { status: "IN_PROGRESS" }, /still in progress/],
  ["missing result", { resultJson: null }, /still in progress/],
  ["missing posting group", { postingGroupId: null }, /still in progress/],
]) {
  test(`idempotent replay rejects ${label}`, async () => {
    given("$queryRaw", [{ ...stored, ...change }]);
    await assert.rejects(posting.executePosting(operation, async () => assert.fail("Must not execute")), message);
    assert.equal(invocations("$transaction").length, 0);
  });
}

for (const failure of [knownError("P2002"), knownError("P2010", { message: "Duplicate index entry" }), knownError("P2010", { message: "UNIQUE constraint" })]) {
  test(`a concurrent unique-key collision replays the winning operation (${failure.code}: ${failure.meta?.message ?? "typed"})`, async () => {
    given("$queryRaw", [], [stored]);
    given("$executeRaw", failure);
    const result = await posting.executePosting(operation, async () => assert.fail("Must not run after a failed claim"));
    assert.deepEqual(result, { result: { transactionId: "earlier" }, postingGroupId: "earlier-group", replayed: true });
    assert.equal(invocations("$queryRaw").length, 2);
  });
}

for (const failure of [new Error("Connectivity"), knownError("P2020"), knownError("P2010"), knownError("P2010", { message: "Database unavailable" })]) {
  test(`non-unique database failures propagate without replay (${failure.code ?? "untyped"}: ${failure.meta?.message ?? "none"})`, async () => {
    given("$queryRaw", []);
    given("$executeRaw", failure);
    await assert.rejects(posting.executePosting(operation, async () => assert.fail("Must not run")), (error) => error === failure);
    assert.equal(invocations("$queryRaw").length, 1);
  });
}

test("a collision without a winning record propagates its original failure", async () => {
  const failure = knownError("P2002");
  given("$queryRaw", [], []);
  given("$executeRaw", failure);
  await assert.rejects(posting.executePosting(operation, async () => assert.fail("Must not run")), (error) => error === failure);
});

test("a posting callback failure aborts before marking the operation complete", async () => {
  const failure = new PostingValidationError("Invalid allocation");
  given("$queryRaw", []);
  given("$executeRaw", 1, 1);
  await assert.rejects(posting.executePosting(operation, async () => { throw failure; }), (error) => error === failure);
  assert.equal(invocations("$executeRaw").length, 2);
});

test("cross-workspace posting groups retain their attribution and default absent fields to null", async () => {
  for (const extra of [{}, { sourceType: "RECEIVABLE", sourceId: "receivable", actorUserId: "editor" }]) {
    given("$executeRaw", 1);
    const id = await posting.createPostingGroupRecord(prisma, { workspaceId: "shared", operation: "RECEIVABLE_CLOSE_SOURCE", idempotencyKey: "once", ...extra });
    assert.match(id, /^[a-f\d-]{36}$/);
    assert.deepEqual(dataCalls("$executeRaw").at(-1).values, [id, "shared", "RECEIVABLE_CLOSE_SOURCE", extra.sourceType ?? null, extra.sourceId ?? null, extra.actorUserId ?? null, "once"]);
  }
});

test("credit and receivable claims require exactly one eligible row", async () => {
  for (const [method, model] of [[posting.claimCreditCardTransaction, "creditCardTransaction"], [posting.claimReceivable, "receivable"]]) {
    given(`${model}.updateMany`, { count: 1 }, { count: 0 });
    await method(prisma, "record");
    await assert.rejects(method(prisma, "record"), PostingConflictError);
  }
  assert.deepEqual(dataCalls("creditCardTransaction.updateMany")[0], { where: { id: "record", isAllocated: false }, data: { isAllocated: true } });
  assert.deepEqual(dataCalls("receivable.updateMany")[0], { where: { id: "record", status: { notIn: ["PAID", "PROCESSING"] } }, data: { status: "PROCESSING" } });
});

const original = {
  id: "record", workspaceId: "home", accountId: "bank", budgetId: "daily", groupId: "meals", kind: "EXPENSE", direction: "DEBIT",
  date: new Date("2026-10-01T00:00:00.000Z"), amountCents: 400, subject: "Dinner", details: "Original details", notes: "Original notes",
  externalRef: "source-reference", creditCardTransactionId: null, receivableId: null, voidedAt: null,
  creditCardLinks: [], postingGroup: { operation: "TRANSACTION_CREATE" }, isSynced: true, isFromFamily: true,
};
const correction = { transactionId: "record", actorUserId: "editor", reason: "Wrong amount", replacement: { subject: "Corrected dinner" } };
function setupCorrection(current = original) {
  given("$queryRaw", [{ id: "record" }]);
  given("transaction.findUnique", current);
  given("budgetEnvelope.findFirst", { id: "budget" });
  given("transactionGroup.findFirst", { id: "group" });
  let sequence = 0;
  const create = ({ data }) => ({ ...data, id: `transaction-${++sequence}` });
  given("transaction.create", create, create);
  given("transaction.updateMany", { count: 1 });
  given("budgetEnvelope.update", { id: "old-budget", availableCents: 100 }, { id: "new-budget", availableCents: 200 });
}
const applyCorrection = (params = correction) => posting.correctLedgerTransactionInPosting(prisma, "correction-group", params);

test("corrections require an existing, unvoided transaction under the ledger lock", async () => {
  for (const [locked, current, message] of [[[], original, /not found/], [[{ id: "record" }], null, /already reversed/], [[{ id: "record" }], { ...original, voidedAt: new Date() }, /already reversed/]]) {
    setupCorrection(current);
    given("$queryRaw", locked);
    await assert.rejects(applyCorrection(), message);
    assert.equal(invocations("transaction.create").length, 0);
  }
});

for (const [label, change] of [
  ["transfer", { kind: "TRANSFER" }],
  ["credit transaction", { creditCardTransactionId: "credit-transaction" }],
  ["receivable", { receivableId: "receivable" }],
  ["card link", { creditCardLinks: [{ id: "link" }] }],
  ["linked posting", { postingGroup: { operation: "RECEIVABLE_CLOSE" } }],
]) {
  test(`corrections refuse the linked ${label} workflow`, async () => {
    setupCorrection({ ...original, ...change });
    await assert.rejects(applyCorrection(), /linked financial workflow/);
    assert.equal(invocations("transaction.create").length, 0);
  });
}

for (const [label, replacement, missing, message] of [
  ["group without subaccount", { budgetId: null, groupId: "group" }, null, /requires a selected sub-account/],
  ["foreign subaccount", { budgetId: "foreign" }, "budgetEnvelope.findFirst", /does not belong to this transaction account/],
  ["foreign group", { groupId: "foreign" }, "transactionGroup.findFirst", /does not belong to this sub-account/],
]) {
  test(`correction allocation rejects ${label} as a validation error`, async () => {
    setupCorrection();
    if (missing) given(missing, null);
    await assert.rejects(applyCorrection({ ...correction, replacement }), (error) => error instanceof PostingValidationError && message.test(error.message));
    assert.equal(invocations("transaction.create").length, 0);
  });
}

for (const [label, change, replacement, allocation, deltas] of [
  ["unchanged allocation", {}, { subject: "Corrected dinner" }, { budgetId: "daily", groupId: "meals", direction: "DEBIT", amountCents: 400, kind: "EXPENSE" }, []],
  ["changed subaccount", { direction: "CREDIT", postingGroup: null, externalRef: null }, { budgetId: "next", amountCents: 500, direction: "DEBIT", kind: "ADJUSTMENT", notes: null, details: null, date: new Date("2026-10-02T00:00:00.000Z") }, { budgetId: "next", groupId: null, direction: "DEBIT", amountCents: 500, kind: "ADJUSTMENT" }, [["daily", -400], ["next", -500]]],
  ["legacy income and explicit group", { direction: "Incoming", kind: "INCOME", groupId: null }, { groupId: "new-group", amountCents: 500 }, { budgetId: "daily", groupId: "new-group", direction: "CREDIT", amountCents: 500, kind: "INCOME" }, [["daily", 100]]],
  ["removed subaccount", { direction: "Outgoing" }, { budgetId: null }, { budgetId: null, groupId: null, direction: "DEBIT", amountCents: 400, kind: "EXPENSE" }, [["daily", 400]]],
  ["unbudgeted transaction", { budgetId: null, groupId: null, externalRef: null }, { notes: "New notes" }, { budgetId: null, groupId: null, direction: "DEBIT", amountCents: 400, kind: "EXPENSE" }, []],
  ["explicitly cleared group", { kind: "ADJUSTMENT" }, { groupId: null }, { budgetId: "daily", groupId: null, direction: "DEBIT", amountCents: 400, kind: "ADJUSTMENT" }, []],
]) {
  test(`correction preserves the reversal history and net budget effect for ${label}`, async () => {
    const current = { ...original, ...change };
    setupCorrection(current);
    const result = await applyCorrection({ ...correction, replacement });
    assert.equal(result.ok, true);
    assert.equal(result.correctedTransactionId, "record");
    assert.equal(result.reversalTransactionId, "transaction-1");
    assert.equal(result.replacementTransactionId, "transaction-2");
    assert.equal(result.updatedBudgets.length, deltas.length);
    const [reversal, corrected] = dataCalls("transaction.create").map(({ data }) => data);
    assert.deepEqual(reversal, {
      workspaceId: "home", accountId: "bank", budgetId: current.budgetId, kind: "REVERSAL",
      direction: ["CREDIT", "Incoming"].includes(current.direction) ? "DEBIT" : "CREDIT", date: reversal.date, amountCents: 400,
      subject: "Reversal: Dinner", details: correction.reason, notes: current.notes,
      externalRef: current.externalRef ? `reversal:${current.externalRef}` : "reversal:record", reversalOfId: "record", isSynced: false, isFromFamily: false,
      postingGroupId: "correction-group",
    });
    assert.ok(reversal.date instanceof Date);
    for (const [key, value] of Object.entries(allocation)) assert.deepEqual(corrected[key], value, key);
    assert.deepEqual(corrected.date, replacement.date ?? current.date);
    assert.equal(corrected.subject, replacement.subject ?? current.subject);
    assert.equal(corrected.notes, Object.hasOwn(replacement, "notes") ? replacement.notes : current.notes);
    assert.equal(corrected.details, Object.hasOwn(replacement, "details") ? replacement.details : current.details);
    assert.equal(corrected.isFromFamily, true);
    assert.equal(corrected.isSynced, false);
    assert.equal(corrected.externalRef, "correction:record:correction-group");
    const [voidQuery] = dataCalls("transaction.updateMany");
    assert.deepEqual(voidQuery.where, { id: "record", voidedAt: null });
    assert.equal(voidQuery.data.voidedByUserId, "editor");
    assert.equal(voidQuery.data.voidReason, correction.reason);
    assert.ok(voidQuery.data.voidedAt instanceof Date);
    assert.deepEqual(dataCalls("budgetEnvelope.update").map(({ where, data }) => [where.id, data.availableCents.increment]), deltas);
    if (allocation.budgetId) {
      assert.deepEqual(dataCalls("budgetEnvelope.findFirst")[0].where, { id: allocation.budgetId, workspaceId: "home", accountId: "bank", ...(allocation.budgetId !== current.budgetId ? { isActive: true } : {}) });
    }
    if (allocation.groupId) assert.deepEqual(dataCalls("transactionGroup.findFirst")[0].where, { id: allocation.groupId, workspaceId: "home", budgetId: allocation.budgetId });
  });
}

test("unsupported ledger directions cannot be corrected", async () => {
  setupCorrection({ ...original, direction: "SIDEWAYS" });
  await assert.rejects(applyCorrection(), /unsupported ledger direction/);
  assert.equal(invocations("transaction.create").length, 0);
});

test("a lost reversal claim prevents replacement and balance changes", async () => {
  setupCorrection();
  given("transaction.updateMany", { count: 0 });
  await assert.rejects(applyCorrection(), /already reversed or corrected/);
  assert.equal(invocations("transaction.create").length, 1);
  assert.equal(invocations("budgetEnvelope.update").length, 0);
});

test("public correction loads the source and runs the reversal and replacement in a serialized posting", async () => {
  setupCorrection();
  given("transaction.findUnique", original, original);
  given("$queryRaw", [], [{ id: "record" }]);
  given("$executeRaw", 1, 1, 1);
  const result = await posting.correctLedgerTransaction({ ...correction, idempotencyKey: "correct-once" });
  assert.equal(result.result.replacementTransactionId, "transaction-2");
  assert.equal(result.replayed, false);
  assert.match(result.postingGroupId, /^[a-f\d-]{36}$/);
  assert.ok(invocations("transaction.create").every((call) => call.inTransaction));
  const expectedHash = createHash("sha256").update(JSON.stringify({ transactionId: "record", reason: correction.reason, replacement: correction.replacement })).digest("hex");
  assert.deepEqual(dataCalls("$executeRaw")[0].values.slice(1), ["home", "TRANSACTION_CORRECTION", "correct-once", expectedHash]);
});

test("public corrections refuse missing records and linked workflows before claiming an idempotency key", async () => {
  given("transaction.findUnique", null, { ...original, kind: "TRANSFER" });
  await assert.rejects(posting.correctLedgerTransaction({ ...correction, idempotencyKey: "once" }), /not found/);
  await assert.rejects(posting.correctLedgerTransaction({ ...correction, idempotencyKey: "once" }), /linked financial workflow/);
  assert.equal(invocations("$queryRaw").length, 0);
});

const reversalParams = { transactionId: "record", actorUserId: "editor", reason: "Duplicate entry", idempotencyKey: "reverse-once" };
function setupReversal(source = original, locked = [{ voidedAt: null }], links = []) {
  given("transaction.findUnique", source);
  given("$queryRaw", [], locked, links);
  given("$executeRaw", 1, 1, 1, 1);
  given("transaction.create", ({ data }) => ({ ...data, id: "reversal" }));
  given("budgetEnvelope.update", { id: "daily", availableCents: 400 });
  given("creditCardTransaction.updateMany", { count: 1 });
}

for (const [direction, links, releasedId, delta] of [
  ["CREDIT", [{ creditCardTransactionId: "source-credit" }], "source-credit", -400],
  ["DEBIT", [], null, 400],
  ["Incoming", [{ creditCardTransactionId: null }], null, -400],
]) {
  test(`reversal offsets ${direction} transactions and releases linked credit allocation when present`, async () => {
    setupReversal({ ...original, direction }, undefined, links);
    const result = await posting.reverseLedgerTransaction(reversalParams);
    assert.deepEqual(result.result, { ok: true, reversedTransactionId: "record", reversalTransactionId: "reversal" });
    assert.equal(result.replayed, false);
    const transaction = dataCalls("transaction.create")[0].data;
    assert.equal(transaction.kind, "REVERSAL");
    assert.equal(transaction.direction, delta > 0 ? "CREDIT" : "DEBIT");
    assert.equal(transaction.reversalOfId, "record");
    assert.equal(transaction.postingGroupId, result.postingGroupId);
    assert.deepEqual(dataCalls("budgetEnvelope.update")[0].data, { availableCents: { increment: delta } });
    const queries = dataCalls("$queryRaw");
    assert.match(queries[1].sql, /WITH \(UPDLOCK, HOLDLOCK\)/);
    assert.match(queries[2].sql, /FROM \[CreditCardTxnLink\]/);
    assert.deepEqual(queries[2].values, ["record"]);
    const voidSql = dataCalls("$executeRaw")[2];
    assert.match(voidSql.sql, /\[voidedAt\] IS NULL/);
    assert.deepEqual(voidSql.values, ["editor", "Duplicate entry", "record"]);
    assert.deepEqual(dataCalls("creditCardTransaction.updateMany"), releasedId ? [{ where: { id: releasedId }, data: { isAllocated: false } }] : []);
    assert.ok(invocations("transaction.create")[0].inTransaction);
  });
}

test("reversal refuses missing records before beginning a posting", async () => {
  given("transaction.findUnique", null);
  await assert.rejects(posting.reverseLedgerTransaction(reversalParams), /Transaction not found/);
  assert.equal(invocations("$transaction").length, 0);
});

for (const locked of [[], [{ voidedAt: new Date() }]]) {
  test(`reversal rejects a transaction ${locked.length ? "already voided" : "removed"} after the initial read`, async () => {
    setupReversal(original, locked);
    await assert.rejects(posting.reverseLedgerTransaction(reversalParams), /already reversed/);
    assert.equal(invocations("transaction.create").length, 0);
  });
}

test("budget reconciliation includes both direction conventions, ignores other budgets, and reports drift without writes", async () => {
  given("budgetEnvelope.findMany", [{ id: "daily", name: "Daily", availableCents: 80 }, { id: "empty", name: "Empty", availableCents: 0 }]);
  given("transaction.groupBy", [
    { budgetId: "daily", direction: "CREDIT", _sum: { amountCents: 100 } },
    { budgetId: "daily", direction: "Incoming", _sum: { amountCents: 40 } },
    { budgetId: "daily", direction: "DEBIT", _sum: { amountCents: 20 } },
    { budgetId: "daily", direction: "Outgoing", _sum: { amountCents: null } },
    { budgetId: "another", direction: "CREDIT", _sum: { amountCents: 1000 } },
  ]);
  assert.deepEqual(await posting.reconcileWorkspaceBudgets(prisma, "home"), [
    { budgetId: "daily", budgetName: "Daily", materializedCents: 80, ledgerCents: 120, driftCents: -40 },
    { budgetId: "empty", budgetName: "Empty", materializedCents: 0, ledgerCents: 0, driftCents: 0 },
  ]);
  assert.deepEqual(dataCalls("budgetEnvelope.findMany")[0].where, { workspaceId: "home", isActive: true });
  assert.deepEqual(dataCalls("transaction.groupBy")[0], { by: ["budgetId", "direction"], where: { workspaceId: "home", budgetId: { not: null } }, _sum: { amountCents: true } });
  assert.equal(invocations("budgetEnvelope.update").length, 0);
});
