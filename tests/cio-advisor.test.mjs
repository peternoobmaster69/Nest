import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  apportionCents,
  buildCioAdvisorBrief,
  monthlyEquivalentCents,
  newMoneyToReachMinimumsCents,
  planCioNewMoneyAllocation,
  solveCioRetirementLevers,
} from "../lib/domains/cio/advisor.ts";
import { projectRetirement } from "../lib/domains/cio/retirement-projection.ts";
import { CIO_ASK_NEST_TOOL_NAMES, getCioAskNestTools } from "../lib/ai/tools/cio-tools.ts";
import { classifyAskNestIntent } from "../lib/ai/ask-nest-intent.mjs";
import { enabledAgentTools, defaultAgentConfiguration } from "../lib/ai/agent-catalog.ts";

const assumptions = {
  asOfDate: "2026-07-30",
  retirementDate: "2046-07-30",
  horizonYears: 20,
  currentRetirementAssetsCents: 37_151_300,
  annualExternalContributionCents: 4_052_000,
  contributionGrowthRateBps: 0,
  inflationRateBps: 250,
  bearReturnBps: 400,
  baseReturnBps: 600,
  bullReturnBps: 800,
  targetMonthlySpendingTodayCents: 700_000,
  sustainableWithdrawalRateBps: 300,
  contributionTiming: "END_OF_YEAR",
  finalPeriodFractionBps: 0,
  horizonRounding: "NONE",
};

function snapshot(overrides = {}) {
  return {
    asOfDate: "2026-07-30",
    baseCurrency: "SGD",
    totals: { bankControlCents: 1_000_000 },
    liquidity: { readilyAvailableCents: 3_000_000, essentialMonthlyExpenseCents: 800_000, emergencyRunwayMonths: 3.75 },
    allocation: {
      totalCents: 10_000_000,
      assetClasses: [
        { key: "EQUITY", valueCents: 8_000_000, allocationBps: 8_000 },
        { key: "FIXED_INCOME", valueCents: 1_000_000, allocationBps: 1_000 },
        { key: "CASH", valueCents: 1_000_000, allocationBps: 1_000 },
      ],
    },
    recurringFlows: { netExternalContributionAnnualCents: 1_200_000 },
    annualContributions: { usedExternalAnnualCents: 1_200_000, source: "DERIVED", internalReallocationAnnualCents: 0 },
    contributionProgress: null,
    dataQuality: { completenessBps: 10_000, warnings: [] },
    retirement: { status: "READY", missingFields: [], projection: { assumptions } },
    evidence: [],
    ...overrides,
  };
}

const policy = {
  confirmed: true,
  minimumLiquidityReserveCents: 4_000_000,
  minimumLiquidityMonths: 4,
  assetClassBands: [
    { assetClass: "EQUITY", minimumBps: 6_000, targetBps: 6_500, maximumBps: 7_000 },
    { assetClass: "FIXED_INCOME", minimumBps: 2_000, targetBps: 2_500, maximumBps: 3_000 },
    { assetClass: "CASH", minimumBps: 500, targetBps: 1_000, maximumBps: 1_500 },
  ],
};

test("monthly equivalents round half away from zero to the cent", () => {
  assert.equal(monthlyEquivalentCents(1_200_000), 100_000);
  assert.equal(monthlyEquivalentCents(4_052_000), 337_667);
  assert.equal(monthlyEquivalentCents(6), 1);
  assert.equal(monthlyEquivalentCents(5), 0);
  assert.equal(monthlyEquivalentCents(-6), -1);
});

test("apportioned cents always sum to the original amount", () => {
  for (const [amount, weights] of [[100, [1, 1, 1]], [1_000_001, [6_500, 2_500, 1_000]], [7, [0, 3, 0]], [50, [0, 0]]]) {
    const parts = apportionCents(amount, weights);
    const expected = weights.some((weight) => weight > 0) ? amount : 0;
    assert.equal(parts.reduce((sum, part) => sum + part, 0), expected);
    assert.ok(parts.every((part, index) => weights[index] > 0 || part === 0));
  }
});

test("new money fills target shortfalls first without selling", () => {
  const plan = planCioNewMoneyAllocation(snapshot(), policy, 2_000_000);
  assert.equal(plan.status, "PLANNED");
  const byClass = Object.fromEntries(plan.bands.map((row) => [row.assetClass, row]));
  assert.equal(plan.bands.reduce((sum, row) => sum + row.allocationCents, 0), 2_000_000);
  assert.equal(byClass.EQUITY.allocationCents, 0);
  assert.ok(byClass.FIXED_INCOME.allocationCents > byClass.CASH.allocationCents);
  assert.ok(plan.bands.every((row) => row.allocationCents >= 0));
  assert.equal(plan.totalAfterCents, 12_000_000);
  // Equity drifts back into its band (8M of 12M) through dilution alone.
  assert.equal(byClass.EQUITY.statusBefore, "ABOVE_BAND");
  assert.equal(byClass.EQUITY.statusAfter, "WITHIN_BAND");
  assert.deepEqual(plan.stillOutsideBands, []);
});

test("large new money beyond shortfalls is split by target weights", () => {
  const plan = planCioNewMoneyAllocation(snapshot(), policy, 100_000_000);
  assert.equal(plan.status, "PLANNED");
  assert.equal(plan.bands.reduce((sum, row) => sum + row.allocationCents, 0), 100_000_000);
  assert.deepEqual(plan.stillOutsideBands, []);
});

test("new-money planning and minimum solver require a confirmed policy", () => {
  assert.equal(planCioNewMoneyAllocation(snapshot(), { ...policy, confirmed: false }, 100_000).status, "POLICY_REQUIRED");
  assert.equal(planCioNewMoneyAllocation(snapshot(), null, 100_000).status, "POLICY_REQUIRED");
  assert.equal(newMoneyToReachMinimumsCents(snapshot(), null), null);
});

