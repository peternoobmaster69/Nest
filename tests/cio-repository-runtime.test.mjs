import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";
import { Prisma } from "@prisma/client";

const require = createRequire(import.meta.url);
const scope = { workspaceId: "household", actorUserId: "editor" };
const now = new Date("2026-10-09T12:00:00Z");
const calls = [];
const persisted = [];
let fixtures;
const models = ["workspace", "workspaceAuditLog", "financialAccount", "budgetEnvelope", "investmentAccount", "cioHouseholdProfile", "cioInvestmentPolicy", "cioPolicyAssetClassBand", "cioPolicyGeographyLimit", "cioInvestmentProfile", "cioInvestmentExposure", "cioRecurringFlow", "cioPlanningPosition"];
const methods = ["findFirst", "findUnique", "findUniqueOrThrow", "findMany", "count", "upsert", "create", "createMany", "update", "deleteMany"];
const writeMethods = new Set(["upsert", "create", "createMany", "update", "deleteMany"]);
function databaseCall(model, method) {
  const operation = `${model}.${method}`;
  return async (args) => {
    calls.push({ operation, args });
    assert.ok(fixtures.has(operation), `Unexpected database operation: ${operation}`);
    const fixture = fixtures.get(operation);
    if (fixture instanceof Error) throw fixture;
    const result = typeof fixture === "function" ? await fixture(args) : fixture;
    if (writeMethods.has(method)) persisted.push({ operation, args, result });
    return result;
  };
}
const tx = Object.fromEntries(models.map((model) => [model, Object.fromEntries(methods.map((method) => [method, databaseCall(model, method)]))]));
const prisma = { ...tx, $transaction: async (operation, options) => {
  const checkpoint = persisted.length;
  calls.push({ operation: "begin", args: options });
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
const repository = require("../lib/domains/cio/repository.ts");
const { ApiRequestError } = require("../lib/api/contracts.ts");
const { ZodError } = require("zod");
const contracts = require("../lib/domains/cio/contracts.ts");
const op = (name) => calls.filter(({ operation }) => operation === name);
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  calls.length = 0;
  persisted.length = 0;
  fixtures = new Map();
  for (const model of models) {
    for (const method of ["findFirst", "findUnique"]) fixtures.set(`${model}.${method}`, null);
    fixtures.set(`${model}.findMany`, []);
    fixtures.set(`${model}.count`, 0);
    fixtures.set(`${model}.create`, ({ data }) => ({ id: "record", ...data }));
    fixtures.set(`${model}.update`, ({ where, data }) => ({ id: where.id, ...data }));
    fixtures.set(`${model}.upsert`, ({ create }) => ({ id: "record", ...create }));
    fixtures.set(`${model}.createMany`, ({ data }) => ({ count: data.length }));
    fixtures.set(`${model}.deleteMany`, { count: 1 });
  }
  fixtures.set("workspace.findUnique", { id: "household", baseCurrency: "SGD" });
  fixtures.set("investmentAccount.findFirst", ({ where }) => ({ id: where.id }));
  fixtures.set("financialAccount.findFirst", ({ where }) => ({ id: where.id }));
  fixtures.set("cioInvestmentPolicy.findUniqueOrThrow", { id: "record", workspaceId: "household", assetClassBands: [], geographyLimits: [] });
});
function audit(action) {
  const writes = op("workspaceAuditLog.create");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].args.data.workspaceId, "household");
  assert.equal(writes[0].args.data.actorUserId, "editor");
  assert.equal(writes[0].args.data.action, action);
  assert.match(writes[0].args.data.details, /configuration updated\./);
  assert.deepEqual(op("begin")[0].args, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  assert.equal(op("commit").length, 1);
}
async function rejectsApi(operation, status, message) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, status);
    assert.match(error.message, message);
    return true;
  });
}
const profile = (overrides = {}) => ({ planningScope: "INDIVIDUAL", primaryBirthDate: null, primaryCurrentAge: null, primaryAgeAsOfDate: null, partnerBirthDate: null, targetRetirementAge: null, targetRetirementDate: null, bearReturnBps: null, baseReturnBps: null, bullReturnBps: null, ...overrides });
const investmentInput = { liquidityClass: "LIQUID", portfolioRole: "CORE", riskLevel: "MODERATE", includeInRetirementProjection: true, classificationStatus: "USER_CONFIRMED", classificationSource: "USER" };
const flowInput = { type: "EXTERNAL_CONTRIBUTION", amountCents: 100, cadence: "MONTHLY", startsOn: "2026-01-01T00:00:00.000Z", includeInRetirementProjection: true, label: "Savings" };
const flowRecord = (overrides = {}) => ({ id: "flow", workspaceId: "household", ...flowInput, sourceFinancialAccountId: null, sourceInvestmentAccountId: null, destinationInvestmentAccountId: null, startsOn: new Date(flowInput.startsOn), endsOn: null, notes: null, ...overrides });
const positionInput = { side: "ASSET", category: "PROPERTY", label: "Home", currentValueCents: 1_000, asOfDate: "2026-10-09T00:00:00.000Z", liquidityClass: "LOCKED", includeInInvestableAllocation: false, includeInRetirementProjection: false };
const positionRecord = (overrides = {}) => ({ id: "position", workspaceId: "household", ...positionInput, asOfDate: new Date(positionInput.asOfDate), notes: null, ...overrides });

