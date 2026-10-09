import assert from "node:assert/strict";
import test from "node:test";
import { ApiAuthError, accessChecks, assertNoWrites, context, dataCalls, given, invocations, request, require, responseBody, state } from "./finance-route-harness.mjs";

const { POST } = require("../app/api/credit-transactions/payments/route.ts");
const input = { cardId: "card", statementMonth: 10, statementYear: 2026, amountCents: 400 };
const card = { id: "card", cardName: "Travel", last4Digit: "1234", bankName: "Bank", workspaceId: "home" };
const workspace = { id: "home", receivableDefaultAccountId: "bank", receivableDefaultBudgetId: "daily" };
function setup(outstanding = 1000, current = outstanding) {
  given("creditCardAccount.findFirst", card);
  given("workspace.findUnique", workspace);
  given("creditCardTransaction.aggregate", { _sum: { amountCents: outstanding } }, { _sum: { amountCents: current } });
  given("financialAccount.findFirst", { id: "bank", name: "Bank" });
  given("budgetEnvelope.findFirst", { id: "daily", name: "Card payment" });
  given("creditCardTransaction.create", ({ data }) => ({ ...data, id: "payment", creditCard: card }));
  given("transaction.create", ({ data }) => ({ ...data, id: "bank-payment" }));
  given("budgetEnvelope.update", { id: "daily", availableCents: 600 });
}
const pay = (body = input, options) => POST(request("POST", body, options), context());
function assertNoPayment() {
  assert.equal(invocations("creditCardTransaction.create").length, 0);
  assert.equal(invocations("transaction.create").length, 0);
  assert.equal(invocations("budgetEnvelope.update").length, 0);
}

test("card payment requires an editor in the active workspace and validates its input", async () => {
  state.accessError = new ApiAuthError(403, "Forbidden");
  await responseBody(await pay(), 403);
  assert.deepEqual(accessChecks, [{ workspaceId: null, minimumRole: "EDITOR" }]);
  state.accessError = null;
  const invalid = await responseBody(await pay({ ...input, statementMonth: 13, amountCents: 0 }), 400);
  assert.equal(invalid.error, "Invalid data");
  assert.ok(invalid.details.fieldErrors.amountCents.length);
  assertNoWrites();
});

test("foreign-origin card payments are denied before authentication or database access", async () => {
  await responseBody(await pay(input, { headers: { origin: "https://untrusted.example" } }), 403);
  assert.deepEqual(accessChecks, []);
  assertNoWrites();
});

for (const [label, method, value, status, message] of [
  ["missing card", "creditCardAccount.findFirst", null, 404, "Credit card not found"],
  ["missing workspace", "workspace.findUnique", null, 400, "Configure default receivable"],
  ["missing account setting", "workspace.findUnique", { ...workspace, receivableDefaultAccountId: null }, 400, "Configure default receivable"],
  ["missing budget setting", "workspace.findUnique", { ...workspace, receivableDefaultBudgetId: null }, 400, "Configure default receivable"],
  ["invalid default account", "financialAccount.findFirst", null, 400, "Default receivable account is invalid"],
  ["invalid default budget", "budgetEnvelope.findFirst", null, 400, "Default receivable subaccount is invalid"],
]) {
  test(`card payment rejects ${label} before posting`, async () => {
    setup();
    given(method, value);
    assert.match((await responseBody(await pay(), status)).error, new RegExp(message));
    assertNoWrites();
  });
}

for (const outstanding of [null, 0, -100, 399]) {
  test(`card payment rejects an unavailable or insufficient balance of ${outstanding}`, async () => {
    setup(outstanding);
    const result = await responseBody(await pay(), 400);
    assert.match(result.error, outstanding > 0 ? /exceeds the outstanding amount/ : /No outstanding amount/);
    assertNoWrites();
  });
}

for (const current of [null, 0, 399]) {
  test(`card payment catches a balance changed to ${current} inside the posting`, async () => {
    setup(1000, current);
    const result = await responseBody(await pay(), 409);
    assert.equal(result.code, "CONFLICT");
    assert.equal(result.error, "Payment conflicts with the current outstanding amount.");
    assertNoPayment();
    assert.ok(invocations("creditCardTransaction.aggregate")[1].inPosting);
  });
}

