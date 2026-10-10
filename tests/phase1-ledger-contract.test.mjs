import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getTransactionBudgetDelta } from "../lib/budget-ledger.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("journal and idempotency records are workspace-scoped and source-linked", async () => {
  const schema = await source("prisma/schema.prisma");
  const migration = await source("prisma/migrations/phase_1_posting_ledger_and_idempotency/migration.sql");

  assert.match(schema, /model PostingGroup[\s\S]*?@@unique\(\[workspaceId, operation, idempotencyKey\]\)/);
  assert.match(schema, /model IdempotencyRecord[\s\S]*?@@unique\(\[workspaceId, operation, idempotencyKey\]\)/);
  assert.match(schema, /model Transaction[\s\S]*?postingGroupId\s+String\?[\s\S]*?creditCardTransactionId\s+String\?[\s\S]*?receivableId\s+String\?/);
  assert.match(migration, /CREATE UNIQUE INDEX \[CreditCardTxnLink_creditCardTransactionId_unique\]/);
  assert.match(migration, /ledgerTxn\.\[externalRef\] LIKE CONCAT/);
  assert.match(migration, /credit-auto:/);
  assert.match(migration, /sourceTxn\.\[id\]/);
});

test("posting service serializes journal effects and replays only matching requests", async () => {
  const service = await source("lib/posting-service.ts");

  assert.match(service, /createHash\("sha256"\)/);
  assert.match(service, /stored\.requestHash !== hash/);
  assert.match(service, /status !== "COMPLETED"/);
  assert.match(service, /replayed: true/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /INSERT INTO \[IdempotencyRecord\]/);
  assert.match(service, /INSERT INTO \[PostingGroup\]/);
  assert.match(service, /UPDATE \[IdempotencyRecord\][\s\S]*?\[status\] = 'COMPLETED'/);
});

