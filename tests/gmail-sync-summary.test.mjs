import assert from "node:assert/strict";
import test from "node:test";
import { formatGmailSyncSummary } from "../lib/gmail-sync-summary.ts";

test("an empty Gmail sync is a calm, useful status", () => {
  assert.equal(
    formatGmailSyncSummary({ scannedMessages: 0, processed: 0, duplicates: 0, ignored: 0, failed: 0 }),
    "Inbox is up to date. No new card alert emails were found.",
  );
});

test("a successful Gmail sync reports only meaningful counts", () => {
  assert.equal(
    formatGmailSyncSummary({ scannedMessages: 3, processed: 2, duplicates: 1, ignored: 0, failed: 0 }),
    "Inbox sync complete. Imported 2 new card alerts. Skipped 1 email already imported.",
  );
});

test("a Gmail sync uses issue language only for actual failures", () => {
  const message = formatGmailSyncSummary({ scannedMessages: 2, processed: 1, duplicates: 0, ignored: 0, failed: 1 });
  assert.match(message, /completed with issues/);
  assert.match(message, /1 card alert email could not be processed/);
});

test("unrelated Gmail messages are reported as neutral ignored items", () => {
  assert.equal(
    formatGmailSyncSummary({ scannedMessages: 4, processed: 0, duplicates: 0, ignored: 4, failed: 0 }),
    "Inbox is up to date. Ignored 4 unrelated emails.",
  );
});
