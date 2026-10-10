import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiAuthError, PostingConflictError, accessChecks, assertNoWrites, calls, dataCalls,
  given, invocations, request, require, responseBody, state,
} from "./finance-route-harness.mjs";

const { POST } = require("../app/api/transactions/bulk-import/route.ts");
const row = (values = {}) => ({ Direction: "DEBIT", Subject: "Groceries", Date: "2026-10-09", AmountCents: 1250, ...values });
const input = (values = {}) => ({ workspaceId: "home", accountId: "bank", budgetId: "daily", transactions: [row()], ...values });
const submit = (body = input(), options) => POST(request("POST", body, options));
function givenDestination() {
  given("financialAccount.findFirst", { id: "bank" });
  given("budgetEnvelope.findFirst", { id: "daily", accountId: "bank" });
}
function givenRecalculation() {
  given("transaction.groupBy", [
    { direction: "CREDIT", _sum: { amountCents: 5000 } },
    { direction: "DEBIT", _sum: { amountCents: 1250 } },
  ]);
  given("budgetEnvelope.update", { id: "daily", availableCents: 3750 });
}

test("bulk imports reject foreign origins before accessing a workspace", async () => {
  const body = await responseBody(await submit(input(), { headers: { origin: "https://untrusted.example" } }), 403);
  assert.equal(body.error, "Cross-origin request denied");
  assert.deepEqual(accessChecks, []);
  assert.ok(calls.every(({ name }) => name === "log"));
  assertNoWrites();
});

test("bulk imports require EDITOR before looking up the destination", async () => {
  state.accessError = new ApiAuthError(403, "Editor access required");
  const body = await responseBody(await submit(), 403);
  assert.equal(body.error, "Editor access required");
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
  assert.equal(invocations("financialAccount.findFirst").length, 0);
  assertNoWrites();
});

for (const [label, body, options, status] of [
  ["invalid JSON", undefined, { rawBody: "{" }, 400],
  ["wrong content type", input(), { headers: { "content-type": "text/plain" } }, 415],
  ["declared oversized body", input(), { headers: { "content-length": String(1024 * 1024 + 1) } }, 413],
  ["actual oversized body", input({ transactions: [row({ Notes: "n".repeat(1024 * 1024) })] }), {}, 413],
  ["empty upload", input({ transactions: [] }), {}, 422],
  ["too many rows", input({ transactions: Array.from({ length: 251 }, () => row()) }), {}, 422],
  ["fractional cents", input({ transactions: [row({ AmountCents: 12.5 })] }), {}, 422],
  ["invalid direction", input({ transactions: [row({ Direction: "OTHER" })] }), {}, 422],
  ["chunk outside the run", input({ chunkIndex: 2, totalChunks: 2 }), {}, 422],
]) {
  test(`bulk imports reject ${label} without database access`, async () => {
    await responseBody(await submit(body, options), status);
    assert.deepEqual(accessChecks, []);
    assert.ok(calls.every(({ name }) => name === "log"));
    assertNoWrites();
  });
}

for (const [label, account, budget, error] of [
  ["missing account", null, undefined, "Invalid account for workspace."],
  ["missing budget", { id: "bank" }, null, "Invalid budget for workspace."],
  ["mismatched budget", { id: "bank" }, { id: "daily", accountId: "other-bank" }, "Selected budget is linked to a different bank account."],
]) {
  test(`bulk imports reject a ${label} before recording a posting`, async () => {
    given("financialAccount.findFirst", account);
    if (account) given("budgetEnvelope.findFirst", budget);
    const body = await responseBody(await submit(), 400);
    assert.equal(body.error, error);
    assert.deepEqual(dataCalls("financialAccount.findFirst"), [{ where: { id: "bank", workspaceId: "home", isActive: true }, select: { id: true } }]);
    if (account) assert.deepEqual(dataCalls("budgetEnvelope.findFirst"), [{ where: { id: "daily", workspaceId: "home", isActive: true }, select: { id: true, accountId: true } }]);
    assertNoWrites();
  });
}

