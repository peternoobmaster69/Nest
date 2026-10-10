import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { beforeEach, mock } from "node:test";
import { calls, dataCalls, given, require, state } from "./finance-route-harness.mjs";

const { Prisma } = require("@prisma/client");
mock.module("../lib/credit-alert-parser.ts", { namedExports: {
  parseCreditAlert(body, subject) { calls.push({ name: "parse", args: [body, subject] }); return state.parsed; },
} });
mock.module("../lib/credit-alert-diagnostics.ts", { namedExports: {
  sealFailedCreditAlertBody(input) { calls.push({ name: "seal", args: [input] }); return "encrypted-diagnostic"; },
} });
const { ingestCreditAlert } = require("../lib/credit-alert-ingest.ts");
const now = new Date("2026-10-10T12:00:00.000Z");
const transactionDate = new Date("2026-10-09T12:00:00.000Z");
const card = { id: "card", statementDay: 15, paymentDueDay: 25 };
const params = (values = {}) => ({ workspaceId: "home", rawBody: "Synthetic purchase details", rawSubject: "Card purchase", sourceMessageId: "message", ...values });
const ingest = (values = {}) => ingestCreditAlert(params(values));
const hash = value => createHash("sha256").update(value).digest("hex");
const record = (values = {}) => ({ id: "alert", parseStatus: "PARSED", creditTransactionId: null, ...values });
beforeEach(t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  state.parsed = { bankName: "DBS", currency: " sgd ", transactionRef: "bank-reference", cardLast4: "1234", merchant: "Coffee shop", amountCents: 250, transactionDate, alertType: "PURCHASE" };
});
function givenNewStaging() {
  given("cardAlertStaging.findFirst", null);
  given("cardAlertStaging.create", ({ data }) => record(data));
}
function givenProcessing({ existingTransaction = null } = {}) {
  given("cardAlertStaging.updateMany", { count: 1 });
  given("creditCardAccount.findFirst", card);
  given("creditCardTransaction.findFirst", existingTransaction);
  given("creditCardTransaction.create", { id: "credit-transaction" });
  given("cardAlertStaging.update", ({ data }) => record(data));
}

for (const status of ["PROCESSED", "DUPLICATE", "FAILED"]) {
  test(`repeated ${status} alerts return their existing result without processing again`, async () => {
    given("cardAlertStaging.findFirst", record({ parseStatus: status, creditTransactionId: "existing-transaction" }));
    assert.deepEqual(await ingest(), { id: "alert", parseStatus: status, creditTransactionId: "existing-transaction", duplicate: true });
    assert.deepEqual(dataCalls("cardAlertStaging.create"), []);
    assert.deepEqual(dataCalls("cardAlertStaging.updateMany"), []);
    assert.deepEqual(dataCalls("seal"), []);
  });
}

test("new alerts redact source text, normalize currency, and derive the statement from the matched card", async () => {
  givenNewStaging();
  givenProcessing();
  const result = await ingest();
  assert.equal(result.parseStatus, "PROCESSED");
  assert.equal(result.creditTransactionId, "credit-transaction");
  const sourceMessageKey = hash("home\0EMAIL\0message");
  const contentHash = hash("Synthetic purchase details");
  assert.deepEqual(dataCalls("cardAlertStaging.findFirst")[0].where, { workspaceId: "home", OR: [{ sourceMessageKey }, { transactionRef: "bank-reference" }] });
  const staged = dataCalls("cardAlertStaging.create")[0].data;
  assert.equal(staged.source, "EMAIL");
  assert.equal(staged.sourceMessageKey, sourceMessageKey);
  assert.equal(staged.transactionKey, hash("home\0bank-reference"));
  assert.equal(staged.contentHash, contentHash);
  assert.equal(staged.rawBody, `[redacted after parsing; sha256:${contentHash}]`);
  assert.equal(staged.rawSubject, "[redacted after parsing]");
  assert.equal(staged.currency, "SGD");
  assert.equal(staged.parseStatus, "PARSED");
  assert.equal(staged.failureReason, null);
  assert.deepEqual(dataCalls("creditCardTransaction.findFirst")[0].where, { workspaceId: "home", creditCardId: "card", transactionDate, amountCents: 250, subject: "Coffee shop" });
  assert.deepEqual(dataCalls("creditCardTransaction.create")[0].data, {
    workspaceId: "home", creditCardId: "card", transactionDate, paymentDueDate: new Date("2026-10-25T00:00:00.000Z"),
    statementMonth: 10, statementYear: 2026, amountCents: 250, subject: "Coffee shop", isInstallment: false,
  });
  assert.deepEqual(dataCalls("cardAlertStaging.update")[0].data, { parseStatus: "PROCESSED", creditCardId: "card", creditTransactionId: "credit-transaction", processingStartedAt: null, processedAt: now });
  assert.deepEqual(dataCalls("seal"), []);
});

