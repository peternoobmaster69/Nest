import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("transaction lineage is an authorized bounded read of immutable correction links", async () => {
  const [route, service] = await Promise.all([
    source("app/api/transactions/[id]/lineage/route.ts"),
    source("lib/domains/ledger/transaction-lineage.ts"),
  ]);

  assert.match(route, /requireWorkspaceAccess\(transaction\.workspaceId\)/);
  assert.match(route, /transaction\.voidedAt \|\| transaction\.kind === "REVERSAL"/);
  assert.match(service, /MAX_TRANSACTION_LINEAGE_VERSIONS = 50/);
  assert.match(service, /operation !== "TRANSACTION_CORRECTION"/);
  assert.match(service, /postingGroup\.sourceId/);
  assert.match(service, /where: \{ id: versionId, workspaceId: params\.workspaceId \}/);
  assert.match(service, /seen\.has\(versionId\)/);
  assert.match(service, /transaction\.reversalOfId === postingGroup\.sourceId/);
});

test("transaction records expose compact scrollable correction history without mixing reversals into the list", async () => {
  const [route, page, list, panel, dialog, styles] = await Promise.all([
    source("app/api/transactions/route.ts"),
    source("components/transactions-page.tsx"),
    source("components/transactions/transaction-month-list.tsx"),
    source("components/transactions/transaction-lineage-panel.tsx"),
    source("components/transactions/transaction-correction-dialog.tsx"),
    source("app/styles/features.css"),
  ]);

  assert.match(route, /voidedAt: null/);
  assert.match(route, /kind: \{ not: "REVERSAL" \}/);
  assert.match(route, /\{ postingGroup, \.\.\.transaction \}/);
  assert.match(route, /hasCorrectionHistory: postingGroup\?\.operation === "TRANSACTION_CORRECTION"/);
  assert.match(page, /\/api\/transactions\/\$\{editingTransaction!\.id\}\/lineage/);
  assert.match(list, />Corrected<\/span>/);
  assert.match(panel, /<details[\s\S]*?className="tx-lineage-panel/);
  assert.match(panel, /<summary className="tx-lineage-summary">/);
  assert.match(panel, /<strong>Record evolution<\/strong>/);
  assert.match(panel, /details\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(panel, /Compensating reversal/);
  assert.match(panel, /describeChanges/);
  assert.match(styles, /\.tx-lineage-body\s*\{[^}]*max-height:\s*min\(46dvh, 420px\)[^}]*overflow-y:\s*auto[^}]*touch-action:\s*pan-y/s);
  assert.ok(
    dialog.indexOf("Correction reason") < dialog.indexOf("<TransactionLineagePanel"),
    "record evolution belongs below the correction fields",
  );
});
