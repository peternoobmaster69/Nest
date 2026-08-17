import assert from "node:assert/strict";
import test from "node:test";

import { getGmailSyncProgressCounters } from "../lib/gmail-sync-counters.ts";

test("a removed Gmail message still advances both durable counters", () => {
  assert.deepEqual(getGmailSyncProgressCounters(1, 0), { current: 1, total: 1 });
});

test("a resumed Gmail sync preserves a larger known total", () => {
  assert.deepEqual(getGmailSyncProgressCounters(20, 50), { current: 20, total: 50 });
});
