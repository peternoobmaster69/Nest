import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";
import { Prisma } from "@prisma/client";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-09T12:00:00.000Z");
const scope = { workspaceId: "household", actorUserId: "editor" };
const calls = [];
const persisted = [];
let report;
let latest;
let stored;
let records;
let failures;
let auditFailure;
let buildFailure;
let latestReads;
function emptyReport() {
  return {
    schemaVersion: "1.0", rendererVersion: "1.0", generatedAt: now.toISOString(), asOfDate: "2026-10-09", reviewByDate: "2026-11-08",
    title: "Household strategy", workspaceName: "Test household", baseCurrency: "SGD", strategyStatus: "SETUP_REQUIRED",
    executiveStance: "Complete household setup before relying on projections.", keyMessages: ["Confirm your retirement assumptions."],
    totals: { financialAssetsCents: 0, planningAssetsCents: 0, planningLiabilitiesCents: 0, planningNetWorthCents: 0, investableAssetsCents: 0, retirementIncludedAssetsCents: 0 },
    allocation: { assetClasses: [], geographies: [] },
    liquidity: { immediateCents: 0, liquidCents: 0, restrictedCents: 0, lockedCents: 0, readilyAvailableCents: 0, essentialMonthlyExpenseCents: null, emergencyRunwayMonths: null },
    contributions: { externalContributionAnnualCents: 0, externalWithdrawalAnnualCents: 0, netExternalContributionAnnualCents: 0, internalReallocationAnnualCents: 0, retirementContributionAnnualCents: 0, source: "DERIVED" },
    investments: [],
    policy: { confirmed: false, minimumLiquidityReserveCents: null, minimumLiquidityMonths: null, maximumAccountConcentrationBps: null, maximumSingleSecurityConcentrationBps: null, maximumSatelliteAllocationBps: null, assetClassBands: [], geographyLimits: [] },
    retirement: { status: "NOT_READY", missingFields: ["primaryBirthDate"], retirementDate: null, targetMonthlySpendingCents: null, currentAnnualContributionCents: null, requiredAnnualContributionCents: null, inflationRateBps: null, sustainableWithdrawalRateBps: null, scenarios: [] },
    recommendations: [], policyExceptions: [],
    dataQuality: { completenessBps: 0, latestValuationDate: null, oldestValuationDate: null, warnings: [] },
    evidence: [], methodology: ["Use confirmed workspace values."], limitations: ["The household assumptions are incomplete."],
  };
}
const tx = {
  cioStrategyReport: {
    findFirst: async (args) => {
      calls.push({ operation: "findFirst", args });
      if (args.where.id) return stored;
      return latestReads.length ? latestReads.shift() : latest;
    },
    findMany: async (args) => { calls.push({ operation: "findMany", args }); return records; },
    create: async (args) => {
      calls.push({ operation: "create", args });
      const failure = failures.shift();
      if (failure) throw failure;
      persisted.push(args.data);
      return { id: "report" };
    },
  },
  workspaceAuditLog: { create: async (args) => {
    calls.push({ operation: "audit", args });
    if (auditFailure) throw auditFailure;
    persisted.push(args.data);
  } },
};
const prisma = { ...tx, $transaction: async (operation, options) => {
  calls.push({ operation: "begin", options });
  const checkpoint = persisted.length;
  try {
    const result = await operation(tx);
    calls.push({ operation: "commit" });
    return result;
  } catch (error) {
    persisted.splice(checkpoint);
    calls.push({ operation: "rollback" });
    throw error;
  }
} };
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/domains/cio/strategy-report-service.ts", { namedExports: { buildWorkspaceCioStrategyReport: async (args) => {
  calls.push({ operation: "build", args });
  if (buildFailure) throw buildFailure;
  return report;
} } });
const repository = require("../lib/domains/cio/report-repository.ts");
const { CioStrategyReportModelSchema } = require("../lib/domains/cio/report-types.ts");
const { ApiRequestError } = require("../lib/api/contracts.ts");
const { cioStrategyReportNextAvailableAt, isCioStrategyReportOnCooldown } = require("../lib/domains/cio/report-cooldown.ts");
const operation = (name) => calls.filter((call) => call.operation === name);
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  report = CioStrategyReportModelSchema.parse(emptyReport());
  latest = null; stored = null; records = []; failures = []; auditFailure = null; buildFailure = null; latestReads = [];
  calls.length = 0; persisted.length = 0;
});
const conflict = (code = "P2034") => new Prisma.PrismaClientKnownRequestError("Transaction conflict", { code, clientVersion: Prisma.prismaVersion.client });

test("strategy report persistence hashes the complete model and atomically stores its audit and workspace ownership", async () => {
  const result = await repository.createCioStrategyReport({ ...scope, asOfDate: "2026-10-09" });
  const json = JSON.stringify(report);
  assert.equal(result.id, "report");
  assert.deepEqual(result.report, report);
  assert.equal(result.summary.recommendationCount, 0);
  assert.deepEqual(operation("build")[0].args, { workspaceId: "household", asOfDate: "2026-10-09", generatedAt: now });
  const write = operation("create")[0].args;
  assert.equal(write.data.workspaceId, "household");
  assert.equal(write.data.createdByUserId, "editor");
  assert.equal(write.data.reportJson, json);
  assert.equal(write.data.contentHash, createHash("sha256").update(json).digest("hex"));
  assert.deepEqual(write.data.asOfDate, new Date("2026-10-09T00:00:00Z"));
  assert.deepEqual(operation("audit")[0].args.data, { workspaceId: "household", actorUserId: "editor", action: "CIO_STRATEGY_REPORT_CREATED", details: "CIO strategy report created for 2026-10-09." });
  assert.deepEqual(operation("begin")[0].options, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  assert.equal(operation("commit").length, 1);
});

test("strategy reports enforce the rolling cooldown before generation and recheck it inside the write transaction", async () => {
  latest = { createdAt: new Date("2026-10-08T12:00:00Z") };
  await assert.rejects(repository.createCioStrategyReport(scope), (error) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "CIO_STRATEGY_REPORT_COOLDOWN");
    assert.match(error.message, /2026-11-07/);
    return true;
  });
  assert.equal(operation("build").length, 0);
  latestReads = [null, latest];
  await assert.rejects(repository.createCioStrategyReport(scope), (error) => error.code === "CIO_STRATEGY_REPORT_COOLDOWN");
  assert.equal(operation("build").length, 1);
  assert.equal(operation("create").length, 0);
  assert.equal(operation("rollback").length, 1);
  assert.deepEqual(persisted, []);
});