test("CIO repository reads are workspace scoped and lists have stable ordering and bounds", async () => {
  await repository.getCioProfile("household");
  await repository.getCioPolicy("household");
  await repository.listCioRecurringFlows("household");
  await repository.listCioPlanningPositions("household");
  assert.ok(calls.every(({ args }) => args.where.workspaceId === "household"));
  assert.deepEqual(op("cioRecurringFlow.findMany")[0].args.orderBy, [{ startsOn: "asc" }, { createdAt: "asc" }, { id: "asc" }]);
  assert.deepEqual(op("cioPlanningPosition.findMany")[0].args.orderBy, [{ asOfDate: "desc" }, { createdAt: "asc" }, { id: "asc" }]);
  assert.equal(op("cioRecurringFlow.findMany")[0].args.take, 500);
  assert.equal(op("cioPlanningPosition.findMany")[0].args.take, 500);
  assert.deepEqual(op("cioInvestmentPolicy.findUnique")[0].args.include.assetClassBands.orderBy, { assetClass: "asc" });
});

test("profile creation defaults to individual planning and audits a serializable write", async () => {
  const result = await repository.upsertCioProfile({ ...scope, data: {} });
  assert.equal(result.planningScope, "INDIVIDUAL");
  const write = op("cioHouseholdProfile.upsert")[0].args;
  assert.deepEqual(write.where, { workspaceId: "household" });
  assert.equal(write.create.workspaceId, "household");
  assert.equal(write.update.primaryBirthDate, undefined);
  audit("CIO_PROFILE_UPDATED");
});

test("profile creation infers household planning from a partner and stores explicit dates and rates", async () => {
  const input = { primaryBirthDate: "1980-01-01T00:00:00.000Z", partnerBirthDate: "1982-01-01T00:00:00.000Z", targetRetirementDate: "2045-01-01T00:00:00.000Z", bearReturnBps: 0, baseReturnBps: 500, bullReturnBps: 800 };
  const result = await repository.upsertCioProfile({ ...scope, data: input });
  assert.equal(result.planningScope, "HOUSEHOLD");
  assert.deepEqual(result.primaryBirthDate, new Date(input.primaryBirthDate));
  assert.deepEqual(result.targetRetirementDate, new Date(input.targetRetirementDate));
  assert.equal(result.bullReturnBps, 800);
  audit("CIO_PROFILE_UPDATED");
});

