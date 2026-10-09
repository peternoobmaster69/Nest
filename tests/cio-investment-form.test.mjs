import assert from "node:assert/strict";
import test from "node:test";
import { calculateExposureTotals, prepareInvestmentForm } from "../components/cio/dialogs/cio-investment-form.ts";

const form = (overrides = {}) => ({ liquidityClass: "LIQUID", portfolioRole: "OTHER", riskLevel: "UNKNOWN", includeInRetirementProjection: false,
  lockUntil: "", notes: "", exposures: [], reviewed: true, ...overrides });
const exposure = (overrides = {}) => ({ id: "temporary-row-id", dimension: "SECURITY", key: "VWRA", weight: "100", ...overrides });

test("investment classification requires valid dates, bounded rows and an explicit review", () => {
  for (const lockUntil of ["invalid", "2026-02-30", "2026-13-01", "10000-01-01"]) {
    assert.match(prepareInvestmentForm(form({ lockUntil })).error, /Choose a valid date/);
  }
  assert.match(prepareInvestmentForm(form({ exposures: Array.from({ length: 101 }, (_, i) => exposure({ key: `F${i}`, weight: "1" })) })).error, /100 rows or fewer/);
  assert.match(prepareInvestmentForm(form({ reviewed: false })).error, /Confirm that you have reviewed/);
  assert.deepEqual(prepareInvestmentForm(form({ lockUntil: "2027-01-01" })), { exposures: [] });
  assert.deepEqual(prepareInvestmentForm(form()), { exposures: [] });
});

test("investment breakdown validation rejects unusable keys, invalid shares, duplicates and incomplete totals", () => {
  for (const [row, expected] of [
    [exposure({ key: " " }), /Choose what the security row represents/],
    [exposure({ key: "bad symbol!" }), /short ticker-like security code/],
    [exposure({ weight: "" }), /Enter the percentage/],
    [exposure({ weight: "NaN" }), /must use a number/],
    [exposure({ weight: "Infinity" }), /must use a number/],
    [exposure({ weight: "0" }), /more than 0%/],
    [exposure({ weight: "-1" }), /more than 0%/],
    [exposure({ weight: "0.001" }), /more than 0%/],
    [exposure({ weight: "101" }), /no more than 100%/],
    [exposure({ weight: "99" }), /adds up to 99%/],
  ]) assert.match(prepareInvestmentForm(form({ exposures: [row] })).error, expected);
  assert.match(prepareInvestmentForm(form({ exposures: [exposure({ key: " vwra ", weight: "50" }), exposure({ key: "VWRA", weight: "50" })] })).error, /already includes Vwra/);
  assert.match(prepareInvestmentForm(form({ exposures: ["A", "B", "C"].map((key) => exposure({ key, weight: "33.3333" })) })).error, /adds up to 99.99%/);
});

test("investment breakdown totals use integer basis points independently for each dimension and strip temporary IDs", () => {
  const rows = [
    exposure({ dimension: "ASSET_CLASS", key: "EQUITY", weight: "60" }), exposure({ dimension: "ASSET_CLASS", key: "CASH", weight: "40" }),
    exposure({ dimension: "GEOGRAPHY", key: "GLOBAL" }), exposure({ key: " brk.b:us ", weight: "33.33" }),
    exposure({ key: "cspx", weight: "33.33" }), exposure({ key: "vwra", weight: "33.34" }),
  ];
  assert.deepEqual(calculateExposureTotals(rows), { ASSET_CLASS: 10000, GEOGRAPHY: 10000, SECURITY: 10000 });
  assert.deepEqual(prepareInvestmentForm(form({ exposures: rows })), { exposures: [
    { dimension: "ASSET_CLASS", key: "EQUITY", weightBps: 6000 }, { dimension: "ASSET_CLASS", key: "CASH", weightBps: 4000 },
    { dimension: "GEOGRAPHY", key: "GLOBAL", weightBps: 10000 }, { dimension: "SECURITY", key: "BRK.B:US", weightBps: 3333 },
    { dimension: "SECURITY", key: "CSPX", weightBps: 3333 }, { dimension: "SECURITY", key: "VWRA", weightBps: 3334 },
  ] });
});
