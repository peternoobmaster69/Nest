import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGmailAlertQuery,
  GMAIL_ALERT_SUBJECTS,
  isGmailCreditAlertSubject,
} from "../lib/gmail-alert-query.ts";

test("the Gmail query and incremental classifier share the supported alert subjects", () => {
  const query = buildGmailAlertQuery(null);
  for (const subject of GMAIL_ALERT_SUBJECTS) {
    assert.match(query, new RegExp(`subject:"${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.equal(isGmailCreditAlertSubject(subject), true);
  }
});

test("incremental Gmail sync ignores unrelated email subjects", () => {
  assert.equal(isGmailCreditAlertSubject("Your weekly bank account summary"), false);
  assert.equal(isGmailCreditAlertSubject("A newsletter about rewards"), false);
  assert.equal(isGmailCreditAlertSubject("Fwd: UOB - Transaction Alert"), true);
});
