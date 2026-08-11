import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  getTransactionPeriodParam,
  getTransactionQuickPeriodDateRange,
} from "../lib/transaction-date-filters.ts";

const root = process.cwd();

test("transaction period URL state distinguishes All from Custom", async () => {
  const page = await readFile(path.join(root, "components/transactions-page.tsx"), "utf8");
  const hydration = page.slice(
    page.indexOf("const requestedPeriod = searchParams.get"),
    page.indexOf("setSearchQuery(requestedSearch)"),
  );

  assert.equal(getTransactionPeriodParam(null), "all");
  assert.equal(getTransactionPeriodParam("custom"), "custom");
  assert.match(page, /period: getTransactionPeriodParam\(activeQuickSelect\)/);
  assert.match(page, /from: activeQuickSelect === "custom" && !customMonthsFilter \? dateFilter\.from : null/);
  assert.match(hydration, /const requestedQuickPeriod = isTransactionQuickPeriod\(requestedPeriod\)/);
  assert.match(hydration, /if \(requestedAllPeriod\) \{\s*clearDateFilter\(\)/);
  assert.match(hydration, /else if \(requestedQuickPeriod\)[\s\S]*?setActiveQuickSelect\(requestedQuickPeriod\)/);
  assert.ok(
    hydration.indexOf("if (requestedAllPeriod)") < hydration.indexOf("else if (requestedFrom || requestedTo)"),
    "All must clear stale date ranges before they can be classified as Custom",
  );
});

test("quick periods use local calendar boundaries without UTC date shifts", () => {
  const thisMonth = getTransactionQuickPeriodDateRange("thisMonth", new Date(2026, 7, 11, 12));
  const lastMonth = getTransactionQuickPeriodDateRange("lastMonth", new Date(2026, 0, 11, 12));

  assert.deepEqual(thisMonth, { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(lastMonth, { from: "2025-12-01", to: "2025-12-31" });
});
