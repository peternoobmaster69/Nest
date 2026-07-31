import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  CioExposuresInputSchema,
  CioPlanningPositionCreateSchema,
  CioProfileInputSchema,
  CioRecurringFlowCreateSchema,
  CioRecurringFlowUpdateSchema,
  CioRetirementProjectionInputSchema,
} from "../lib/domains/cio/contracts.ts";
import { assessCioDataQuality } from "../lib/domains/cio/data-quality.ts";
import { evaluateCioPolicy } from "../lib/domains/cio/policy-engine.ts";
import { upsertCioProfile } from "../lib/domains/cio/repository.ts";
import { buildCioSnapshot } from "../lib/domains/cio/snapshot-service.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

function snapshotDatabase({
  bankControls = [],
  savingsSubAccounts = [],
  investments = [],
  householdProfile = null,
  investmentPolicy = null,
  planningPositions = [],
  recurringFlows = [],
} = {}) {
  return {
    workspace: { findUnique: async () => ({ id: "workspace-1", baseCurrency: "SGD" }) },
    financialAccount: { findMany: async () => bankControls },
    budgetEnvelope: {
      findMany: async (args) => {
        assert.equal(args.where.isSavings, true);
        return savingsSubAccounts;
      },
    },
    investmentAccount: { findMany: async () => investments },
    cioHouseholdProfile: { findUnique: async () => householdProfile },
    cioInvestmentPolicy: { findUnique: async () => investmentPolicy },
    cioPlanningPosition: { findMany: async () => planningPositions },
    cioRecurringFlow: { findMany: async () => recurringFlows },
  };
}

function snapshotInvestment({
  id,
  asOf,
  currentValueCents,
  cioProfile = null,
  cioExposures = [],
  isLiquid = false,
}) {
  return {
    id,
    displayName: id,
    productName: null,
    institutionName: null,
    isLiquid,
    cioProfile,
    cioExposures,
    entries: [{
      id: `entry-${id}`,
      date: asOf,
      createdAt: asOf,
      investedCents: currentValueCents,
      currentValueCents,
    }],
  };
}

test("CIO input contracts enforce bounded mutually consistent data", () => {
  assert.equal(CioProfileInputSchema.safeParse({
    planningScope: "INDIVIDUAL",
    targetMonthlyRetirementSpendingCents: 0,
    essentialMonthlySpendingCents: 0,
  }).success, true);
  assert.equal(CioProfileInputSchema.safeParse({
    planningScope: "INDIVIDUAL",
    partnerBirthDate: "1982-01-01T00:00:00.000Z",
  }).success, false);
  assert.equal(CioProfileInputSchema.safeParse({
    planningScope: "HOUSEHOLD",
    partnerBirthDate: "1982-01-01T00:00:00.000Z",
  }).success, true);
  assert.equal(CioProfileInputSchema.safeParse({
    essentialMonthlySpendingCents: -1,
  }).success, false);
  assert.equal(CioProfileInputSchema.safeParse({
    primaryBirthDate: "1980-01-01T00:00:00.000Z",
    primaryCurrentAge: 46,
  }).success, false);

  assert.equal(CioRetirementProjectionInputSchema.safeParse({
    asOfDate: "2026-07-30",
    targetRetirementAge: 65,
  }).success, true);
  assert.equal(CioRetirementProjectionInputSchema.safeParse({
    inflationRateBps: -10_000,
  }).success, false);
  assert.equal(CioRetirementProjectionInputSchema.safeParse({
    targetRetirementAge: 65,
    targetRetirementDate: "2045-01-01T00:00:00.000Z",
  }).success, false);
  assert.equal(CioRetirementProjectionInputSchema.safeParse({
    asOfDate: "2026-07-30",
    targetRetirementAge: 65,
    unexpected: "unbounded",
  }).success, false);
  assert.equal(CioRetirementProjectionInputSchema.safeParse({
    asOfDate: "2026-02-30",
  }).success, false);

  assert.equal(CioRecurringFlowCreateSchema.safeParse({
    type: "EXTERNAL_CONTRIBUTION",
    sourceFinancialAccountId: "bank-1",
    sourceInvestmentAccountId: "investment-1",
    destinationInvestmentAccountId: "investment-2",
    amountCents: 10_000,
    cadence: "MONTHLY",
    startsOn: "2026-01-01T00:00:00.000Z",
    includeInRetirementProjection: true,
    label: "Monthly investment",
  }).success, false);
  assert.equal(CioRecurringFlowCreateSchema.safeParse({
    type: "INTERNAL_REALLOCATION",
    amountCents: 10_000,
    cadence: "MONTHLY",
    startsOn: "2026-01-01T00:00:00.000Z",
    includeInRetirementProjection: false,
    label: "Incomplete transfer",
  }).success, false);
  assert.equal(CioRecurringFlowUpdateSchema.safeParse({
    type: "INTERNAL_REALLOCATION",
  }).success, true);
  assert.equal(CioRecurringFlowCreateSchema.safeParse({
    type: "INTERNAL_REALLOCATION",
    sourceInvestmentAccountId: "investment-1",
    destinationInvestmentAccountId: "investment-1",
    amountCents: 10_000,
    cadence: "MONTHLY",
    startsOn: "2026-01-01T00:00:00.000Z",
    includeInRetirementProjection: false,
    label: "No-op transfer",
  }).success, false);

  assert.equal(CioPlanningPositionCreateSchema.safeParse({
    side: "LIABILITY",
    category: "MORTGAGE",
    label: "Home loan",
    currentValueCents: 100_000,
    asOfDate: "2026-07-30T00:00:00.000Z",
    liquidityClass: "LOCKED",
    includeInInvestableAllocation: false,
    includeInRetirementProjection: true,
  }).success, false);
});

