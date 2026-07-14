import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("normal transaction APIs hide voided originals and reversal rows", async () => {
  const prismaRoutes = [
    "app/api/transactions/route.ts",
    "app/api/budgets/route.ts",
    "app/api/dashboard/summary/route.ts",
    "app/api/transaction-groups/route.ts",
    "app/api/transaction-groups/[id]/route.ts",
    "lib/budget-ledger.ts",
  ];

  for (const file of prismaRoutes) {
    const code = await source(file);
    assert.match(code, /voidedAt:\s*null/, file);
    assert.match(code, /kind:\s*\{\s*not:\s*"REVERSAL"\s*\}/, file);
  }
});

test("raw transaction summaries apply the same visibility rule", async () => {
  for (const file of ["app/api/transactions/months/route.ts", "app/api/dashboard/summary/route.ts"]) {
    const code = await source(file);
    assert.match(code, /\[voidedAt\] IS NULL/, file);
    assert.match(code, /\[kind\] <> 'REVERSAL'/, file);
  }
});

test("ledger reconciliation retains voided and reversal rows", async () => {
  const service = await source("lib/posting-service.ts");
  const reconciliation = service.slice(service.indexOf("export async function reconcileWorkspaceBudgets"));

  assert.doesNotMatch(reconciliation, /voidedAt:\s*null/);
  assert.doesNotMatch(reconciliation, /kind:\s*\{\s*not:\s*"REVERSAL"/);
});
