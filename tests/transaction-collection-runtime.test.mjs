import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiAuthError, PostingConflictError, accessChecks, assertNoWrites, calls, dataCalls, given,
  invocations, request, require, state,
} from "./finance-route-harness.mjs";

const { GET, POST } = require("../app/api/transactions/route.ts");
const date = new Date("2026-10-09T12:30:00.000Z");
const transaction = (values = {}) => ({ id: "record", workspaceId: "home", accountId: "bank", budgetId: "daily", direction: "DEBIT", amountCents: 250, subject: "Lunch", date, createdAt: date, updatedAt: date, postingGroup: null, ...values });
const input = (values = {}) => ({ workspaceId: "home", accountId: "bank", budgetId: "daily", subject: "Lunch", amountCents: 250, direction: "DEBIT", kind: "EXPENSE", date: date.toISOString(), budgetOperation: "DEDUCT", ...values });
const read = (values = {}) => GET(request("GET", undefined, { query: `?${new URLSearchParams({ workspaceId: "home", ...values })}` }));
async function bodyOf(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}
function givenPage(rows = [], summary = [], total = rows.length) {
  given("transaction.findMany", rows);
  given("transaction.count", total);
  given("transaction.groupBy", summary);
}

test("transaction lists require a workspace and reject overlong filters before reading data", async () => {
  assert.deepEqual(await bodyOf(await GET(request("GET")), 400), { error: "workspaceId is required" });
  for (const [key, length] of [["search", 101], ["transactionId", 192], ["cursor", 192]]) {
    assert.deepEqual(await bodyOf(await read({ [key]: "x".repeat(length) }), 400), { error: "Search, cursor, or transaction id is too long", code: "INVALID_REQUEST" });
  }
  assert.deepEqual(accessChecks, []);
  assert.deepEqual(calls, []);
});

test("single and multiple month filters reject invalid periods and more than 24 unique months", async () => {
  for (const month of ["2026-13", "2026-1", "not-a-month"]) {
    assert.deepEqual(await bodyOf(await read({ month }), 400), { error: "month must be in YYYY-MM format" });
  }
  for (const months of ["2026-10,2026-00", Array.from({ length: 25 }, (_, index) => `${2020 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`).join(",")]) {
    assert.deepEqual(await bodyOf(await read({ months }), 400), { error: "months must contain at most 24 YYYY-MM values" });
  }
  assert.equal(accessChecks.length, 5);
  assert.deepEqual(calls, []);
});

test("legacy transaction lists stay bounded and serialize correction history without internal posting details", async () => {
  const rows = [transaction(), transaction({ id: "corrected", postingGroup: { operation: "TRANSACTION_CORRECTION" } }), transaction({ id: "ordinary", postingGroup: { operation: "TRANSACTION_CREATE" } })];
  given("transaction.findMany", rows);
  const body = await bodyOf(await read({ search: " ", transactionId: " " }));
  assert.ok(Array.isArray(body));
  assert.deepEqual(body.map(({ id, hasCorrectionHistory }) => ({ id, hasCorrectionHistory })), [{ id: "record", hasCorrectionHistory: false }, { id: "corrected", hasCorrectionHistory: true }, { id: "ordinary", hasCorrectionHistory: false }]);
  assert.ok(body.every((row) => row.date === date.toISOString() && row.createdAt === date.toISOString() && row.updatedAt === date.toISOString() && !("postingGroup" in row)));
  const [query] = dataCalls("transaction.findMany");
  assert.deepEqual(query.where, { workspaceId: "home", voidedAt: null, kind: { not: "REVERSAL" } });
  assert.deepEqual(query.orderBy, [{ date: "desc" }, { createdAt: "desc" }]);
  assert.equal(query.take, 100);
  assert.deepEqual(query.select.postingGroup, { select: { operation: true } });
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: undefined }]);
  assert.equal(invocations("transaction.count").length, 0);
  assertNoWrites();
});

