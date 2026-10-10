import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("background jobs use database-enforced scope ownership, leases, retries, and dead letters", async () => {
  const [schema, migration, jobs] = await Promise.all([
    source("prisma/schema.prisma"),
    source("prisma/migrations/phase_5_reliable_background_jobs/migration.sql"),
    source("lib/background-jobs.ts"),
  ]);

  for (const field of ["activeScopeKey", "idempotencyKey", "leaseToken", "checkpointJson", "retryCount", "deadLetteredAt", "cancelRequestedAt"]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }
  assert.match(migration, /UNIQUE NONCLUSTERED INDEX \[BackgroundJob_activeScopeKey_key\][\s\S]*?WHERE \[activeScopeKey\] IS NOT NULL/);
  assert.match(migration, /UNIQUE NONCLUSTERED INDEX \[BackgroundJob_idempotencyKey_key\][\s\S]*?WHERE \[idempotencyKey\] IS NOT NULL/);
  assert.match(migration, /EXEC\(N'CREATE UNIQUE NONCLUSTERED INDEX \[CardAlertStaging_sourceMessageKey_key\]/);
  assert.match(migration, /EXEC\(N'CREATE UNIQUE NONCLUSTERED INDEX \[BackgroundJob_activeScopeKey_key\]/);
  assert.match(migration, /COL_LENGTH\(N'dbo\.BackgroundJob', N'activeScopeKey'\)/);
  assert.match(migration, /IF NOT EXISTS \(SELECT 1 FROM sys\.indexes/);
  assert.match(migration, /BEGIN TRY[\s\S]*?BEGIN TRANSACTION[\s\S]*?COMMIT TRANSACTION[\s\S]*?BEGIN CATCH[\s\S]*?ROLLBACK TRANSACTION/);
  assert.match(jobs, /updateMany\([\s\S]*?status: "PENDING"[\s\S]*?leaseToken/);
  assert.match(jobs, /where: \{ id: jobId, status: "RUNNING", leaseToken/);
  assert.match(jobs, /status: "DEAD_LETTER"/);
  assert.match(jobs, /retryDelayMs/);
});

test("Gmail sync is bounded, resumable, cursor-based, and never launched after a response", async () => {
  const [runner, provider, route, status, settings, controller, ingest, diagnostics, creditAlerts, retention] = await Promise.all([
    source("lib/gmail-sync-runner.ts"),
    source("lib/gmail.ts"),
    source("app/api/gmail/sync/route.ts"),
    source("app/api/gmail/status/route.ts"),
    source("components/settings/gmail-settings-card.tsx"),
    source("hooks/use-gmail-settings.ts"),
    source("lib/credit-alert-ingest.ts"),
    source("lib/credit-alert-diagnostics.ts"),
    source("app/credit-alerts/page.tsx"),
    source("lib/data-retention.ts"),
  ]);

  assert.doesNotMatch(runner, /activeSyncs|setTimeout|setInterval/);
  assert.match(runner, /checkpointJson|continueBackgroundJob|lastHistoryId/);
  assert.match(
    runner,
    /await continueBackgroundJob\([\s\S]*?getGmailSyncProgressCounters\(checkpoint\.scannedMessages, job\.total\)/,
  );
  assert.match(runner, /GMAIL_SYNC_MESSAGES_PER_SLICE/);
  assert.match(provider, /listGmailHistoryPage|getGmailProfile|maxResults/);
  assert.match(provider, /GMAIL_RECONNECT_REQUIRED/);
  assert.match(provider, /fetchGmailMessageMetadata[\s\S]*?format: "metadata"[\s\S]*?metadataHeaders/);
  assert.match(runner, /const metadata = await fetchGmailMessageMetadata[\s\S]*?if \(!isGmailCreditAlertSubject\(metadata\.subject\)\) return "ignored"/);
  assert.match(runner, /checkpoint\[outcome\] \+= 1/);
  assert.ok(
    runner.indexOf("fetchGmailMessageMetadata(accessToken, messageId)") >= 0 &&
    runner.indexOf("fetchGmailMessageMetadata(accessToken, messageId)") <
      runner.indexOf("fetchGmailMessage(accessToken, messageId)"),
    "Gmail subject metadata must be checked before a message body is fetched",
  );
  assert.match(route, /await processGmailSyncQueue[\s\S]*?maxSlices: 10/);
  assert.match(route, /errorCode/);
  assert.match(status, /requiresReconnect/);
  assert.doesNotMatch(status, /integration: integration \}/);
  assert.match(settings, /Reconnect Gmail/);
  assert.match(controller, /fetchJson<GmailSyncProgress>\("\/api\/gmail\/sync"\)/);
  assert.doesNotMatch(controller, /GMAIL_SYNC_INTERVAL_MS/);
  assert.doesNotMatch(controller, /setInterval\([\s\S]{0,220}syncGmail\.mutate/);
  assert.match(ingest, /sourceMessageId/);
  assert.match(ingest, /normalizeCreditAlertCurrency/);
  assert.match(ingest, /\[redacted after parsing; sha256:/);
  assert.match(ingest, /requiredMissing[\s\S]*?sealFailedCreditAlertBody/);
  assert.match(ingest, /Unable to parse required fields: \$\{missingFields\.join\(", "\)\}/);
  assert.match(diagnostics, /MAX_DIAGNOSTIC_BODY_CHARS = 32_000/);
  assert.match(diagnostics, /encryptCredential/);
  assert.match(creditAlerts, /requireWorkspaceAccess\(null, "OWNER"\)/);
  assert.match(creditAlerts, /openFailedCreditAlertBody/);
  assert.match(creditAlerts, /View retained body/);
  assert.match(retention, /CARD_ALERT_BODY_RETENTION_DAYS[\s\S]*?defaultDays: 7/);
  assert.match(ingest, /processingStartedAt/);
  assert.match(ingest, /parseStatus: "PROCESSING"/);
});

test("reminder delivery has atomic dedupe, provider idempotency, caps, and sanitized partial failures", async () => {
  const [reminders, notifications, canonical, legacy, nestedLegacy] = await Promise.all([
    source("lib/credit-card-payment-reminders.ts"),
    source("lib/in-app-notifications.ts"),
    source("app/api/cron/credit-card-payment-reminders/route.ts"),
    source("app/api/credit-card-payment-reminders/route.ts"),
    source("app/api/credit-transactions/payment-due/reminders/route.ts"),
  ]);

  assert.match(reminders, /idempotencyKey: deliveryKey/);
  assert.match(reminders, /operationId/);
  assert.match(reminders, /Array<\{ code: string; count: number \}>/);
  assert.match(reminders, /PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN/);
  assert.doesNotMatch(reminders, /wasAlreadySentOrIsSending/);
  assert.match(notifications, /idempotencyKey: deliveryKey/);
  assert.match(notifications, /processReminderPushDeliveryJob/);
  assert.match(canonical, /runCreditCardPaymentReminderJob/);
  assert.match(legacy, /status: 410/);
  assert.match(nestedLegacy, /status: 410/);
});

test("operators can inspect, retry, and cancel scoped jobs without exposing provider details", async () => {
  const [overview, page, tables, actions] = await Promise.all([
    source("lib/admin-overview.ts"),
    source("app/admin/page.tsx"),
    source("components/admin-record-tables.tsx"),
    source("app/admin/job-actions.ts"),
  ]);

  assert.match(overview, /queueAgeMs|averageDurationMs|successRate|duplicateSuppressions|deadLetters/);
  assert.match(page, /Background jobs/);
  assert.match(page, /AdminBackgroundJobsTable/);
  assert.match(tables, /retryJobAction|cancelJobAction/);
  assert.match(actions, /requireAdminPage/);
  assert.match(actions, /processGmailSyncQueue|processReminderEmailDeliveryJob|processReminderPushDeliveryJob/);
  assert.doesNotMatch(overview, /payloadJson: true|resultJson: true|error: true/);
});