test("CIO profile persists an explicit planning scope and infers legacy partner updates", async () => {
  const writes = [];
  const db = {
    cioHouseholdProfile: {
      findUnique: async () => null,
      upsert: async ({ create }) => {
        writes.push(create);
        return create;
      },
    },
    workspaceAuditLog: { create: async () => ({}) },
  };

  await upsertCioProfile({
    workspaceId: "workspace-1",
    actorUserId: "user-1",
    data: { partnerBirthDate: "1982-01-01T00:00:00.000Z" },
  }, db);

  assert.equal(writes[0].planningScope, "HOUSEHOLD");
  assert.equal(writes[0].partnerBirthDate.toISOString(), "1982-01-01T00:00:00.000Z");
});

test("exposure dimensions independently total exactly 10000 BPS", () => {
  const valid = CioExposuresInputSchema.safeParse({
    exposures: [
      { dimension: "ASSET_CLASS", key: "EQUITY", weightBps: 7_500 },
      { dimension: "ASSET_CLASS", key: "FIXED_INCOME", weightBps: 2_500 },
      { dimension: "GEOGRAPHY", key: "SINGAPORE", weightBps: 4_000 },
      { dimension: "GEOGRAPHY", key: "GLOBAL", weightBps: 6_000 },
      { dimension: "SECURITY", key: "VWRA", weightBps: 10_000 },
    ],
  });
  assert.equal(valid.success, true);

  assert.equal(CioExposuresInputSchema.safeParse({
    exposures: [{ dimension: "ASSET_CLASS", key: "EQUITY", weightBps: 9_999 }],
  }).success, false);
  assert.equal(CioExposuresInputSchema.safeParse({
    exposures: [
      { dimension: "ASSET_CLASS", key: "EQUITY", weightBps: 5_000 },
      { dimension: "ASSET_CLASS", key: "EQUITY", weightBps: 5_000 },
    ],
  }).success, false);
});

