import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";
import { snapshot, policy as configuredPolicy } from "./cio-strategy-fixtures.mjs";

const require = createRequire(import.meta.url);
const calls = [];
let data;
const record = (name, args, value) => { calls.push({ name, args }); return value; };
mock.module("../lib/prisma.ts", { namedExports: { prisma: {
  workspace: { async findUnique(...args) { return record("workspace", args, data.workspace); } },
  investmentAccount: { async findMany(...args) { return record("investments", args, data.investments); } },
} } });
mock.module("../lib/domains/cio/repository.ts", { namedExports: {
  async getCioPolicy(...args) { return record("policy", args, data.policy); },
  async getCioProfile(...args) { return record("profile", args, data.profile); },
} });
mock.module("../lib/domains/cio/snapshot-service.ts", { namedExports: {
  async buildCioSnapshot(...args) {
    if (data.snapshotError) throw data.snapshotError;
    return record("snapshot", args, data.snapshot);
  },
} });
const actualRecommendations = require("../lib/domains/cio/strategy-recommendations.ts");
mock.module("../lib/domains/cio/strategy-recommendations.ts", { namedExports: {
  ...actualRecommendations,
  buildCioStrategyRecommendations(params) {
    return data.recommendations ?? actualRecommendations.buildCioStrategyRecommendations(params);
  },
} });
const service = require("../lib/domains/cio/strategy-report-service.ts");

