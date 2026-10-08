import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";
import { Prisma } from "@prisma/client";

const require = createRequire(import.meta.url);
const now = new Date("2026-10-08T12:00:00Z");
const calls = [];
const accessChecks = [];
let fixtures;
let accessError;
class ApiAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function databaseCall(operation) {
  return async (args) => {
    calls.push({ operation, args });
    assert.ok(fixtures.has(operation), `Unexpected database operation: ${operation}`);
    const value = fixtures.get(operation);
    if (value instanceof Error) throw value;
    return typeof value === "function" ? value(args) : value;
  };
}
const prisma = Object.fromEntries([
  "creditCardAccount", "creditCardReward", "frequentFlyerAccount", "hotelRewardAccount", "pointConversion", "mileProgram",
].map((model) => [model, Object.fromEntries(["findFirst", "findMany", "create", "update", "delete"].map((method) => [method, databaseCall(`${model}.${method}`)]))]));
prisma.$transaction = async (handler) => {
  calls.push({ operation: "begin" });
  try {
    const value = await handler(prisma);
    calls.push({ operation: "commit" });
    return value;
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
const credit = require("../app/api/rewards/credit-card/route.ts");
const flyer = require("../app/api/rewards/frequent-flyer/route.ts");
const hotel = require("../app/api/rewards/hotel-rewards/route.ts");
const conversion = require("../app/api/rewards/conversion/route.ts");
const overview = require("../app/api/rewards/route.ts");
const operation = (name) => calls.filter((call) => call.operation === name);
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  calls.length = 0;
  accessChecks.length = 0;
  accessError = null;
  fixtures = new Map();
  for (const model of Object.keys(prisma).filter((name) => !name.startsWith("$"))) {
    fixtures.set(`${model}.findFirst`, ({ where }) => where.programName ? null : { id: where.id, fromPoints: 100, toMiles: 50 });
    fixtures.set(`${model}.findMany`, []);
    fixtures.set(`${model}.create`, ({ data }) => ({ id: `${model}-new`, ...data }));
    fixtures.set(`${model}.update`, ({ where, data }) => ({ id: where.id, ...data }));
    fixtures.set(`${model}.delete`, null);
  }
});
function request(method, body, query = {}) {
  return new Request(`https://nest.example.test/api/rewards?${new URLSearchParams(query)}`, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function errorResponse(response, status, error) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).error, error);
}
const createCredit = { creditCardId: "card", currentPoints: 1200, conversionFromPoints: 100, conversionToMiles: 50 };
const createFlyer = { programName: "Air Rewards", airlineName: "Example Air" };
const createHotel = { programName: "Hotel Rewards", hotelBrand: "Example Hotel" };
const createConversion = { creditCardRewardId: "reward", frequentFlyerId: "flyer", fromPoints: 100, toMiles: 60 };
const resources = [
  { name: "credit card reward", label: "Credit card reward", route: credit, model: "creditCardReward", create: createCredit },
  { name: "frequent flyer account", label: "Frequent flyer account", route: flyer, model: "frequentFlyerAccount", create: createFlyer },
  { name: "hotel rewards account", label: "Hotel rewards account", route: hotel, model: "hotelRewardAccount", create: createHotel },
  { name: "conversion", label: "Conversion", route: conversion, model: "pointConversion", create: createConversion },
];

