import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, context, dataCalls, given, invocations,
  request, require, responseBody, state,
} from "./finance-route-harness.mjs";

const { POST } = require("../app/api/receivables/[id]/close/route.ts");
const timestamp = "2026-10-09T00:00:00.000Z";
const receipt = { id: "record", workspaceId: "home", accountId: null, budgetId: null, sourceWorkspaceId: null, sourceAccountId: null, sourceBudgetId: null, amountCents: 400, status: "OPEN", title: "Shared dinner", notes: "Payment from Alex" };
const defaults = { id: "home", receivableDefaultAccountId: "target-bank", receivableDefaultBudgetId: "target-budget" };
const targetAccount = { id: "target-bank", workspaceId: "home" };
const targetBudget = { id: "target-budget", accountId: "target-bank", workspaceId: "home" };
function setup(record = receipt, sourceAccount, sourceBudget) {
  given("receivable.findUnique", record);
  given("workspace.findUnique", defaults);
  given("financialAccount.findFirst", targetAccount, sourceAccount);
  given("budgetEnvelope.findFirst", targetBudget, sourceBudget);
  given("receivable.updateMany", { count: 1 });
  let sequence = 0;
  const transaction = ({ data }) => ({ ...data, id: `tx-${++sequence}` });
  given("transaction.create", transaction, transaction);
  given("receivable.update", ({ data }) => ({ ...record, ...data }));
  given("budgetEnvelope.update", { id: "target-budget" }, { id: "source-budget" });
  given("$executeRaw", 1);
}
const close = (body = { closeDate: timestamp }, options) => POST(request("POST", body, options), context());

test("receivable closing accepts an empty body but rejects malformed or invalid JSON", async () => {
  await responseBody(await close({}, { rawBody: "{bad-json" }), 400);
  const invalid = await responseBody(await close({ closeDate: "yesterday" }), 400);
  assert.match(invalid.error, /^Invalid input:/);
  assertNoWrites();
  setup();
  const before = Date.now();
  const result = await responseBody(await close({}, { rawBody: "   " }));
  assert.equal(result.receivable.status, "PAID");
  const date = dataCalls("transaction.create")[0].data.date;
  assert.ok(date.getTime() >= before && date.getTime() <= Date.now());
});

test("receivable closing checks origins and editor access before posting money", async () => {
  await responseBody(await close({}, { headers: { origin: "https://untrusted.example" } }), 403);
  assert.deepEqual(accessChecks, []);
  given("receivable.findUnique", receipt);
  state.accessError = new ApiAuthError(403, "Forbidden");
  await responseBody(await close(), 403);
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
  assertNoWrites();
});

for (const [label, method, values, status, message] of [
  ["missing receivable", "receivable.findUnique", [null], 404, "Receivable not found"],
  ["missing workspace", "workspace.findUnique", [null], 400, "Configure default receivable"],
  ["missing default account", "workspace.findUnique", [{ ...defaults, receivableDefaultAccountId: null }], 400, "Configure default receivable"],
  ["missing default budget", "workspace.findUnique", [{ ...defaults, receivableDefaultBudgetId: null }], 400, "Configure default receivable"],
  ["invalid target account", "financialAccount.findFirst", [null], 400, "Default receivable account is invalid"],
  ["invalid target budget", "budgetEnvelope.findFirst", [null], 400, "Default receivable subaccount is invalid"],
]) {
  test(`receivable closing rejects ${label} without changing balances`, async () => {
    setup();
    given(method, ...values);
    assert.match((await responseBody(await close(), status)).error, new RegExp(message));
    assertNoWrites();
  });
}