for (const current of [1000, 700, 400]) {
  test(`card payment records both ledger sides and returns the remainder from current balance ${current}`, async () => {
    setup(1000, current);
    const before = Date.now();
    const result = await responseBody(await pay());
    assert.equal(result.ok, true);
    assert.equal(result.paidAmountCents, 400);
    assert.equal(result.outstandingAmountCents, current - 400);
    assert.equal(result.bankTransactionId, "bank-payment");
    assert.equal(result.paymentTransaction.id, "payment");
    assert.equal(result.postingGroupId, "posting-group");
    assert.equal(result.replayed, false);
    const [credit] = dataCalls("creditCardTransaction.create");
    assert.deepEqual(credit.data, {
      workspaceId: "home", creditCardId: "card", transactionDate: credit.data.transactionDate, paymentDueDate: credit.data.transactionDate,
      statementMonth: 10, statementYear: 2026, amountCents: -400, subject: "Payment • Travel ••1234",
      isInstallment: false, installmentNo: null, totalInstallments: null, isAllocated: true,
    });
    assert.ok(credit.data.transactionDate.getTime() >= before && credit.data.transactionDate.getTime() <= Date.now());
    assert.deepEqual(dataCalls("transaction.create")[0].data, {
      workspaceId: "home", accountId: "bank", budgetId: "daily", kind: "CREDIT_CARD_PAYMENT", direction: "DEBIT",
      date: credit.data.transactionDate, amountCents: 400, subject: "Payment • Travel ••1234", details: "Payment for 10/2026 from Card payment",
      creditCardTransactionId: "payment", isSynced: false, isFromFamily: false, postingGroupId: "posting-group",
    });
    assert.deepEqual(dataCalls("budgetEnvelope.update")[0].data, { availableCents: { increment: -400 } });
    assert.deepEqual(dataCalls("creditCardAccount.findFirst")[0].where, { id: "card", workspaceId: "home", isActive: true });
    assert.deepEqual(dataCalls("financialAccount.findFirst")[0].where, { id: "bank", workspaceId: "home", kind: "BANK", isActive: true });
    assert.deepEqual(dataCalls("budgetEnvelope.findFirst")[0].where, { id: "daily", workspaceId: "home", accountId: "bank", isActive: true });
    assert.deepEqual(dataCalls("creditCardTransaction.aggregate").map(({ where }) => where), Array(2).fill({ workspaceId: "home", creditCardId: "card", statementMonth: 10, statementYear: 2026 }));
    assert.ok([...invocations("creditCardTransaction.create"), ...invocations("transaction.create"), ...invocations("budgetEnvelope.update")].every((call) => call.inPosting));
    assert.deepEqual(dataCalls("posting")[0], { workspaceId: "home", operation: "CREDIT_CARD_PAYMENT", idempotencyKey: "operation-once", actorUserId: "editor", sourceType: "CREDIT_CARD", sourceId: "card", request: input });
  });
}

test("a replayed card payment preserves its stored outstanding balance and creates no new payment", async () => {
  setup();
  state.replayedPosting = { result: { bankTransactionId: "prior-bank-payment", paymentTransaction: { id: "prior-payment" }, outstandingAmountCents: 250 }, postingGroupId: "prior-posting", replayed: true };
  const result = await responseBody(await pay());
  assert.equal(result.outstandingAmountCents, 250);
  assert.equal(result.replayed, true);
  assert.equal(result.bankTransactionId, "prior-bank-payment");
  assertNoPayment();
});

test("older stored card payments still include an outstanding balance in their replay response", async () => {
  setup(1000);
  state.replayedPosting = { result: { bankTransactionId: "prior-bank-payment", paymentTransaction: { id: "prior-payment" } }, postingGroupId: "prior-posting", replayed: true };
  const result = await responseBody(await pay());
  assert.equal(result.outstandingAmountCents, 600);
  assert.equal(result.replayed, true);
  assertNoPayment();
});
