import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("bulk transaction import accepts and persists Notes", async () => {
  const route = await source("app/api/transactions/bulk-import/route.ts");
  const contracts = await source("lib/domains/integrations/import-contracts.ts");

  assert.match(route, /BulkImportSchema/);
  assert.match(contracts, /Notes:\s*optionalImportedText\(\)/);
  assert.match(route, /notes:\s*item\.tx\.Notes\?\.trim\(\)\s*\|\|\s*null/);
});

test("bulk transaction import accepts Notes longer than 2,000 characters", async () => {
  const { BulkImportSchema } = await import("../lib/domains/integrations/import-contracts.ts");
  const parsed = BulkImportSchema.safeParse({
    workspaceId: "workspace",
    accountId: "account",
    budgetId: "groceries",
    kind: "Migration",
    transactions: [{
      Direction: "DEBIT",
      Subject: "Groceries",
      Date: "2024-01-01",
      AmountCents: 1_000,
      Notes: "n".repeat(2_500),
    }],
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.transactions[0].Notes.length, 2_500);
});

test("bulk transaction import accepts null optional migration metadata", async () => {
  const { BulkImportSchema } = await import("../lib/domains/integrations/import-contracts.ts");
  const parsed = BulkImportSchema.safeParse({
    workspaceId: "workspace",
    accountId: "account",
    budgetId: "groceries",
    kind: "Migration",
    transactions: [{
      AccountName: null,
      Direction: "DEBIT",
      Subject: "Groceries",
      Date: "2024-01-01",
      AmountCents: 1_000,
      Details: null,
      Notes: null,
    }],
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.transactions[0].AccountName, undefined);
  assert.equal(parsed.data.transactions[0].Details, undefined);
  assert.equal(parsed.data.transactions[0].Notes, undefined);
});

test("bulk transaction import settings example documents Notes", async () => {
  const component = await source("components/data-import-section.tsx");

  assert.match(component, /"Notes": "Auto Credit"/);
});

test("bulk transaction import reports records that were skipped as duplicates", async () => {
  const route = await source("app/api/transactions/bulk-import/route.ts");
  const component = await source("components/data-import-section.tsx");

  assert.match(route, /duplicateRecords\.push\(/);
  assert.match(route, /"EXISTING_TRANSACTION"\s*:\s*"DUPLICATE_IN_PAYLOAD"/);
  assert.match(component, /Skipped duplicates \(\{progress\.duplicateRecords\.length\}\)/);
  assert.match(component, /Already exists in this subaccount/);
  assert.match(component, /Repeated in uploaded JSON/);
});

test("migration imports preserve repeated rows while other import kinds still detect duplicates", async () => {
  const route = await source("app/api/transactions/bulk-import/route.ts");
  const component = await source("components/data-import-section.tsx");

  assert.match(route, /if \(kind\.trim\(\)\.toUpperCase\(\) !== "MIGRATION"\)/);
  assert.match(route, /let rowsToCreate = toImport/);
  assert.match(route, /rowsToCreate = toImport\.filter/);
  assert.match(component, /Migration imports preserve every supplied row, including repeated transactions\./);
});

test("bulk transaction import uses the server row limit for each client chunk", async () => {
  const contracts = await source("lib/domains/integrations/import-contracts.ts");
  const component = await source("components/data-import-section.tsx");

  assert.match(contracts, /export const MAX_IMPORT_ROWS_PER_CHUNK = 250/);
  assert.match(component, /MAX_IMPORT_ROWS_PER_CHUNK,/);
  assert.match(component, /const CHUNK_SIZE = MAX_IMPORT_ROWS_PER_CHUNK/);
  assert.doesNotMatch(component, /const CHUNK_SIZE = 25/);
});

test("the import preview uses the same transaction schema as the server", async () => {
  const component = await source("components/data-import-section.tsx");

  assert.match(component, /ImportedTransactionSchema\.safeParse\(tx\)/);
  assert.match(component, /parsed\.error\.issues/);
});

test("bulk transaction imports require access without request-rate limiting", async () => {
  const route = await source("app/api/transactions/bulk-import/route.ts");

  assert.match(route, /requireWorkspaceAccess\(workspaceId, "EDITOR"\)/);
  assert.doesNotMatch(route, /enforceDistributedRateLimit/);
  assert.doesNotMatch(route, /transaction-bulk-import/);
});

test("the final import chunk recalculates the balance inside the posting transaction", async () => {
  const route = await source("app/api/transactions/bulk-import/route.ts");
  const component = await source("components/data-import-section.tsx");

  assert.match(route, /recalculateBudgetAvailableCents\(db, workspaceId, budgetId\)/);
  assert.match(route, /chunkIndex === totalChunks - 1/);
  assert.match(route, /const shouldRecalculate = recalculate && isFinalChunk/);
  assert.doesNotMatch(route, /applyBudgetAvailableDelta/);
  assert.doesNotMatch(route, /getBudgetAvailableDeltaCents/);
  assert.doesNotMatch(component, /await recalculateBudget\(targetBudgetId\)/);
  assert.match(component, /balanceRecalculated \? " Balance recalculated\."/);
});