test("profile patches preserve stored assumptions and explicit nulls allow changing from birth-date to current-age planning", async () => {
  fixtures.set("cioHouseholdProfile.findUnique", profile({ planningScope: "HOUSEHOLD", primaryBirthDate: new Date("1980-01-01"), partnerBirthDate: new Date("1982-01-01"), targetRetirementDate: new Date("2045-01-01"), bearReturnBps: 0, baseReturnBps: 500, bullReturnBps: 800 }));
  await repository.upsertCioProfile({ ...scope, data: { essentialMonthlySpendingCents: 200 } });
  assert.equal(op("cioHouseholdProfile.upsert")[0].args.update.planningScope, "HOUSEHOLD");
  const input = { planningScope: "INDIVIDUAL", primaryBirthDate: null, partnerBirthDate: null, targetRetirementDate: null, primaryCurrentAge: 46, primaryAgeAsOfDate: now.toISOString(), targetRetirementAge: 65, bearReturnBps: null, baseReturnBps: null, bullReturnBps: null };
  await repository.upsertCioProfile({ ...scope, data: input });
  const saved = op("cioHouseholdProfile.upsert")[1].args.update;
  assert.equal(saved.primaryBirthDate, null);
  assert.equal(saved.partnerBirthDate, null);
  assert.equal(saved.targetRetirementDate, null);
  assert.equal(saved.primaryCurrentAge, 46);
  assert.deepEqual(saved.primaryAgeAsOfDate, now);
  fixtures.set("cioHouseholdProfile.findUnique", profile({ primaryCurrentAge: 46, primaryAgeAsOfDate: now, targetRetirementAge: 65 }));
  await repository.upsertCioProfile({ ...scope, data: { essentialMonthlySpendingCents: 0 } });
  await repository.upsertCioProfile({ ...scope, data: { primaryCurrentAge: null, primaryAgeAsOfDate: null, targetRetirementAge: null } });
  assert.equal(op("cioHouseholdProfile.upsert").at(-1).args.update.primaryAgeAsOfDate, null);
});

test("profile partial edits validate their merged state before writing or auditing", async () => {
  const cases = [
    [profile({ planningScope: "UNKNOWN" }), {}, /Planning scope/],
    [profile({ planningScope: "HOUSEHOLD", partnerBirthDate: now }), { planningScope: "INDIVIDUAL" }, /Partner birth date/],
    [profile({ primaryBirthDate: new Date("1980-01-01") }), { primaryCurrentAge: 46 }, /either primary birth date/],
    [profile(), { primaryCurrentAge: 46 }, /configured together/],
    [profile({ primaryAgeAsOfDate: now }), {}, /configured together/],
    [profile({ targetRetirementAge: 65 }), { targetRetirementDate: "2045-01-01T00:00:00.000Z" }, /either target retirement age/],
    [profile({ bearReturnBps: 500 }), { baseReturnBps: 400 }, /Bear return/],
    [profile({ baseReturnBps: 500 }), { bullReturnBps: 400 }, /Bull return/],
  ];
  for (const [existing, data, error] of cases) {
    fixtures.set("cioHouseholdProfile.findUnique", existing);
    await rejectsApi(() => repository.upsertCioProfile({ ...scope, data }), 422, error);
  }
  assert.equal(op("cioHouseholdProfile.upsert").length, 0);
  assert.deepEqual(persisted, []);
});

test("policy confirmation uses the server clock while omission and null preserve their distinct meanings", async () => {
  for (const [data, expected] of [[{}, undefined], [{ confirmedAt: null }, null], [{ confirmedAt: "2000-01-01T00:00:00.000Z" }, now]]) {
    await repository.upsertCioPolicy({ ...scope, data });
    assert.deepEqual(op("cioInvestmentPolicy.upsert").at(-1).args.update.confirmedAt, expected);
  }
  assert.equal(op("cioPolicyAssetClassBand.deleteMany").length, 0);
  assert.equal(op("cioPolicyGeographyLimit.deleteMany").length, 0);
});