for (const { name, label, route, model, create } of resources) {
  test(`${name} mutations require editor access and validate input before database writes`, async () => {
    for (const status of [401, 403]) {
      accessError = new ApiAuthError(status, "Access denied");
      for (const method of ["POST", "PATCH", "DELETE"]) {
        await errorResponse(await route[method](request(method, undefined, { id: "record" })), status, "Access denied");
      }
    }
    assert.deepEqual(calls, []);
    accessError = null;
    for (const method of ["POST", "PATCH"]) {
      for (const body of [null, {}, []]) {
        const response = await route[method](request(method, body));
        assert.equal(response.status, 400);
        const result = await response.json();
        assert.equal(result.error, "Invalid data");
        assert.ok(result.details);
      }
    }
    assert.deepEqual(calls, []);
    assert.ok(accessChecks.every((args) => args[0] === null && args[1] === "EDITOR"));
  });

  test(`${name} updates and deletions look up ownership before modifying a record`, async () => {
    fixtures.set(`${model}.findFirst`, null);
    await errorResponse(await route.PATCH(request("PATCH", { id: "foreign" })), 404, `${label} not found`);
    await errorResponse(await route.DELETE(request("DELETE", undefined, { id: "foreign" })), 404, `${label} not found`);
    assert.ok(operation(`${model}.findFirst`).every(({ args }) => args.where.id === "foreign" && args.where.workspaceId === "household"));
    assert.equal(operation(`${model}.update`).length, 0);
    assert.equal(operation(`${model}.delete`).length, 0);
  });

  test(`${name} deletion requires an ID and selects only this workspace's record`, async () => {
    await errorResponse(await route.DELETE(request("DELETE")), 400, "ID is required");
    assert.deepEqual(calls, []);
    const response = await route.DELETE(request("DELETE", undefined, { id: "record" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(operation(`${model}.findFirst`)[0].args, { where: { id: "record", workspaceId: "household" }, select: { id: true } });
    assert.deepEqual(operation(`${model}.delete`)[0].args, { where: { id: "record" } });
  });

  test(`${name} failures return stable public errors for each mutation`, async () => {
    for (const [method, action, body] of [["POST", "create", create], ["PATCH", "update", { id: "record" }], ["DELETE", "delete", undefined]]) {
      fixtures.set(`${model}.${action}`, new Error("Private connection details"));
      await errorResponse(await route[method](request(method, body, { id: "record" })), 500, `Failed to ${action} ${name}`);
    }
  });
}

test("credit rewards create their default conversion in the same transaction and normalize optional descriptions", async () => {
  for (const [description, expected] of [[undefined, null], [" ", null], ["  Standard transfer  ", "Standard transfer"]]) {
    calls.length = 0;
    const response = await credit.POST(request("POST", { ...createCredit, pointsValueCents: 25, conversionDescription: description }));
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.currentPoints, 1200);
    assert.equal(result.pointsValueCents, 25);
    assert.equal(result.workspaceId, "household");
    assert.deepEqual(operation("creditCardAccount.findFirst")[0].args.where, { id: "card", workspaceId: "household" });
    const saved = operation("pointConversion.create")[0].args.data;
    assert.deepEqual(saved, { workspaceId: "household", creditCardRewardId: result.id, fromPoints: 100, toMiles: 50, conversionRate: 0.5, description: expected });
    assert.deepEqual(calls.map(({ operation: name }) => name), ["creditCardAccount.findFirst", "begin", "creditCardReward.create", "pointConversion.create", "commit"]);
  }
});

test("credit rewards reject invalid balances, unknown cards, and incomplete conversion transactions", async () => {
  for (const invalid of [{ currentPoints: -1 }, { currentPoints: 1.5 }, { conversionFromPoints: 0 }, { conversionToMiles: 0 }, { pointsValueCents: -1 }]) {
    await errorResponse(await credit.POST(request("POST", { ...createCredit, ...invalid })), 400, "Invalid data");
  }
  assert.deepEqual(calls, []);
  fixtures.set("creditCardAccount.findFirst", null);
  await errorResponse(await credit.POST(request("POST", createCredit)), 404, "Credit card not found");
  assert.equal(operation("begin").length, 0);
  fixtures.set("creditCardAccount.findFirst", { id: "card" });
  fixtures.set("pointConversion.create", new Error("Conversion constraint failure"));
  await errorResponse(await credit.POST(request("POST", createCredit)), 500, "Failed to create credit card reward");
  assert.equal(operation("rollback").length, 1);
  assert.equal(operation("commit").length, 0);
});

test("credit reward edits preserve omitted values and allow balances to be reset to zero", async () => {
  for (const values of [{}, { currentPoints: 0, pointsValueCents: 0 }]) {
    const response = await credit.PATCH(request("PATCH", { id: "reward", ...values }));
    assert.equal(response.status, 200);
    assert.deepEqual(operation("creditCardReward.update").at(-1).args.data, { ...values, lastUpdated: now });
    assert.equal((await response.json()).id, "reward");
  }
});

for (const [label, route, model, create, defaults, conflict] of [
  ["frequent flyer", flyer, "frequentFlyerAccount", createFlyer, { currentMiles: 0, expiryWarning: 6, mileNeverExpire: false, validityPeriodYears: 3 }, "Program with this name already exists"],
  ["hotel rewards", hotel, "hotelRewardAccount", createHotel, { currentPoints: 0, centsPerPoint: 0 }, "Hotel rewards program with this name already exists"],
]) {
  test(`${label} creation enforces unique workspace names and applies balance defaults`, async () => {
    const response = await route.POST(request("POST", create));
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.workspaceId, "household");
    for (const [key, value] of Object.entries(defaults)) assert.equal(result[key], value);
    assert.deepEqual(operation(`${model}.findFirst`)[0].args.where, { workspaceId: "household", programName: create.programName });
    fixtures.set(`${model}.findFirst`, { id: "existing" });
    await errorResponse(await route.POST(request("POST", create)), 409, conflict);
    assert.equal(operation(`${model}.create`).length, 1);
  });
}

test("frequent flyer updates preserve explicit null targets, zero balances, and disabled expiry", async () => {
  const fields = { programName: "New name", airlineName: "Airline", accountNumber: "Member", currentMiles: 0, targetMiles: null, expiryWarning: 12, mileNeverExpire: true, validityPeriodYears: 5, notes: "Note", isActive: false };
  const response = await flyer.PATCH(request("PATCH", { id: "flyer", ...fields }));
  assert.equal(response.status, 200);
  assert.deepEqual(operation("frequentFlyerAccount.update")[0].args, { where: { id: "flyer" }, data: { ...fields, updatedAt: now } });
  assert.equal((await response.json()).targetMiles, null);
});

test("hotel reward creates and updates serialize database decimals as numbers", async () => {
  const saved = { id: "hotel", centsPerPoint: new Prisma.Decimal("0.375"), targetPoints: null };
  fixtures.set("hotelRewardAccount.create", saved);
  fixtures.set("hotelRewardAccount.update", saved);
  for (const [method, input, status] of [["POST", { ...createHotel, centsPerPoint: 0.375, targetPoints: null }, 201], ["PATCH", { id: "hotel", centsPerPoint: 0.375, targetPoints: null, isActive: false }, 200]]) {
    const response = await hotel[method](request(method, input));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { id: "hotel", centsPerPoint: 0.375, targetPoints: null });
  }
  assert.deepEqual(operation("hotelRewardAccount.update")[0].args.data, { centsPerPoint: 0.375, targetPoints: null, isActive: false, updatedAt: now });
});

