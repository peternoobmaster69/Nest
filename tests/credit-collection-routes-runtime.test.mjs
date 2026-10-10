import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, calls, dataCalls, given,
  request, require, state,
} from "./finance-route-harness.mjs";

const transactions = require("../app/api/credit-transactions/route.ts");
const rules = require("../app/api/credit-transactions/auto-rules/route.ts");
const read = (values = {}) => transactions.GET(request("GET", undefined, { query: `?${new URLSearchParams(values)}` }));
const creditInput = (values = {}) => ({ creditCardId: "card", transactionDate: "2026-10-09T12:00:00.000Z", statementMonth: 10, statementYear: 2026, amountCents: 1234, subject: " Lunch ", ...values });
const sameRule = { id: "same-rule", name: "Lunch", enabled: true, action: "DEDUCT_SAME_WORKSPACE", filters: ["Lunch"], sourceBudgetId: "source", destinationBudgetId: "destination" };
const crossRule = { id: "cross-rule", name: "Shared lunch", enabled: true, action: "RECEIVABLE_OTHER_WORKSPACE", filters: ["Shared"], sourceWorkspaceId: "other", sourceAccountId: "source-bank", sourceBudgetId: "source-budget" };
const bankBudget = (id, values = {}) => ({ id, account: { kind: "BANK", isActive: true }, ...values });
beforeEach((t) => { const logger = mock.method(console, "error", () => {}); t.after(() => logger.mock.restore()); });
async function bodyOf(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}
function givenCardPage(rows = [], { total = rows.length, sum = null, unaccounted = null, due = null, counts = [] } = {}) {
  given("creditCardTransaction.findMany", rows);
  given("creditCardTransaction.count", total);
  given("creditCardTransaction.aggregate", { _sum: { amountCents: sum }, _min: { paymentDueDate: due } }, { _sum: { amountCents: unaccounted } });
  given("creditCardTransaction.groupBy", counts);
}