test("policy replacement scopes child rows to their workspace and supports clearing both constraint lists", async () => {
  const data = { assetClassBands: [{ assetClass: "EQUITY", minimumBps: 1_000, targetBps: 5_000, maximumBps: 9_000 }], geographyLimits: [{ geography: "SINGAPORE", maximumBps: 9_000 }] };
  await repository.upsertCioPolicy({ ...scope, data });
  for (const [model, key] of [["cioPolicyAssetClassBand", "assetClassBands"], ["cioPolicyGeographyLimit", "geographyLimits"]]) {
    assert.deepEqual(op(`${model}.deleteMany`)[0].args.where, { policyId: "record", workspaceId: "household" });
    assert.deepEqual(op(`${model}.createMany`)[0].args.data, data[key].map((row) => ({ ...row, workspaceId: "household", policyId: "record" })));
  }
  audit("CIO_POLICY_UPDATED");
  await repository.upsertCioPolicy({ ...scope, data: { assetClassBands: [], geographyLimits: [] } });
  assert.equal(op("cioPolicyAssetClassBand.deleteMany").length, 2);
  assert.equal(op("cioPolicyAssetClassBand.createMany").length, 1);
  assert.equal(op("cioPolicyGeographyLimit.deleteMany").length, 2);
  assert.equal(op("cioPolicyGeographyLimit.createMany").length, 1);
});

test("configuration writes and child replacement roll back when their audit record cannot be stored", async () => {
  fixtures.set("workspaceAuditLog.create", new Error("Audit unavailable"));
  await assert.rejects(repository.upsertCioProfile({ ...scope, data: {} }), /Audit unavailable/);
  await assert.rejects(repository.upsertCioPolicy({ ...scope, data: { assetClassBands: [] } }), /Audit unavailable/);
  assert.equal(op("rollback").length, 2);
  assert.equal(op("commit").length, 0);
  assert.deepEqual(persisted, []);
});

test("investment classification and exposure reads verify ownership before touching CIO records", async () => {
  const params = { workspaceId: "household", investmentAccountId: "fund" };
  await repository.getCioInvestmentProfile(params);
  await repository.getCioInvestmentExposures(params);
  assert.ok(op("investmentAccount.findFirst").every(({ args }) => args.where.id === "fund" && args.where.workspaceId === "household"));
  assert.deepEqual(op("cioInvestmentProfile.findFirst")[0].args.where, params);
  assert.deepEqual(op("cioInvestmentExposure.findMany")[0].args, { where: params, orderBy: [{ dimension: "asc" }, { exposureKey: "asc" }], take: 100 });
  fixtures.set("investmentAccount.findFirst", null);
  await rejectsApi(() => repository.getCioInvestmentProfile(params), 404, /Investment account not found/);
  await rejectsApi(() => repository.upsertCioInvestmentProfile({ ...scope, ...params, data: investmentInput }), 404, /Investment account not found/);
  assert.equal(op("cioInvestmentProfile.upsert").length, 0);
});

test("investment profiles preserve lock-date omission, explicit removal and a configured lock", async () => {
  for (const [data, expected] of [[investmentInput, undefined], [{ ...investmentInput, lockUntil: null }, null], [{ ...investmentInput, liquidityClass: "LOCKED", lockUntil: "2030-01-01T00:00:00.000Z" }, new Date("2030-01-01")]]) {
    await repository.upsertCioInvestmentProfile({ ...scope, investmentAccountId: "fund", data });
    const write = op("cioInvestmentProfile.upsert").at(-1).args;
    assert.deepEqual(write.where, { investmentAccountId: "fund" });
    assert.equal(write.create.workspaceId, "household");
    assert.deepEqual(write.update.lockUntil, expected);
  }
});

test("exposure replacement preserves each dimension's total and rejects inconsistent persisted totals atomically", async () => {
  const data = { exposures: [{ dimension: "ASSET_CLASS", key: "EQUITY", weightBps: 6_000 }, { dimension: "ASSET_CLASS", key: "CASH", weightBps: 4_000 }, { dimension: "GEOGRAPHY", key: "GLOBAL", weightBps: 10_000 }] };
  const rows = data.exposures.map(({ key, ...row }) => ({ ...row, exposureKey: key, workspaceId: "household", investmentAccountId: "fund" }));
  fixtures.set("cioInvestmentExposure.findMany", rows);
  const result = await repository.replaceCioInvestmentExposures({ ...scope, investmentAccountId: "fund", data });
  assert.deepEqual(result, rows);
  assert.deepEqual(op("cioInvestmentExposure.createMany")[0].args.data, rows);
  audit("CIO_INVESTMENT_EXPOSURES_REPLACED");
  const checkpoint = persisted.length;
  fixtures.set("cioInvestmentExposure.findMany", [{ ...rows[0], weightBps: 3_000 }]);
  await rejectsApi(() => repository.replaceCioInvestmentExposures({ ...scope, investmentAccountId: "fund", data }), 422, /Every configured exposure dimension/);
  assert.equal(persisted.length, checkpoint);
  fixtures.set("cioInvestmentExposure.findMany", []);
  await repository.replaceCioInvestmentExposures({ ...scope, investmentAccountId: "fund", data: { exposures: [] } });
  assert.equal(op("cioInvestmentExposure.createMany").length, 2);
  assert.equal(op("cioInvestmentExposure.deleteMany").length, 3);
});