test("missing valuations and exposures stay explicit in data quality", () => {
  const result = assessCioDataQuality({
    asOfDate: new Date("2026-07-30T00:00:00.000Z"),
    investments: [{
      id: "investment-1",
      latestValuationDate: null,
      hasConfirmedProfile: false,
      hasAssetClassExposure: false,
      hasGeographyExposure: false,
    }],
    hasHouseholdProfile: false,
    hasConfirmedPolicy: false,
    staleAfterDays: 90,
  });

  assert.equal(result.completenessBps, 0);
  assert.equal(result.latestValuationDate, null);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    [
      "MISSING_PROFILE",
      "MISSING_POLICY",
      "MISSING_VALUATION",
      "UNCLASSIFIED_INVESTMENT",
      "UNKNOWN_EXPOSURE",
      "UNKNOWN_EXPOSURE",
    ],
  );
});

test("policy exceptions put data and liquidity risks before allocation optimization", () => {
  const result = evaluateCioPolicy({
    policy: {
      minimumLiquidityReserveCents: 5_000,
      minimumLiquidityMonths: null,
      maximumAccountConcentrationBps: null,
      maximumSingleSecurityConcentrationBps: null,
      maximumSatelliteAllocationBps: null,
      assetClassBands: [{ assetClass: "EQUITY", minimumBps: 4_000, targetBps: 5_000, maximumBps: 6_000 }],
      geographyLimits: [],
    },
    allocation: {
      totalCents: 10_000,
      assetClasses: [{ key: "EQUITY", valueCents: 8_000, allocationBps: 8_000, sourceCount: 1, isUnknown: false }],
      geographies: [],
      securities: [],
    },
    liquidity: {
      immediateCents: 1_000,
      liquidCents: 0,
      restrictedCents: 0,
      lockedCents: 9_000,
      readilyAvailableCents: 1_000,
      essentialMonthlyExpenseCents: null,
      emergencyRunwayMonths: null,
    },
    dataQuality: {
      completenessBps: 5_000,
      completenessPercentage: 50,
      latestValuationDate: null,
      oldestValuationDate: null,
      warnings: [],
    },
    accounts: [],
    retirementProjection: null,
    evidence: [],
  });

  assert.deepEqual(result.map((exception) => exception.code), [
    "DATA_INCOMPLETE",
    "LIQUIDITY_BELOW_FLOOR",
    "ASSET_CLASS_OUTSIDE_BAND",
  ]);
});

test("policy engine reports configured account, security, geography, and satellite concentration", () => {
  const result = evaluateCioPolicy({
    minimumImmediateBankCashCents: 2_000,
    policy: {
      minimumLiquidityReserveCents: null,
      minimumLiquidityMonths: null,
      maximumAccountConcentrationBps: 5_000,
      maximumSingleSecurityConcentrationBps: 5_000,
      maximumSatelliteAllocationBps: 4_000,
      assetClassBands: [],
      geographyLimits: [{ geography: "UNITED_STATES", maximumBps: 6_000 }],
    },
    allocation: {
      totalCents: 100_000,
      assetClasses: [],
      geographies: [{ key: "UNITED_STATES", valueCents: 80_000, allocationBps: 8_000, sourceCount: 1, isUnknown: false }],
      securities: [{ key: "ABC", valueCents: 60_000, allocationBps: 6_000, sourceCount: 1, isUnknown: false }],
    },
    liquidity: {
      immediateCents: 1_000,
      liquidCents: 99_000,
      restrictedCents: 0,
      lockedCents: 0,
      readilyAvailableCents: 100_000,
      essentialMonthlyExpenseCents: 1_000,
      emergencyRunwayMonths: 100,
    },
    dataQuality: {
      completenessBps: 10_000,
      completenessPercentage: 100,
      latestValuationDate: "2026-07-30",
      oldestValuationDate: "2026-07-30",
      warnings: [],
    },
    accounts: [{ id: "investment-1", currentValueCents: 90_000, portfolioRole: "SATELLITE" }],
    retirementProjection: null,
    evidence: [],
  });

  assert.deepEqual(result.map((exception) => exception.code), [
    "LIQUIDITY_BELOW_FLOOR",
    "ACCOUNT_CONCENTRATION",
    "SECURITY_CONCENTRATION",
    "GEOGRAPHY_CONCENTRATION",
    "SATELLITE_ALLOCATION_EXCEEDED",
  ]);
});