test("credit transaction lists use the authenticated workspace and retain empty aggregate values", async () => {
  givenCardPage();
  const body = await bodyOf(await read({ workspaceId: "untrusted-workspace" }));
  assert.deepEqual(body, { transactions: [], cardCounts: [], total: 0, page: 1, limit: 250, hasMore: false, nextCursor: null, summary: { totalAmountCents: 0, unaccountedAmountCents: 0, earliestPaymentDueDate: null } });
  assert.deepEqual(accessChecks, [{ workspaceId: undefined, minimumRole: undefined }]);
  const [query] = dataCalls("creditCardTransaction.findMany");
  assert.deepEqual(query.where, { workspaceId: "home" });
  assert.equal(query.take, 251);
  assert.equal(query.skip, 0);
  assert.deepEqual(query.orderBy, [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(query.select.creditCard, { select: { id: true, cardName: true, bankName: true, last4Digit: true } });
  assertNoWrites();
});

for (const [name, value, error] of [
  ["cardId", "c".repeat(192), "Card id or cursor is too long"],
  ["cursor", "c".repeat(192), "Card id or cursor is too long"],
  ["year", "abc", "Invalid statement period"], ["year", "2019", "Invalid statement period"], ["year", "2101", "Invalid statement period"],
  ["month", "abc", "Invalid statement period"], ["month", "0", "Invalid statement period"], ["month", "13", "Invalid statement period"],
]) {
  test(`credit lists reject invalid ${name}=${value.slice(0, 8)}`, async () => {
    assert.deepEqual(await bodyOf(await read({ [name]: value }), 400), { error, code: "INVALID_REQUEST" });
    assert.deepEqual(calls, []);
  });
}

test("card and statement filters constrain totals while per-card unaccounted counts span all cards", async () => {
  const rows = [{ id: "first" }, { id: "second" }, { id: "extra" }];
  const due = new Date("2026-11-10T00:00:00Z");
  givenCardPage(rows, { total: 10, sum: 10000, unaccounted: 2500, due, counts: [{ creditCardId: "card", _count: { id: 2 } }] });
  const body = await bodyOf(await read({ cardId: "card", year: "2026", month: "10", page: "2", limit: "2" }));
  assert.deepEqual(body.transactions, rows.slice(0, 2));
  assert.equal(body.total, 10);
  assert.equal(body.hasMore, true);
  assert.equal(body.nextCursor, "second");
  assert.deepEqual(body.summary, { totalAmountCents: 10000, unaccountedAmountCents: 2500, earliestPaymentDueDate: due.toISOString() });
  const where = { workspaceId: "home", creditCardId: "card", statementYear: 2026, statementMonth: 10 };
  const [query] = dataCalls("creditCardTransaction.findMany");
  assert.deepEqual(query.where, where);
  assert.equal(query.skip, 2);
  assert.equal(query.take, 3);
  assert.deepEqual(dataCalls("creditCardTransaction.count"), [{ where }]);
  assert.deepEqual(dataCalls("creditCardTransaction.aggregate"), [
    { where, _sum: { amountCents: true }, _min: { paymentDueDate: true } },
    { where: { ...where, isAllocated: false }, _sum: { amountCents: true } },
  ]);
  assert.deepEqual(dataCalls("creditCardTransaction.groupBy"), [{ by: ["creditCardId"], where: { workspaceId: "home", isAllocated: false, statementYear: 2026, statementMonth: 10 }, _count: { id: true } }]);
});

test("cursor pages retain zeros, use the supplied cursor and do not constrain the all-cards option", async () => {
  givenCardPage([{ id: "only" }], { sum: 0, unaccounted: 0 });
  const body = await bodyOf(await read({ cardId: "all", cursor: "previous", page: "5", year: "", month: "" }));
  const [query] = dataCalls("creditCardTransaction.findMany");
  assert.deepEqual(query.where, { workspaceId: "home" });
  assert.deepEqual(query.cursor, { id: "previous" });
  assert.equal(query.skip, 1);
  assert.equal(body.hasMore, false);
  assert.equal(body.nextCursor, null);
  assert.equal(body.summary.totalAmountCents, 0);
});

for (const [page, limit, expectedPage, expectedLimit] of [["-1", "-2", 1, 1], ["0", "0", 1, 250], ["invalid", "invalid", 1, 250], ["3", "999", 3, 500]]) {
  test(`credit page bounds preserve page=${page} and limit=${limit}`, async () => {
    givenCardPage();
    const body = await bodyOf(await read({ page, limit, cardId: "", cursor: "" }));
    assert.equal(body.page, expectedPage);
    assert.equal(body.limit, expectedLimit);
    assert.equal(dataCalls("creditCardTransaction.findMany")[0].skip, (expectedPage - 1) * expectedLimit);
  });
}

for (const [year, month] of [["2020", "1"], ["2100", "12"]]) {
  test(`credit statement boundary ${year}-${month} remains valid`, async () => {
    givenCardPage();
    await bodyOf(await read({ year, month }));
    assert.deepEqual(dataCalls("creditCardTransaction.findMany")[0].where, { workspaceId: "home", statementYear: Number(year), statementMonth: Number(month) });
  });
}

test("credit list failures preserve authorization and hide storage diagnostics", async () => {
  state.accessError = new ApiAuthError(401, "Sign-in required");
  assert.deepEqual(await bodyOf(await read(), 401), { error: "Sign-in required" });
  assert.deepEqual(calls, []);
  state.accessError = null;
  givenCardPage();
  given("creditCardTransaction.findMany", new Error("private storage details"));
  assert.deepEqual(await bodyOf(await read(), 500), { error: "Failed to fetch transactions" });
  assertNoWrites();
});

test("credit creation requires EDITOR and validates the posted transaction before card lookup", async () => {
  state.accessError = new ApiAuthError(403, "Forbidden");
  assert.deepEqual(await bodyOf(await transactions.POST(request("POST", creditInput())), 403), { error: "Forbidden" });
  assert.deepEqual(accessChecks, [{ workspaceId: null, minimumRole: "EDITOR" }]);
  state.accessError = null;
  for (const invalid of [null, creditInput({ amountCents: 1.1 }), creditInput({ subject: " " }), creditInput({ statementMonth: 13 })]) {
    const body = await bodyOf(await transactions.POST(request("POST", invalid)), 400);
    assert.equal(body.error, "Invalid data");
    assert.ok(body.details.formErrors.length || Object.keys(body.details.fieldErrors).length);
  }
  assert.deepEqual(calls, []);
});

for (const card of [null, { id: "card", workspaceId: "other" }]) {
  test(`credit creation rejects ${card ? "another workspace's" : "a missing"} card`, async () => {
    given("creditCardAccount.findUnique", card);
    assert.deepEqual(await bodyOf(await transactions.POST(request("POST", creditInput())), 404), { error: "Credit card not found" });
    assertNoWrites();
  });
}

for (const paymentDueDate of [undefined, "2026-12-01T00:00:00.000Z"]) {
  test(`new credit transactions preserve ${paymentDueDate ? "an explicit" : "a derived"} due date and signed cents`, async () => {
    given("creditCardAccount.findUnique", { id: "card", workspaceId: "home", statementDay: 10, paymentDueDay: 20 });
    given("creditCardTransaction.create", { id: "new-credit" });
    assert.deepEqual(await bodyOf(await transactions.POST(request("POST", creditInput({ paymentDueDate, amountCents: -250 }))), 201), { id: "new-credit" });
    assert.deepEqual(dataCalls("creditCardTransaction.create"), [{ data: {
      workspaceId: "home", creditCardId: "card", transactionDate: new Date("2026-10-09T12:00:00.000Z"), paymentDueDate: new Date(paymentDueDate ?? "2026-10-20T00:00:00.000Z"),
      statementMonth: 10, statementYear: 2026, amountCents: -250, subject: "Lunch", isInstallment: false, installmentNo: null, totalInstallments: null,
    }, include: { creditCard: true } }]);
  });
}

test("credit creation failures do not return private storage diagnostics", async () => {
  given("creditCardAccount.findUnique", new Error("private card details"));
  assert.deepEqual(await bodyOf(await transactions.POST(request("POST", creditInput())), 500), { error: "Failed to create transaction" });
  assertNoWrites();
});

const readRules = () => rules.GET(request("GET", undefined, { query: "?workspaceId=home" }));
const saveRules = (values) => rules.PUT(request("PUT", { workspaceId: "home", rules: values }));

test("auto-accounting rules require a workspace, membership and an existing workspace record", async () => {
  assert.deepEqual(await bodyOf(await rules.GET(request("GET")), 400), { error: "workspaceId is required" });
  assert.deepEqual(accessChecks, []);
  state.accessError = new ApiAuthError(403, "Forbidden");
  assert.deepEqual(await bodyOf(await readRules(), 403), { error: "Forbidden" });
  assert.deepEqual(calls, []);
  state.accessError = null;
  given("workspace.findUnique", null);
  assert.deepEqual(await bodyOf(await readRules(), 404), { error: "Workspace not found." });
  assert.deepEqual(dataCalls("workspace.findUnique"), [{ where: { id: "home" }, select: { id: true, creditCardAutoRules: true } }]);
  assertNoWrites();
});

test("stored auto-accounting rules are parsed and malformed legacy settings stay empty", async () => {
  for (const [stored, expected] of [[JSON.stringify([sameRule, crossRule]), [sameRule, crossRule]], [null, []], ["invalid JSON", []], ['{"unexpected":true}', []]]) {
    given("workspace.findUnique", { id: "home", creditCardAutoRules: stored });
    assert.deepEqual(await bodyOf(await readRules()), { workspaceId: "home", rules: expected });
  }
  assertNoWrites();
});

test("invalid rule payloads provide readable field paths before authorization or writes", async () => {
  const rootError = await bodyOf(await rules.PUT(request("PUT", null)), 400);
  assert.equal(rootError.error, "Invalid auto-accounting rules");
  assert.match(rootError.message, /^rules:/);
  const fieldError = await bodyOf(await saveRules([{ ...sameRule, filters: [], name: "" }]), 400);
  assert.equal(fieldError.error, "Invalid auto-accounting rules");
  assert.match(fieldError.message, /rules\.0\.filters:/);
  assert.match(fieldError.message, /rules\.0\.name:/);
  assert.deepEqual(accessChecks, []);
  assert.deepEqual(calls, []);
});

test("only an OWNER can change auto-accounting rules", async () => {
  state.accessError = new ApiAuthError(403, "Owner required");
  assert.deepEqual(await bodyOf(await saveRules([]), 403), { error: "Owner required" });
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "OWNER" }]);
  assert.deepEqual(calls, []);
});

