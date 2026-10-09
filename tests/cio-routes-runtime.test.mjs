import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const calls = [];
const accessChecks = [];
let responses;
let accessError;
class ApiAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
mock.module("../lib/workspace-auth.ts", { namedExports: {
  ApiAuthError,
  requireWorkspaceAccess: async (...args) => {
    accessChecks.push(args);
    if (accessError) throw accessError;
    return { workspaceId: "household", userId: "editor", role: "EDITOR" };
  },
  requireRecentAuthentication: async () => { throw new Error("Unexpected recent-authentication check"); },
} });
mock.module("../lib/prisma.ts", { namedExports: { prisma: new Proxy({}, { get() { throw new Error("Route tests must use their service fixtures"); } }) } });
mock.module("../lib/observability/logger.ts", { namedExports: { logEvent() {} } });
function service(name) {
  return async (...args) => {
    calls.push({ name, args });
    assert.ok(responses.has(name), `Unexpected service call: ${name}`);
    const value = responses.get(name);
    if (value instanceof Error) throw value;
    return value;
  };
}
const repositoryMethods = ["getCioProfile", "upsertCioProfile", "getCioPolicy", "upsertCioPolicy", "getCioInvestmentProfile", "upsertCioInvestmentProfile", "getCioInvestmentExposures", "replaceCioInvestmentExposures", "listCioRecurringFlows", "createCioRecurringFlow", "updateCioRecurringFlow", "deleteCioRecurringFlow", "listCioPlanningPositions", "createCioPlanningPosition", "updateCioPlanningPosition", "deleteCioPlanningPosition"];
mock.module("../lib/domains/cio/repository.ts", { namedExports: Object.fromEntries(repositoryMethods.map((name) => [name, service(name)])) });
mock.module("../lib/domains/cio/snapshot-service.ts", { namedExports: { buildCioSnapshot: service("buildCioSnapshot"), runWorkspaceRetirementProjection: service("runWorkspaceRetirementProjection") } });
mock.module("../lib/domains/cio/report-repository.ts", { namedExports: Object.fromEntries(["createCioStrategyReport", "listCioStrategyReports", "getCioStrategyReport"].map((name) => [name, service(name)])) });
mock.module("../lib/domains/cio/strategy-report-pdf.tsx", { namedExports: { renderCioStrategyReportPdf: service("renderCioStrategyReportPdf") } });
const { ApiRequestError } = require("../lib/api/contracts.ts");
const record = { id: "record", workspaceId: "household", label: "Household plan" };
const policyRecord = { ...record, assetClassBands: [{ workspaceId: "household", policyId: "record", assetClass: "EQUITY", minimumBps: 0, targetBps: 5_000, maximumBps: 10_000 }], geographyLimits: [{ workspaceId: "household", policyId: "record", geography: "SINGAPORE", maximumBps: 10_000 }] };
const publicRecord = { id: "record", label: "Household plan" };
const publicPolicy = { ...publicRecord, assetClassBands: [{ assetClass: "EQUITY", minimumBps: 0, targetBps: 5_000, maximumBps: 10_000 }], geographyLimits: [{ geography: "SINGAPORE", maximumBps: 10_000 }] };
const exposures = [{ workspaceId: "household", investmentAccountId: "investment", dimension: "SECURITY", exposureKey: "ABC", weightBps: 10_000 }];
const publicExposures = [{ investmentAccountId: "investment", dimension: "SECURITY", key: "ABC", weightBps: 10_000 }];
const report = { title: "Household strategy", asOfDate: "2026-10-09", recommendations: [] };
const stored = { id: "record", contentHash: "reviewed-hash", report };
const profileInput = { planningScope: "INDIVIDUAL", essentialMonthlySpendingCents: 2_000 };
const investmentInput = { liquidityClass: "LIQUID", portfolioRole: "CORE", riskLevel: "MODERATE", includeInRetirementProjection: true, classificationStatus: "USER_CONFIRMED", classificationSource: "USER" };
const flowInput = { type: "EXTERNAL_CONTRIBUTION", amountCents: 100, cadence: "MONTHLY", startsOn: "2026-01-01T00:00:00.000Z", includeInRetirementProjection: true, label: "Savings" };
const positionInput = { side: "ASSET", category: "PROPERTY", label: "Home", currentValueCents: 20_000, asOfDate: "2026-10-09T00:00:00.000Z", liquidityClass: "LOCKED", includeInInvestableAllocation: false, includeInRetirementProjection: false };
const scoped = (data, extra = {}) => ({ workspaceId: "household", actorUserId: "editor", data, ...extra });
const investmentScope = { workspaceId: "household", investmentAccountId: "investment" };
const entries = [
  ["profile", "GET", "getCioProfile", undefined, ["household"], { profile: publicRecord }],
  ["profile", "PATCH", "upsertCioProfile", profileInput, [scoped(profileInput)], { profile: publicRecord }],
  ["policy", "GET", "getCioPolicy", undefined, ["household"], { policy: publicPolicy }],
  ["policy", "PATCH", "upsertCioPolicy", { maximumSatelliteAllocationBps: 2_000 }, [scoped({ maximumSatelliteAllocationBps: 2_000 })], { policy: publicPolicy }],
  ["investments/[investmentId]/profile", "GET", "getCioInvestmentProfile", undefined, [investmentScope], { profile: publicRecord }],
  ["investments/[investmentId]/profile", "PUT", "upsertCioInvestmentProfile", investmentInput, [scoped(investmentInput, { investmentAccountId: "investment" })], { profile: publicRecord }],
  ["investments/[investmentId]/exposures", "GET", "getCioInvestmentExposures", undefined, [investmentScope], { exposures: publicExposures }],
  ["investments/[investmentId]/exposures", "PUT", "replaceCioInvestmentExposures", { exposures: [] }, [scoped({ exposures: [] }, { investmentAccountId: "investment" })], { exposures: publicExposures }],
  ["recurring-flows", "GET", "listCioRecurringFlows", undefined, ["household"], { items: [publicRecord] }],
  ["recurring-flows", "POST", "createCioRecurringFlow", flowInput, [scoped(flowInput)], { flow: publicRecord }],
  ["recurring-flows/[id]", "PATCH", "updateCioRecurringFlow", { amountCents: 200 }, [scoped({ amountCents: 200 }, { id: "record" })], { flow: publicRecord }],
  ["recurring-flows/[id]", "DELETE", "deleteCioRecurringFlow", undefined, [{ workspaceId: "household", actorUserId: "editor", id: "record" }], { deleted: { id: "record" } }],
  ["planning-positions", "GET", "listCioPlanningPositions", undefined, ["household"], { items: [publicRecord] }],
  ["planning-positions", "POST", "createCioPlanningPosition", positionInput, [scoped(positionInput)], { position: publicRecord }],
  ["planning-positions/[id]", "PATCH", "updateCioPlanningPosition", { currentValueCents: 0 }, [scoped({ currentValueCents: 0 }, { id: "record" })], { position: publicRecord }],
  ["planning-positions/[id]", "DELETE", "deleteCioPlanningPosition", undefined, [{ workspaceId: "household", actorUserId: "editor", id: "record" }], { deleted: { id: "record" } }],
  ["overview", "GET", "buildCioSnapshot", undefined, [{ workspaceId: "household" }], { overview: { currency: "SGD" } }],
  ["retirement-projection", "POST", "runWorkspaceRetirementProjection", { asOfDate: "2026-10-09" }, [{ workspaceId: "household", input: { asOfDate: "2026-10-09" } }], { projection: { scenarios: [] } }],
  ["reports", "GET", "listCioStrategyReports", undefined, ["household"], { reports: [{ id: "record", title: report.title }] }],
  ["reports", "POST", "createCioStrategyReport", { asOfDate: "2026-10-09" }, [{ workspaceId: "household", actorUserId: "editor", asOfDate: "2026-10-09" }], { report: { id: "record", title: report.title } }],
  ["reports/[id]", "GET", "getCioStrategyReport", undefined, ["household", "record"], { id: "record", report }],
].map(([path, method, name, body, args, expected]) => ({ path, method, name, body, args, expected, route: require(`../app/api/cio/${path}/route.ts`)[method], mutation: method !== "GET" && path !== "retirement-projection" }));
const pdfRoute = require("../app/api/cio/reports/[id]/pdf/route.ts");
beforeEach((t) => {
  const url = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = "https://nest.example.test";
  t.after(() => { if (url === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = url; });
  accessError = null;
  accessChecks.length = 0;
  calls.length = 0;
  responses = new Map(repositoryMethods.map((name) => [name, record]));
  for (const name of ["getCioPolicy", "upsertCioPolicy"]) responses.set(name, policyRecord);
  for (const name of ["getCioInvestmentExposures", "replaceCioInvestmentExposures"]) responses.set(name, exposures);
  for (const name of ["listCioRecurringFlows", "listCioPlanningPositions"]) responses.set(name, [record]);
  for (const name of ["deleteCioRecurringFlow", "deleteCioPlanningPosition"]) responses.set(name, { id: "record" });
  responses.set("buildCioSnapshot", { currency: "SGD" });
  responses.set("runWorkspaceRetirementProjection", { scenarios: [] });
  responses.set("listCioStrategyReports", [{ id: "record", title: report.title }]);
  responses.set("getCioStrategyReport", stored);
  responses.set("createCioStrategyReport", { ...stored, summary: { id: "record", title: report.title } });
  responses.set("renderCioStrategyReportPdf", Buffer.from("%PDF-synthetic-render-result"));
});
function request(method, body, headers = {}) {
  return new Request("https://nest.example.test/api/cio?workspaceId=untrusted", { method, headers: { "content-type": "application/json", origin: "https://nest.example.test", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const context = (id = "record", investmentId = "investment") => ({ params: Promise.resolve({ id, investmentId }) });
function assertPrivateHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.match(response.headers.get("x-request-id"), /^[a-f\d-]{36}$/);
}

for (const entry of entries) {
  test(`CIO ${entry.method} ${entry.path} binds the authenticated workspace and returns its public response`, async () => {
    const response = await entry.route(request(entry.method, entry.body), context());
    const expectedStatus = entry.method === "POST" && entry.mutation ? 201 : 200;
    assert.equal(response.status, expectedStatus);
    assertPrivateHeaders(response);
    assert.deepEqual(await response.json(), entry.expected);
    assert.deepEqual(calls, [{ name: entry.name, args: entry.args }]);
    assert.deepEqual(accessChecks, [[undefined, entry.mutation ? "EDITOR" : "VIEWER"]]);
  });
}

test("all CIO endpoints reject missing or denied access before invoking a service", async () => {
  for (const status of [401, 403]) {
    accessError = new ApiAuthError(status, "Access denied");
    for (const entry of entries) {
      const response = await entry.route(request(entry.method, entry.body), context());
      assert.equal(response.status, status);
      assertPrivateHeaders(response);
      assert.equal((await response.json()).error, "Access denied");
    }
    assert.equal((await pdfRoute.GET(request("GET"), context())).status, status);
  }
  assert.deepEqual(calls, []);
});

test("CIO configuration mutations reject cross-origin requests before authorization or writes", async () => {
  for (const entry of entries.filter(({ mutation }) => mutation)) {
    const response = await entry.route(request(entry.method, entry.body, { origin: "https://attacker.example.test" }), context());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "Cross-origin request denied");
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(accessChecks, []);
});

test("CIO request validation rejects unknown fields, malformed JSON, media types and oversized bodies", async () => {
  for (const entry of entries.filter(({ body }) => body !== undefined)) {
    const invalid = await entry.route(request(entry.method, { ...entry.body, workspaceId: "attacker" }), context());
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).code, "UNPROCESSABLE_ENTITY");
    const malformed = new Request("https://nest.example.test/api/cio", { method: entry.method, headers: { "content-type": "application/json" }, body: "{" });
    assert.equal((await entry.route(malformed, context())).status, 400);
    assert.equal((await entry.route(request(entry.method, entry.body, { "content-type": "text/plain" }), context())).status, 415);
    assert.equal((await entry.route(request(entry.method, entry.body, { "content-length": "65537" }), context())).status, 413);
  }
  assert.deepEqual(calls, []);
});

test("CIO routes validate dynamic record identifiers and preserve typed errors without leaking unexpected failures", async () => {
  for (const entry of entries.filter(({ path }) => path.includes("["))) {
    assert.equal((await entry.route(request(entry.method, entry.body), context("", ""))).status, 422);
  }
  assert.equal((await pdfRoute.GET(request("GET"), context("x".repeat(1_001)))).status, 422);
  assert.deepEqual(calls, []);
  for (const entry of entries) {
    responses.set(entry.name, new ApiRequestError(404, "Record not found"));
    const missing = await entry.route(request(entry.method, entry.body), context());
    assert.equal(missing.status, 404);
    responses.set(entry.name, new Error("Private provider connection details"));
    const failed = await entry.route(request(entry.method, entry.body), context());
    const result = await failed.json();
    assert.equal(failed.status, 500);
    assert.equal(result.code, "INTERNAL_ERROR");
    assert.doesNotMatch(result.error, /Private provider/);
    assert.equal(result.requestId, failed.headers.get("x-request-id"));
  }
});

test("CIO profile and policy reads represent missing setup as null", async () => {
  for (const name of ["getCioProfile", "getCioPolicy", "getCioInvestmentProfile"]) {
    const entry = entries.find((entry) => entry.name === name);
    responses.set(name, null);
    const response = await entry.route(request("GET"), context());
    assert.equal(response.status, 200);
    assert.deepEqual(Object.values(await response.json()), [null]);
  }
});

test("CIO PDF downloads use bounded safe filenames, hash-based ETags and private response headers", async () => {
  for (const [title, filename] of [["Café / retirement", "Cafe-retirement"], ["💰", "CIO-Strategy"], ["a".repeat(100), "a".repeat(80)]]) {
    const current = { ...stored, report: { ...report, title } };
    responses.set("getCioStrategyReport", current);
    const response = await pdfRoute.GET(request("GET"), context());
    assert.equal(response.status, 200);
    assertPrivateHeaders(response);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("content-disposition"), `attachment; filename="${filename}-2026-10-09.pdf"`);
    assert.equal(response.headers.get("etag"), '"reviewed-hash"');
    const body = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(body, responses.get("renderCioStrategyReportPdf"));
    assert.equal(response.headers.get("content-length"), String(body.byteLength));
    assert.deepEqual(calls.at(-2), { name: "getCioStrategyReport", args: ["household", "record"] });
    assert.deepEqual(calls.at(-1), { name: "renderCioStrategyReportPdf", args: [current.report] });
  }
  responses.set("renderCioStrategyReportPdf", new Error("Private renderer path"));
  const failed = await pdfRoute.GET(request("GET"), context());
  assert.equal(failed.status, 500);
  assert.equal((await failed.json()).error, "Failed to render CIO strategy report");
});
