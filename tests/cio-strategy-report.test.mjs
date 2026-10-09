import assert from "node:assert/strict";
import test from "node:test";
import { projectRetirement } from "../lib/domains/cio/retirement-projection.ts";
import { snapshot, policy } from "./cio-strategy-fixtures.mjs";
import {
  buildCioStrategyRecommendations,
  solveRequiredAnnualRetirementContributionCents,
} from "../lib/domains/cio/strategy-recommendations.ts";
import { composeCioStrategyReportModel } from "../lib/domains/cio/strategy-report-service.ts";
import { CioStrategyReportDocument, renderCioStrategyReportPdf } from "../lib/domains/cio/strategy-report-pdf.tsx";
import {
  CIO_STRATEGY_REPORT_COOLDOWN_DAYS,
  cioStrategyReportNextAvailableAt,
  isCioStrategyReportOnCooldown,
} from "../lib/domains/cio/report-cooldown.ts";

test("CIO strategy reports have a rolling 30-day generation cooldown", () => {
  const generatedAt = new Date("2026-07-01T10:30:00.000Z");
  assert.equal(CIO_STRATEGY_REPORT_COOLDOWN_DAYS, 30);
  assert.equal(cioStrategyReportNextAvailableAt(generatedAt).toISOString(), "2026-07-31T10:30:00.000Z");
  assert.equal(isCioStrategyReportOnCooldown(generatedAt, new Date("2026-07-31T10:29:59.999Z")), true);
  assert.equal(isCioStrategyReportOnCooldown(generatedAt, new Date("2026-07-31T10:30:00.000Z")), false);
});

test("strategy recommendations prioritize liquidity, contribution-led allocation, and retirement sufficiency", () => {
  const current = snapshot();
  const recommendations = buildCioStrategyRecommendations({
    snapshot: current,
    policy: {
      confirmed: true,
      minimumLiquidityReserveCents: policy.minimumLiquidityReserveCents,
      minimumLiquidityMonths: policy.minimumLiquidityMonths,
      assetClassBands: policy.assetClassBands,
    },
    profile: { minimumImmediateBankCashCents: 1_500_000 },
  });
  const codes = recommendations.map((item) => item.code);

  assert.equal(codes[0], "REBUILD_IMMEDIATE_CASH");
  assert.ok(codes.includes("REBUILD_LIQUID_RESERVE"));
  assert.ok(codes.includes("PAUSE_NEW_CONTRIBUTIONS_TO_OVERWEIGHT_ASSET"));
  assert.ok(codes.includes("DIRECT_NEW_CONTRIBUTIONS_TO_UNDERWEIGHT_ASSET"));
  assert.ok(codes.includes("INCREASE_RETIREMENT_CONTRIBUTIONS"));
  assert.ok(recommendations.every((item) => item.requiresUserConfirmation));
  assert.ok(recommendations.every((item) => !/\b(?:buy|sell|order)\b/i.test(item.action)));
});

test("retirement contribution solver finds the minimum funded base-case contribution", () => {
  const assumptions = snapshot().retirement.projection.assumptions;
  const required = solveRequiredAnnualRetirementContributionCents(assumptions);
  assert.ok(required > assumptions.annualExternalContributionCents);

  const funded = projectRetirement({
    asOfDate: assumptions.asOfDate,
    targetRetirementDate: assumptions.retirementDate,
    currentRetirementAssetsCents: assumptions.currentRetirementAssetsCents,
    annualExternalContributionCents: required,
    contributionGrowthBps: assumptions.contributionGrowthRateBps,
    bearReturnBps: assumptions.bearReturnBps,
    baseReturnBps: assumptions.baseReturnBps,
    bullReturnBps: assumptions.bullReturnBps,
    inflationBps: assumptions.inflationRateBps,
    targetMonthlyRetirementSpendingCents: assumptions.targetMonthlySpendingTodayCents,
    sustainableWithdrawalRateBps: assumptions.sustainableWithdrawalRateBps,
  });
  assert.equal(funded.scenarios.base.outcome.realTargetGapCents, 0);
});

test("an unfunded retirement target is surfaced for review instead of appearing on track", () => {
  const current = snapshot();
  current.retirement.projection.assumptions = {
    ...current.retirement.projection.assumptions,
    retirementDate: "2027-07-30",
    horizonYears: 1,
    targetMonthlySpendingTodayCents: 2_147_483_647,
  };
  const recommendations = buildCioStrategyRecommendations({
    snapshot: current,
    policy: {
      confirmed: true,
      minimumLiquidityReserveCents: policy.minimumLiquidityReserveCents,
      minimumLiquidityMonths: policy.minimumLiquidityMonths,
      assetClassBands: policy.assetClassBands,
    },
    profile: { minimumImmediateBankCashCents: 1_500_000 },
  });

  assert.ok(recommendations.some((item) => item.code === "REVIEW_UNFUNDED_RETIREMENT_TARGET"));
});

