import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, context, dataCalls, given, invocations,
  request, require, responseBody, state,
} from "./finance-route-harness.mjs";

const { POST } = require("../app/api/credit-transactions/[id]/accounting/route.ts");
const timestamp = "2026-10-09T00:00:00.000Z";
const transaction = { id: "record", creditCardId: "card", workspaceId: "home", amountCents: 400, transactionDate: new Date(timestamp), subject: "Shared meal", creditCard: { id: "card", cardName: "Travel", last4Digit: "1234", workspaceId: "home" } };
const deduct = { action: "DEDUCT", accountId: "source-bank", budgetId: "source-budget" };
const receivable = { action: "RECEIVABLE", title: "Dinner share", amountCents: 200, receivableDate: timestamp };
const review = { smartReviewFingerprint: "a".repeat(64), smartReviewGeneratedAt: timestamp };
function setup() {
  given("creditCardTransaction.findUnique", transaction);
  given("financialAccount.findFirst", { id: "source-bank", name: "Bank", workspaceId: "home" });
  given("budgetEnvelope.findFirst", { id: "source-budget", name: "Daily" }, { id: "target-budget", accountId: "target-bank" });
  given("workspace.findUnique", { receivableDefaultAccountId: "target-bank", receivableDefaultBudgetId: "target-budget" });
  given("creditCardTransaction.updateMany", { count: 1 });
  let index = 0;
  const createTransaction = ({ data }) => ({ ...data, id: `ledger-${++index}` });
  given("transaction.create", createTransaction, createTransaction);
  given("budgetEnvelope.update", { id: "source-budget" }, { id: "target-budget" });
  given("creditCardTxnLink.create", { id: "link" });
  given("receivable.create", { id: "receivable" });
  given("$executeRaw", 1);
}
const account = (body = deduct, options) => POST(request("POST", body, options), context());

test("credit accounting enforces same-origin editor authorization", async () => {
  await responseBody(await account(deduct, { headers: { origin: "https://untrusted.example" } }), 403);
  assert.deepEqual(accessChecks, []);
  setup();
  state.accessError = new ApiAuthError(403, "Forbidden");
  await responseBody(await account(), 403);
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
  assertNoWrites();
});

test("credit accounting distinguishes a missing transaction from invalid input", async () => {
  given("creditCardTransaction.findUnique", null);
  assert.equal((await responseBody(await account(), 404)).error, "Credit transaction not found");
  const invalid = await responseBody(await account({ action: "RECEIVABLE", amountCents: -1 }), 400);
  assert.ok(invalid.error.fieldErrors.amountCents.length);
  assertNoWrites();
});

for (const [label, input, message] of [
  ["fingerprint only", { ...deduct, smartReviewFingerprint: review.smartReviewFingerprint }, "fingerprint and generation time"],
  ["time only", { ...receivable, smartReviewGeneratedAt: timestamp }, "fingerprint and generation time"],
  ["destination account only", { ...deduct, destinationAccountId: "target-bank" }, "destination account and destination sub account"],
  ["destination budget only", { ...deduct, destinationBudgetId: "target-budget" }, "destination account and destination sub account"],
]) {
  test(`credit accounting rejects a partial pair: ${label}`, async () => {
    const result = await responseBody(await account(input), 400);
    assert.ok(result.error.formErrors.some((error) => error.includes(message)));
    assert.equal(invocations("creditCardTransaction.findUnique").length, 0);
    assertNoWrites();
  });
}

for (const [fresh, fingerprint, message] of [[false, null, "expired"], [true, null, "stale"], [true, "b".repeat(64), "stale"]]) {
  test(`Smart Review rejects ${message} suggestions before allocating the transaction (${fingerprint?.slice(0, 1) ?? "missing"})`, async () => {
    setup();
    given("smartReview.fresh", fresh);
    given("smartReview.fingerprint", fingerprint);
    assert.match((await responseBody(await account({ ...deduct, ...review }), 409)).error, new RegExp(message));
    assert.equal(invocations("smartReview.fingerprint").length, fresh ? 1 : 0);
    assertNoWrites();
  });
}

