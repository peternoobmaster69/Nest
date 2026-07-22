import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const root = process.cwd();

test("receivable close postings preserve receivable title and notes", async () => {
  const route = await readFile(
    path.join(root, "app/api/receivables/[id]/close/route.ts"),
    "utf8",
  );

  assert.equal((route.match(/subject: transactionTitle/g) ?? []).length, 2);
  assert.equal((route.match(/notes: transactionNotes/g) ?? []).length, 2);
  assert.equal((route.match(/details: null/g) ?? []).length, 2);
  assert.doesNotMatch(route, /Auto-accounted by rule|Receivable transfer out/);
});

test("cross-workspace receivable deductions use workspace-safe ledger references", async () => {
  const route = await readFile(
    path.join(root, "app/api/receivables/[id]/close/route.ts"),
    "utf8",
  );

  assert.match(route, /createPostingGroupRecord/);
  assert.match(route, /sourceAccount\.workspaceId === receivable\.workspaceId/);
  assert.match(route, /operation: "RECEIVABLE_CLOSE_SOURCE"/);
  assert.match(route, /createLedgerTransaction\(db, sourcePostingGroupId/);
  assert.match(route, /receivableId: sourceIsInReceivableWorkspace \? receivable\.id : null/);
});

test("existing receivable close postings are backfilled from their receivable", async () => {
  const migration = await readFile(
    path.join(root, "prisma/migrations/sync_receivable_close_transaction_content/migration.sql"),
    "utf8",
  );

  assert.match(migration, /\[transaction\]\.\[subject\] = \[receivable\]\.\[title\]/);
  assert.match(migration, /\[transaction\]\.\[notes\] = \[receivable\]\.\[notes\]/);
  assert.match(migration, /\[transaction\]\.\[details\] = NULL/);
  assert.match(migration, /receivable-close:/);
});