test("incomplete plans prioritize setup and explain missing retirement assumptions", () => {
  for (const completenessBps of [0, 6000]) {
    const current = snapshot();
    current.dataQuality.completenessBps = completenessBps;
    current.retirement = { status: "NOT_READY", missingFields: ["targetRetirementDate", "inflationRateBps"], projection: null };
    const recommendations = buildCioStrategyRecommendations({ snapshot: current, policy: null, profile: null });
    assert.equal(recommendations[0].code, "COMPLETE_CIO_SETUP");
    assert.equal(recommendations[0].severity, completenessBps === 0 ? "CRITICAL" : "HIGH");
    assert.ok(recommendations.some((item) => item.code === "CONFIRM_INVESTMENT_POLICY"));
    const retirement = recommendations.find((item) => item.code === "COMPLETE_RETIREMENT_ASSUMPTIONS");
    assert.deepEqual(retirement.current, { unit: "COUNT", value: 2, label: "Missing assumptions" });
    assert.ok(recommendations.every((item) => item.requiresUserConfirmation));
  }
});

test("a funded plan inside every configured band recommends maintaining contributions and allocation", () => {
  const current = snapshot();
  current.retirement.projection.assumptions.targetMonthlySpendingTodayCents = 0;
  current.liquidity.essentialMonthlyExpenseCents = null;
  const recommendations = buildCioStrategyRecommendations({
    snapshot: current, profile: null,
    policy: { confirmed: true, minimumLiquidityReserveCents: null, minimumLiquidityMonths: null, assetClassBands: current.allocation.assetClasses.map((item) => ({ assetClass: item.key, minimumBps: 0, targetBps: item.allocationBps, maximumBps: 10000 })) },
  });
  assert.deepEqual(recommendations.map((item) => item.code), ["MAINTAIN_RETIREMENT_CONTRIBUTIONS", "MAINTAIN_CONFIRMED_ALLOCATION"]);
  assert.equal(recommendations[0].target.value, 0);
  assert.equal(recommendations[0].annualChangeCents, 0);
  assert.equal(solveRequiredAnnualRetirementContributionCents(current.retirement.projection.assumptions), 0);
});

test("missing asset classes are treated as zero allocation and equally ranked actions have deterministic ordering", () => {
  const current = snapshot();
  current.allocation.assetClasses = [];
  const recommendations = buildCioStrategyRecommendations({ snapshot: current, policy: { ...policy, confirmed: true }, profile: null });
  const allocation = recommendations.filter((item) => item.code === "DIRECT_NEW_CONTRIBUTIONS_TO_UNDERWEIGHT_ASSET");
  assert.deepEqual(allocation.map((item) => item.scopeKey), ["CASH", "EQUITY", "FIXED_INCOME"]);
  assert.ok(allocation.every((item) => item.current.value === 0));
});

test("concentration actions retain supported units, nullable limits, bounded evidence, and a four-action limit", () => {
  const current = snapshot();
  const codes = ["ACCOUNT_CONCENTRATION", "SECURITY_CONCENTRATION", "GEOGRAPHY_CONCENTRATION", "SATELLITE_ALLOCATION_EXCEEDED"];
  current.policyExceptions = codes.map((code, index) => ({
    code, title: code, actual: { unit: ["CENTS", "BPS", "COUNT", "MONTHS"][index], value: index === 0 ? null : 100 },
    threshold: index === 0 ? undefined : { unit: ["CENTS", "BPS", "CENTS", "MONTHS"][index], value: index === 1 ? null : 50 },
    evidence: Array.from({ length: 10 }, (_, number) => ({ id: `evidence-${number}` })),
  }));
  current.policyExceptions.push({ ...current.policyExceptions[1], code: "UNSUPPORTED" }, { ...current.policyExceptions[1], title: "Fifth supported exception" });
  const recommendations = buildCioStrategyRecommendations({ snapshot: current, policy: null, profile: null });
  const concentration = recommendations.filter((item) => item.code === "LIMIT_CONCENTRATION_WITH_FUTURE_FLOWS");
  assert.equal(concentration.length, 4);
  assert.deepEqual(concentration.map((item) => item.current?.unit ?? null), [null, "BPS", "COUNT", "COUNT"]);
  assert.deepEqual(concentration.map((item) => item.target?.unit ?? null), [null, null, "CENTS", "COUNT"]);
  assert.ok(concentration.every((item) => item.evidenceIds.length === 8));
  assert.ok(concentration.every((item) => item.title !== "Fifth supported exception"));
  current.policyExceptions = [{ ...current.policyExceptions[0], actual: { unit: "CENTS", value: 100 }, threshold: { unit: "BPS", value: 50 } }];
  const cents = buildCioStrategyRecommendations({ snapshot: current, policy: null, profile: null }).find((item) => item.category === "CONCENTRATION");
  assert.equal(cents.current.unit, "CENTS");
  assert.equal(cents.target.unit, "BPS");
});