test("CIO planning net worth uses only savings sub-accounts, investments, and planning positions", async () => {
  const asOf = new Date("2026-07-30T00:00:00.000Z");
  const db = {
    workspace: { findUnique: async () => ({ id: "workspace-1", baseCurrency: "SGD" }) },
    financialAccount: { findMany: async () => [{ id: "bank-1", startingCents: 1_000, updatedAt: asOf }] },
    budgetEnvelope: {
      findMany: async (args) => {
        assert.deepEqual(args.where, { workspaceId: "workspace-1", isActive: true, isSavings: true });
        return [{ id: "savings-1", availableCents: 600, updatedAt: asOf }];
      },
    },
    investmentAccount: { findMany: async () => [{
      id: "investment-1",
      displayName: "Broker",
      productName: null,
      institutionName: null,
      isLiquid: true,
      cioProfile: null,
      cioExposures: [],
      entries: [{
        id: "entry-1",
        date: asOf,
        createdAt: asOf,
        investedCents: 1_500,
        currentValueCents: 2_000,
      }],
    }] },
    cioHouseholdProfile: { findUnique: async () => null },
    cioInvestmentPolicy: { findUnique: async () => null },
    cioPlanningPosition: { findMany: async () => [
      {
        id: "position-asset",
        side: "ASSET",
        category: "PROPERTY",
        label: "Home",
        currentValueCents: 50_000,
        asOfDate: asOf,
        liquidityClass: "LOCKED",
        includeInInvestableAllocation: false,
        includeInRetirementProjection: false,
      },
      {
        id: "position-liability",
        side: "LIABILITY",
        category: "MORTGAGE",
        label: "Mortgage",
        currentValueCents: 400,
        asOfDate: asOf,
        liquidityClass: "LOCKED",
        includeInInvestableAllocation: false,
        includeInRetirementProjection: false,
      },
    ] },
    cioRecurringFlow: { findMany: async () => [] },
  };

  const snapshot = await buildCioSnapshot({ workspaceId: "workspace-1", asOfDate: asOf, db });
  assert.equal(snapshot.totals.bankControlCents, 1_000);
  assert.equal(snapshot.totals.savingsSubAccountCents, 600);
  assert.equal(snapshot.totals.investmentCurrentValueCents, 2_000);
  assert.equal(snapshot.totals.financialAssetsCents, 2_600);
  assert.equal(snapshot.totals.planningPositionAssetsCents, 50_000);
  assert.equal(snapshot.totals.planningNetWorthCents, 52_200);
  assert.equal(snapshot.totals.investableAssetsCents, 2_600);
});

test("only a confirmed policy changes the valuation freshness threshold", async () => {
  const asOf = new Date("2026-07-30T00:00:00.000Z");
  const valuationDate = new Date("2026-07-01T00:00:00.000Z");
  const policy = (confirmed) => ({
    confirmedAt: confirmed ? asOf : null,
    updatedAt: asOf,
    valuationStaleAfterDays: 1,
    minimumLiquidityReserveCents: null,
    minimumLiquidityMonths: null,
    maximumAccountConcentrationBps: null,
    maximumSingleSecurityConcentrationBps: null,
    maximumSatelliteAllocationBps: null,
    assetClassBands: [],
    geographyLimits: [],
  });
  const database = (confirmed) => ({
    workspace: { findUnique: async () => ({ id: "workspace-1", baseCurrency: "SGD" }) },
    financialAccount: { findMany: async () => [] },
    budgetEnvelope: { findMany: async () => [] },
    investmentAccount: { findMany: async () => [{
      id: "investment-1",
      displayName: "Broker",
      productName: null,
      institutionName: null,
      isLiquid: true,
      cioProfile: null,
      cioExposures: [],
      entries: [{
        id: "entry-1",
        date: valuationDate,
        createdAt: valuationDate,
        investedCents: 2_000,
        currentValueCents: 2_000,
      }],
    }] },
    cioHouseholdProfile: { findUnique: async () => null },
    cioInvestmentPolicy: { findUnique: async () => policy(confirmed) },
    cioPlanningPosition: { findMany: async () => [] },
    cioRecurringFlow: { findMany: async () => [] },
  });

  const draftSnapshot = await buildCioSnapshot({ workspaceId: "workspace-1", asOfDate: asOf, db: database(false) });
  const confirmedSnapshot = await buildCioSnapshot({ workspaceId: "workspace-1", asOfDate: asOf, db: database(true) });

  assert.equal(draftSnapshot.investments[0].isStale, false);
  assert.equal(draftSnapshot.dataQuality.warnings.some((warning) => warning.code === "STALE_VALUATION"), false);
  assert.equal(confirmedSnapshot.investments[0].isStale, true);
  assert.equal(confirmedSnapshot.dataQuality.warnings.some((warning) => warning.code === "STALE_VALUATION"), true);
});

