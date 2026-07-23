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
  assert.match(contracts, /Notes:\s*z\.string\(\)\.trim\(\)\.max\([^)]*\)\.optional\(\)/);
  assert.match(route, /notes:\s*item\.tx\.Notes\?\.trim\(\)\s*\|\|\s*null/);
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