test("alerts without provider IDs use a workspace-and-source-scoped content fingerprint", async () => {
  delete state.parsed.transactionRef;
  givenNewStaging();
  givenProcessing();
  await ingest({ rawSubject: undefined, sourceMessageId: undefined, source: "IMPORT" });
  const contentHash = hash("Synthetic purchase details");
  const expectedKey = hash(`home\0IMPORT\0${contentHash}`);
  assert.deepEqual(dataCalls("cardAlertStaging.findFirst")[0].where.OR, [{ sourceMessageKey: expectedKey }]);
  const { data } = dataCalls("cardAlertStaging.create")[0];
  assert.equal(data.sourceMessageKey, expectedKey);
  assert.equal(data.transactionKey, null);
  assert.equal(data.rawSubject, null);
});

for (const [alertType, amountCents, expected] of [["REVERSAL", 250, -250], ["REVERSAL", -250, -250], ["PURCHASE", 0, 0], ["PURCHASE", -250, -250]]) {
  test(`${alertType} amounts retain their intended sign (${amountCents})`, async () => {
    Object.assign(state.parsed, { alertType, amountCents });
    givenNewStaging();
    givenProcessing();
    await ingest();
    assert.equal(dataCalls("cardAlertStaging.create")[0].data.amountCents, expected);
    assert.equal(dataCalls("creditCardTransaction.create")[0].data.amountCents, expected);
  });
}

for (const [field, description] of [["cardLast4", "card last four digits"], ["merchant", "merchant"], ["amountCents", "amount"], ["transactionDate", "transaction date"]]) {
  test(`alerts missing ${description} keep an encrypted diagnostic and never reach the card ledger`, async () => {
    delete state.parsed[field];
    givenNewStaging();
    const result = await ingest();
    assert.equal(result.parseStatus, "FAILED");
    assert.equal(result.failureReason, `Unable to parse required fields: ${description}.`);
    assert.equal(result.rawBody, "encrypted-diagnostic");
    assert.deepEqual(dataCalls("seal"), [{ workspaceId: "home", sourceMessageKey: hash("home\0EMAIL\0message"), rawBody: "Synthetic purchase details", contentHash: hash("Synthetic purchase details") }]);
    assert.deepEqual(dataCalls("cardAlertStaging.updateMany"), []);
    assert.deepEqual(dataCalls("creditCardTransaction.create"), []);
  });
}

test("reprocessing a pending alert that cannot be parsed records a terminal, encrypted failure", async () => {
  delete state.parsed.amountCents;
  given("cardAlertStaging.findFirst", record({ parseStatus: "PENDING" }));
  given("cardAlertStaging.updateMany", { count: 1 });
  given("cardAlertStaging.update", ({ data }) => record(data));
  const result = await ingest();
  assert.equal(result.parseStatus, "FAILED");
  assert.equal(result.rawBody, "encrypted-diagnostic");
  assert.equal(result.failureReason, "Unable to parse required fields: amount.");
  assert.equal(result.processingStartedAt, null);
  assert.deepEqual(dataCalls("creditCardTransaction.create"), []);
});

test("an unparseable retry cannot overwrite another worker's active processing claim", async () => {
  delete state.parsed.amountCents;
  given("cardAlertStaging.findFirst", record({ parseStatus: "PROCESSING" }));
  given("cardAlertStaging.updateMany", { count: 0 });
  await assert.rejects(ingest(), error => error.code === "ALERT_STAGING_BUSY" && error.retryable);
  assert.deepEqual(dataCalls("cardAlertStaging.update"), []);
  assert.deepEqual(dataCalls("seal"), []);
});

for (const status of ["PENDING", "PARSED", "PROCESSING"]) {
  test(`${status} staging records are claimed before touching the card ledger`, async () => {
    given("cardAlertStaging.findFirst", record({ parseStatus: status }));
    givenProcessing();
    assert.equal((await ingest()).parseStatus, "PROCESSED");
    assert.deepEqual(dataCalls("cardAlertStaging.create"), []);
    assert.deepEqual(dataCalls("cardAlertStaging.updateMany"), [{
      where: { id: "alert", OR: [{ parseStatus: { in: ["PENDING", "PARSED"] } }, { parseStatus: "PROCESSING", processingStartedAt: { lte: new Date("2026-10-10T11:58:00.000Z") } }] },
      data: { parseStatus: "PROCESSING", processingStartedAt: now },
    }]);
    assert.ok(calls.findIndex(call => call.name === "cardAlertStaging.updateMany") < calls.findIndex(call => call.name === "creditCardAccount.findFirst"));
  });
}