test("historical snapshots exclude bank controls updated after the data date", async () => {
  const asOf = new Date("2026-07-30T00:00:00.000Z");
  const snapshot = await buildCioSnapshot({
    workspaceId: "workspace-1",
    asOfDate: asOf,
    db: snapshotDatabase({
      bankControls: [{
        id: "bank-after-as-of",
        startingCents: 50_000,
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      }],
    }),
  });

  assert.equal(snapshot.totals.bankControlCents, 0);
  const warning = snapshot.dataQuality.warnings.find((item) => item.code === "BANK_BALANCE_AFTER_DATA_DATE");
  assert.equal(warning?.severity, "CRITICAL");
  assert.deepEqual(warning?.actual, { unit: "COUNT", value: 1 });
});

test("historical snapshots exclude savings sub-accounts updated after the data date", async () => {
  const asOf = new Date("2026-07-30T00:00:00.000Z");
  const snapshot = await buildCioSnapshot({
    workspaceId: "workspace-1",
    asOfDate: asOf,
    db: snapshotDatabase({
      savingsSubAccounts: [{
        id: "savings-after-as-of",
        availableCents: 50_000,
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      }],
    }),
  });

  assert.equal(snapshot.totals.savingsSubAccountCents, 0);
  assert.equal(snapshot.totals.planningNetWorthCents, 0);
  const warning = snapshot.dataQuality.warnings.find((item) => item.code === "SAVINGS_BALANCE_AFTER_DATA_DATE");
  assert.equal(warning?.severity, "CRITICAL");
  assert.deepEqual(warning?.actual, { unit: "COUNT", value: 1 });
});

test("suggested classifications remain UNKNOWN and cannot opt assets into retirement", async () => {
  const asOf = new Date("2026-07-30T00:00:00.000Z");
  const snapshot = await buildCioSnapshot({
    workspaceId: "workspace-1",
    asOfDate: asOf,
    db: snapshotDatabase({
      investments: [snapshotInvestment({
        id: "suggested-fund",
        asOf,
        currentValueCents: 10_000,
        isLiquid: false,
        cioProfile: {
          classificationStatus: "SUGGESTED",
          liquidityClass: "IMMEDIATE",
          portfolioRole: "SATELLITE",
          includeInRetirementProjection: true,
        },
        cioExposures: [
          { dimension: "ASSET_CLASS", exposureKey: "EQUITY", weightBps: 10_000 },
          { dimension: "GEOGRAPHY", exposureKey: "UNITED_STATES", weightBps: 10_000 },
          { dimension: "SECURITY", exposureKey: "SUGGESTED_SECURITY", weightBps: 10_000 },
        ],
      })],
    }),
  });

  assert.deepEqual(
    snapshot.allocation.assetClasses.map(({ key, valueCents }) => [key, valueCents]),
    [["UNKNOWN", 10_000]],
  );
  assert.deepEqual(
    snapshot.allocation.securities.map(({ key, valueCents }) => [key, valueCents]),
    [["UNKNOWN", 10_000]],
  );
  assert.equal(snapshot.totals.retirementIncludedAssetsCents, 0);
  assert.equal(snapshot.investments[0].liquidityClass, "LOCKED");
  assert.equal(snapshot.investments[0].liquiditySource, "LEGACY_IS_LIQUID_FALLBACK");
  assert.equal(snapshot.investments[0].portfolioRole, null);
});