test("recurring flow creation enforces the workspace limit and records defaults in a serializable audited transaction", async () => {
  fixtures.set("cioRecurringFlow.count", 499);
  const result = await repository.createCioRecurringFlow({ ...scope, data: flowInput });
  assert.deepEqual(result, { ...flowRecord(), id: "record" });
  assert.deepEqual(op("cioRecurringFlow.count")[0].args.where, { workspaceId: "household" });
  audit("CIO_RECURRING_FLOW_CREATED");
  fixtures.set("cioRecurringFlow.count", 500);
  await rejectsApi(() => repository.createCioRecurringFlow({ ...scope, data: flowInput }), 422, /at most 500 recurring flows/);
  assert.equal(op("cioRecurringFlow.create").length, 1);
});

test("recurring flow references must exist in the same workspace before a create can commit", async () => {
  const data = { ...flowInput, type: "INTERNAL_REALLOCATION", sourceFinancialAccountId: "bank", destinationInvestmentAccountId: "fund", endsOn: "2028-01-01T00:00:00.000Z", notes: "Monthly transfer" };
  await repository.createCioRecurringFlow({ ...scope, data });
  assert.deepEqual(op("financialAccount.findFirst")[0].args, { where: { id: "bank", workspaceId: "household" }, select: { id: true } });
  assert.deepEqual(op("investmentAccount.findFirst")[0].args.where, { id: "fund", workspaceId: "household" });
  assert.deepEqual(op("cioRecurringFlow.create")[0].args.data.endsOn, new Date(data.endsOn));
  assert.equal(op("cioRecurringFlow.create")[0].args.data.notes, "Monthly transfer");
  fixtures.set("financialAccount.findFirst", null);
  await rejectsApi(() => repository.createCioRecurringFlow({ ...scope, data }), 404, /Source financial account not found/);
  fixtures.set("investmentAccount.findFirst", null);
  const withdrawal = { ...flowInput, type: "EXTERNAL_WITHDRAWAL", sourceInvestmentAccountId: "foreign" };
  await rejectsApi(() => repository.createCioRecurringFlow({ ...scope, data: withdrawal }), 404, /Investment account not found/);
  assert.equal(op("cioRecurringFlow.create").length, 1);
});

test("recurring flow partial updates preserve old fields and explicit nulls clear optional values", async () => {
  fixtures.set("cioRecurringFlow.findFirst", flowRecord({ endsOn: new Date("2028-01-01"), notes: "Existing note" }));
  await repository.updateCioRecurringFlow({ ...scope, id: "flow", data: { amountCents: 200 } });
  assert.deepEqual(op("cioRecurringFlow.findFirst")[0].args.where, { id: "flow", workspaceId: "household" });
  const first = op("cioRecurringFlow.update")[0].args;
  assert.deepEqual(first.where, { id: "flow" });
  assert.equal(first.data.type, "EXTERNAL_CONTRIBUTION");
  assert.equal(first.data.notes, "Existing note");
  assert.deepEqual(first.data.endsOn, new Date("2028-01-01"));
  const patch = { type: "INTERNAL_REALLOCATION", sourceFinancialAccountId: null, sourceInvestmentAccountId: "fund-source", destinationInvestmentAccountId: "fund-target", amountCents: 300, cadence: "ANNUAL", startsOn: "2027-01-01T00:00:00.000Z", endsOn: null, includeInRetirementProjection: false, label: "Reallocation", notes: null };
  await repository.updateCioRecurringFlow({ ...scope, id: "flow", data: patch });
  assert.deepEqual(op("cioRecurringFlow.update")[1].args.data, { workspaceId: "household", ...patch, startsOn: new Date(patch.startsOn) });
  assert.deepEqual(op("investmentAccount.findFirst").map(({ args }) => args.where), [{ id: "fund-source", workspaceId: "household" }, { id: "fund-target", workspaceId: "household" }]);
  fixtures.set("cioRecurringFlow.findFirst", flowRecord());
  await repository.updateCioRecurringFlow({ ...scope, id: "flow", data: { label: "Edited" } });
  assert.equal(op("cioRecurringFlow.update")[2].args.data.endsOn, null);
});

