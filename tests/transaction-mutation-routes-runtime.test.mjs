import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiAuthError, PostingConflictError, PostingValidationError, accessChecks, assertNoWrites,
  context, dataCalls, given, invocations, request, require, responseBody, state,
} from "./finance-route-harness.mjs";

const transactions = require("../app/api/transactions/[id]/route.ts");
const corrections = require("../app/api/transactions/[id]/corrections/route.ts");
const current = { id: "record", workspaceId: "home", accountId: "bank", budgetId: "daily", direction: "DEBIT", amountCents: 300 };
const handlers = [[transactions.PATCH, "PATCH", { budgetId: "daily" }], [transactions.DELETE, "DELETE"], [corrections.POST, "POST", { subject: "Corrected" }]];

for (const [handler, method, input] of handlers) {
  test(`transaction ${method} rejects foreign origins without reading the ledger`, async () => {
    await responseBody(await handler(request(method, input, { headers: { origin: "https://untrusted.example" } }), context()), 403);
    assert.equal(invocations("transaction.findUnique").length, 0);
    assertNoWrites();
  });
  test(`transaction ${method} returns a missing-record response`, async () => {
    given("transaction.findUnique", null);
    const result = await responseBody(await handler(request(method, input), context()), 404);
    assert.equal(result.error, "Transaction not found");
    assertNoWrites();
  });
  test(`transaction ${method} requires EDITOR in the record's workspace`, async () => {
    given("transaction.findUnique", current);
    state.accessError = new ApiAuthError(403, "Forbidden");
    await responseBody(await handler(request(method, input), context()), 403);
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
    assertNoWrites();
  });
}

test("transaction updates require a subaccount and corrections require an actual changed field", async () => {
  for (const [handler, method, body] of [[transactions.PATCH, "PATCH", { amountCents: 40 }], [corrections.POST, "POST", { reason: "Please update" }], [corrections.POST, "POST", { kind: "TRANSFER" }]]) {
    const result = await responseBody(await handler(request(method, body), context()), 400);
    assert.ok(result.error.formErrors.length || Object.keys(result.error.fieldErrors).length);
  }
  assert.equal(invocations("transaction.findUnique").length, 0);
  assertNoWrites();
});

for (const [label, locked, message] of [
  ["deleted", [], "Transaction is unavailable for update."],
  ["voided", [{ voidedAt: new Date() }], "Transaction is unavailable for update."],
  ["posted", [{ voidedAt: null, postingGroupId: "original-posting" }], "Posted transactions are immutable; reverse and replace instead."],
]) {
  test(`legacy transaction updates reject a ${label} ledger row under its posting lock`, async () => {
    given("transaction.findUnique", current);
    given("$queryRaw", locked);
    const result = await responseBody(await transactions.PATCH(request("PATCH", { budgetId: "daily" }), context()), 409);
    assert.equal(result.error, message);
    assert.equal(result.code, "CONFLICT");
    assert.equal(invocations("transaction.update").length, 0);
    const lock = invocations("$queryRaw")[0];
    assert.ok(lock.inPosting);
    assert.match(lock.args[0].sql, /WITH \(UPDLOCK, HOLDLOCK\)/);
    assert.deepEqual(lock.args[0].values, ["record"]);
  });
}

test("transaction allocation validates both account ownership and group membership before updating", async () => {
  for (const validBudget of [false, true]) {
    given("transaction.findUnique", current);
    given("$queryRaw", [{ voidedAt: null, postingGroupId: null }]);
    given("transaction.findUniqueOrThrow", current);
    given("budgetEnvelope.findFirst", validBudget ? { id: "daily" } : null);
    if (validBudget) given("transactionGroup.findFirst", null);
    const result = await responseBody(await transactions.PATCH(request("PATCH", { budgetId: "daily", groupId: "group" }), context()), 400);
    assert.match(result.error, validBudget ? /Selected group/ : /Selected budget/);
    assert.equal(invocations("transaction.update").length, 0);
  }
  assert.deepEqual(dataCalls("budgetEnvelope.findFirst")[0].where, { id: "daily", workspaceId: "home", accountId: "bank", isActive: true });
  assert.deepEqual(dataCalls("transactionGroup.findFirst")[0].where, { id: "group", workspaceId: "home", budgetId: "daily" });
});