test("negative investment valuations are warned and excluded from planning calculations", async () => {
  const asOf = new Date("2026-07-30T00:00:00.000Z");
  const snapshot = await buildCioSnapshot({
    workspaceId: "workspace-1",
    asOfDate: asOf,
    db: snapshotDatabase({
      investments: [snapshotInvestment({
        id: "negative-fund",
        asOf,
        currentValueCents: -1_000,
        isLiquid: true,
        cioProfile: {
          classificationStatus: "USER_CONFIRMED",
          liquidityClass: "LIQUID",
          portfolioRole: "CORE",
          includeInRetirementProjection: true,
        },
        cioExposures: [
          { dimension: "ASSET_CLASS", exposureKey: "EQUITY", weightBps: 10_000 },
          { dimension: "GEOGRAPHY", exposureKey: "GLOBAL", weightBps: 10_000 },
        ],
      })],
    }),
  });

  assert.equal(snapshot.totals.financialAssetsCents, -1_000);
  assert.equal(snapshot.totals.investableAssetsCents, 0);
  assert.equal(snapshot.totals.retirementIncludedAssetsCents, 0);
  assert.equal(snapshot.liquidity.readilyAvailableCents, 0);
  const warning = snapshot.dataQuality.warnings.find((item) => item.code === "NEGATIVE_VALUATION");
  assert.equal(warning?.severity, "CRITICAL");
  assert.equal(warning?.entityId, "negative-fund");
});

test("large security look-through is bounded with omission metadata and retains UNKNOWN", async () => {
  const asOf = new Date("2026-07-30T00:00:00.000Z");
  const confirmedProfile = {
    classificationStatus: "USER_CONFIRMED",
    liquidityClass: "LIQUID",
    portfolioRole: "CORE",
    includeInRetirementProjection: false,
  };
  const configured = Array.from({ length: 101 }, (_, index) => snapshotInvestment({
    id: `fund-${String(index).padStart(3, "0")}`,
    asOf,
    currentValueCents: 1,
    cioProfile: confirmedProfile,
    cioExposures: [{
      dimension: "SECURITY",
      exposureKey: `SECURITY_${String(index).padStart(3, "0")}`,
      weightBps: 10_000,
    }],
  }));
  const unknown = snapshotInvestment({
    id: "unclassified-fund",
    asOf,
    currentValueCents: 1,
  });
  const snapshot = await buildCioSnapshot({
    workspaceId: "workspace-1",
    asOfDate: asOf,
    db: snapshotDatabase({ investments: [...configured, unknown] }),
  });

  assert.equal(snapshot.allocation.securityBucketCount, 102);
  assert.equal(snapshot.allocation.securities.length, 100);
  assert.equal(snapshot.allocation.securitiesTruncated, true);
  assert.equal(snapshot.allocation.omittedSecurityValueCents, 2);
  assert.ok(snapshot.allocation.omittedSecurityAllocationBps > 0);
  assert.ok(snapshot.allocation.securities.some((bucket) => bucket.key === "UNKNOWN"));
});