test("report composition is deterministic, validated, and renders a PDF", async () => {
  const report = composeCioStrategyReportModel({
    snapshot: snapshot(),
    workspaceName: "Example Household",
    investments: [{ id: "investment-1", displayName: "Global Core", institutionName: "Example", productName: "Core Portfolio" }],
    policy,
    profile: { minimumImmediateBankCashCents: 1_500_000 },
    generatedAt: new Date("2026-07-30T10:00:00.000Z"),
  });

  assert.equal(report.title, "Example Household CIO Strategy");
  assert.equal(report.strategyStatus, "ACTION_REQUIRED");
  assert.equal(report.reviewByDate, "2027-01-30");
  assert.equal(report.investments[0].label, "Global Core");
  assert.ok(report.recommendations.length >= 5);

  const pdf = await renderCioStrategyReportPdf(report);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(pdf.byteLength > 10_000);
});

function documentText(element) {
  if (element == null || typeof element === "boolean") return "";
  if (typeof element === "string" || typeof element === "number") return String(element);
  if (Array.isArray(element)) return element.map(documentText).join("");
  if (typeof element.type === "function") return documentText(element.type(element.props));
  const rendered = element.props.render?.({ pageNumber: 1, totalPages: 8 }) ?? "";
  return documentText(element.props.children) + rendered + "\n";
}

test("reports with incomplete records render explicit missing-data explanations and all metric units", async () => {
  const current = snapshot();
  current.retirement = { status: "NOT_READY", missingFields: ["targetRetirementDate"], projection: null };
  current.investments = [];
  current.allocation.assetClasses[0] = { ...current.allocation.assetClasses[0], key: "UNKNOWN", isUnknown: true };
  current.liquidity.essentialMonthlyExpenseCents = null;
  current.liquidity.emergencyRunwayMonths = null;
  current.dataQuality.latestValuationDate = null;
  current.dataQuality.oldestValuationDate = null;
  current.dataQuality.warnings = [{ code: "MISSING_PROFILE", severity: "WARNING", message: "Complete the household profile" }];
  current.policyExceptions = [{ code: "UNCONFIRMED_POLICY", severity: "WARNING", title: "Confirm guardrails", reviewAction: "Review the household policy" }];
  const report = composeCioStrategyReportModel({ snapshot: current, workspaceName: "Home", investments: [], policy: null, profile: null, generatedAt: new Date("2026-07-30T10:00:00.000Z") });
  const original = report.recommendations[0];
  report.recommendations.push(
    { ...original, id: "runway", severity: "MEDIUM", current: { unit: "MONTHS", value: 1.5, label: "Runway" }, target: null },
    { ...original, id: "missing-count", severity: "LOW", current: null, target: { unit: "COUNT", value: 2, label: "Records to complete" } },
  );
  const content = documentText(CioStrategyReportDocument({ report }));
  for (const expected of ["No investment accounts are available", "The investment policy is not confirmed", "The retirement projection is not ready", "targetRetirementDate", "Runway: 1.5 months", "Records to complete: 2", "Not configured", "Complete the household profile", "Review the household policy", "Latest valuation: Not available", "Not set", "Unknown (incomplete)"]) assert.ok(content.includes(expected), expected);
  const pdf = await renderCioStrategyReportPdf(report);
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
});

test("report investment rows and legacy retirement data remain readable when optional fields are missing", () => {
  const current = snapshot();
  current.investments.push({ ...current.investments[0], id: "unclassified", currentValueCents: null, portfolioRole: null });
  const report = composeCioStrategyReportModel({ snapshot: current, workspaceName: "Household", investments: [], policy, profile: null, generatedAt: new Date("2026-07-30T10:00:00.000Z") });
  report.retirement.retirementDate = null;
  const content = documentText(CioStrategyReportDocument({ report }));
  assert.ok(content.includes("Recorded investment"));
  assert.ok(content.includes("Unknown institution"));
  assert.ok(content.includes("Not set"));
  assert.ok(content.includes("Not configured"));
  assert.ok(content.includes("No policy exceptions were produced"));
  assert.ok(content.includes("PAGE 1 OF 8"));
});