test("a competing active claim returns a retryable error without a second transaction", async () => {
  given("cardAlertStaging.findFirst", record({ parseStatus: "PROCESSING" }));
  given("cardAlertStaging.updateMany", { count: 0 });
  await assert.rejects(ingest(), error => error.code === "ALERT_STAGING_BUSY" && error.retryable && error.safeMessage === "Credit alert staging is busy. The job will retry.");
  assert.deepEqual(dataCalls("creditCardAccount.findFirst"), []);
  assert.deepEqual(dataCalls("creditCardTransaction.create"), []);
});

for (const status of ["PROCESSED", "DUPLICATE", "FAILED", "PARSED"]) {
  test(`concurrent staging creation reuses the winning ${status} record`, async () => {
    const collision = new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "test" });
    given("cardAlertStaging.findFirst", null, record({ parseStatus: status }));
    given("cardAlertStaging.create", collision);
    if (status === "PARSED") givenProcessing();
    const result = await ingest();
    if (status === "PARSED") assert.equal(result.parseStatus, "PROCESSED");
    else {
      assert.equal(result.parseStatus, status);
      assert.equal(result.duplicate, true);
      assert.deepEqual(dataCalls("creditCardTransaction.create"), []);
    }
    assert.deepEqual(dataCalls("cardAlertStaging.findFirst")[0], dataCalls("cardAlertStaging.findFirst")[1]);
  });
}

for (const failure of [new Error("Storage unavailable"), new Prisma.PrismaClientKnownRequestError("Other database error", { code: "P2010", clientVersion: "test" }), new Prisma.PrismaClientKnownRequestError("Missing concurrent row", { code: "P2002", clientVersion: "test" })]) {
  test(`staging failures cannot silently report success (${failure.message})`, async () => {
    given("cardAlertStaging.findFirst", null, null);
    given("cardAlertStaging.create", failure);
    await assert.rejects(ingest(), error => error === failure);
    assert.deepEqual(dataCalls("creditCardTransaction.create"), []);
  });
}

for (const bankName of [undefined, "Unlisted Bank"]) {
  test(`card matching falls back to an active workspace card when ${bankName ? "the bank has no match" : "the alert has no bank name"}`, async () => {
    state.parsed.bankName = bankName;
    givenNewStaging();
    givenProcessing();
    given("creditCardAccount.findFirst", ...(bankName ? [null, card] : [card]));
    await ingest();
    const queries = dataCalls("creditCardAccount.findFirst");
    assert.equal(queries.length, bankName ? 2 : 1);
    assert.deepEqual(queries.at(-1).where, { workspaceId: "home", isActive: true, last4Digit: "1234" });
    if (bankName) assert.equal(queries[0].where.bankName, bankName);
  });
}

test("unmatched alerts become terminal failures with their processing lease cleared", async () => {
  givenNewStaging();
  givenProcessing();
  given("creditCardAccount.findFirst", null, null);
  const result = await ingest();
  assert.equal(result.parseStatus, "FAILED");
  assert.equal(result.failureReason, "No active card found for last4 1234.");
  assert.equal(result.processingStartedAt, null);
  assert.deepEqual(result.processedAt, now);
  assert.deepEqual(dataCalls("creditCardTransaction.findFirst"), []);
});

test("matching financial transactions are linked as duplicates without adding another charge", async () => {
  givenNewStaging();
  givenProcessing({ existingTransaction: { id: "existing-charge" } });
  const result = await ingest();
  assert.equal(result.parseStatus, "DUPLICATE");
  assert.equal(result.creditCardId, "card");
  assert.equal(result.creditTransactionId, "existing-charge");
  assert.equal(result.processingStartedAt, null);
  assert.deepEqual(dataCalls("creditCardTransaction.create"), []);
});

test("a transaction storage failure is retryable and never marks staging as processed", async () => {
  givenNewStaging();
  givenProcessing();
  given("creditCardTransaction.create", new Error("Transaction write failed"));
  await assert.rejects(ingest(), /Transaction write failed/);
  assert.deepEqual(dataCalls("cardAlertStaging.update"), []);
});
