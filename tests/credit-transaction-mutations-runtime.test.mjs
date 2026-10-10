import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, context, dataCalls, given,
  request, require, responseBody, state,
} from "./finance-route-harness.mjs";

const transactionRoute = require("../app/api/credit-transactions/[id]/route.ts");
const dueRoute = require("../app/api/credit-transactions/payment-due/route.ts");
const expectedUpdatedAt = "2026-10-10T12:00:00.000Z";
const edit = (body = {}, options = {}) => transactionRoute.PATCH(request("PATCH", { expectedUpdatedAt, ...body }, options), context());
const remove = (options = {}) => transactionRoute.DELETE(request("DELETE", undefined, options), context());
const readDues = (query = "year=2026") => dueRoute.GET(request("GET", undefined, { query: `?${query}` }));
const updateDues = (body = {}, options = {}) => dueRoute.PATCH(request("PATCH", { statementMonth: 10, statementYear: 2026, paymentDueDate: null, ...body }, options));
beforeEach(t => t.mock.method(console, "error", () => {}));
function givenExisting() { given("creditCardTransaction.findUnique", { workspaceId: "home", updatedAt: new Date(expectedUpdatedAt) }); }
function givenUpdate() {
  givenExisting();
  given("creditCardTransaction.updateMany", { count: 1 });
  given("creditCardTransaction.findUniqueOrThrow", { id: "record", subject: "Lunch" });
}

test("cross-origin credit edits are denied before authorization or financial writes", async () => {
  givenUpdate();
  const response = await edit({}, { headers: { origin: "https://untrusted.example" } });
  assert.equal(response.status, 403);
  assert.deepEqual(accessChecks, []);
  assertNoWrites();
});

test("cross-origin credit deletion is denied before touching the transaction", async () => {
  givenExisting();
  given("creditCardTransaction.delete", { id: "record" });
  assert.equal((await remove({ headers: { origin: "https://untrusted.example" } })).status, 403);
  assert.deepEqual(accessChecks, []);
  assertNoWrites();
});

test("cross-origin statement due-date changes cannot update the workspace", async () => {
  given("creditCardTransaction.updateMany", { count: 2 });
  assert.equal((await updateDues({}, { headers: { origin: "https://untrusted.example" } })).status, 403);
  assert.deepEqual(accessChecks, []);
  assertNoWrites();
});

test("payment-due failures do not expose private database diagnostics", async () => {
  given("creditCardTransaction.groupBy", new Error("private bank connection details"), []);
  const response = await readDues();
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private bank connection details/);
});

for (const [label, execute] of [["editing", edit], ["deleting", remove]]) {
  test(`credit ${label} requires an existing transaction and workspace EDITOR access`, async () => {
    given("creditCardTransaction.findUnique", null);
    assert.deepEqual(await responseBody(await execute(), 404), { error: "Transaction not found" });
    assert.deepEqual(accessChecks, []);
    givenExisting();
    state.accessError = new ApiAuthError(403, "Editor access required");
    const denied = await responseBody(await execute(), 403);
    assert.equal(denied.error, "Editor access required");
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
    assertNoWrites();
  });
}

for (const invalid of [
  { expectedUpdatedAt: undefined }, { expectedUpdatedAt: "invalid" }, { creditCardId: null },
  { transactionDate: "invalid" }, { paymentDueDate: "invalid" }, { statementMonth: 0 },
  { statementMonth: 13 }, { statementYear: 2019 }, { statementYear: 2101 },
  { amountCents: 1.5 }, { subject: "" }, { isAllocated: "false" },
]) {
  test(`credit edits reject invalid ${Object.keys(invalid)[0]} before accessing a transaction`, async () => {
    const body = await responseBody(await edit(invalid), 400);
    assert.equal(body.error, "Invalid data");
    assert.ok(Object.keys(body.details.fieldErrors).length);
    assert.deepEqual(dataCalls("creditCardTransaction.findUnique"), []);
    assert.deepEqual(accessChecks, []);
    assertNoWrites();
  });
}

for (const [label, execute] of [["credit edit", edit], ["due-date edit", updateDues]]) {
  for (const [reason, options, status] of [
    ["malformed JSON", { rawBody: "{" }, 400],
    ["a non-JSON body", { headers: { "content-type": "text/plain" } }, 415],
    ["an oversized declared body", { headers: { "content-length": "65537" } }, 413],
    ["an oversized actual body", { rawBody: JSON.stringify({ subject: "x".repeat(65537) }) }, 413],
  ]) {
    test(`${label} rejects ${reason} without financial writes`, async () => {
      await responseBody(await execute({}, options), status);
      assertNoWrites();
      assert.deepEqual(dataCalls("creditCardTransaction.findUnique"), []);
    });
  }
}