test("clearing auto-accounting rules does not require any target lookups", async () => {
  given("workspace.update", { id: "home", creditCardAutoRules: "[]" });
  assert.deepEqual(await bodyOf(await saveRules([])), { workspaceId: "home", rules: [] });
  assert.deepEqual(dataCalls("workspace.update"), [{ where: { id: "home" }, data: { creditCardAutoRules: "[]" }, select: { id: true, creditCardAutoRules: true } }]);
  assert.deepEqual(calls.map(({ name }) => name), ["workspace.update"]);
});

test("same-workspace rules require distinct source and destination subaccounts", async () => {
  const body = await bodyOf(await saveRules([{ ...sameRule, destinationBudgetId: "source" }]), 500);
  assert.equal(body.message, 'Rule "Lunch" needs different source and destination sub accounts.');
  assert.deepEqual(calls, []);
});

for (const target of ["source", "destination"]) {
  for (const [label, account] of [["missing", null], ["non-bank", { kind: "INVESTMENT", isActive: true }], ["inactive", { kind: "BANK", isActive: false }]]) {
    test(`same-workspace rules reject a ${label} ${target} subaccount`, async () => {
      const budgets = [bankBudget("source"), bankBudget("destination")].filter(({ id }) => id !== target);
      if (account) budgets.push(bankBudget(target, { account }));
      given("budgetEnvelope.findMany", budgets);
      const body = await bodyOf(await saveRules([sameRule]), 500);
      assert.equal(body.message, `Rule "Lunch" has an invalid ${target} sub account.`);
      assertNoWrites();
    });
  }
}

