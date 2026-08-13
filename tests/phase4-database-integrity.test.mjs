import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFile(path.join(root, relativePath), "utf8");

test("Phase 4 retains a complete baseline manifest and forward migration", async () => {
  const history = JSON.parse(await read("prisma/baseline/history.json"));
  const baseline = await read("prisma/baseline/migration.sql");
  const migration = await read("prisma/migrations/20260721000000_phase_4_database_integrity/migration.sql");

  assert.ok(history.migrations.length >= 30);
  for (const migrationName of history.migrations) {
    await fs.access(path.join(root, "prisma", "migrations", migrationName, "migration.sql"));
  }
  for (const table of ["User", "Workspace", "Transaction", "BackgroundJob", "WebAuthnChallenge"]) {
    assert.match(baseline, new RegExp(`CREATE TABLE \\[dbo\\]\\.\\[${table}\\]`));
  }
  assert.match(migration, /WorkspaceMember_role_check/);
  assert.match(migration, /BEGIN TRY[\s\S]*?BEGIN TRANSACTION[\s\S]*?COMMIT TRANSACTION[\s\S]*?BEGIN CATCH[\s\S]*?ROLLBACK TRANSACTION/);
  assert.match(migration, /COL_LENGTH\(N'dbo\.BackgroundJob', N'activeScopeKey'\)/);
  assert.match(migration, /Recovered from legacy non-durable lease/);
  assert.match(migration, /EXEC\(N'UPDATE \[dbo\]\.\[BackgroundJob\]/);
  assert.match(migration, /BackgroundJob_progress_check[\s\S]*?\[current\] <= \[total\]\)\)'\)/);
  assert.match(migration, /Transaction_workspace_account_fkey/);
  assert.match(migration, /Workspace_publicNetWorthToken_key/);
  assert.doesNotMatch(migration, /Transaction_workspaceId_externalRef_key/);
  assert.match(migration, /DROP CONSTRAINT \[HotelRewardAccount_centsPerPoint_df\][\s\S]*?ALTER COLUMN \[centsPerPoint\] DECIMAL\(19, 8\)[\s\S]*?DEFAULT 0 FOR \[centsPerPoint\]/);
  assert.match(migration, /UPDATE s[\s\S]*?SET \[creditTransactionId\] = NULL[\s\S]*?t\.\[id\] IS NULL/);
  assert.match(migration, /ALTER COLUMN \[creditCardTransactionId\] NVARCHAR\(1000\)/);
  assert.match(migration, /Transaction_posting_group_workspace_trg/);
  assert.match(migration, /PostingGroup_workspace_update_trg/);
  assert.match(migration, /DELETE FROM \[dbo\]\.\[WebAuthnChallenge\]/);
});

test("runtime schema-drift compatibility fallbacks are gone", async () => {
  const files = [
    "app/api/accounts/route.ts",
    "app/api/credit-cards/route.ts",
    "app/api/credit-cards/[id]/route.ts",
    "app/api/investments/route.ts",
    "app/api/investments/[id]/route.ts",
  ];
  const source = (await Promise.all(files.map(read))).join("\n");
  assert.doesNotMatch(source, /Unknown (argument|field)|Invalid column name|db push/);
});

test("Phase 4 preflight distinguishes repairable legacy aliases from blockers", async () => {
  const preflight = await read("scripts/check-phase4-preflight.mjs");
  assert.match(preflight, /legacy cross-workspace receivable aliases[\s\S]*?"repair"/);
  assert.match(preflight, /inconsistent legacy receivable source aliases/);
  assert.doesNotMatch(preflight, /Transaction\][\s\S]{0,180}externalRef[\s\S]{0,180}HAVING COUNT/);
});

test("monthly budget confirmation's claim state is permitted by the database", async () => {
  const [service, migration, preflight] = await Promise.all([
    read("lib/domains/ledger/budget-plan/confirm-service.ts"),
    read("prisma/migrations/20260813000000_allow_monthly_budget_plan_confirming_status/migration.sql"),
    read("scripts/check-phase4-preflight.mjs"),
  ]);

  assert.match(service, /data: \{ status: "CONFIRMING" \}/);
  assert.match(migration, /MonthlyBudgetPlan_status_check/);
  assert.match(migration, /N'DRAFT', N'REVIEW', N'CONFIRMING', N'CONFIRMED'/);
  assert.match(preflight, /N'DRAFT', N'REVIEW', N'CONFIRMING', N'CONFIRMED'/);
});

test("cross-workspace receivables keep source aliases out of local composite foreign keys", async () => {
  const route = await read("app/api/credit-transactions/[id]/accounting/route.ts");
  assert.match(route, /accountId: sourceAccount\?\.workspaceId === workspaceId \? sourceAccount\.id : null/);
  assert.match(route, /budgetId: sourceAccount\?\.workspaceId === workspaceId \? sourceBudget\?\.id : null/);
  assert.match(route, /sourceWorkspaceId: sourceAccount\?\.workspaceId/);
  assert.match(route, /sourceAccountId: sourceAccount\?\.id/);
  assert.match(route, /sourceBudgetId: sourceBudget\?\.id/);
});

test("the consolidated retention route covers security and operational records", async () => {
  const retention = await read("lib/data-retention.ts");
  const route = await read("app/api/cron/ask-nest-retention/route.ts");
  for (const table of [
    "IntegrationOAuthState",
    "WebAuthnChallenge",
    "BackgroundJob",
    "CardAlertStaging",
    "WorkspaceInvite",
    "InAppNotification",
    "WorkspaceAuditLog",
  ]) {
    assert.match(retention, new RegExp(`\\[${table}\\]`));
  }
  assert.match(retention, /runBoundedPolicy/);
  assert.match(route, /runDataRetention/);
});
