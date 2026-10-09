import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const projection = require("../lib/domains/cio/retirement-projection.ts");
const allocation = require("../lib/domains/cio/allocation-engine.ts");
const cashflow = require("../lib/domains/cio/cashflow-engine.ts");
const { RetirementProjectionValidationError } = projection;
let project, allocationResult, flowResult, records;
mock.module("../lib/domains/cio/retirement-projection.ts", { namedExports: { ...projection, projectRetirement: (...args) => project(...args) } });
mock.module("../lib/domains/cio/allocation-engine.ts", { namedExports: { ...allocation, calculateAllocation: (...args) => allocationResult ?? allocation.calculateAllocation(...args) } });
mock.module("../lib/domains/cio/cashflow-engine.ts", { namedExports: { ...cashflow, summarizeRecurringFlows: (...args) => flowResult ?? cashflow.summarizeRecurringFlows(...args) } });
mock.module("../lib/domains/cio/repository.ts", { namedExports: { loadCioSnapshotData: async () => records } });
const { solveRequiredAnnualRetirementContributionCents: solve } = require("../lib/domains/cio/strategy-recommendations.ts");
const { solveCioRetirementLevers } = require("../lib/domains/cio/advisor.ts");
const { buildCioSnapshot } = require("../lib/domains/cio/snapshot-service.ts");
const asOf = new Date("2026-10-09T00:00:00.000Z");
const assumptions = { asOfDate: "2026-10-09", retirementDate: "2036-10-09", currentRetirementAssetsCents: 0, annualExternalContributionCents: 123, contributionGrowthRateBps: 0, inflationRateBps: 0, bearReturnBps: 0, baseReturnBps: 0, bullReturnBps: 0, targetMonthlySpendingTodayCents: 100, sustainableWithdrawalRateBps: 400 };
const outcome = (funded) => ({ scenarios: { base: { outcome: { realTargetGapCents: funded ? 0 : 100 } } } });
const build = () => buildCioSnapshot({ workspaceId: "home", asOfDate: "2026-10-09" });
beforeEach(() => {
  project = projection.projectRetirement;
  allocationResult = null;
  flowResult = null;
  records = {
    workspace: { baseCurrency: "SGD" }, bankControls: [], savingsSubAccounts: [], investments: [], planningPositions: [], recurringFlows: [], investmentPolicy: null,
    bankControlCount: 0, bankControlsAfterAsOfCount: 0, savingsSubAccountCount: 0, savingsSubAccountsAfterAsOfCount: 0, truncated: {},
    householdProfile: {
      primaryBirthDate: null, primaryCurrentAge: 40, primaryAgeAsOfDate: asOf, targetRetirementAge: null, targetRetirementDate: new Date("2036-10-09T00:00:00.000Z"),
      inflationRateBps: 0, bearReturnBps: 0, baseReturnBps: 0, bullReturnBps: 0, targetMonthlyRetirementSpendingCents: 0, sustainableWithdrawalRateBps: 400,
      essentialMonthlySpendingCents: 0, minimumImmediateBankCashCents: null, annualExternalContributionOverrideCents: null, contributionGrowthRateBps: null, updatedAt: asOf,
    },
  };
});

test("snapshot projection failures without a field retain their validation code", async () => {
  project = () => { throw new RetirementProjectionValidationError("RESULT_OUT_OF_RANGE", "Projection overflow"); };
  const result = await build();
  assert.deepEqual(result.retirement, { status: "NOT_READY", missingFields: ["invalid_RESULT_OUT_OF_RANGE"], projection: null });
});

test("unexpected projection errors propagate instead of being presented as incomplete household inputs", async () => {
  const failure = new Error("Unexpected calculation failure");
  project = () => { throw failure; };
  await assert.rejects(build(), (error) => error === failure);
  assert.throws(() => solveCioRetirementLevers(assumptions), (error) => error === failure);
});

test("contribution search verifies its final bound after overflow and reports an unrepresentable target", () => {
  const seen = [];
  project = ({ annualExternalContributionCents }) => {
    seen.push(annualExternalContributionCents);
    if (annualExternalContributionCents >= 10) throw new RetirementProjectionValidationError("RESULT_OUT_OF_RANGE", "Projection overflow", "nominalValueCents");
    return outcome(false);
  };
  assert.equal(solve(assumptions), null);
  assert.equal(seen[0], 0);
  assert.equal(seen.at(-1), 10);
  assert.ok(seen.includes(9));
});

for (const failure of [new Error("Unexpected failure"), new RetirementProjectionValidationError("INVALID_AMOUNT", "Invalid amount", "annualExternalContributionCents")]) {
  test(`contribution search preserves non-overflow errors before searching: ${failure.name}`, () => {
    project = () => { throw failure; };
    assert.throws(() => solve(assumptions), (error) => error === failure);
  });
  test(`contribution search preserves non-overflow errors in final candidate validation: ${failure.name}`, () => {
    let boundaryCalls = 0;
    project = ({ annualExternalContributionCents }) => {
      if (annualExternalContributionCents === 10 && ++boundaryCalls === 2) throw failure;
      return outcome(annualExternalContributionCents >= 10);
    };
    assert.throws(() => solve(assumptions), (error) => error === failure);
    assert.equal(boundaryCalls, 2);
  });
}

test("advisory levers retain null outcomes when the current contribution cannot be projected", () => {
  project = ({ annualExternalContributionCents }) => {
    if (annualExternalContributionCents === 123) throw new RetirementProjectionValidationError("INVALID_AMOUNT", "Current contribution is invalid");
    return outcome(true);
  };
  const result = solveCioRetirementLevers(assumptions);
  assert.equal(result.baseGapOrSurplusRealCents, null);
  assert.equal(result.baseSustainableMonthlyIncomeRealCents, null);
  assert.equal(result.monthlySpendingGapOrSurplusTodayCents, null);
  assert.equal(result.earliestFundedRetirementDate, null);
  assert.equal(result.requiredAnnualContributionCents, 0);
  assert.equal(result.requiredBaseReturn.status, "ABOVE_BULL_RETURN");
});

test("snapshot summaries tolerate missing allocation provenance without inventing contributing accounts", async () => {
  allocationResult = allocation.calculateAllocation([]);
  allocationResult.totalValueCents = 100;
  allocationResult.assetClass.buckets = [{ key: "CASH", valueCents: 100, allocationBps: 10000 }];
  const result = await build();
  assert.deepEqual(result.allocation.assetClasses, [{ key: "CASH", valueCents: 100, allocationBps: 10000, sourceCount: 0, isUnknown: false }]);
});

test("a flow summary with a missing source keeps its annualized result and does not fabricate the original amount", async () => {
  flowResult = cashflow.summarizeRecurringFlows([], asOf);
  flowResult.sourceBreakdown = [{ id: "missing-source", label: "Imported plan", active: true, type: "EXTERNAL_CONTRIBUTION", cadence: "ANNUAL", annualizedCents: 100, retirementEligible: true }];
  records.recurringFlows = [{ id: "another-source", label: "Another plan", type: "EXTERNAL_CONTRIBUTION", cadence: "ANNUAL", amountCents: 100, startsOn: asOf, endsOn: null, includeInRetirementProjection: true, updatedAt: asOf }];
  const result = await build();
  assert.deepEqual(result.recurringFlows.breakdown, [{ id: "missing-source", label: "Imported plan", type: "EXTERNAL_CONTRIBUTION", cadence: "ANNUAL", amountCents: 0, annualizedCents: 100, includeInRetirementProjection: true }]);
});