test("recurring flow changes revalidate merged references and deletions enforce ownership before auditing", async () => {
  await rejectsApi(() => repository.updateCioRecurringFlow({ ...scope, id: "foreign", data: { amountCents: 200 } }), 404, /Recurring flow not found/);
  fixtures.set("cioRecurringFlow.findFirst", flowRecord({ type: "INTERNAL_REALLOCATION", sourceFinancialAccountId: "bank", destinationInvestmentAccountId: "fund" }));
  await assert.rejects(repository.updateCioRecurringFlow({ ...scope, id: "flow", data: { type: "EXTERNAL_CONTRIBUTION" } }), ZodError);
  assert.equal(op("cioRecurringFlow.update").length, 0);
  fixtures.set("cioRecurringFlow.deleteMany", { count: 0 });
  await rejectsApi(() => repository.deleteCioRecurringFlow({ ...scope, id: "foreign" }), 404, /Recurring flow not found/);
  assert.equal(op("workspaceAuditLog.create").length, 0);
  fixtures.set("cioRecurringFlow.deleteMany", { count: 1 });
  assert.deepEqual(await repository.deleteCioRecurringFlow({ ...scope, id: "flow" }), { id: "flow" });
  assert.deepEqual(op("cioRecurringFlow.deleteMany").at(-1).args.where, { id: "flow", workspaceId: "household" });
  assert.equal(op("workspaceAuditLog.create")[0].args.data.action, "CIO_RECURRING_FLOW_DELETED");
});

test("planning position creation applies defaults and protects the workspace record limit", async () => {
  fixtures.set("cioPlanningPosition.count", 499);
  const result = await repository.createCioPlanningPosition({ ...scope, data: positionInput });
  assert.deepEqual(result, { ...positionRecord(), id: "record" });
  audit("CIO_PLANNING_POSITION_CREATED");
  fixtures.set("cioPlanningPosition.count", 500);
  await rejectsApi(() => repository.createCioPlanningPosition({ ...scope, data: positionInput }), 422, /at most 500 planning positions/);
  assert.equal(op("cioPlanningPosition.create").length, 1);
});

test("planning position patches preserve omitted fields and accept explicit zero values, false flags and null notes", async () => {
  fixtures.set("cioPlanningPosition.findFirst", positionRecord({ notes: "Existing note" }));
  await repository.updateCioPlanningPosition({ ...scope, id: "position", data: { label: "Edited" } });
  assert.deepEqual(op("cioPlanningPosition.update")[0].args, { where: { id: "position" }, data: { ...positionInput, workspaceId: "household", label: "Edited", asOfDate: new Date(positionInput.asOfDate), notes: "Existing note" } });
  const patch = { ...positionInput, side: "LIABILITY", category: "MORTGAGE", label: "Loan", currentValueCents: 0, asOfDate: "2026-10-08T00:00:00.000Z", liquidityClass: "RESTRICTED", notes: null };
  await repository.updateCioPlanningPosition({ ...scope, id: "position", data: patch });
  assert.deepEqual(op("cioPlanningPosition.update")[1].args.data, { ...patch, workspaceId: "household", asOfDate: new Date(patch.asOfDate) });
  assert.deepEqual(op("cioPlanningPosition.findFirst")[0].args.where, { id: "position", workspaceId: "household" });
});