test("invalid persisted retirement targets degrade the snapshot to NOT_READY", async () => {
  const asOf = new Date("2026-07-30T00:00:00.000Z");
  const snapshot = await buildCioSnapshot({
    workspaceId: "workspace-1",
    asOfDate: asOf,
    db: snapshotDatabase({
      householdProfile: {
        primaryBirthDate: null,
        primaryCurrentAge: 70,
        primaryAgeAsOfDate: asOf,
        partnerBirthDate: null,
        targetRetirementAge: 60,
        targetRetirementDate: null,
        targetMonthlyRetirementSpendingCents: 100_000,
        essentialMonthlySpendingCents: 50_000,
        minimumImmediateBankCashCents: null,
        inflationRateBps: 200,
        bearReturnBps: 100,
        baseReturnBps: 300,
        bullReturnBps: 500,
        sustainableWithdrawalRateBps: 400,
        annualExternalContributionOverrideCents: null,
        contributionGrowthRateBps: 0,
        updatedAt: asOf,
      },
    }),
  });

  assert.equal(snapshot.retirement.status, "NOT_READY");
  assert.equal(snapshot.retirement.projection, null);
  assert.ok(snapshot.retirement.missingFields.includes("invalid_projectionYears"));
});

test("zero essential spending remains configured without fabricating emergency runway", async () => {
  const asOf = new Date("2026-07-30T00:00:00.000Z");
  const snapshot = await buildCioSnapshot({
    workspaceId: "workspace-1",
    asOfDate: asOf,
    db: snapshotDatabase({
      householdProfile: {
        primaryBirthDate: null,
        primaryCurrentAge: 40,
        primaryAgeAsOfDate: asOf,
        partnerBirthDate: null,
        targetRetirementAge: 65,
        targetRetirementDate: null,
        targetMonthlyRetirementSpendingCents: 100_000,
        essentialMonthlySpendingCents: 0,
        minimumImmediateBankCashCents: null,
        inflationRateBps: 200,
        bearReturnBps: 100,
        baseReturnBps: 300,
        bullReturnBps: 500,
        sustainableWithdrawalRateBps: 400,
        annualExternalContributionOverrideCents: null,
        contributionGrowthRateBps: 0,
        updatedAt: asOf,
      },
    }),
  });

  assert.equal(snapshot.liquidity.essentialMonthlyExpenseCents, 0);
  assert.equal(snapshot.liquidity.emergencyRunwayMonths, null);
  assert.equal(snapshot.retirement.status, "READY");
  assert.equal(snapshot.dataQuality.warnings.some((warning) => warning.code === "MISSING_PROFILE"), false);
});