for (const [label, sourceWorkspace, accountId, budgetId, legacy, notes, expectedDeduction] of [
  ["no deduction", null, null, null, false, null, false],
  ["legacy source references", "home", "source-bank", "source-budget", true, "Legacy notes", true],
  ["another workspace", "shared", "source-bank", "source-budget", false, receipt.notes, true],
  ["another subaccount of the same bank", "home", "target-bank", "source-budget", false, receipt.notes, true],
  ["identical source and target", "home", "target-bank", "target-budget", false, receipt.notes, false],
]) {
  test(`receivable closing handles ${label}, preserving notes and workspace-safe posting references`, async () => {
    const record = { ...receipt, notes, ...(legacy ? { accountId, budgetId } : { sourceAccountId: accountId, sourceBudgetId: budgetId, sourceWorkspaceId: sourceWorkspace }) };
    setup(record, accountId ? { id: accountId, workspaceId: sourceWorkspace } : null, budgetId ? { id: budgetId } : null);
    const result = await responseBody(await close());
    assert.equal(result.receivable.status, "PAID");
    assert.equal(result.receivable.transactionDate, timestamp);
    assert.equal(result.incomeTransactionId, "tx-1");
    assert.equal(result.sourceTransactionId, expectedDeduction ? "tx-2" : null);
    assert.equal(result.postingGroupId, "posting-group");
    assert.equal(result.replayed, false);
    const transactions = dataCalls("transaction.create").map(({ data }) => data);
    assert.equal(transactions.length, expectedDeduction ? 2 : 1);
    for (const transaction of transactions) {
      assert.equal(transaction.subject, receipt.title);
      assert.equal(transaction.notes, notes);
      assert.equal(transaction.details, null);
      assert.equal(transaction.amountCents, 400);
      assert.deepEqual(transaction.date, new Date(timestamp));
      assert.equal(transaction.externalRef, "receivable-close:record:operation-once");
    }
    assert.equal(transactions[0].direction, "CREDIT");
    assert.equal(transactions[0].receivableId, "record");
    assert.equal(transactions[0].accountId, "target-bank");
    assert.equal(transactions[0].budgetId, "target-budget");
    assert.equal(transactions[0].workspaceId, "home");
    assert.equal(transactions[0].postingGroupId, "posting-group");
    assert.deepEqual(dataCalls("receivable.updateMany"), [{ where: { id: "record", status: { notIn: ["PAID", "PROCESSING"] } }, data: { status: "PROCESSING" } }]);
    assert.deepEqual(dataCalls("budgetEnvelope.update").map(({ where, data }) => [where.id, data.availableCents.increment]), expectedDeduction ? [["target-budget", 400], [budgetId, -400]] : [["target-budget", 400]]);
    assert.deepEqual(dataCalls("financialAccount.findFirst")[0].where, { id: "target-bank", workspaceId: "home", kind: "BANK", isActive: true });
    assert.deepEqual(dataCalls("budgetEnvelope.findFirst")[0].where, { id: "target-budget", workspaceId: "home", accountId: "target-bank", isActive: true });
    if (expectedDeduction) {
      const source = transactions[1];
      assert.equal(source.direction, "DEBIT");
      assert.equal(source.accountId, accountId);
      assert.equal(source.budgetId, budgetId);
      assert.equal(source.workspaceId, sourceWorkspace);
      assert.equal(source.receivableId, sourceWorkspace === "home" ? "record" : null);
      assert.equal(source.postingGroupId, result.sourcePostingGroupId);
      if (sourceWorkspace === "home") assert.equal(source.postingGroupId, "posting-group");
      else {
        assert.match(source.postingGroupId, /^[a-f\d-]{36}$/);
        assert.deepEqual(invocations("$executeRaw")[0].args[0].values, [source.postingGroupId, sourceWorkspace, "RECEIVABLE_CLOSE_SOURCE", "RECEIVABLE", "record", "editor", "operation-once"]);
      }
    } else assert.equal(result.sourcePostingGroupId, null);
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }, ...(accountId ? [{ workspaceId: sourceWorkspace, minimumRole: "EDITOR" }] : [])]);
    assert.ok([...invocations("transaction.create"), ...invocations("receivable.update"), ...invocations("budgetEnvelope.update")].every((call) => call.inPosting));
  });
}

for (const invalid of ["account", "missing budget", "budget"]) {
  test(`receivable closing rejects an invalid source ${invalid}`, async () => {
    const record = { ...receipt, sourceAccountId: "source-bank", sourceBudgetId: invalid === "missing budget" ? null : "source-budget" };
    setup(record, invalid === "account" ? null : { id: "source-bank", workspaceId: "shared" }, invalid === "budget" ? null : { id: "source-budget" });
    const result = await responseBody(await close(), 400);
    assert.match(result.error, invalid === "account" ? /deduction account is invalid/ : /deduction subaccount is invalid/);
    assertNoWrites();
  });
}

test("receivable closing requires editor access to the deduction's workspace", async () => {
  setup({ ...receipt, sourceAccountId: "source-bank", sourceBudgetId: "source-budget" }, { id: "source-bank", workspaceId: "shared" }, { id: "source-budget" });
  state.workspaceErrors.set("shared", new ApiAuthError(403, "Forbidden"));
  await responseBody(await close(), 403);
  assertNoWrites();
});

test("a receivable already claimed by another request cannot post again", async () => {
  setup();
  given("receivable.updateMany", { count: 0 });
  const result = await responseBody(await close(), 409);
  assert.equal(result.error, "Receivable is already closed.");
  assert.equal(invocations("transaction.create").length, 0);
  assert.equal(invocations("receivable.update").length, 0);
});

test("receivable retries use a stable server key and replay the previous result without a second claim", async () => {
  setup();
  state.replayedPosting = { result: { incomeTransactionId: "original-income", sourceTransactionId: null }, postingGroupId: "original-posting", replayed: true };
  const result = await responseBody(await close({}, { headers: { "idempotency-key": "" } }));
  assert.equal(result.replayed, true);
  assert.equal(result.incomeTransactionId, "original-income");
  assert.equal(dataCalls("posting")[0].idempotencyKey, "receivable-close:record");
  assert.equal(invocations("receivable.updateMany").length, 0);
  assert.equal(invocations("transaction.create").length, 0);
});
