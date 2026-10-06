import assert from "node:assert/strict";
import test from "node:test";
import { formatTransactionDate, formatTransactionGroupDateRange, getAmountToneClass, normalizeTransactionGroupSearchValue } from "../lib/transaction-presentation.ts";

test("transaction amounts distinguish outflows, inflows, and zero balances", () => {
  assert.equal(getAmountToneClass(-123), "negative");
  assert.equal(getAmountToneClass(456), "positive");
  assert.equal(getAmountToneClass(0), "zero");
});

test("transaction dates hide exact hours and keep meaningful local times", () => {
  const wholeHour = new Date(2026, 9, 7, 12, 0, 0);
  const withMinutes = new Date(2026, 9, 7, 12, 30, 0);
  const withSeconds = new Date(2026, 9, 7, 12, 0, 5);
  assert.equal(formatTransactionDate(wholeHour.toISOString()), wholeHour.toLocaleDateString());
  assert.equal(formatTransactionDate(withMinutes.toISOString()), withMinutes.toLocaleString());
  assert.equal(formatTransactionDate(withSeconds.toISOString()), withSeconds.toLocaleString());
});

test("group ranges use UTC months, consolidate a single month, and handle missing dates", () => {
  assert.equal(formatTransactionGroupDateRange("2026-10-01", "2026-10-31"), "Oct 2026");
  assert.equal(formatTransactionGroupDateRange("2026-09-30T23:00:00Z", "2026-10-01T00:00:00Z"), "Sept 2026 – Oct 2026");
  assert.equal(formatTransactionGroupDateRange("2025-10-01", "2026-10-01"), "Oct 2025 – Oct 2026");
  for (const dates of [[], [null, "2026-10-01"], ["2026-10-01", ""], ["invalid", "2026-10-01"], ["2026-10-01", "invalid"]]) {
    assert.equal(formatTransactionGroupDateRange(...dates), "No transaction dates");
  }
});

test("group search treats dash variants, letter case, and whitespace consistently", () => {
  assert.equal(normalizeTransactionGroupSearchValue("  HOLIDAY—Oct–Dec-2026\n "), "holiday oct dec 2026");
});