test("Prisma CIO storage is additive and the forward migrations carry database checks", async () => {
  const [schema, migration, flowHardeningMigration, profileScopeMigration, savingsMigration, currentNetWorth] = await Promise.all([
    source("prisma/schema.prisma"),
    source("prisma/migrations/20260730000000_nest_cio/migration.sql"),
    source("prisma/migrations/20260730070000_cio_flow_reference_invariants/migration.sql"),
    source("prisma/migrations/20260730080000_cio_profile_planning_scope/migration.sql"),
    source("prisma/migrations/20260731000000_budget_envelope_is_savings/migration.sql"),
    source("lib/net-worth.ts"),
  ]);

  for (const model of [
    "CioHouseholdProfile",
    "CioInvestmentPolicy",
    "CioPolicyAssetClassBand",
    "CioPolicyGeographyLimit",
    "CioInvestmentProfile",
    "CioInvestmentExposure",
    "CioPlanningPosition",
    "CioRecurringFlow",
  ]) {
    assert.match(schema, new RegExp(`model ${model}\\b`));
    assert.match(migration, new RegExp(`CREATE TABLE \\[dbo\\]\\.\\[${model}\\]`));
  }
  assert.match(schema, /@@unique\(\[investmentAccountId, dimension, exposureKey\]\)/);
  assert.match(migration, /CioInvestmentExposure_weight_check[^\n]*CHECK \(\[weightBps\] BETWEEN 1 AND 10000\)/);
  assert.match(migration, /CioRecurringFlow_source_check[^\n]*CHECK/);
  assert.match(flowHardeningMigration, /DROP CONSTRAINT \[CioRecurringFlow_source_check\]/);
  assert.match(flowHardeningMigration, /type\] <> 'EXTERNAL_CONTRIBUTION'/);
  assert.match(flowHardeningMigration, /type\] <> 'INTERNAL_REALLOCATION'/);
  assert.match(schema, /planningScope\s+String\s+@default\("INDIVIDUAL"\)/);
  assert.match(profileScopeMigration, /WHEN \[partnerBirthDate\] IS NULL THEN ''INDIVIDUAL''/);
  assert.match(profileScopeMigration, /planningScope\] IN \(''INDIVIDUAL'', ''HOUSEHOLD''\)/);
  assert.match(profileScopeMigration, /planningScope\] = ''HOUSEHOLD'' OR \[partnerBirthDate\] IS NULL/);
  assert.match(schema, /isSavings\s+Boolean\s+@default\(false\)/);
  assert.match(savingsMigration, /ADD \[isSavings\] BIT NOT NULL/);
  assert.match(savingsMigration, /SET \[isSavings\] = 1/);
  assert.match(savingsMigration, /BudgetEnvelope_workspaceId_isSavings_isActive_idx/);
  assert.match(migration, /CioPlanningPosition_liability_flags_check[^\n]*CHECK/);
  assert.match(migration, /CioInvestmentProfile_workspace_account_fkey[\s\S]*?FOREIGN KEY \(\[workspaceId\], \[investmentAccountId\]\)/);
  assert.match(migration, /CioInvestmentExposure_workspace_account_fkey[\s\S]*?FOREIGN KEY \(\[workspaceId\], \[investmentAccountId\]\)/);
  assert.match(migration, /CioRecurringFlow_workspace_source_financial_fkey[\s\S]*?FOREIGN KEY \(\[workspaceId\], \[sourceFinancialAccountId\]\)/);
  assert.match(migration, /Physical NO ACTION keys reject orphaned and[\s\S]*?cross-workspace rows/);
  assert.match(schema, /model CioInvestmentProfile[\s\S]*?investmentAccount\s+InvestmentAccount\s+@relation\([^\n]*onDelete: Cascade\)/);
  assert.match(schema, /model CioInvestmentExposure[\s\S]*?investmentAccount\s+InvestmentAccount\s+@relation\([^\n]*onDelete: Cascade\)/);
  assert.match(schema, /model CioRecurringFlow[\s\S]*?sourceFinancialAccount\s+FinancialAccount\?\s+@relation\([^\n]*onDelete: Cascade\)/);
  assert.match(schema, /model CioRecurringFlow[\s\S]*?sourceInvestmentAccount\s+InvestmentAccount\?\s+@relation\([^\n]*onDelete: Cascade\)/);
  assert.match(schema, /model CioRecurringFlow[\s\S]*?destinationInvestmentAccount\s+InvestmentAccount\?\s+@relation\([^\n]*onDelete: Cascade\)/);
  assert.doesNotMatch(currentNetWorth, /Cio[A-Z]/);
});

test("CIO strategy reports are immutable workspace-scoped snapshots", async () => {
  const [schema, migration, repository] = await Promise.all([
    source("prisma/schema.prisma"),
    source("prisma/migrations/20260730090000_cio_strategy_reports/migration.sql"),
    source("lib/domains/cio/report-repository.ts"),
  ]);

  assert.match(schema, /model CioStrategyReport\b/);
  assert.match(schema, /reportJson\s+String\s+@db\.NVarChar\(Max\)/);
  assert.match(schema, /@@unique\(\[workspaceId, id\]\)/);
  assert.match(migration, /CREATE TABLE \[dbo\]\.\[CioStrategyReport\]/);
  assert.match(migration, /CioStrategyReport_status_check/);
  assert.match(migration, /CioStrategyReport_completeness_check/);
  assert.match(migration, /CioStrategyReport_workspace_fkey/);
  assert.match(repository, /where: \{ id, workspaceId \}/);
  assert.match(repository, /CIO_STRATEGY_REPORT_CREATED/);
  assert.match(repository, /CIO_STRATEGY_REPORT_COOLDOWN/);
  assert.match(repository, /assertCioStrategyReportCooldown\(tx/);
  assert.match(repository, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.doesNotMatch(repository, /cioStrategyReport\.(?:update|upsert|delete)/);
});