test("allocation and receivable claims are conditional single-row updates", async () => {
  const service = await source("lib/posting-service.ts");
  const autoRunner = await source("lib/credit-txn-auto-account-runner.ts");

  assert.match(service, /creditCardTransaction\.updateMany\([\s\S]*?isAllocated: false[\s\S]*?claimed\.count !== 1/);
  assert.match(service, /receivable\.updateMany\([\s\S]*?status: \{ notIn: \["PAID", "PROCESSING"\] \}[\s\S]*?claimed\.count !== 1/);
  assert.match(autoRunner, /creditCardTransaction\.updateMany\([\s\S]*?isAllocated: false/);
});

test("all interactive balance mutations use the central posting service", async () => {
  const routes = [
    "app/api/transactions/route.ts",
    "app/api/transactions/transfer/route.ts",
    "app/api/transactions/[id]/route.ts",
    "app/api/transactions/[id]/corrections/route.ts",
    "app/api/receivables/[id]/close/route.ts",
    "app/api/credit-transactions/[id]/accounting/route.ts",
    "app/api/credit-transactions/payments/route.ts",
    "app/api/transactions/bulk-import/route.ts",
    "app/api/budgets/plan/route.ts",
  ];

  for (const route of routes) {
    const code = await source(route);
    assert.match(code, /executePosting|reverseLedgerTransaction|correctLedgerTransaction/, route);
  }
});

test("posted transaction deletion creates an attributed reversal and never deletes history", async () => {
  const route = await source("app/api/transactions/[id]/route.ts");
  const service = await source("lib/posting-service.ts");

  assert.match(route, /reverseLedgerTransaction/);
  assert.doesNotMatch(route, /transaction\.delete\(/);
  assert.doesNotMatch(route, /creditCardTransaction\.update[\s\S]*?creditCardId/);
  assert.match(service, /kind: "REVERSAL"/);
  assert.match(service, /reversalOfId: original\.id/);
  assert.match(service, /\[voidedByUserId\]/);
  assert.match(service, /\[voidReason\]/);
  assert.match(service, /SELECT \[creditCardTransactionId\][\s\S]*?FROM \[CreditCardTxnLink\]/);
});

test("posted transaction correction atomically reverses and replaces standalone entries", async () => {
  const [route, service, client, contract] = await Promise.all([
    source("app/api/transactions/[id]/corrections/route.ts"),
    source("lib/posting-service.ts"),
    source("components/transactions-page.tsx"),
    source("lib/domains/ledger/transaction-contracts.ts"),
  ]);
  const correction = service.slice(
    service.indexOf("export async function correctLedgerTransaction"),
    service.indexOf("export async function reverseLedgerTransaction"),
  );

  assert.match(route, /correctLedgerTransaction/);
  assert.match(route, /getIdempotencyKey\(request\)/);
  assert.match(correction, /operation: "TRANSACTION_CORRECTION"/);
  assert.match(correction, /WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(correction, /createTransactionReversal/);
  assert.match(correction, /voidedAt: new Date\(\)/);
  assert.match(correction, /const replacement = await createLedgerTransaction/);
  assert.match(correction, /previousAmountCents: current\.amountCents/);
  assert.match(correction, /nextAmountCents/);
  assert.match(service, /reversalOfId: original\.id/);
  assert.match(service, /CORRECTABLE_POSTING_OPERATIONS/);
  assert.match(service, /linked financial workflow/);
  assert.match(client, /\/api\/transactions\/\$\{payload\.id\}\/corrections/);
  assert.match(client, /The original entry will be reversed and the corrected replacement will be posted atomically/);
  assert.match(contract, /amountCents: z\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(contract, /Provide at least one corrected transaction field/);
});

test("transaction correction applies only the net envelope difference", () => {
  const sameEnvelope = getTransactionBudgetDelta({
    previousBudgetId: "daily",
    previousDirection: "DEBIT",
    previousAmountCents: 10_000,
    nextBudgetId: "daily",
    nextDirection: "DEBIT",
    nextAmountCents: 12_000,
  });
  assert.equal(sameEnvelope.get("daily"), -2_000);

  const movedEnvelope = getTransactionBudgetDelta({
    previousBudgetId: "daily",
    previousDirection: "DEBIT",
    previousAmountCents: 10_000,
    nextBudgetId: "travel",
    nextDirection: "DEBIT",
    nextAmountCents: 12_000,
  });
  assert.equal(movedEnvelope.get("daily"), 10_000);
  assert.equal(movedEnvelope.get("travel"), -12_000);
});

test("imports and monthly plans attach their ledger rows to one posting group", async () => {
  const bulk = await source("app/api/transactions/bulk-import/route.ts");
  const plans = await source("app/api/budgets/plan/route.ts");

  assert.match(bulk, /ledgerRows = data\.map\(\(row\) => \(\{ \.\.\.row, postingGroupId \}\)\)/);
  assert.match(bulk, /if \(posting\.replayed\)/);
  assert.match(plans, /postingGroupId/);
  assert.match(plans, /monthly-budget-confirm:/);
});

test("money-changing clients send idempotency keys", async () => {
  const files = [
    "components/transactions-page.tsx",
    "components/dashboard-shell.tsx",
    "components/credit-transactions-page.tsx",
    "components/receivables-page.tsx",
    "hooks/use-data-import.ts",
    "components/budget-plan-page.tsx",
  ];

  for (const file of files) {
    assert.match(await source(file), /"Idempotency-Key"/, file);
  }
});

test("reconciliation reports drift without silently repairing balances", async () => {
  const service = await source("lib/posting-service.ts");
  const route = await source("app/api/budgets/reconciliation/route.ts");

  assert.match(service, /driftCents: budget\.availableCents - ledgerCents/);
  assert.doesNotMatch(service, /budgetEnvelope\.update/);
  assert.match(route, /drifted\.length === 0/);
  assert.match(route, /"Cache-Control": "no-store"/);
});