beforeEach(() => {
  calls.length = 0;
  data = {
    workspace: { name: "Home" }, policy: configuredPolicy, profile: { minimumImmediateBankCashCents: 1_500_000 }, snapshot: snapshot(),
    investments: [{ id: "investment-1", displayName: "Global core", institutionName: "Broker", productName: "Portfolio" }],
    recommendations: null, snapshotError: null,
  };
});
function assertWorkspaceQueries(asOfDate) {
  assert.deepEqual(calls.find(({ name }) => name === "snapshot").args, [{ workspaceId: "home", asOfDate }]);
  assert.deepEqual(calls.find(({ name }) => name === "workspace").args, [{ where: { id: "home" }, select: { name: true } }]);
  assert.deepEqual(calls.find(({ name }) => name === "policy").args, ["home"]);
  assert.deepEqual(calls.find(({ name }) => name === "profile").args, ["home"]);
  assert.deepEqual(calls.find(({ name }) => name === "investments").args[0], { where: { workspaceId: "home" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500, select: { id: true, displayName: true, institutionName: true, productName: true } });
}

test("workspace strategy recommendations are built from the canonical workspace snapshot", async () => {
  const result = await service.buildWorkspaceCioStrategyRecommendations({ workspaceId: "home", asOfDate: "2026-07-30" });
  assert.equal(result.asOfDate, "2026-07-30");
  assert.equal(result.baseCurrency, "SGD");
  assert.ok(result.recommendations.some((item) => item.code === "REBUILD_IMMEDIATE_CASH"));
  assert.equal(result.dataQuality, data.snapshot.dataQuality);
  assert.equal(result.evidence, data.snapshot.evidence);
  assertWorkspaceQueries("2026-07-30");
});

test("workspace advisor briefs include the deterministic stance and calculated contribution amounts", async () => {
  const result = await service.buildWorkspaceCioAdvisorBrief({ workspaceId: "home" });
  assert.equal(result.strategyStatus, "ACTION_REQUIRED");
  assert.match(result.executiveStance, /Protect liquidity/);
  assert.equal(result.retirement.status, "READY");
  assert.equal(result.contributions.usedAnnualCents, 4_052_000);
  assertWorkspaceQueries(undefined);
});

test("workspace new-money scenarios use the confirmed policy and never mutate holdings", async () => {
  const result = await service.planWorkspaceCioNewMoney({ workspaceId: "home", amountCents: 100_000 });
  assert.equal(result.plan.status, "PLANNED");
  assert.equal(result.plan.bands.reduce((sum, band) => sum + band.allocationCents, 0), 100_000);
  assert.equal(result.dataQuality, data.snapshot.dataQuality);
  assertWorkspaceQueries(undefined);
});

test("workspace reports bind their labels, policy, data date, and generation time", async () => {
  const generatedAt = new Date("2026-07-31T10:00:00.000Z");
  const result = await service.buildWorkspaceCioStrategyReport({ workspaceId: "home", asOfDate: "2026-07-30", generatedAt });
  assert.equal(result.workspaceName, "Home");
  assert.equal(result.title, "Home Household CIO Strategy");
  assert.equal(result.generatedAt, generatedAt.toISOString());
  assert.equal(result.reviewByDate, "2027-01-31");
  assert.equal(result.investments[0].label, "Global core");
  assertWorkspaceQueries("2026-07-30");
});

test("missing strategy workspaces and snapshot errors are propagated as actionable failures", async () => {
  data.workspace = null;
  await assert.rejects(service.buildWorkspaceCioStrategyReport({ workspaceId: "home" }), { status: 404, message: "Workspace not found" });
  data.snapshotError = new Error("Snapshot unavailable");
  await assert.rejects(service.buildWorkspaceCioAdvisorBrief({ workspaceId: "home" }), (error) => error === data.snapshotError);
});

test("reports preserve incomplete setup and nullable policy values without inventing defaults", async () => {
  data.policy = null;
  data.profile = null;
  data.snapshot.retirement = { status: "NOT_READY", projection: null, missingFields: ["primaryBirthDate"] };
  const before = Date.now();
  const result = await service.buildWorkspaceCioStrategyReport({ workspaceId: "home" });
  assert.equal(result.strategyStatus, "SETUP_REQUIRED");
  assert.equal(result.policy.confirmed, false);
  assert.deepEqual(result.policy.assetClassBands, []);
  assert.equal(result.policy.minimumLiquidityReserveCents, null);
  assert.equal(result.policy.maximumSingleSecurityConcentrationBps, null);
  assert.equal(result.retirement.status, "NOT_READY");
  assert.deepEqual(result.retirement.missingFields, ["primaryBirthDate"]);
  assert.equal(result.retirement.currentAnnualContributionCents, null);
  assert.ok(new Date(result.generatedAt).getTime() >= before);
  const plan = await service.planWorkspaceCioNewMoney({ workspaceId: "home", amountCents: 1000 });
  assert.equal(plan.plan.status, "POLICY_REQUIRED");
});

test("reports retain bounded policy exceptions, warnings, and legacy investment labels", async () => {
  data.policy = { ...configuredPolicy, confirmedAt: null, minimumLiquidityMonths: null, minimumLiquidityReserveCents: null, maximumAccountConcentrationBps: null, maximumSingleSecurityConcentrationBps: null, maximumSatelliteAllocationBps: null, geographyLimits: [{ geography: "GLOBAL", maximumBps: 10000 }] };
  data.snapshot.policyExceptions = [{ code: "UNCONFIRMED_POLICY", severity: "WARNING", title: "Confirm policy", reviewAction: "Review household limits" }];
  data.snapshot.dataQuality.warnings = [{ code: "MISSING_POLICY", severity: "WARNING", message: "Confirm the policy" }];
  data.snapshot.investments = [data.snapshot.investments[0], { ...data.snapshot.investments[0], id: "investment-2" }, { ...data.snapshot.investments[0], id: "missing-source" }];
  data.investments = [
    { id: "investment-1", displayName: "   ", institutionName: "", productName: "Named product" },
    { id: "investment-2", displayName: null, institutionName: "Broker", productName: "" },
  ];
  const result = await service.buildWorkspaceCioStrategyReport({ workspaceId: "home" });
  assert.deepEqual(result.investments.map((item) => item.label), ["Named product", "Recorded investment", "Recorded investment"]);
  assert.equal(result.investments[0].institutionName, "Unknown institution");
  assert.equal(result.investments[2].productName, "Recorded investment");
  assert.deepEqual(result.policy.geographyLimits, [{ geography: "GLOBAL", maximumBps: 10000 }]);
  assert.equal(result.policyExceptions[0].reviewAction, "Review household limits");
  assert.deepEqual(result.dataQuality.warnings, [{ code: "MISSING_POLICY", severity: "WARNING", message: "Confirm the policy" }]);
});

test("a strategy with no generated actions still has a valid report message and no fabricated contribution target", async () => {
  data.recommendations = [];
  const report = await service.buildWorkspaceCioStrategyReport({ workspaceId: "home" });
  assert.equal(report.strategyStatus, "ON_TRACK");
  assert.equal(report.retirement.requiredAnnualContributionCents, null);
  assert.equal(report.keyMessages.length, 1);
  assert.match(report.keyMessages[0], /Continue monitoring/);
});

test("report status and executive stance prioritize liquidity, setup, retirement, and allocation consistently", () => {
  const current = data.snapshot;
  const action = (code, category = "RETIREMENT", severity = "HIGH") => ({ code, category, severity });
  for (const code of ["CONFIRM_INVESTMENT_POLICY", "COMPLETE_RETIREMENT_ASSUMPTIONS"]) assert.equal(service.strategyStatus(current, [action(code)]), "SETUP_REQUIRED");
  for (const severity of ["CRITICAL", "HIGH"]) assert.equal(service.strategyStatus(current, [action("INCREASE_RETIREMENT_CONTRIBUTIONS", "RETIREMENT", severity)]), "ACTION_REQUIRED");
  assert.equal(service.strategyStatus(current, [action("MAINTAIN_RETIREMENT_CONTRIBUTIONS", "RETIREMENT", "LOW")]), "ON_TRACK");
  current.dataQuality.completenessBps = 0;
  assert.equal(service.strategyStatus(current, []), "SETUP_REQUIRED");
  assert.match(service.executiveStance("SETUP_REQUIRED", []), /foundation is not complete/);
  assert.match(service.executiveStance("ACTION_REQUIRED", [action("INCREASE_RETIREMENT_CONTRIBUTIONS")]), /funding rate is below/);
  assert.match(service.executiveStance("ACTION_REQUIRED", [action("DIRECT_NEW_CONTRIBUTIONS_TO_UNDERWEIGHT_ASSET", "ALLOCATION")]), /new cash flows/);
  assert.match(service.executiveStance("ON_TRACK", []), /broadly aligned/);
});
