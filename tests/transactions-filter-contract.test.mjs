import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  getTransactionPeriodParam,
  getTransactionQuickPeriodDateRange,
} from "../lib/transaction-date-filters.ts";
import { resolveTransactionUrlFilters } from "../lib/transaction-view-filters.ts";

const root = process.cwd();

test("transaction period URL state distinguishes All from Custom", async () => {
  const page = await readFile(path.join(root, "components/transactions-page.tsx"), "utf8");
  assert.equal(getTransactionPeriodParam(null), "all");
  assert.equal(getTransactionPeriodParam("custom"), "custom");
  assert.match(page, /period: getTransactionPeriodParam\(activeQuickSelect\)/);
  assert.match(page, /from: activeQuickSelect === "custom" && !customMonthsFilter \? dateFilter\.from : null/);
  const now = new Date(2026, 7, 11, 12);
  for (const period of ["all", "thisMonth", "lastMonth", "thisYear"]) {
    const parameters = new URLSearchParams({ period, months: "2020-01", from: "2020-01-01", to: "2020-01-31" });
    const { dates } = resolveTransactionUrlFilters(parameters, [], [], now);
    assert.equal(dates.activeQuickSelect, period === "all" ? null : period);
    assert.deepEqual(dates.customMonths, []);
    assert.deepEqual(dates.dateFilter, period === "all" ? {} : getTransactionQuickPeriodDateRange(period, now));
  }
});

test("quick periods use local calendar boundaries without UTC date shifts", () => {
  const thisMonth = getTransactionQuickPeriodDateRange("thisMonth", new Date(2026, 7, 11, 12));
  const lastMonth = getTransactionQuickPeriodDateRange("lastMonth", new Date(2026, 0, 11, 12));

  assert.deepEqual(thisMonth, { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(lastMonth, { from: "2025-12-01", to: "2025-12-31" });
});
