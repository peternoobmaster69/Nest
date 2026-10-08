import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-08T12:00:00Z");
const today = new Date("2026-10-08T00:00:00Z");
const calls = [];
const accessChecks = [];
let fixtures;
let failures;
let accessError;
let sources;
class ApiAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function databaseCall(operation) {
  return async (args) => {
    calls.push({ operation, args });
    if (failures.has(operation)) return Promise.reject(failures.get(operation));
    assert.ok(fixtures.has(operation), `Unexpected database operation: ${operation}`);
    const value = fixtures.get(operation);
    return typeof value === "function" ? value(args) : value;
  };
}
const prisma = Object.fromEntries(["frequentFlyerAccount", "mileProgram", "mileRedemption", "mileRedemptionDetail"].map((model) => [model,
  Object.fromEntries(["findFirst", "findMany", "aggregate", "count", "create", "update", "delete"].map((method) => [method, databaseCall(`${model}.${method}`)])),
]));
prisma.$transaction = async (handler) => {
  calls.push({ operation: "begin" });
  try {
    const result = await handler(prisma);
    calls.push({ operation: "commit" });
    return result;
  } catch (error) {
    calls.push({ operation: "rollback" });
    throw error;
  }
};
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/workspace-auth.ts", { namedExports: {
  ApiAuthError,
  requireWorkspaceAccess: async (...args) => {
    accessChecks.push(args);
    if (accessError) throw accessError;
    return { workspaceId: "household", userId: "owner", role: "EDITOR" };
  },
} });
const route = require("../app/api/rewards/frequent-flyer/history/route.ts");
const { decodeCursor } = require("../lib/api/pagination.ts");
const operation = (name) => calls.filter((call) => call.operation === name);
const earn = { type: "earn", frequentFlyerId: "flyer", date: "2026-10-08T00:00:00Z", miles: 500 };
const redeem = { type: "redeem", frequentFlyerId: "flyer", dateTime: "2026-10-08T09:30:00Z", milesToRedeem: 150, redemptionTitle: "Flight" };
function request(method = "GET", body, query = { frequentFlyerId: "flyer" }) {
  return new Request(`https://nest.example.test/api/rewards/frequent-flyer/history?${new URLSearchParams(query)}`, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const cursor = (id, sortValue) => Buffer.from(JSON.stringify({ v: 1, id, sortValue })).toString("base64url");
async function rejected(response, status, error) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).error, error);
}
function availableSource(source, where) {
  if (source.workspaceId !== where.workspaceId || source.frequentFlyerId !== where.frequentFlyerId) return false;
  if (source.balanceMiles <= where.balanceMiles.gt) return false;
  return !where.OR || where.OR.some(({ expiryDate }) => expiryDate === null ? source.expiryDate === null : source.expiryDate !== null && source.expiryDate >= expiryDate.gte);
}
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  calls.length = 0; accessChecks.length = 0;
  accessError = null;
  failures = new Map();
  sources = [
    { id: "old", workspaceId: "household", frequentFlyerId: "flyer", balanceMiles: 1000, expiryDate: new Date("2026-10-07T00:00:00Z") },
    { id: "first", workspaceId: "household", frequentFlyerId: "flyer", balanceMiles: 100, expiryDate: today },
    { id: "second", workspaceId: "household", frequentFlyerId: "flyer", balanceMiles: 80, expiryDate: new Date("2026-11-30T00:00:00Z") },
    { id: "last", workspaceId: "household", frequentFlyerId: "flyer", balanceMiles: 50, expiryDate: null },
    { id: "foreign", workspaceId: "other", frequentFlyerId: "flyer", balanceMiles: 5000, expiryDate: null },
  ];
  fixtures = new Map([
    ["frequentFlyerAccount.findFirst", { id: "flyer", programName: "Air Rewards", mileNeverExpire: false, validityPeriodYears: 3 }],
    ["frequentFlyerAccount.update", {}],
    ["mileProgram.findFirst", { id: "earn", miles: 500, balanceMiles: 350 }],
    ["mileProgram.findMany", ({ where }) => where.balanceMiles ? sources.filter((source) => availableSource(source, where)) : []],
    ["mileProgram.aggregate", { _sum: { miles: 500, balanceMiles: 350 } }],
    ["mileProgram.create", { id: "earned" }], ["mileProgram.update", {}], ["mileProgram.delete", {}],
    ["mileRedemption.findFirst", { id: "redemption", details: [{ milesFileId: "first", milesRedeemed: 100 }, { milesFileId: "second", milesRedeemed: 50 }] }],
    ["mileRedemption.findMany", []], ["mileRedemption.aggregate", { _sum: { totalMilesRedeemed: 150 } }],
    ["mileRedemption.create", { id: "redemption" }], ["mileRedemption.update", {}], ["mileRedemption.delete", {}],
    ["mileRedemptionDetail.create", {}], ["mileRedemptionDetail.count", 0],
  ]);
});