test("transaction pages combine account, budget, group, record and search filters with full-result totals", async () => {
  givenPage([transaction({ id: "first" }), transaction({ id: "second" }), transaction({ id: "extra" })], [
    { direction: "DEBIT", _sum: { amountCents: 650 } }, { direction: "CREDIT", _sum: { amountCents: 1000 } },
  ], 8);
  const body = await bodyOf(await read({ page: "2", limit: "2", accountId: "bank", budgetId: "daily", groupId: "group", transactionId: " record ", search: " Lunch " }));
  assert.deepEqual(body.transactions.map(({ id }) => id), ["first", "second"]);
  assert.deepEqual({ ...body, transactions: undefined }, { transactions: undefined, total: 8, page: 2, limit: 2, hasMore: true, nextCursor: "second", summary: { incomeCents: 1000, expenseCents: 650 } });
  const [query] = dataCalls("transaction.findMany");
  assert.equal(query.skip, 2);
  assert.equal(query.take, 3);
  assert.deepEqual(query.orderBy, [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(query.where, {
    workspaceId: "home", voidedAt: null, kind: { not: "REVERSAL" }, id: "record", accountId: "bank", budgetId: "daily", groupId: "group",
    AND: [{ OR: [{ subject: { contains: "Lunch" } }, { details: { contains: "Lunch" } }, { notes: { contains: "Lunch" } }] }],
  });
  assert.deepEqual(dataCalls("transaction.count"), [{ where: query.where }]);
  assert.deepEqual(dataCalls("transaction.groupBy"), [{ by: ["direction"], where: query.where, _sum: { amountCents: true } }]);
});

test("cursor pages advance after the supplied record and preserve empty and null aggregate totals", async () => {
  givenPage([transaction()], [{ direction: "CREDIT", _sum: { amountCents: null } }, { direction: "DEBIT", _sum: { amountCents: null } }]);
  const body = await bodyOf(await read({ cursor: "previous", page: "10", limit: "2" }));
  assert.deepEqual(dataCalls("transaction.findMany")[0].cursor, { id: "previous" });
  assert.equal(dataCalls("transaction.findMany")[0].skip, 1);
  assert.equal(body.hasMore, false);
  assert.equal(body.nextCursor, null);
  assert.deepEqual(body.summary, { incomeCents: 0, expenseCents: 0 });
  givenPage();
  const empty = await bodyOf(await read({ paginated: "1" }));
  assert.deepEqual(empty.transactions, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.nextCursor, null);
  assert.deepEqual(empty.summary, { incomeCents: 0, expenseCents: 0 });
});

for (const [name, value] of [["paginated", "1"], ["page", ""], ["limit", ""], ["cursor", ""], ["accountId", ""], ["budgetId", "ALL"], ["groupId", ""], ["transactionId", "record"], ["month", "ALL"], ["months", ""], ["from", ""], ["to", ""], ["search", "Lunch"]]) {
  test(`the ${name} query opts into the transaction page response`, async () => {
    givenPage();
    const body = await bodyOf(await read({ [name]: value }));
    assert.deepEqual(body.transactions, []);
    assert.equal(body.page, 1);
    assert.equal(body.limit, 50);
    assert.equal(dataCalls("transaction.findMany")[0].take, 51);
    if (name === "budgetId") assert.ok(!("budgetId" in dataCalls("transaction.findMany")[0].where));
  });
}

for (const [page, limit, expectedPage, expectedLimit] of [["-3", "-2", 1, 1], ["0", "0", 1, 50], ["invalid", "invalid", 1, 50], ["3", "1000", 3, 100]]) {
  test(`transaction pagination bounds page=${page} and limit=${limit}`, async () => {
    givenPage();
    const body = await bodyOf(await read({ page, limit }));
    assert.equal(body.page, expectedPage);
    assert.equal(body.limit, expectedLimit);
    assert.equal(dataCalls("transaction.findMany")[0].skip, (expectedPage - 1) * expectedLimit);
  });
}

test("single month filters include the start and exclude the next month", async () => {
  givenPage();
  await bodyOf(await read({ month: "2026-12" }));
  assert.deepEqual(dataCalls("transaction.findMany")[0].where.date, { gte: new Date("2026-12-01T00:00:00Z"), lt: new Date("2027-01-01T00:00:00Z") });
});

test("custom months are trimmed and deduplicated and take precedence over explicit from/to dates", async () => {
  givenPage();
  await bodyOf(await read({ months: " 2026-09,2026-10,2026-09, ,", from: "2020-01-01", to: "2020-02-01" }));
  const { where } = dataCalls("transaction.findMany")[0];
  assert.ok(!("date" in where));
  assert.deepEqual(where.AND, [{ OR: [
    { date: { gte: new Date("2026-09-01T00:00:00Z"), lt: new Date("2026-10-01T00:00:00Z") } },
    { date: { gte: new Date("2026-10-01T00:00:00Z"), lt: new Date("2026-11-01T00:00:00Z") } },
  ] }]);
});

for (const range of [{ from: "2026-10-01" }, { to: "2026-10-05" }, { from: "2026-10-01", to: "2026-10-05", month: "2026-09" }]) {
  test(`explicit dates support ${Object.keys(range).join(" and ")}`, async () => {
    givenPage();
    await bodyOf(await read(range));
    const expected = {};
    if (range.from) expected.gte = new Date(range.from);
    if (range.to) { expected.lte = new Date(range.to); expected.lte.setHours(23, 59, 59, 999); }
    assert.deepEqual(dataCalls("transaction.findMany")[0].where.date, expected);
  });
}

test("transaction list errors preserve authorization status and report storage failures", async () => {
  state.accessError = new ApiAuthError(403, "Forbidden");
  assert.deepEqual(await bodyOf(await read(), 403), { error: "Forbidden" });
  assert.deepEqual(calls, []);
  state.accessError = null;
  for (const failure of [new Error("Storage unavailable"), "Unavailable"]) {
    given("transaction.findMany", () => Promise.reject(failure));
    assert.deepEqual(await bodyOf(await read(), 500), { error: "Failed to fetch transactions", message: failure instanceof Error ? failure.message : "Unknown error" });
  }
  assertNoWrites();
});

test("new transactions require valid input and EDITOR access before writing", async () => {
  for (const invalid of [null, input({ amountCents: 1.2 }), input({ budgetId: "" }), input({ budgetOperation: "OTHER" }), input({ date: "invalid" })]) {
    const body = await bodyOf(await POST(request("POST", invalid)), 400);
    assert.ok(body.error.formErrors.length || Object.keys(body.error.fieldErrors).length);
  }
  assert.deepEqual(accessChecks, []);
  state.accessError = new ApiAuthError(403, "Editor access required");
  assert.deepEqual(await bodyOf(await POST(request("POST", input())), 403), { error: "Editor access required" });
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
  assert.deepEqual(calls, []);
});

test("new transactions reject an account outside the active workspace", async () => {
  given("financialAccount.findFirst", null);
  assert.deepEqual(await bodyOf(await POST(request("POST", input())), 400), { error: "Invalid account for workspace." });
  assert.deepEqual(dataCalls("financialAccount.findFirst"), [{ where: { id: "bank", workspaceId: "home", isActive: true }, select: { id: true } }]);
  assertNoWrites();
});

for (const [operation, direction, kind, groupId] of [["ADD", "CREDIT", "ADJUSTMENT", undefined], ["DEDUCT", "DEBIT", "EXPENSE", "group"]]) {
  test(`${operation} transactions use the requested budget operation and apply one posted balance change`, async () => {
    given("financialAccount.findFirst", { id: "bank" });
    const created = transaction({ direction, kind });
    given("transaction.create", created);
    given("budgetEnvelope.findFirst", { id: "daily", accountId: "bank" });
    if (groupId) {
      given("transactionGroup.findFirst", { id: groupId });
      given("transaction.update", { ...created, groupId });
    }
    given("budgetEnvelope.update", { id: "daily", availableCents: 1000 });
    const payload = input({ budgetOperation: operation, ...(groupId ? { groupId } : {}), direction: direction === "DEBIT" ? "CREDIT" : "DEBIT", kind: "INCOME", details: "Receipt", notes: "Entry note" });
    const body = await bodyOf(await POST(request("POST", payload)), 201);
    assert.equal(body.tx.direction, direction);
    assert.equal(body.tx.kind, kind);
    assert.deepEqual(body.updatedBudget, { id: "daily", availableCents: 1000 });
    assert.equal(body.postingGroupId, "posting-group");
    assert.equal(body.replayed, false);
    const { budgetOperation, groupId: suppliedGroup, ...expectedPayload } = payload;
    assert.equal(budgetOperation, operation);
    assert.equal(suppliedGroup, groupId);
    assert.deepEqual(dataCalls("transaction.create"), [{ data: { ...expectedPayload, direction, kind, date, isSynced: false, isFromFamily: false, postingGroupId: "posting-group" } }]);
    assert.equal(dataCalls("budgetEnvelope.update")[0].data.availableCents.increment, direction === "CREDIT" ? 250 : -250);
    assert.deepEqual(dataCalls("posting")[0], { workspaceId: "home", operation: "TRANSACTION_CREATE", idempotencyKey: "operation-once", actorUserId: "editor", sourceType: "TRANSACTION_REQUEST", request: payload });
    assert.deepEqual(dataCalls("budgetEnvelope.findFirst")[0], { where: { id: "daily", workspaceId: "home", isActive: true }, select: { id: true, accountId: true } });
    if (groupId) {
      assert.deepEqual(dataCalls("transactionGroup.findFirst")[0], { where: { id: groupId, workspaceId: "home", budgetId: "daily" }, select: { id: true } });
      assert.deepEqual(dataCalls("transaction.update"), [{ where: { id: "record" }, data: { groupId } }]);
    }
    assert.ok(calls.filter(({ name }) => ["transaction.create", "transaction.update", "budgetEnvelope.findFirst", "budgetEnvelope.update", "transactionGroup.findFirst"].includes(name)).every((call) => call.inPosting));
  });
}

for (const [budget, groupId, error] of [
  [null, undefined, "Selected budget does not belong to workspace."],
  [{ id: "daily", accountId: "another" }, undefined, "Selected budget is linked to a different bank account."],
  [{ id: "daily", accountId: "bank" }, "missing", "Selected group does not belong to this sub-account."],
]) {
  test(`transaction postings reject invalid links: ${error}`, async () => {
    given("financialAccount.findFirst", { id: "bank" });
    given("transaction.create", transaction());
    given("budgetEnvelope.findFirst", budget);
    if (groupId) given("transactionGroup.findFirst", null);
    assert.deepEqual(await bodyOf(await POST(request("POST", input({ groupId }))), 400), { error });
    assert.equal(invocations("budgetEnvelope.update").length, 0);
    assert.ok(invocations("transaction.create")[0].inPosting);
  });
}

test("replayed transaction requests return the original result without a second transaction or budget update", async () => {
  given("financialAccount.findFirst", { id: "bank" });
  state.replayedPosting = { result: { tx: { id: "original" }, updatedBudget: { id: "daily" } }, postingGroupId: "original-group", replayed: true };
  assert.deepEqual(await bodyOf(await POST(request("POST", input()))), { ...state.replayedPosting.result, postingGroupId: "original-group", replayed: true });
  assert.equal(invocations("transaction.create").length, 0);
  assert.equal(invocations("budgetEnvelope.update").length, 0);
});

for (const [failure, status, expected] of [
  [new PostingConflictError("Request already changed"), 409, { error: "Request already changed" }],
  [new Error("Posting unavailable"), 500, { error: "Failed to create transaction", message: "Posting unavailable" }],
  ["Unavailable", 500, { error: "Failed to create transaction", message: "Unknown error" }],
]) {
  test(`transaction creation reports ${status} for ${String(failure)}`, async () => {
    given("financialAccount.findFirst", { id: "bank" });
    state.postingError = failure;
    assert.deepEqual(await bodyOf(await POST(request("POST", input())), status), expected);
    assert.equal(invocations("transaction.create").length, 0);
  });
}