test("credit edits preserve omitted fields and clear unsupported legacy installments", async () => {
  givenUpdate();
  assert.deepEqual(await responseBody(await edit({ workspaceId: "injected", isInstallment: true, installmentNo: 2 })), { id: "record", subject: "Lunch" });
  assert.deepEqual(dataCalls("creditCardTransaction.findUnique"), [{ where: { id: "record" }, select: { workspaceId: true, updatedAt: true } }]);
  assert.deepEqual(dataCalls("creditCardTransaction.updateMany"), [{
    where: { id: "record", updatedAt: new Date(expectedUpdatedAt) },
    data: { isInstallment: false, installmentNo: null, totalInstallments: null },
  }]);
  assert.deepEqual(dataCalls("creditCardTransaction.findUniqueOrThrow"), [{ where: { id: "record" }, include: { creditCard: true } }]);
});

test("credit edits retain zero amounts, false allocation, dates and the authorized target card", async () => {
  givenUpdate();
  given("creditCardAccount.findFirst", { id: "other-card" });
  const transactionDate = "2026-10-09T01:02:03.000Z";
  const paymentDueDate = "2026-11-20T00:00:00.000Z";
  await responseBody(await edit({ creditCardId: "other-card", transactionDate, paymentDueDate, statementMonth: 11, statementYear: 2027, subject: "Updated lunch", amountCents: 0, isAllocated: false }));
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
  assert.deepEqual(dataCalls("creditCardAccount.findFirst"), [{ where: { id: "other-card", workspaceId: "home" }, select: { id: true } }]);
  assert.deepEqual(dataCalls("creditCardTransaction.updateMany")[0].data, {
    creditCardId: "other-card", transactionDate: new Date(transactionDate), paymentDueDate: new Date(paymentDueDate),
    statementMonth: 11, statementYear: 2027, subject: "Updated lunch", amountCents: 0, isAllocated: false,
    isInstallment: false, installmentNo: null, totalInstallments: null,
  });
});

test("credit edits can clear the due date and retain signed reversal amounts", async () => {
  givenUpdate();
  await responseBody(await edit({ paymentDueDate: null, amountCents: -500, isAllocated: true }));
  assert.deepEqual(dataCalls("creditCardTransaction.updateMany")[0].data, {
    paymentDueDate: null, amountCents: -500, isAllocated: true,
    isInstallment: false, installmentNo: null, totalInstallments: null,
  });
});

test("credit edits reject a target card outside the authorized workspace", async () => {
  givenExisting();
  given("creditCardAccount.findFirst", null);
  assert.deepEqual(await responseBody(await edit({ creditCardId: "private-card" }), 404), { error: "Credit card not found" });
  assert.deepEqual(dataCalls("creditCardAccount.findFirst")[0].where, { id: "private-card", workspaceId: "home" });
  assertNoWrites();
});

for (const current of [{ updatedAt: new Date("2026-10-10T12:01:00.000Z") }, null]) {
  test(`stale credit edits report ${current ? "the latest revision" : "a concurrently removed record"}`, async () => {
    given("creditCardTransaction.findUnique", { workspaceId: "home", updatedAt: new Date(expectedUpdatedAt) }, current);
    given("creditCardTransaction.updateMany", { count: 0 });
    const body = await responseBody(await edit({ amountCents: 100 }), 412);
    assert.equal(body.code, "STALE_WRITE");
    assert.equal(body.currentUpdatedAt, current?.updatedAt.toISOString() ?? null);
    assert.deepEqual(dataCalls("creditCardTransaction.updateMany")[0].where, { id: "record", updatedAt: new Date(expectedUpdatedAt) });
    assert.deepEqual(dataCalls("creditCardTransaction.findUniqueOrThrow"), []);
  });
}

test("authorized credit deletion removes only the requested transaction", async () => {
  givenExisting();
  given("creditCardTransaction.delete", { id: "record" });
  assert.deepEqual(await responseBody(await remove()), { success: true });
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
  assert.deepEqual(dataCalls("creditCardTransaction.findUnique"), [{ where: { id: "record" }, select: { workspaceId: true } }]);
  assert.deepEqual(dataCalls("creditCardTransaction.delete"), [{ where: { id: "record" } }]);
});

for (const [label, execute] of [["reading", readDues], ["changing", updateDues]]) {
  test(`${label} statement due dates requires workspace authorization`, async () => {
    state.accessError = new ApiAuthError(401, "Sign-in required");
    assert.equal((await responseBody(await execute(), 401)).error, "Sign-in required");
    assert.deepEqual(accessChecks, [{ workspaceId: label === "reading" ? undefined : null, minimumRole: label === "reading" ? undefined : "EDITOR" }]);
    assert.deepEqual(dataCalls("creditCardTransaction.groupBy"), []);
    assertNoWrites();
  });
}

for (const year of ["", "year=", "year=unknown", "year=2019", "year=2101", "year=2026.5"]) {
  test(`payment-due months reject the query ${year || "without a year"}`, async () => {
    const body = await responseBody(await readDues(year), 400);
    assert.equal(body.error, "Invalid query");
    assert.ok(body.details.fieldErrors.year.length);
    assert.deepEqual(dataCalls("creditCardTransaction.groupBy"), []);
  });
}