test("reward history requires authorization and validates bounded queries and cursor dates before database reads", async () => {
  accessError = new ApiAuthError(403, "Forbidden");
  await rejected(await route.GET(request()), 403, "Forbidden");
  accessError = null;
  for (const query of [{}, { frequentFlyerId: " " }, { frequentFlyerId: "flyer", limit: "101" }, { frequentFlyerId: "flyer", limit: "0" }, { frequentFlyerId: "flyer", earnCursor: "x".repeat(513) }]) {
    await rejected(await route.GET(request("GET", undefined, query)), 422, "Invalid reward history query");
  }
  for (const value of ["invalid-cursor", cursor("earn", "invalid-date")]) {
    await rejected(await route.GET(request("GET", undefined, { frequentFlyerId: "flyer", earnCursor: value })), 400, "Invalid history cursor");
  }
  assert.deepEqual(calls, []);
});

test("reward history refuses inactive or foreign accounts and redacts unexpected database failures", async () => {
  fixtures.set("frequentFlyerAccount.findFirst", null);
  await rejected(await route.GET(request()), 404, "Frequent flyer account not found");
  assert.deepEqual(operation("frequentFlyerAccount.findFirst")[0].args.where, { id: "flyer", workspaceId: "household", isActive: true });
  assert.equal(operation("mileProgram.findMany").length, 0);
  failures.set("frequentFlyerAccount.findFirst", new Error("Private database diagnostic"));
  await rejected(await route.GET(request()), 500, "Failed to fetch transaction history");
});