for (const [label, workspace, extra, destination] of [
  ["workspace defaults", { receivableDefaultAccountId: "target-bank", receivableDefaultBudgetId: "target-budget" }, {}, true],
  ["explicit destination", { receivableDefaultAccountId: "unused-bank", receivableDefaultBudgetId: "unused-budget" }, { destinationAccountId: "target-bank", destinationBudgetId: "target-budget", ...review }, true],
  ["no defaults", { receivableDefaultAccountId: null, receivableDefaultBudgetId: null }, {}, false],
  ["missing workspace defaults", null, {}, false],
]) {
  test(`credit deduction applies ${label} in one claimed posting`, async () => {
    setup();
    given("workspace.findUnique", workspace);
    if (extra.smartReviewFingerprint) {
      given("smartReview.fresh", true);
      given("smartReview.fingerprint", extra.smartReviewFingerprint);
    }
    const result = await responseBody(await account({ ...deduct, ...extra }));
    assert.deepEqual(result, { ok: true, action: "DEDUCT", transactionId: "ledger-1", postingGroupId: "posting-group", replayed: false });
    assert.deepEqual(dataCalls("creditCardTransaction.updateMany"), [{ where: { id: "record", isAllocated: false }, data: { isAllocated: true } }]);
    const ledger = dataCalls("transaction.create").map(({ data }) => data);
    assert.equal(ledger.length, destination ? 2 : 1);
    assert.deepEqual(ledger[0], {
      workspaceId: "home", accountId: "source-bank", budgetId: "source-budget", kind: "CREDIT_CARD_PAYMENT", direction: "DEBIT",
      date: new Date(timestamp), amountCents: 400, subject: "Shared meal", details: "Accounted from Travel ••1234",
      creditCardTransactionId: "record", isSynced: false, isFromFamily: false, postingGroupId: "posting-group",
    });
    if (destination) {
      assert.equal(ledger[1].accountId, "target-bank");
      assert.equal(ledger[1].budgetId, "target-budget");
      assert.equal(ledger[1].direction, "CREDIT");
      assert.equal(ledger[1].amountCents, 400);
      assert.equal(ledger[1].subject, "Receivable: Shared meal");
      assert.deepEqual(dataCalls("budgetEnvelope.findFirst")[1].where, { id: "target-budget", workspaceId: "home", accountId: "target-bank", isActive: true, account: { kind: "BANK", isActive: true } });
    }
    assert.deepEqual(dataCalls("budgetEnvelope.update").map(({ where, data }) => [where.id, data.availableCents]), destination ? [["source-budget", { decrement: 400 }], ["target-budget", { increment: 400 }]] : [["source-budget", { decrement: 400 }]]);
    const link = dataCalls("creditCardTxnLink.create")[0].data;
    assert.deepEqual({ ...link, interfacedAt: undefined }, { creditCardId: "card", creditCardTransactionId: "record", transactionId: "ledger-1", cardNameSnapshot: "Travel", cardNoEnding: "1234", txDate: new Date(timestamp), isProcessed: true, interfacedAt: undefined });
    assert.ok(link.interfacedAt instanceof Date);
    assert.ok([...invocations("creditCardTransaction.updateMany"), ...invocations("transaction.create"), ...invocations("creditCardTxnLink.create"), ...invocations("budgetEnvelope.update")].every((call) => call.inPosting));
    assert.deepEqual(dataCalls("financialAccount.findFirst")[0].where, { id: "source-bank", workspaceId: "home", kind: "BANK", isActive: true });
    if (extra.smartReviewFingerprint) assert.deepEqual(dataCalls("smartReview.fingerprint"), [{ workspaceId: "home", userId: "editor", transactionId: "record" }]);
  });
}

for (const [label, method, values, message] of [
  ["source account", "financialAccount.findFirst", [null], "Selected deduction account is invalid"],
  ["source budget", "budgetEnvelope.findFirst", [null], "Selected sub account is invalid"],
  ["destination account setting", "workspace.findUnique", [{ receivableDefaultBudgetId: "target-budget" }], "Select both destination"],
  ["destination budget setting", "workspace.findUnique", [{ receivableDefaultAccountId: "target-bank" }], "Select both destination"],
  ["destination budget", "budgetEnvelope.findFirst", [{ id: "source-budget" }, null], "Selected destination sub account is invalid"],
  ["same source and destination", "budgetEnvelope.findFirst", [{ id: "source-budget" }, { id: "source-budget", accountId: "source-bank" }], "must be different"],
]) {
  test(`credit deduction rejects an invalid ${label}`, async () => {
    setup();
    given(method, ...values);
    assert.match((await responseBody(await account(), 400)).error, new RegExp(message));
    assertNoWrites();
  });
}

