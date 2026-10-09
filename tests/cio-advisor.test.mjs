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

test("new-money planning keeps unknown holdings visible and cannot satisfy a fully committed band by dilution", () => {
  const unknown = snapshot({ allocation: { totalCents: 100, assetClasses: [{ key: "UNKNOWN", valueCents: 100, allocationBps: 10000 }] } });
  const equityOnly = { ...policy, assetClassBands: [{ assetClass: "EQUITY", minimumBps: 10000, targetBps: 10000, maximumBps: 10000 }] };
  assert.equal(newMoneyToReachMinimumsCents(unknown, equityOnly), null);
  const plan = planCioNewMoneyAllocation(unknown, equityOnly, 100);
  assert.deepEqual(plan.unknown, { valueCents: 100, allocationBps: 10000 });
  assert.deepEqual(plan.stillOutsideBands, ["EQUITY"]);
  assert.equal(plan.bands[0].allocationCents, 100);
  assert.equal(plan.bands[0].afterBps, 5000);
  const noAssets = snapshot({ allocation: { totalCents: 0, assetClasses: [] } });
  const zeroPlan = planCioNewMoneyAllocation(noAssets, equityOnly, 0);
  assert.equal(zeroPlan.bands[0].currentBps, 0);
  assert.equal(zeroPlan.bands[0].allocationShareBps, 0);
  assert.deepEqual(apportionCents(0, [1, 2]), [0, 0]);
  assert.deepEqual(apportionCents(3, [-1, 1]), [0, 3]);
  assert.deepEqual(apportionCents(3, []), []);
});

test("well-funded policy bands need no new money and excess contributions still follow target weights", () => {
  const narrow = { ...policy, assetClassBands: [{ assetClass: "EQUITY", minimumBps: 1000, targetBps: 2000, maximumBps: 10000 }] };
  assert.equal(newMoneyToReachMinimumsCents(snapshot(), narrow), 0);
  const plan = planCioNewMoneyAllocation(snapshot(), narrow, 1000);
  assert.equal(plan.bands[0].allocationCents, 1000);
  assert.equal(plan.bands[0].afterCents, 8_001_000);
});

test("retirement levers distinguish a funded plan, a solved return, and an unsupported contribution target", () => {
  const funded = solveCioRetirementLevers({ ...assumptions, targetMonthlySpendingTodayCents: 0, annualExternalContributionCents: 0 });
  assert.equal(funded.requiredAnnualContributionCents, 0);
  assert.equal(funded.additionalMonthlyContributionCents, 0);
  assert.equal(funded.requiredBaseReturn.status, "FUNDED_AT_BEAR_RETURN");
  assert.equal(funded.earliestFundedRetirementDate, "2027-07-30");
  const solvable = { ...assumptions, currentRetirementAssetsCents: 1_000_000, annualExternalContributionCents: 0, targetMonthlySpendingTodayCents: 10000, sustainableWithdrawalRateBps: 400, inflationRateBps: 0, bearReturnBps: 0, baseReturnBps: 300, bullReturnBps: 1000 };
  const solved = solveCioRetirementLevers(solvable);
  assert.equal(solved.requiredBaseReturn.status, "SOLVED");
  assert.ok(solved.requiredBaseReturn.bps > 0 && solved.requiredBaseReturn.bps < 1000);
  for (const [rate, fundedAtRate] of [[solved.requiredBaseReturn.bps, true], [solved.requiredBaseReturn.bps - 1, false]]) {
    const projection = projectRetirement({ asOfDate: solvable.asOfDate, targetRetirementDate: solvable.retirementDate, currentRetirementAssetsCents: solvable.currentRetirementAssetsCents, annualExternalContributionCents: 0, contributionGrowthBps: 0, bearReturnBps: 0, baseReturnBps: rate, bullReturnBps: 1000, inflationBps: 0, targetMonthlyRetirementSpendingCents: 10000, sustainableWithdrawalRateBps: 400 });
    assert.equal(projection.scenarios.base.outcome.realTargetGapCents === 0, fundedAtRate);
  }
  const unfunded = solveCioRetirementLevers({ ...assumptions, retirementDate: "2027-07-30", horizonYears: 1, currentRetirementAssetsCents: 0, annualExternalContributionCents: 0, targetMonthlySpendingTodayCents: 2_147_483_647 });
  assert.equal(unfunded.requiredAnnualContributionCents, null);
  assert.equal(unfunded.additionalAnnualContributionCents, null);
  assert.equal(unfunded.requiredMonthlyContributionCents, null);
  assert.equal(unfunded.additionalMonthlyContributionCents, null);
  assert.equal(unfunded.requiredBaseReturn.status, "ABOVE_BULL_RETURN");
  assert.equal(unfunded.earliestFundedRetirementDate, null);
});

test("advisor reserve recovery distinguishes missing floors, funded floors, and no available contributions", () => {
  const notReady = { status: "NOT_READY", missingFields: ["targetRetirementDate"] };
  for (const [reserve, months, available, netAnnual, expectedFloor, expectedMonths] of [
    [null, null, 1000, 1200, null, null],
    [1000, null, 1000, 1200, 1000, 0],
    [1000, null, 200, 0, 1000, null],
    [1000, null, 200, -1200, 1000, null],
  ]) {
    const current = snapshot({ retirement: notReady, liquidity: { readilyAvailableCents: available, essentialMonthlyExpenseCents: null, emergencyRunwayMonths: null }, recurringFlows: { netExternalContributionAnnualCents: netAnnual } });
    const brief = buildCioAdvisorBrief({ snapshot: current, policy: { ...policy, minimumLiquidityReserveCents: reserve, minimumLiquidityMonths: months }, profile: null, recommendations: [] });
    assert.equal(brief.liquidity.policyFloorCents, expectedFloor);
    assert.equal(brief.liquidity.monthsToRestoreAtNetContributions, expectedMonths);
  }
  const progress = { year: 2026, status: "BEHIND", actualYtdCents: 1000, expectedToDateCents: 2000, annualTargetCents: 4000, paceGapCents: -1000, remainingAnnualCents: 3000, annualProgressBps: 2500, calendarProgressBps: 5000 };
  const brief = buildCioAdvisorBrief({ snapshot: snapshot({ retirement: notReady, contributionProgress: progress }), policy: { ...policy, confirmed: false }, profile: null, recommendations: [] });
  assert.deepEqual(brief.contributions.progress, progress);
  assert.equal(brief.allocation.policyConfirmed, false);
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