test("reward history paginates earnings and redemptions independently and returns workspace-wide totals", async () => {
  const date = new Date("2026-10-01T00:00:00Z");
  fixtures.set("mileProgram.findMany", [{ id: "earn-2", date, miles: 250 }, { id: "earn-1", date, miles: 250 }]);
  fixtures.set("mileRedemption.findMany", [{ id: "redeem-2", dateTime: date }, { id: "redeem-1", dateTime: date }]);
  const response = await route.GET(request("GET", undefined, { frequentFlyerId: "flyer", limit: "1" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.totals, { earned: 500, available: 350, redeemed: 150 });
  assert.equal(result.milePrograms.items.length, 1);
  assert.equal(result.redemptions.items.length, 1);
  assert.deepEqual(decodeCursor(result.milePrograms.pageInfo.nextCursor), { id: "earn-2", sortValue: date.toISOString() });
  assert.deepEqual(decodeCursor(result.redemptions.pageInfo.nextCursor), { id: "redeem-2", sortValue: date.toISOString() });
  calls.length = 0;
  await route.GET(request("GET", undefined, { frequentFlyerId: "flyer", limit: "1", earnCursor: result.milePrograms.pageInfo.nextCursor, redemptionCursor: result.redemptions.pageInfo.nextCursor }));
  assert.deepEqual(operation("mileProgram.findMany")[0].args, { where: { workspaceId: "household", frequentFlyerId: "flyer", OR: [{ date: { lt: date } }, { date, id: { lt: "earn-2" } }] }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 2 });
  assert.deepEqual(operation("mileRedemption.findMany")[0].args.where.OR, [{ dateTime: { lt: date } }, { dateTime: date, id: { lt: "redeem-2" } }]);
  assert.ok(calls.every(({ args }) => args.where.workspaceId === "household" && (args.where.id === "flyer" || args.where.frequentFlyerId === "flyer")));
  const totals = operation("mileProgram.aggregate");
  assert.ok(!("OR" in totals[0].args.where));
  assert.deepEqual(totals[1].args.where.OR, [{ expiryDate: null }, { expiryDate: { gte: today } }]);
});

test("empty history uses default page limits and normalizes null sums to zero", async () => {
  fixtures.set("mileProgram.aggregate", { _sum: { miles: null, balanceMiles: null } });
  fixtures.set("mileRedemption.aggregate", { _sum: { totalMilesRedeemed: null } });
  const result = await (await route.GET(request())).json();
  assert.deepEqual(result.totals, { earned: 0, available: 0, redeemed: 0 });
  assert.deepEqual(result.milePrograms, { items: [], pageInfo: { hasMore: false, nextCursor: null, limit: 50 } });
  assert.deepEqual(result.redemptions, result.milePrograms);
  assert.equal(operation("mileProgram.findMany")[0].args.take, 51);
  assert.deepEqual(accessChecks, [[]]);
});

test("history mutations validate authentication, dates, positive miles, and required identifiers before opening a transaction", async () => {
  accessError = new ApiAuthError(401, "Unauthorized");
  for (const method of ["POST", "PATCH", "DELETE"]) await rejected(await route[method](request(method)), 401, "Unauthorized");
  accessError = null;
  for (const method of ["POST", "PATCH"]) {
    for (const body of [null, {}, { ...earn, date: "not-a-date" }, { ...earn, miles: -1 }, { ...redeem, milesToRedeem: 0 }]) {
      await rejected(await route[method](request(method, body)), 400, "Invalid data");
    }
  }
  for (const query of [{}, { id: "earn" }, { id: "earn", type: "earn" }, { type: "earn", frequentFlyerId: "flyer" }]) {
    await rejected(await route.DELETE(request("DELETE", undefined, query)), 400, "id, type and frequentFlyerId are required");
  }
  assert.deepEqual(calls, []);
  assert.ok(accessChecks.every((args) => args[0] === null && args[1] === "EDITOR"));
});

for (const [label, body, program, expiry] of [
  ["default anniversary", earn, { mileNeverExpire: false, validityPeriodYears: 3 }, "2029-10-31T00:00:00.000Z"],
  ["explicit expiry", { ...earn, title: "  Bonus miles  ", expiryDate: "2027-01-31T00:00:00Z", firstRedeemedDate: "2026-10-08T01:00:00Z" }, { mileNeverExpire: false, validityPeriodYears: 3 }, "2027-01-31T00:00:00.000Z"],
  ["non-expiring program", { ...earn, expiryDate: "2027-01-31T00:00:00Z", firstRedeemedDate: null }, { mileNeverExpire: true, validityPeriodYears: 3 }, null],
  ["leap-year month end", { ...earn, date: "2023-02-14T00:00:00Z", expiryDate: null }, { mileNeverExpire: false, validityPeriodYears: 1 }, "2024-02-29T00:00:00.000Z"],
]) {
  test(`earning miles applies ${label} and synchronizes the available balance`, async () => {
    fixtures.set("frequentFlyerAccount.findFirst", { id: "flyer", ...program });
    const response = await route.POST(request("POST", body));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { success: true });
    const saved = operation("mileProgram.create")[0].args.data;
    assert.equal(saved.workspaceId, "household");
    assert.equal(saved.frequentFlyerId, "flyer");
    assert.equal(saved.miles, 500);
    assert.equal(saved.balanceMiles, 500);
    assert.equal(saved.expiryDate?.toISOString() ?? null, expiry);
    assert.equal(saved.title, body.title?.trim() ?? null);
    assert.equal(saved.firstRedeemedDate?.toISOString() ?? null, body.firstRedeemedDate ? new Date(body.firstRedeemedDate).toISOString() : null);
    assert.deepEqual(operation("frequentFlyerAccount.update")[0].args, { where: { id: "flyer" }, data: { currentMiles: 350 } });
    assert.deepEqual(operation("mileProgram.aggregate")[0].args.where.OR, [{ expiryDate: null }, { expiryDate: { gte: today } }]);
    assert.equal(operation("commit").length, 1);
  });
}

test("redemptions allocate only unexpired balances in order and stop after satisfying the request", async () => {
  const response = await route.POST(request("POST", redeem));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(operation("mileRedemption.create")[0].args.data, { workspaceId: "household", frequentFlyerId: "flyer", redemptionTitle: "Flight", dateTime: new Date(redeem.dateTime), totalMilesRedeemed: 150 });
  assert.deepEqual(operation("mileRedemptionDetail.create").map(({ args }) => args.data), [
    { redemptionId: "redemption", milesFileId: "first", milesRedeemed: 100 },
    { redemptionId: "redemption", milesFileId: "second", milesRedeemed: 50 },
  ]);
  assert.deepEqual(operation("mileProgram.update").map(({ args }) => args), [
    { where: { id: "first" }, data: { balanceMiles: { decrement: 100 }, firstRedeemedDate: new Date(redeem.dateTime) } },
    { where: { id: "second" }, data: { balanceMiles: { decrement: 50 }, firstRedeemedDate: new Date(redeem.dateTime) } },
  ]);
  const query = operation("mileProgram.findMany")[0].args;
  assert.equal(query.take, 5000);
  assert.deepEqual(query.where, { workspaceId: "household", frequentFlyerId: "flyer", balanceMiles: { gt: 0 }, OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] });
  assert.deepEqual(query.orderBy, [{ expiryDate: "asc" }, { date: "asc" }, { createdAt: "asc" }]);
  assert.equal(operation("commit").length, 1);
});

