import assert from "node:assert/strict";
import test from "node:test";
import { getAutoAccountingNotice, getGmailNotice } from "../components/settings/operation-notices.ts";

test("operation notices omit empty messages and give re-authentication an actionable warning", () => {
  for (const notice of [getGmailNotice, getAutoAccountingNotice]) {
    assert.equal(notice("   "), null);
    assert.deepEqual(notice(" Recent authentication required "), {
      title: "Re-authentication required", detail: "Sign in again to continue this security-sensitive action.", tone: "warning",
    });
  }
});

test("Gmail notices separate timestamps and explanations from their headline", () => {
  assert.deepEqual(getGmailNotice("Synced 4 emails. Last synced at 12:00"), { title: "Synced 4 emails", detail: "Last synced at 12:00", tone: "success" });
  assert.deepEqual(getGmailNotice("Inbox is up to date. No new card alert emails were found."), { title: "Inbox is up to date", detail: "No new card alert emails were found.", tone: "info" });
  assert.deepEqual(getGmailNotice("Connected."), { title: "Connected", detail: null, tone: "success" });
});

test("Gmail notices distinguish real failures, processing warnings, and zero-failure results", () => {
  for (const [message, phase, tone] of [
    ["Completed", "error", "error"],
    ["Access denied", undefined, "error"],
    ["Completed with issues", undefined, "warning"],
    ["One email could not be processed", undefined, "warning"],
    ["Completed with issues: 0 failed", undefined, "success"],
    ["Sync running", "reading", "info"],
    ["All done: 0 failed", "complete", "success"],
  ]) assert.equal(getGmailNotice(message, phase).tone, tone);
});

test("auto-accounting results distinguish unmatched, matched but unaccounted, and accounted transactions", () => {
  assert.deepEqual(getAutoAccountingNotice("Auto-accounted 0 transactions from 0 matched rule hits."), {
    title: "No transactions auto-accounted", detail: "No unaccounted transactions matched your enabled rules.", tone: "info",
  });
  for (const [count, words] of [[1, "hit was"], [2, "hits were"]]) {
    const result = getAutoAccountingNotice(`Auto-accounted 0 transactions from ${count} matched rule hits.`);
    assert.equal(result.tone, "warning");
    assert.equal(result.detail, `${count} matched rule ${words} found, but no transactions were accounted.`);
  }
  assert.deepEqual(getAutoAccountingNotice("Auto-accounted 1 transaction from 1 matched rule hit."), {
    title: "Auto-accounted 1 transaction", detail: "1 matched rule hit.", tone: "success",
  });
  assert.deepEqual(getAutoAccountingNotice("Auto-accounted 2 transactions from 3 matched rule hits."), {
    title: "Auto-accounted 2 transactions", detail: "3 matched rule hits.", tone: "success",
  });
});

test("other accounting messages retain their explanation and severity", () => {
  assert.deepEqual(getAutoAccountingNotice("Failed. Try again."), { title: "Failed", detail: "Try again.", tone: "error" });
  assert.deepEqual(getAutoAccountingNotice("Rule needs attention."), { title: "Rule needs attention", detail: null, tone: "warning" });
  assert.deepEqual(getAutoAccountingNotice("Saved."), { title: "Saved", detail: null, tone: "success" });
});