for (const [label, lockedCurrent, input, deltas] of [
  ["same subaccount", current, { budgetId: "daily", amountCents: 350, groupId: null }, [["daily", -50]]],
  ["fresh amount and changed subaccount", { ...current, budgetId: "old-budget", amountCents: 700 }, { budgetId: "daily", amountCents: 200, direction: "CREDIT", groupId: "group", subject: "New details", notes: null, details: "Memo", date: "2026-10-09T00:00:00.000Z", kind: "INCOME" }, [["old-budget", 700], ["daily", 200]]],
]) {
  test(`legacy transaction updates apply the correct net balance for ${label}`, async () => {
    const updated = { ...lockedCurrent, ...input };
    given("transaction.findUnique", current);
    given("$queryRaw", [{ voidedAt: null, postingGroupId: null }]);
    given("transaction.findUniqueOrThrow", lockedCurrent);
    given("budgetEnvelope.findFirst", { id: "daily" });
    if (input.groupId) given("transactionGroup.findFirst", { id: "group" });
    given("transaction.update", updated);
    given("budgetEnvelope.update", ...deltas.map(([id]) => ({ id })));
    given("$executeRaw", 1);
    const result = await responseBody(await transactions.PATCH(request("PATCH", input), context()));
    assert.deepEqual(result, { ...updated, postingGroupId: "posting-group", replayed: false });
    assert.deepEqual(dataCalls("transaction.update"), [{ where: { id: "record" }, data: input }]);
    assert.deepEqual(dataCalls("budgetEnvelope.update").map(({ where, data }) => [where.id, data.availableCents.increment]), deltas);
    assert.deepEqual(dataCalls("posting")[0], { workspaceId: "home", operation: "TRANSACTION_UPDATE", idempotencyKey: "operation-once", actorUserId: "editor", sourceType: "TRANSACTION", sourceId: "record", request: { transactionId: "record", ...input } });
    const journalUpdate = invocations("$executeRaw")[0];
    assert.deepEqual(journalUpdate.args[0].values, ["posting-group", "record"]);
    assert.ok([...invocations("transaction.update"), ...invocations("budgetEnvelope.update"), journalUpdate].every((call) => call.inPosting));
  });
}

test("retried transaction edits return the stored posting without applying a second balance change", async () => {
  given("transaction.findUnique", current);
  state.replayedPosting = { result: current, postingGroupId: "earlier", replayed: true };
  assert.deepEqual(await responseBody(await transactions.PATCH(request("PATCH", { budgetId: "daily" }), context())), { ...current, postingGroupId: "earlier", replayed: true });
  assert.equal(invocations("$queryRaw").length, 0);
  assert.equal(invocations("transaction.update").length, 0);
});

for (const [supplied, expected] of [[undefined, "User requested transaction reversal"], ["   ", "User requested transaction reversal"], ["   Duplicate purchase   ", "Duplicate purchase"], ["x".repeat(600), "x".repeat(500)]]) {
  test(`transaction deletion requests an attributed reversal with reason length ${supplied?.length ?? 0}`, async () => {
    given("transaction.findUnique", current);
    const posting = { result: { ok: true, reversalTransactionId: "reversal" }, postingGroupId: "reversal-posting", replayed: false };
    given("ledger.reverse", posting);
    const headers = supplied === undefined ? {} : { "x-reversal-reason": supplied };
    assert.deepEqual(await responseBody(await transactions.DELETE(request("DELETE", undefined, { headers }), context())), { ...posting.result, postingGroupId: posting.postingGroupId, replayed: false });
    assert.deepEqual(dataCalls("ledger.reverse"), [{ transactionId: "record", actorUserId: "editor", reason: expected, idempotencyKey: "operation-once" }]);
    assert.equal(invocations("transaction.delete").length, 0);
  });
}

for (const input of [{ notes: null }, { subject: "Corrected", date: "2026-10-09T00:00:00.000Z", reason: "  Wrong date  ", amountCents: 500, budgetId: null, groupId: null }]) {
  test(`transaction correction passes validated replacement fields ${Object.keys(input).join(", ")} to the ledger`, async () => {
    given("transaction.findUnique", current);
    given("ledger.correct", { result: { tx: { id: "replacement" } }, postingGroupId: "correction", replayed: true });
    assert.deepEqual(await responseBody(await corrections.POST(request("POST", input), context())), { tx: { id: "replacement" }, postingGroupId: "correction", replayed: true });
    const { reason, date, ...replacement } = input;
    assert.deepEqual(dataCalls("ledger.correct"), [{
      transactionId: "record", actorUserId: "editor", reason: reason?.trim() || "User corrected transaction", idempotencyKey: "operation-once",
      replacement: { ...replacement, ...(date ? { date: new Date(date) } : {}) },
    }]);
  });
}

for (const [failure, status, expectedError] of [
  [new PostingConflictError("Already corrected"), 409, "Already corrected"],
  [new PostingValidationError("Selected group does not belong to this sub-account."), 400, "Selected group does not belong to this sub-account."],
  [new Error("secret database credentials"), 500, "Failed to correct transaction"],
]) {
  test(`correction errors return the appropriate safe ${status} response`, async () => {
    given("transaction.findUnique", current);
    given("ledger.correct", failure);
    const result = await responseBody(await corrections.POST(request("POST", { notes: "Updated" }), context()), status);
    assert.equal(result.error, expectedError);
  });
}
