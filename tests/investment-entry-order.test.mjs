import assert from "node:assert/strict";
import test from "node:test";

import {
  compareInvestmentEntries,
  getLatestInvestmentEntry,
} from "../lib/investment-entry-order.ts";

const entry = (id, date, createdAt, updatedAt = createdAt) => ({ id, date, createdAt, updatedAt });

test("latest investment snapshot uses creation order for entries on the same date", () => {
  const first = entry("first", "2026-07-23T00:00:00.000Z", "2026-07-23T02:00:00.000Z");
  const second = entry("second", "2026-07-23T00:00:00.000Z", "2026-07-23T04:00:00.000Z");

  assert.equal(getLatestInvestmentEntry([second, first]), second);
  assert.deepEqual([second, first].sort(compareInvestmentEntries), [first, second]);
});

test("same-day edited investment snapshots use the most recent update", () => {
  const first = entry(
    "first",
    "2026-07-23T00:00:00.000Z",
    "2026-07-23T02:00:00.000Z",
    "2026-07-23T06:00:00.000Z",
  );
  const second = entry("second", "2026-07-23T00:00:00.000Z", "2026-07-23T04:00:00.000Z");

  assert.equal(getLatestInvestmentEntry([second, first]), first);
  assert.deepEqual([second, first].sort(compareInvestmentEntries), [second, first]);
});

test("snapshot date takes precedence over creation time", () => {
  const olderSnapshot = entry("older", "2026-07-22T00:00:00.000Z", "2026-07-23T10:00:00.000Z");
  const newerSnapshot = entry("newer", "2026-07-23T00:00:00.000Z", "2026-07-23T01:00:00.000Z");

  assert.equal(getLatestInvestmentEntry([olderSnapshot, newerSnapshot]), newerSnapshot);
});

test("snapshot ordering has a deterministic id fallback", () => {
  const first = entry("a", "2026-07-23T00:00:00.000Z", "2026-07-23T02:00:00.000Z");
  const second = entry("b", "2026-07-23T00:00:00.000Z", "2026-07-23T02:00:00.000Z");

  assert.equal(getLatestInvestmentEntry([second, first]), second);
});