test("conversion creation validates both account owners and computes a numeric rate", async () => {
  fixtures.set("creditCardReward.findFirst", null);
  await errorResponse(await conversion.POST(request("POST", createConversion)), 404, "Credit card reward not found");
  fixtures.set("creditCardReward.findFirst", { id: "reward" });
  fixtures.set("frequentFlyerAccount.findFirst", null);
  await errorResponse(await conversion.POST(request("POST", createConversion)), 404, "Frequent flyer account not found");
  assert.equal(operation("pointConversion.create").length, 0);
  fixtures.set("frequentFlyerAccount.findFirst", { id: "flyer" });
  fixtures.set("pointConversion.create", ({ data }) => ({ id: "conversion", ...data, conversionRate: new Prisma.Decimal(data.conversionRate) }));
  const response = await conversion.POST(request("POST", { ...createConversion, description: "Transfer" }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).conversionRate, 0.6);
  assert.deepEqual(operation("pointConversion.create")[0].args.data, { workspaceId: "household", ...createConversion, conversionRate: 0.6, description: "Transfer" });
  assert.ok(calls.filter(({ operation: name }) => name.endsWith("findFirst")).every(({ args }) => args.where.workspaceId === "household"));
});

test("conversion edits recompute rates from changed and stored values and distinguish omitted descriptions from clearing", async () => {
  for (const [changes, rate, expected] of [
    [{}, 0.5, {}], [{ fromPoints: 200 }, 0.25, { fromPoints: 200 }], [{ toMiles: 75 }, 0.75, { toMiles: 75 }],
    [{ description: "Updated" }, 0.5, { description: "Updated" }], [{ description: "" }, 0.5, { description: null }], [{ description: null }, 0.5, { description: null }],
  ]) {
    const response = await conversion.PATCH(request("PATCH", { id: "conversion", ...changes }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).conversionRate, rate);
    assert.deepEqual(operation("pointConversion.update").at(-1).args.data, { ...expected, conversionRate: rate });
  }
});