for (const [cardQuery, expectedCard] of [["", undefined], ["&cardId=", undefined], ["&cardId=all", undefined], ["&cardId=selected", "selected"]]) {
  test(`payment-due months scope empty results to the workspace for ${cardQuery || "no card filter"}`, async () => {
    given("creditCardTransaction.groupBy", [], []);
    assert.deepEqual(await responseBody(await readDues(`year=2026${cardQuery}&workspaceId=private`)), { months: [] });
    const where = { workspaceId: "home", statementYear: 2026, ...(expectedCard ? { creditCardId: expectedCard } : {}) };
    assert.deepEqual(dataCalls("creditCardTransaction.groupBy"), [
      { by: ["creditCardId", "statementMonth"], where, _sum: { amountCents: true } },
      { by: ["creditCardId", "statementMonth"], where: { ...where, amountCents: { gt: 0 } }, _min: { paymentDueDate: true } },
    ]);
    assertNoWrites();
  });
}

test("statement months use the earliest due date across cards with positive net balances", async () => {
  const balance = (creditCardId, statementMonth, amountCents) => ({ creditCardId, statementMonth, _sum: { amountCents } });
  const due = (creditCardId, statementMonth, value) => ({ creditCardId, statementMonth, _min: { paymentDueDate: value ? new Date(value) : null } });
  given("creditCardTransaction.groupBy", [
    balance("later", 11, 500), balance("earlier", 11, 100), balance("latest", 11, 200), balance("equal", 11, 300),
    balance("january", 1, 1), balance("paid", 3, 0), balance("reversed", 4, -500),
    balance("null", 5, null), balance("undated", 6, 100),
  ], [
    due("later", 11, "2026-12-20"), due("earlier", 11, "2026-12-10"), due("latest", 11, "2026-12-25"), due("equal", 11, "2026-12-10"),
    due("january", 1, "2026-02-10"), due("paid", 3, "2026-04-10"), due("reversed", 4, "2026-05-10"),
    due("null", 5, "2026-06-10"), due("undated", 6, null), due("no-balance", 7, "2026-08-10"),
  ]);
  assert.deepEqual(await responseBody(await readDues()), { months: [
    { statementMonth: 1, paymentDueDate: "2026-02-10T00:00:00.000Z" },
    { statementMonth: 11, paymentDueDate: "2026-12-10T00:00:00.000Z" },
  ] });
});

for (const invalid of [{ statementMonth: 13 }, { statementYear: 2019 }, { paymentDueDate: "invalid" }, { paymentDueDate: undefined }]) {
  test(`statement due-date changes validate ${Object.keys(invalid)[0]} before any writes`, async () => {
    const body = await responseBody(await updateDues(invalid), 400);
    assert.equal(body.error, "Invalid data");
    assert.ok(Object.keys(body.details.fieldErrors).length);
    assertNoWrites();
  });
}

for (const cardId of [undefined, ""]) {
  test(`clearing due dates without ${cardId === undefined ? "a supplied" : "a nonempty"} card affects only the workspace statement`, async () => {
    given("creditCardTransaction.updateMany", { count: 0 });
    assert.deepEqual(await responseBody(await updateDues({ cardId, workspaceId: "private" })), { ok: true, updatedCount: 0 });
    assert.deepEqual(dataCalls("creditCardTransaction.updateMany"), [{
      where: { workspaceId: "home", statementMonth: 10, statementYear: 2026 }, data: { paymentDueDate: null },
    }]);
    assert.deepEqual(dataCalls("creditCardAccount.findFirst"), []);
  });
}

test("changing a card statement due date validates ownership and returns the affected row count", async () => {
  given("creditCardAccount.findFirst", { id: "card" });
  given("creditCardTransaction.updateMany", { count: 5 });
  const paymentDueDate = "2026-11-10T00:00:00.000Z";
  assert.deepEqual(await responseBody(await updateDues({ cardId: "card", paymentDueDate })), { ok: true, updatedCount: 5 });
  assert.deepEqual(dataCalls("creditCardAccount.findFirst"), [{ where: { id: "card", workspaceId: "home" }, select: { id: true } }]);
  assert.deepEqual(dataCalls("creditCardTransaction.updateMany"), [{
    where: { workspaceId: "home", statementMonth: 10, statementYear: 2026, creditCardId: "card" }, data: { paymentDueDate: new Date(paymentDueDate) },
  }]);
});

test("a missing or private card prevents statement due-date writes", async () => {
  given("creditCardAccount.findFirst", null);
  assert.deepEqual(await responseBody(await updateDues({ cardId: "private" }), 404), { error: "Credit card not found" });
  assert.deepEqual(dataCalls("creditCardAccount.findFirst")[0].where, { id: "private", workspaceId: "home" });
  assertNoWrites();
});

for (const [label, execute, operation, message] of [
  ["credit edit", edit, "creditCardTransaction.findUnique", "Failed to update transaction"],
  ["credit deletion", remove, "creditCardTransaction.findUnique", "Failed to delete transaction"],
  ["payment-due change", updateDues, "creditCardTransaction.updateMany", "Failed to update payment due date"],
]) {
  test(`${label} failures retain private diagnostics only in server logs`, async () => {
    given(operation, new Error("private connection and bank details"));
    const response = await responseBody(await execute(), 500);
    assert.equal(response.error, message);
    assert.equal(response.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(response), /private connection|bank details/);
  });
}