for (const [sourceWorkspace, extra] of [
  [null, {}],
  ["home", { accountId: "source-bank", budgetId: "source-budget", transactionDate: timestamp, remarks: "  Shared by Alex  ", notes: "Return after payday" }],
  ["shared", { accountId: "source-bank", budgetId: "source-budget", remarks: "   " }],
]) {
  test(`credit receivable creation preserves dates, notes and source references for ${sourceWorkspace ?? "no source"}`, async () => {
    setup();
    if (sourceWorkspace) given("financialAccount.findFirst", { id: "source-bank", workspaceId: sourceWorkspace });
    const result = await responseBody(await account({ ...receivable, ...extra }));
    assert.deepEqual(result, { ok: true, action: "RECEIVABLE", receivableId: "receivable", postingGroupId: "posting-group", replayed: false });
    assert.deepEqual(dataCalls("receivable.create")[0], {
      data: {
        workspaceId: "home", title: "Dinner share", amountCents: 200, date: new Date(timestamp), transactionDate: extra.transactionDate ? new Date(timestamp) : null,
        remarkTogether: extra.remarks?.trim() || "Created from Travel ••1234", notes: extra.notes, status: "OPEN",
        accountId: sourceWorkspace === "home" ? "source-bank" : null, budgetId: sourceWorkspace === "home" ? "source-budget" : null,
        sourceWorkspaceId: sourceWorkspace ?? undefined, sourceAccountId: sourceWorkspace ? "source-bank" : undefined, sourceBudgetId: sourceWorkspace ? "source-budget" : undefined,
      }, select: { id: true },
    });
    assert.deepEqual(invocations("$executeRaw")[0].args[0].values, ["posting-group", "receivable"]);
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }, ...(sourceWorkspace ? [{ workspaceId: sourceWorkspace, minimumRole: "EDITOR" }] : [])]);
    if (sourceWorkspace) {
      assert.deepEqual(dataCalls("financialAccount.findFirst")[0].where, { id: "source-bank", kind: "BANK", isActive: true });
      assert.deepEqual(dataCalls("budgetEnvelope.findFirst")[0].where, { id: "source-budget", workspaceId: sourceWorkspace, accountId: "source-bank", isActive: true });
    }
    assert.equal(invocations("transaction.create").length, 0);
  });
}

for (const extra of [{ accountId: "source-bank" }, { budgetId: "source-budget" }]) {
  test(`credit receivables require both source fields when ${Object.keys(extra)[0]} is supplied`, async () => {
    setup();
    assert.match((await responseBody(await account({ ...receivable, ...extra }), 400)).error, /Select both deduction account and subaccount/);
    assertNoWrites();
  });
}

for (const [label, method, value, status] of [["account", "financialAccount.findFirst", null, 400], ["subaccount", "budgetEnvelope.findFirst", null, 400], ["permissions", null, null, 403]]) {
  test(`credit receivables validate source ${label} before claiming a transaction`, async () => {
    setup();
    if (method) given(method, value);
    else {
      given("financialAccount.findFirst", { id: "source-bank", workspaceId: "shared" });
      state.workspaceErrors.set("shared", new ApiAuthError(403, "Forbidden"));
    }
    await responseBody(await account({ ...receivable, accountId: "source-bank", budgetId: "source-budget" }), status);
    assertNoWrites();
  });
}

for (const input of [deduct, receivable]) {
  test(`${input.action} accounting cannot claim a transaction that another request already processed`, async () => {
    setup();
    given("creditCardTransaction.updateMany", { count: 0 });
    assert.equal((await responseBody(await account(input), 409)).error, "Credit transaction is already accounted.");
    assert.equal(invocations("transaction.create").length, 0);
    assert.equal(invocations("receivable.create").length, 0);
  });
}

test("credit accounting retries use the record's stable key and return the earlier posting", async () => {
  setup();
  state.replayedPosting = { result: { transactionId: "earlier-tx" }, postingGroupId: "earlier-posting", replayed: true };
  const result = await responseBody(await account(deduct, { headers: { "idempotency-key": "" } }));
  assert.equal(result.transactionId, "earlier-tx");
  assert.equal(result.replayed, true);
  assert.equal(dataCalls("posting")[0].idempotencyKey, "credit-account:record");
  assert.equal(invocations("creditCardTransaction.updateMany").length, 0);
});