test("migration imports preserve repeated rows, UTC dates and optional notes in one balanced posting", async () => {
  givenDestination();
  const transactions = [row(), row(), row({ Direction: "CREDIT", Date: "2026-10-10T01:30:00+08:00", Subject: "  Salary  ", Details: "  Payroll  ", Notes: "  Keep this note  " })];
  given("transaction.createMany", { count: 3 });
  givenRecalculation();
  const body = await responseBody(await submit(input({ transactions })), 201);
  assert.deepEqual(body, { success: true, imported: 3, duplicates: 0, duplicateRecords: [], failed: 0, errors: [], total: 3, chunked: false, chunkIndex: 0, totalChunks: 1, nextChunkIndex: 1, chunkSize: 3, processedCount: 3, remainingCount: 0, isComplete: true, recalculated: true });
  assert.equal(invocations("transaction.findMany").length, 0);
  const common = { workspaceId: "home", accountId: "bank", budgetId: "daily", kind: "Migration", amountCents: 1250, isSynced: false, isFromFamily: false, postingGroupId: "posting-group" };
  assert.deepEqual(dataCalls("transaction.createMany"), [{ data: [
    { ...common, direction: "DEBIT", date: new Date("2026-10-09T00:00:00Z"), subject: "Groceries", details: null, notes: null },
    { ...common, direction: "DEBIT", date: new Date("2026-10-09T00:00:00Z"), subject: "Groceries", details: null, notes: null },
    { ...common, direction: "CREDIT", date: new Date("2026-10-09T17:30:00Z"), subject: "Salary", details: "Payroll", notes: "Keep this note" },
  ] }]);
  const operation = dataCalls("posting")[0];
  assert.deepEqual({ ...operation, request: undefined }, { workspaceId: "home", operation: "TRANSACTION_BULK_IMPORT", idempotencyKey: "operation-once", actorUserId: "editor", sourceType: "IMPORT", sourceId: null, request: undefined });
  assert.equal(operation.request.kind, "Migration");
  assert.equal(operation.request.recalculate, true);
  assert.equal(operation.request.transactions[2].Subject, "Salary");
  assert.deepEqual(dataCalls("transaction.groupBy")[0], { by: ["direction"], where: { workspaceId: "home", budgetId: "daily", voidedAt: null, kind: { not: "REVERSAL" } }, _sum: { amountCents: true } });
  assert.equal(dataCalls("budgetEnvelope.update")[0].data.availableCents, 3750);
  assert.ok([...invocations("transaction.createMany"), ...invocations("transaction.groupBy"), ...invocations("budgetEnvelope.update")].every((call) => call.inPosting));
});

test("ordinary imports distinguish existing UTC-day duplicates from repeated payload rows", async () => {
  givenDestination();
  given("transaction.findMany", [{ date: new Date("2026-10-09T23:15:00Z"), subject: "Existing", amountCents: 1250 }]);
  given("transaction.createMany", { count: 1 });
  const transactions = [
    row({ Subject: " Existing ", Notes: " Stored elsewhere " }),
    row({ Subject: "Existing", Date: "2026-10-10T03:00:00+08:00", Notes: null }),
    row({ Subject: "New transaction", Notes: "" }),
    row({ Subject: "New transaction", Date: "2026-10-09T21:00:00Z", Notes: " repeated " }),
    row({ Date: "invalid-date" }),
  ];
  const body = await responseBody(await submit(input({ kind: "Import", transactions, recalculate: false })), 201);
  assert.equal(body.imported, 1);
  assert.equal(body.failed, 1);
  assert.deepEqual(body.errors, ["Groceries: Invalid date: invalid-date"]);
  assert.equal(body.duplicates, 3);
  assert.deepEqual(body.duplicateRecords, [
    { date: "2026-10-09", subject: "Existing", amountCents: 1250, direction: "DEBIT", notes: "Stored elsewhere", reason: "EXISTING_TRANSACTION" },
    { date: "2026-10-09", subject: "Existing", amountCents: 1250, direction: "DEBIT", notes: null, reason: "EXISTING_TRANSACTION" },
    { date: "2026-10-09", subject: "New transaction", amountCents: 1250, direction: "DEBIT", notes: "repeated", reason: "DUPLICATE_IN_PAYLOAD" },
  ]);
  const [query] = dataCalls("transaction.findMany");
  const { OR, ...scope } = query.where;
  assert.deepEqual(scope, { workspaceId: "home", accountId: "bank", budgetId: "daily", voidedAt: null, kind: { not: "REVERSAL" } });
  assert.equal(query.take, 40);
  assert.equal(OR.length, 4);
  assert.ok(OR.every(({ date }) => date.gte.toISOString() === "2026-10-09T00:00:00.000Z" && date.lt.toISOString() === "2026-10-10T00:00:00.000Z"));
  assert.deepEqual(dataCalls("transaction.createMany")[0].data.map(({ subject, notes }) => ({ subject, notes })), [{ subject: "New transaction", notes: null }]);
  assert.equal(invocations("transaction.groupBy").length, 0);
});

test("duplicate lookups use bounded batches without dropping rows from a larger import", async () => {
  givenDestination();
  given("transaction.findMany", [], []);
  given("transaction.createMany", { count: 51 });
  const transactions = Array.from({ length: 51 }, (_, index) => row({ Subject: `Imported ${index}` }));
  const body = await responseBody(await submit(input({ transactions, kind: "Statement", recalculate: false, chunkSize: 250 })), 201);
  assert.equal(body.imported, 51);
  assert.equal(body.processedCount, 51);
  assert.equal(body.chunked, true);
  assert.equal(body.chunkSize, 250);
  assert.deepEqual(dataCalls("transaction.findMany").map(({ where, take }) => [where.OR.length, take]), [[50, 500], [1, 10]]);
  assert.equal(dataCalls("transaction.createMany")[0].data.length, 51);
});