test("minimum new money lifts every band to its minimum", () => {
  const needed = newMoneyToReachMinimumsCents(snapshot(), policy);
  assert.ok(needed > 0);
  const total = 10_000_000 + needed;
  // Equity is overweight, so fixed income must reach 20% of the enlarged portfolio.
  assert.ok(1_000_000 + needed >= Math.ceil(total * 0.2));
  const lower = 10_000_000 + needed - 1;
  assert.ok(1_000_000 + needed - 1 < Math.ceil(lower * 0.2));
});

test("retirement levers are consistent with the deterministic projection", () => {
  const levers = solveCioRetirementLevers(assumptions);
  assert.ok(levers.requiredAnnualContributionCents > assumptions.annualExternalContributionCents);
  assert.equal(levers.additionalAnnualContributionCents, levers.requiredAnnualContributionCents - assumptions.annualExternalContributionCents);
  assert.equal(levers.requiredMonthlyContributionCents, monthlyEquivalentCents(levers.requiredAnnualContributionCents));
  assert.ok(levers.baseGapOrSurplusRealCents < 0);
  assert.ok(levers.monthlySpendingGapOrSurplusTodayCents < 0);
  if (levers.requiredBaseReturn.status === "SOLVED") {
    assert.ok(levers.requiredBaseReturn.bps > assumptions.baseReturnBps);
    assert.ok(levers.requiredBaseReturn.bps <= assumptions.bullReturnBps);
  }
  if (levers.earliestFundedRetirementDate) {
    assert.ok(levers.earliestFundedRetirementDate > assumptions.retirementDate);
    const outcome = projectRetirement({
      asOfDate: assumptions.asOfDate,
      targetRetirementDate: levers.earliestFundedRetirementDate,
      currentRetirementAssetsCents: assumptions.currentRetirementAssetsCents,
      annualExternalContributionCents: assumptions.annualExternalContributionCents,
      contributionGrowthBps: 0,
      bearReturnBps: 400, baseReturnBps: 600, bullReturnBps: 800,
      inflationBps: 250,
      targetMonthlyRetirementSpendingCents: 700_000,
      sustainableWithdrawalRateBps: 300,
    });
    assert.equal(outcome.scenarios.base.outcome.realTargetGapCents, 0);
  }
});

test("advisor brief precomputes drift, liquidity shortfall, and monthly equivalents", () => {
  const brief = buildCioAdvisorBrief({ snapshot: snapshot(), policy, profile: { minimumImmediateBankCashCents: 1_500_000 }, recommendations: [] });
  const equity = brief.allocation.drift.find((row) => row.assetClass === "EQUITY");
  assert.equal(equity.status, "ABOVE_BAND");
  assert.equal(equity.driftFromTargetBps, 1_500);
  assert.equal(equity.differenceFromTargetCents, 1_500_000);
  assert.equal(brief.liquidity.policyFloorCents, 4_000_000);
  assert.equal(brief.liquidity.policyShortfallCents, 1_000_000);
  assert.equal(brief.liquidity.monthsToRestoreAtNetContributions, 10);
  assert.equal(brief.liquidity.immediateBankCashShortfallCents, 500_000);
  assert.equal(brief.contributions.usedMonthlyCents, 100_000);
  assert.equal(brief.retirement.status, "READY");

  const notReady = buildCioAdvisorBrief({
    snapshot: snapshot({ retirement: { status: "NOT_READY", missingFields: ["targetRetirementDate"] } }),
    policy: null, profile: null, recommendations: [],
  });
  assert.equal(notReady.retirement.levers, null);
  assert.deepEqual(notReady.allocation.drift, []);
  assert.equal(notReady.liquidity.policyShortfallCents, null);
});

test("advisor tools are registered, read-only, and enabled for Ask Nest", async () => {
  const tools = getCioAskNestTools();
  for (const name of ["get_cio_advisor_brief", "plan_cio_new_money"]) {
    assert.ok(CIO_ASK_NEST_TOOL_NAMES.includes(name));
    const tool = tools.find((item) => item.name === name);
    assert.ok(tool, name);
    assert.match(tool.description, /read-only/i);
    assert.doesNotMatch(tool.description, /\bbuy\b/i);
  }
  const enabled = enabledAgentTools(defaultAgentConfiguration("ask-nest"));
  for (const name of CIO_ASK_NEST_TOOL_NAMES) assert.ok(enabled.has(name), `${name} should be enabled by the investments capability`);

  const orchestration = await readFile(new URL("../lib/ai/ask-nest.ts", import.meta.url), "utf8");
  assert.match(orchestration, /get_cio_advisor_brief: "Nest CIO advisor brief"/);
  assert.match(orchestration, /never compute a monthly equivalent, gap, sum, difference, or split yourself/);
  assert.match(orchestration, /groundingRepairDetail\(groundingFailure\.detail\)/);
});

test("advice and new-money questions route to the advisor tools", () => {
  const cases = [
    ["Where should I put my SGD 20,000 bonus?", "plan_cio_new_money"],
    ["How should we invest SGD 5000 of new money?", "plan_cio_new_money"],
    ["Give me advice on my portfolio", "get_cio_advisor_brief"],
    ["How far off is my retirement?", "get_cio_advisor_brief"],
    ["Can I retire earlier?", "get_cio_advisor_brief"],
    ["What household investment strategy do you recommend?", "get_cio_advisor_brief"],
  ];
  for (const [question, expected] of cases) {
    assert.ok(classifyAskNestIntent(question, "/cio").recommendedTools.includes(expected), `${question} → ${expected}`);
  }
});