test("redemptions can consume all valid sources, including miles without an expiry date", async () => {
  fixtures.set("mileProgram.aggregate", { _sum: { balanceMiles: null } });
  const response = await route.POST(request("POST", { ...redeem, milesToRedeem: 230 }));
  assert.equal(response.status, 201);
  assert.deepEqual(operation("mileRedemptionDetail.create").map(({ args }) => [args.data.milesFileId, args.data.milesRedeemed]), [["first", 100], ["second", 80], ["last", 50]]);
  assert.equal(operation("frequentFlyerAccount.update")[0].args.data.currentMiles, 0);
});

test("insufficient unexpired miles roll back without creating a redemption or changing balances", async () => {
  await rejected(await route.POST(request("POST", { ...redeem, milesToRedeem: 231 })), 400, "Not enough available miles for redemption");
  assert.equal(operation("mileRedemption.create").length, 0);
  assert.equal(operation("mileProgram.update").length, 0);
  assert.equal(operation("rollback").length, 1);
});

test("history mutations reject inactive accounts and handle non-Error database failures", async () => {
  const inputs = [["POST", earn], ["PATCH", { type: "earn", frequentFlyerId: "flyer", id: "earn" }], ["DELETE", undefined]];
  fixtures.set("frequentFlyerAccount.findFirst", null);
  for (const [method, body] of inputs) {
    await rejected(await route[method](request(method, body, { id: "earn", type: "earn", frequentFlyerId: "flyer" })), 400, "Frequent flyer account not found");
  }
  assert.equal(operation("begin").length, 0);
  failures.set("frequentFlyerAccount.findFirst", { internal: "diagnostic" });
  for (const [method, body] of inputs) {
    const action = { POST: "create", PATCH: "update", DELETE: "delete" }[method];
    await rejected(await route[method](request(method, body, { id: "earn", type: "earn", frequentFlyerId: "flyer" })), 500, `Failed to ${action} history item`);
  }
});