test("planning position changes cannot turn included assets into liabilities or modify another workspace's records", async () => {
  await rejectsApi(() => repository.updateCioPlanningPosition({ ...scope, id: "foreign", data: { label: "Changed" } }), 404, /Planning position not found/);
  fixtures.set("cioPlanningPosition.findFirst", positionRecord({ includeInRetirementProjection: true }));
  await assert.rejects(repository.updateCioPlanningPosition({ ...scope, id: "position", data: { side: "LIABILITY" } }), ZodError);
  assert.equal(op("cioPlanningPosition.update").length, 0);
  fixtures.set("cioPlanningPosition.deleteMany", { count: 0 });
  await rejectsApi(() => repository.deleteCioPlanningPosition({ ...scope, id: "foreign" }), 404, /Planning position not found/);
  assert.equal(op("workspaceAuditLog.create").length, 0);
  fixtures.set("cioPlanningPosition.deleteMany", { count: 1 });
  assert.deepEqual(await repository.deleteCioPlanningPosition({ ...scope, id: "position" }), { id: "position" });
  assert.deepEqual(op("cioPlanningPosition.deleteMany").at(-1).args.where, { id: "position", workspaceId: "household" });
  assert.equal(op("workspaceAuditLog.create")[0].args.data.action, "CIO_PLANNING_POSITION_DELETED");
});

test("CIO snapshot reads use UTC day boundaries, exclude newer balances and expose truncation", async () => {
  const boundedRows = Array.from({ length: 501 }, (_, index) => ({ id: String(index), updatedAt: new Date("2026-10-09T23:59:59.999Z") }));
  const afterDay = { id: "later", updatedAt: new Date("2026-10-10T00:00:00Z") };
  fixtures.set("financialAccount.findMany", [...boundedRows, afterDay]);
  fixtures.set("budgetEnvelope.findMany", [...boundedRows, afterDay]);
  for (const model of ["investmentAccount", "cioPlanningPosition", "cioRecurringFlow"]) fixtures.set(`${model}.findMany`, boundedRows);
  const result = await repository.loadCioSnapshotData({ workspaceId: "household", asOfDate: now });
  assert.deepEqual(result.truncated, { bankControls: true, savingsSubAccounts: true, investments: true, planningPositions: true, recurringFlows: true });
  assert.equal(result.bankControlCount, 502);
  assert.equal(result.bankControlsAfterAsOfCount, 1);
  assert.equal(result.savingsSubAccountsAfterAsOfCount, 1);
  for (const key of ["bankControls", "savingsSubAccounts", "investments", "planningPositions", "recurringFlows"]) assert.equal(result[key].length, 500);
  assert.ok(result.bankControls.every(({ id }) => id !== "later"));
  const investmentsQuery = op("investmentAccount.findMany")[0].args;
  assert.deepEqual(investmentsQuery.where, { workspaceId: "household", inceptionDate: { lt: new Date("2026-10-10") } });
  assert.deepEqual(investmentsQuery.select.entries.where, { date: { lt: new Date("2026-10-10") } });
  assert.equal(investmentsQuery.select.entries.take, 5_000);
  assert.deepEqual(op("cioRecurringFlow.findMany")[0].args.where, { workspaceId: "household", startsOn: { lt: new Date("2026-10-10") }, OR: [{ endsOn: null }, { endsOn: { gte: new Date("2026-10-09") } }] });
  fixtures.set("workspace.findUnique", null);
  await rejectsApi(() => repository.loadCioSnapshotData({ workspaceId: "household", asOfDate: now }), 404, /Workspace not found/);
});

test("CIO mutations validate input before starting a transaction and reuse an existing transaction client", async () => {
  const operations = [
    () => repository.upsertCioProfile({ ...scope, data: { unexpected: true } }),
    () => repository.upsertCioPolicy({ ...scope, data: { unexpected: true } }),
    () => repository.upsertCioInvestmentProfile({ ...scope, investmentAccountId: "fund", data: {} }),
    () => repository.replaceCioInvestmentExposures({ ...scope, investmentAccountId: "fund", data: { exposures: [{ dimension: "SECURITY", key: "ABC", weightBps: 9_000 }] } }),
    () => repository.createCioRecurringFlow({ ...scope, data: {} }),
    () => repository.updateCioRecurringFlow({ ...scope, id: "flow", data: {} }),
    () => repository.createCioPlanningPosition({ ...scope, data: {} }),
    () => repository.updateCioPlanningPosition({ ...scope, id: "position", data: {} }),
  ];
  for (const operation of operations) await assert.rejects(operation, ZodError);
  assert.deepEqual(calls, []);
  await repository.upsertCioProfile({ ...scope, data: {} }, tx);
  assert.equal(op("begin").length, 0);
  assert.equal(op("cioHouseholdProfile.upsert").length, 1);
});