test("valid rules check each target before persisting both local and cross-workspace actions", async () => {
  given("budgetEnvelope.findMany", [bankBudget("source"), bankBudget("destination")]);
  given("financialAccount.findFirst", { id: "source-bank" });
  given("budgetEnvelope.findFirst", { id: "source-budget" });
  given("workspace.update", { id: "home", creditCardAutoRules: JSON.stringify([sameRule, crossRule]) });
  assert.deepEqual(await bodyOf(await saveRules([sameRule, crossRule])), { workspaceId: "home", rules: [sameRule, crossRule] });
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "OWNER" }, { workspaceId: "other", minimumRole: undefined }]);
  assert.deepEqual(dataCalls("budgetEnvelope.findMany"), [{ take: 500, where: { id: { in: ["source", "destination"] }, workspaceId: "home", isActive: true }, select: { id: true, account: { select: { kind: true, isActive: true } } } }]);
  assert.deepEqual(dataCalls("financialAccount.findFirst"), [{ where: { id: "source-bank", workspaceId: "other", kind: "BANK", isActive: true }, select: { id: true } }]);
  assert.deepEqual(dataCalls("budgetEnvelope.findFirst"), [{ where: { id: "source-budget", workspaceId: "other", accountId: "source-bank", isActive: true }, select: { id: true } }]);
  assert.deepEqual(dataCalls("workspace.update")[0].data, { creditCardAutoRules: JSON.stringify([sameRule, crossRule]) });
  assert.equal(calls.at(-1).name, "workspace.update");
});

test("cross-workspace rules require source membership before looking up private target records", async () => {
  state.workspaceErrors.set("other", new ApiAuthError(403, "Source workspace is private"));
  assert.deepEqual(await bodyOf(await saveRules([crossRule]), 403), { error: "Source workspace is private" });
  assert.deepEqual(calls, []);
});

for (const missing of ["bank account", "sub account"]) {
  test(`cross-workspace rules reject a missing source ${missing}`, async () => {
    given("financialAccount.findFirst", missing === "bank account" ? null : { id: "source-bank" });
    if (missing === "sub account") given("budgetEnvelope.findFirst", null);
    const body = await bodyOf(await saveRules([crossRule]), 500);
    assert.equal(body.message, `Rule "Shared lunch" has an invalid source ${missing}.`);
    assertNoWrites();
  });
}

test("rule read and write failures keep their documented error messages", async () => {
  for (const failure of [new Error("Rules unavailable"), "Unavailable"]) {
    given("workspace.findUnique", () => Promise.reject(failure));
    assert.deepEqual(await bodyOf(await readRules(), 500), { error: "Failed to fetch auto-accounting rules", message: failure instanceof Error ? failure.message : "Unknown error" });
    given("workspace.update", () => Promise.reject(failure));
    assert.deepEqual(await bodyOf(await saveRules([]), 500), { error: "Failed to save auto-accounting rules", message: failure instanceof Error ? failure.message : "Unknown error" });
  }
});