for (const [label, chunk, recalculate] of [
  ["intermediate", { chunkIndex: 0, totalChunks: 2 }, false],
  ["final", { chunkIndex: 1, totalChunks: 2 }, true],
  ["unknown total", { chunkIndex: 4 }, true],
  ["missing index", { totalChunks: 2 }, true],
  ["explicitly disabled", { chunkIndex: 1, totalChunks: 2, recalculate: false }, false],
]) {
  test(`the ${label} chunk reports progress and recalculates only when required`, async () => {
    givenDestination();
    given("transaction.createMany", { count: 1 });
    if (recalculate) givenRecalculation();
    const body = await responseBody(await submit(input({ ...chunk, importRunId: "fixture-import-run", chunkSize: 100 }), { headers: { "idempotency-key": "" } }), 201);
    assert.equal(body.imported, 1);
    assert.equal(body.recalculated, recalculate);
    assert.equal(body.chunkIndex, chunk.chunkIndex ?? 0);
    assert.equal(body.totalChunks, chunk.totalChunks ?? 1);
    assert.equal(body.nextChunkIndex, (chunk.chunkIndex ?? 0) + 1);
    assert.equal(body.chunkSize, 100);
    const operation = dataCalls("posting")[0];
    assert.equal(operation.sourceId, chunk.chunkIndex === undefined ? null : String(chunk.chunkIndex));
    if (chunk.chunkIndex === undefined) assert.match(operation.idempotencyKey, /^[a-f\d-]{36}$/);
    else assert.equal(operation.idempotencyKey, `json-import:fixture-import-run:${chunk.chunkIndex}`);
    assert.equal(invocations("transaction.groupBy").length, Number(recalculate));
  });
}

test("a run containing only invalid dates records failures without querying duplicates or inserting rows", async () => {
  givenDestination();
  givenRecalculation();
  const body = await responseBody(await submit(input({ kind: "Import", transactions: [row({ Date: "invalid-date" }), row({ Subject: "Another", Date: "2026-99-99" })] })), 201);
  assert.equal(body.imported, 0);
  assert.equal(body.failed, 2);
  assert.deepEqual(body.errors, ["Groceries: Invalid date: invalid-date", "Another: Invalid date: 2026-99-99"]);
  assert.equal(invocations("transaction.findMany").length, 0);
  assert.equal(invocations("transaction.createMany").length, 0);
  assert.equal(body.recalculated, true);
});

test("a replay returns the original posting result without recounting duplicates or updating balances", async () => {
  givenDestination();
  given("transaction.findMany", [{ date: new Date("2026-10-09T00:00:00Z"), subject: "Groceries", amountCents: 1250 }]);
  state.replayedPosting = { result: { count: 1, recalculated: true }, postingGroupId: "prior-posting", replayed: true };
  const body = await responseBody(await submit(input({ kind: "Import", transactions: [row(), row({ Date: "invalid-date" })] })), 201);
  assert.equal(body.imported, 1);
  assert.equal(body.recalculated, true);
  assert.equal(body.duplicates, 0);
  assert.equal(body.failed, 0);
  assert.deepEqual(body.duplicateRecords, []);
  assert.deepEqual(body.errors, []);
  assert.equal(invocations("transaction.createMany").length, 0);
  assert.equal(invocations("transaction.groupBy").length, 0);
  assert.equal(invocations("budgetEnvelope.update").length, 0);
});

for (const [failure, status, message] of [
  [new PostingConflictError("Import key was already used with different rows"), 409, "Import key was already used with different rows"],
  [new Error("private database diagnostic"), 500, "Failed to import transactions"],
]) {
  test(`posting failures return a safe ${status} import response`, async () => {
    givenDestination();
    state.postingError = failure;
    const body = await responseBody(await submit(), status);
    assert.equal(body.error, message);
    assert.equal(invocations("transaction.createMany").length, 0);
    assert.equal(invocations("transaction.groupBy").length, 0);
    assert.ok(!JSON.stringify(body).includes("private database diagnostic"));
  });
}

test("an insert failure aborts before recalculation and never reports a successful import", async () => {
  givenDestination();
  given("transaction.createMany", new Error("private insert details"));
  const body = await responseBody(await submit(), 500);
  assert.equal(body.error, "Failed to import transactions");
  assert.ok(!body.success);
  assert.equal(invocations("transaction.groupBy").length, 0);
  assert.ok(invocations("transaction.createMany")[0].inPosting);
});