function schemaRejects(schema, input, issuePath) {
  const result = schema.safeParse(input);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => JSON.stringify(issue.path) === JSON.stringify(issuePath)), JSON.stringify(result.error.issues));
}

test("CIO profile and projection schemas reject contradictory dates and return assumptions", () => {
  for (const [input, field] of [
    [{ primaryCurrentAge: 46, primaryAgeAsOfDate: null }, "primaryAgeAsOfDate"],
    [{ targetRetirementAge: 65, targetRetirementDate: "2045-01-01T00:00:00.000Z" }, "targetRetirementDate"],
    [{ bearReturnBps: 500, baseReturnBps: 400 }, "bearReturnBps"],
    [{ baseReturnBps: 500, bullReturnBps: 400 }, "bullReturnBps"],
  ]) schemaRejects(contracts.CioProfileInputSchema, input, [field]);
  for (const [input, field] of [[{ bearReturnBps: 500, baseReturnBps: 400 }, "bearReturnBps"], [{ baseReturnBps: 500, bullReturnBps: 400 }, "bullReturnBps"]]) {
    schemaRejects(contracts.CioRetirementProjectionInputSchema, input, [field]);
  }
  for (const input of [{ bearReturnBps: 0 }, { baseReturnBps: 0 }, { bearReturnBps: 0, baseReturnBps: 500, bullReturnBps: 800 }]) {
    assert.equal(contracts.CioRetirementProjectionInputSchema.safeParse(input).success, true);
  }
});

test("CIO policy schemas reject unordered asset bands and duplicate asset or geography constraints", () => {
  const band = { assetClass: "EQUITY", minimumBps: 1_000, targetBps: 5_000, maximumBps: 9_000 };
  for (const invalid of [{ ...band, minimumBps: 6_000 }, { ...band, maximumBps: 4_000 }]) {
    schemaRejects(contracts.CioPolicyInputSchema, { assetClassBands: [invalid] }, ["assetClassBands", 0, "targetBps"]);
  }
  schemaRejects(contracts.CioPolicyInputSchema, { assetClassBands: [band, band] }, ["assetClassBands", 1, "assetClass"]);
  const geography = { geography: "SINGAPORE", maximumBps: 9_000 };
  schemaRejects(contracts.CioPolicyInputSchema, { geographyLimits: [geography, geography] }, ["geographyLimits", 1, "geography"]);
});

test("CIO classifications reject unlocked lock dates and unsupported exposure keys", () => {
  schemaRejects(contracts.CioInvestmentProfileInputSchema, { ...investmentInput, lockUntil: "2030-01-01T00:00:00.000Z" }, ["lockUntil"]);
  for (const [dimension, key] of [["ASSET_CLASS", "MAGIC"], ["GEOGRAPHY", "MOON"], ["SECURITY", "not a ticker"]]) {
    schemaRejects(contracts.CioExposuresInputSchema, { exposures: [{ dimension, key, weightBps: 10_000 }] }, ["exposures", 0, "key"]);
  }
});

test("CIO flow contracts reject reversed calendar ranges and multiple existing sources", () => {
  schemaRejects(contracts.CioRecurringFlowCreateSchema, { ...flowInput, endsOn: "2025-12-31T00:00:00.000Z" }, ["endsOn"]);
  schemaRejects(contracts.CioRecurringFlowCreateSchema, { ...flowInput, type: "INTERNAL_REALLOCATION", sourceFinancialAccountId: "bank", sourceInvestmentAccountId: "source", destinationInvestmentAccountId: "target" }, ["sourceInvestmentAccountId"]);
});
