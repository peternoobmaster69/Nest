import assert from "node:assert/strict";
import test from "node:test";

import { calculateCioContributionProgress } from "../lib/domains/cio/contribution-progress.ts";
import { buildCioSnapshot } from "../lib/domains/cio/snapshot-service.ts";

test("CIO contribution pace prorates the annual target through the as-of date", () => {
  const progress = calculateCioContributionProgress({
    asOfDate: new Date("2026-07-02T00:00:00.000Z"),
    actualYtdCents: 610_000,
    annualTargetCents: 1_200_000,
    contributionGrowthRateBps: 500,
    targetSource: "OVERRIDE",
  });

  assert.equal(progress.year, 2026);
  assert.equal(progress.expectedToDateCents, 601_644);
  assert.equal(progress.status, "ON_TRACK");
  assert.equal(progress.paceGapCents, 8_356);
  assert.equal(progress.remainingAnnualCents, 590_000);
  assert.equal(progress.annualProgressBps, 5_083);
  assert.equal(progress.calendarProgressBps, 5_014);
});

test("CIO contribution pace uses leap-year calendar days and reports a shortfall", () => {
  const progress = calculateCioContributionProgress({
    asOfDate: new Date("2024-02-29T00:00:00.000Z"),
    actualYtdCents: 100_000,
    annualTargetCents: 1_200_000,
    contributionGrowthRateBps: 0,
    targetSource: "DERIVED",
  });

  assert.equal(progress.expectedToDateCents, 196_721);
  assert.equal(progress.status, "BEHIND");
  assert.equal(progress.paceGapCents, -96_721);
  assert.equal(progress.calendarProgressBps, 1_639);
});

test("CIO snapshot compares configured contribution pace with recorded invested changes", async () => {
  const profileUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
  const investment = {
    id: "investment-1",
    displayName: "Brokerage",
    productName: null,
    institutionName: null,
    isLiquid: true,
    cioProfile: null,
    cioExposures: [],
    entries: [
      { id: "entry-new", date: new Date("2026-07-02T00:00:00.000Z"), createdAt: new Date("2026-07-02T00:00:00.000Z"), investedCents: 710_000, currentValueCents: 750_000 },
      { id: "entry-old", date: new Date("2025-12-31T00:00:00.000Z"), createdAt: new Date("2025-12-31T00:00:00.000Z"), investedCents: 100_000, currentValueCents: 110_000 },
    ],
  };
  const db = {
    workspace: { findUnique: async () => ({ id: "workspace-1", baseCurrency: "SGD" }) },
    financialAccount: { findMany: async () => [] },
    budgetEnvelope: { findMany: async () => [] },
    investmentAccount: { findMany: async () => [investment] },
    cioHouseholdProfile: { findUnique: async () => ({
      annualExternalContributionOverrideCents: 1_200_000,
      contributionGrowthRateBps: 500,
      updatedAt: profileUpdatedAt,
    }) },
    cioInvestmentPolicy: { findUnique: async () => null },
    cioPlanningPosition: { findMany: async () => [] },
    cioRecurringFlow: { findMany: async () => [] },
  };

  const snapshot = await buildCioSnapshot({
    workspaceId: "workspace-1",
    asOfDate: "2026-07-02",
    db,
  });

  assert.equal(snapshot.contributionProgress?.actualYtdCents, 610_000);
  assert.equal(snapshot.contributionProgress?.annualTargetCents, 1_200_000);
  assert.equal(snapshot.contributionProgress?.status, "ON_TRACK");
  assert.equal(snapshot.contributionProgress?.targetSource, "OVERRIDE");
});

test("CIO snapshot omits contribution pace until a growth assumption is configured", async () => {
  const db = {
    workspace: { findUnique: async () => ({ id: "workspace-1", baseCurrency: "SGD" }) },
    financialAccount: { findMany: async () => [] },
    budgetEnvelope: { findMany: async () => [] },
    investmentAccount: { findMany: async () => [] },
    cioHouseholdProfile: { findUnique: async () => ({
      annualExternalContributionOverrideCents: 1_200_000,
      contributionGrowthRateBps: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }) },
    cioInvestmentPolicy: { findUnique: async () => null },
    cioPlanningPosition: { findMany: async () => [] },
    cioRecurringFlow: { findMany: async () => [] },
  };

  const snapshot = await buildCioSnapshot({ workspaceId: "workspace-1", asOfDate: "2026-07-02", db });
  assert.equal(snapshot.contributionProgress, null);
});