test("reward overview groups expiry months, honors warning windows, and excludes cards already tracked", async () => {
  fixtures.set("creditCardReward.findMany", [{ id: "reward", creditCardId: "tracked" }]);
  fixtures.set("frequentFlyerAccount.findMany", [{ id: "flyer", expiryWarning: 2 }, { id: "default-window", expiryWarning: null }, { id: "no-expiry", expiryWarning: 6 }]);
  fixtures.set("hotelRewardAccount.findMany", [{ id: "hotel", centsPerPoint: new Prisma.Decimal("0.25") }]);
  fixtures.set("pointConversion.findMany", [{ id: "conversion", conversionRate: new Prisma.Decimal("0.6") }]);
  fixtures.set("creditCardAccount.findMany", [{ id: "tracked" }, { id: "available" }]);
  fixtures.set("mileProgram.findMany", [
    { frequentFlyerId: "flyer", expiryDate: new Date("2027-01-31T00:00:00Z"), balanceMiles: 999 },
    { frequentFlyerId: "flyer", expiryDate: new Date("2026-12-31T00:00:00Z"), balanceMiles: 50 },
    { frequentFlyerId: "flyer", expiryDate: new Date("2026-11-15T00:00:00Z"), balanceMiles: 100 },
    { frequentFlyerId: "flyer", expiryDate: new Date("2026-11-30T00:00:00Z"), balanceMiles: 200 },
    { frequentFlyerId: "default-window", expiryDate: new Date("2027-03-31T00:00:00Z"), balanceMiles: 25 },
    { frequentFlyerId: "flyer", expiryDate: null, balanceMiles: 1 },
    { frequentFlyerId: null, expiryDate: new Date("2026-11-30T00:00:00Z"), balanceMiles: 1 },
  ]);
  const response = await overview.GET();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.frequentFlyers.map(({ expirySummary }) => expirySummary), [[{ month: "Nov 2026", amount: 300 }, { month: "Dec 2026", amount: 50 }], [{ month: "Mar 2027", amount: 25 }], []]);
  assert.deepEqual(result.cardsWithoutRewards, [{ id: "available" }]);
  assert.equal(result.hotelRewards[0].centsPerPoint, 0.25);
  assert.equal(result.conversions[0].conversionRate, 0.6);
  assert.ok(calls.every(({ args }) => args.where.workspaceId === "household"));
  assert.deepEqual(operation("mileProgram.findMany")[0].args.where, { workspaceId: "household", frequentFlyerId: { in: ["flyer", "default-window", "no-expiry"] }, balanceMiles: { gt: 0 }, expiryDate: { gte: new Date("2026-10-08T00:00:00Z") } });
  assert.ok(calls.every(({ args }) => args.take === 500 || args.take === 5000));
});

test("empty reward overviews avoid an expiry query and new workspaces receive an empty result", async () => {
  const empty = { creditCards: [], frequentFlyers: [], hotelRewards: [], conversions: [], cardsWithoutRewards: [] };
  assert.deepEqual(await (await overview.GET()).json(), empty);
  assert.equal(operation("mileProgram.findMany").length, 0);
  calls.length = 0;
  accessError = new ApiAuthError(404, "No workspace");
  const response = await overview.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), empty);
  assert.deepEqual(calls, []);
});

test("reward overviews preserve authentication errors and redact database diagnostics", async () => {
  accessError = new ApiAuthError(401, "Unauthorized");
  await errorResponse(await overview.GET(), 401, "Unauthorized");
  assert.deepEqual(calls, []);
  accessError = null;
  fixtures.set("creditCardReward.findMany", new Error("Private diagnostic"));
  await errorResponse(await overview.GET(), 500, "Failed to fetch rewards data");
});