test("earn edits preserve redeemed miles while supporting optional dates, titles, and explicitly cleared fields", async () => {
  const updates = [
    [{}, { date: undefined, title: undefined, miles: 500, balanceMiles: 350, expiryDate: undefined, firstRedeemedDate: undefined }],
    [{ miles: 600, date: "2026-10-01T00:00:00Z", title: "  Revised  ", expiryDate: "2027-01-31T00:00:00Z", firstRedeemedDate: "2026-10-08T00:00:00Z" }, { date: new Date("2026-10-01T00:00:00Z"), title: "Revised", miles: 600, balanceMiles: 450, expiryDate: new Date("2027-01-31T00:00:00Z"), firstRedeemedDate: today }],
    [{ miles: 150, title: null, expiryDate: null, firstRedeemedDate: null }, { date: undefined, title: null, miles: 150, balanceMiles: 0, expiryDate: null, firstRedeemedDate: null }],
  ];
  for (const [change, expected] of updates) {
    const response = await route.PATCH(request("PATCH", { type: "earn", frequentFlyerId: "flyer", id: "earn", ...change }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(operation("mileProgram.update").at(-1).args, { where: { id: "earn" }, data: expected });
  }
  assert.ok(operation("mileProgram.findFirst").every(({ args }) => args.where.id === "earn" && args.where.workspaceId === "household" && args.where.frequentFlyerId === "flyer"));
});

test("earn edits reject unknown entries and reductions below already redeemed miles", async () => {
  fixtures.set("mileProgram.findFirst", null);
  await rejected(await route.PATCH(request("PATCH", { type: "earn", frequentFlyerId: "flyer", id: "foreign" })), 400, "Earn transaction not found");
  fixtures.set("mileProgram.findFirst", { miles: 500, balanceMiles: 350 });
  await rejected(await route.PATCH(request("PATCH", { type: "earn", frequentFlyerId: "flyer", id: "earn", miles: 149 })), 400, "Miles cannot be reduced below already redeemed amount");
  assert.equal(operation("mileProgram.update").length, 0);
  assert.equal(operation("rollback").length, 2);
});

test("redemption edits update only descriptive fields and retain the original allocations", async () => {
  for (const changes of [{}, { redemptionTitle: "New itinerary", dateTime: "2026-10-09T01:00:00Z" }]) {
    const response = await route.PATCH(request("PATCH", { type: "redeem", frequentFlyerId: "flyer", id: "redemption", ...changes }));
    assert.equal(response.status, 200);
    assert.deepEqual(operation("mileRedemption.update").at(-1).args, { where: { id: "redemption" }, data: { redemptionTitle: changes.redemptionTitle, dateTime: changes.dateTime ? new Date(changes.dateTime) : undefined } });
  }
  assert.equal(operation("mileProgram.update").length, 0);
  fixtures.set("mileRedemption.findFirst", null);
  await rejected(await route.PATCH(request("PATCH", { type: "redeem", frequentFlyerId: "flyer", id: "foreign" })), 400, "Redemption transaction not found");
});

test("deleting an unused earning recalculates the available balance", async () => {
  const response = await route.DELETE(request("DELETE", undefined, { id: "earn", type: "earn", frequentFlyerId: "flyer" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(operation("mileProgram.findFirst")[0].args.where, { id: "earn", workspaceId: "household", frequentFlyerId: "flyer" });
  assert.deepEqual(operation("mileRedemptionDetail.count")[0].args, { where: { milesFileId: "earn" } });
  assert.deepEqual(operation("mileProgram.delete")[0].args, { where: { id: "earn" } });
  assert.equal(operation("frequentFlyerAccount.update").length, 1);
  assert.equal(operation("commit").length, 1);
});

test("earning deletion rejects unknown entries and records with redemption allocations", async () => {
  fixtures.set("mileProgram.findFirst", null);
  await rejected(await route.DELETE(request("DELETE", undefined, { id: "earn", type: "earn", frequentFlyerId: "flyer" })), 400, "Earn transaction not found");
  fixtures.set("mileProgram.findFirst", { id: "earn" });
  fixtures.set("mileRedemptionDetail.count", 1);
  await rejected(await route.DELETE(request("DELETE", undefined, { id: "earn", type: "earn", frequentFlyerId: "flyer" })), 400, "Cannot delete an earn transaction that has redemption allocations");
  assert.equal(operation("mileProgram.delete").length, 0);
  assert.equal(operation("rollback").length, 2);
});

test("deleting a redemption restores each allocation before deleting and recalculating the balance", async () => {
  const response = await route.DELETE(request("DELETE", undefined, { id: "redemption", type: "redeem", frequentFlyerId: "flyer" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(operation("mileProgram.update").map(({ args }) => args), [
    { where: { id: "first" }, data: { balanceMiles: { increment: 100 } } },
    { where: { id: "second" }, data: { balanceMiles: { increment: 50 } } },
  ]);
  assert.deepEqual(operation("mileRedemption.delete")[0].args, { where: { id: "redemption" } });
  const mutationOrder = calls.map(({ operation: name }) => name).filter((name) => name.endsWith("update") || name.endsWith("delete"));
  assert.deepEqual(mutationOrder, ["mileProgram.update", "mileProgram.update", "mileRedemption.delete", "frequentFlyerAccount.update"]);
  assert.equal(operation("commit").length, 1);
});

test("redemption deletion rejects invalid types and unknown records without restoring balances", async () => {
  await rejected(await route.DELETE(request("DELETE", undefined, { id: "record", type: "invalid", frequentFlyerId: "flyer" })), 400, "Invalid type");
  fixtures.set("mileRedemption.findFirst", null);
  await rejected(await route.DELETE(request("DELETE", undefined, { id: "foreign", type: "redeem", frequentFlyerId: "flyer" })), 400, "Redemption transaction not found");
  assert.equal(operation("mileProgram.update").length, 0);
  assert.equal(operation("mileRedemption.delete").length, 0);
  assert.equal(operation("rollback").length, 2);
});