test("strategy report generation becomes available at the exact cooldown boundary and preserves the caller's optional date", async () => {
  const previous = "2026-09-09T12:00:00.000Z";
  latest = { createdAt: new Date(previous) };
  assert.deepEqual(cioStrategyReportNextAvailableAt(previous), now);
  assert.equal(isCioStrategyReportOnCooldown(previous), false);
  assert.equal(isCioStrategyReportOnCooldown("2026-09-09T12:00:00.001Z"), true);
  await repository.createCioStrategyReport(scope);
  assert.equal(operation("build")[0].args.asOfDate, undefined);
  assert.ok(operation("findFirst").every(({ args }) => args.where.workspaceId === "household"));
});

test("strategy report serialization conflicts retry at most three transactions while building only once", async () => {
  failures = [conflict(), conflict()];
  const result = await repository.createCioStrategyReport(scope);
  assert.equal(result.id, "report");
  assert.equal(operation("begin").length, 3);
  assert.equal(operation("rollback").length, 2);
  assert.equal(operation("commit").length, 1);
  assert.equal(operation("build").length, 1);
  assert.equal(operation("audit").length, 1);
  assert.equal(persisted.length, 2);
});

test("strategy report retries stop after the third conflict without leaving a partial report", async () => {
  const finalConflict = conflict();
  failures = [conflict(), conflict(), finalConflict];
  await assert.rejects(repository.createCioStrategyReport(scope), (error) => error === finalConflict);
  assert.equal(operation("begin").length, 3);
  assert.equal(operation("build").length, 1);
  assert.equal(operation("audit").length, 0);
  assert.deepEqual(persisted, []);
});

test("strategy report persistence does not retry unrelated database or audit failures", async () => {
  const uniqueFailure = conflict("P2002");
  failures = [uniqueFailure];
  await assert.rejects(repository.createCioStrategyReport(scope), (error) => error === uniqueFailure);
  assert.equal(operation("begin").length, 1);
  auditFailure = new Error("Audit store unavailable");
  await assert.rejects(repository.createCioStrategyReport(scope), (error) => error === auditFailure);
  assert.equal(operation("begin").length, 2);
  assert.equal(operation("commit").length, 0);
  assert.deepEqual(persisted, []);
});

test("strategy report build failures never open a write transaction", async () => {
  buildFailure = new Error("Snapshot unavailable");
  await assert.rejects(repository.createCioStrategyReport(scope), (error) => error === buildFailure);
  assert.equal(operation("begin").length, 0);
  assert.deepEqual(persisted, []);
});

test("strategy report lists are bounded, workspace scoped, and summarize only the first three recommendations", async () => {
  report.recommendations = Array.from({ length: 4 }, (_, index) => ({ id: `setup-${index}`, code: "COMPLETE_CIO_SETUP", category: "DATA_QUALITY", severity: "HIGH", priority: 10, title: `Set up assumption ${index}`, action: "Review the missing household assumption.", rationale: "A confirmed assumption is required.", scopeKey: null, current: null, target: null, annualChangeCents: null, evidenceIds: [], requiresUserConfirmation: true }));
  records = [{ id: "report", reportJson: JSON.stringify(report) }];
  for (const [take, expected] of [[undefined, 20], [0, 1], [1.9, 1], [100, 50]]) {
    const result = await repository.listCioStrategyReports("household", take);
    assert.equal(result[0].recommendationCount, 4);
    assert.deepEqual(result[0].topRecommendations, report.recommendations.slice(0, 3));
    const query = operation("findMany").at(-1).args;
    assert.deepEqual(query, { where: { workspaceId: "household" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: expected, select: { id: true, reportJson: true } });
  }
});

test("strategy report reads verify workspace ownership and reject corrupt or incompatible stored models", async () => {
  await assert.rejects(repository.getCioStrategyReport("household", "foreign"), (error) => error instanceof ApiRequestError && error.status === 404);
  stored = { id: "report", contentHash: "hash", reportJson: JSON.stringify(report) };
  assert.deepEqual(await repository.getCioStrategyReport("household", "report"), { id: "report", contentHash: "hash", report });
  assert.deepEqual(operation("findFirst").at(-1).args.where, { id: "report", workspaceId: "household" });
  for (const invalid of ["{", "{}", JSON.stringify({ ...report, schemaVersion: "2.0" })]) {
    stored = { ...stored, reportJson: invalid };
    records = [stored];
    for (const read of [() => repository.getCioStrategyReport("household", "report"), () => repository.listCioStrategyReports("household")]) {
      await assert.rejects(read, (error) => error instanceof ApiRequestError && error.status === 500 && error.message === "The stored CIO strategy report is invalid");
    }
  }
});
