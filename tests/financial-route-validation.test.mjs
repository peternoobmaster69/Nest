import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { mock } from "node:test";

const require = createRequire(import.meta.url);
const databaseCalls = [];
function unexpectedDatabaseCall(operation) {
  databaseCalls.push(operation);
  throw new Error(`Invalid requests must not access the database: ${operation}`);
}
const database = new Proxy({}, {
  get(_target, model) {
    if (typeof model !== "string") return undefined;
    if (model.startsWith("$")) return () => unexpectedDatabaseCall(model);
    return new Proxy({}, { get: (_table, operation) => () => unexpectedDatabaseCall(`${model}.${String(operation)}`) });
  },
});
class ApiAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const unauthorized = async () => { throw new ApiAuthError(401, "Unauthorized"); };
mock.module("../lib/prisma.ts", { namedExports: { prisma: database } });
mock.module("../lib/workspace-auth.ts", { namedExports: {
  ApiAuthError,
  requireSessionUserId: unauthorized,
  requireRecentAuthentication: unauthorized,
  requireWorkspaceAccess: unauthorized,
  requireWorkspaceRole: unauthorized,
  requireSensitiveWorkspaceAction: unauthorized,
  normalizeWorkspaceRole: (role) => role,
} });
mock.module("../lib/server-session.ts", { namedExports: { getDatabaseReadyServerSession: async () => null } });
const { NextRequest } = require("next/server");

const resources = [
  "accounts", "accounts/[id]", "budgets", "budgets/[id]", "budgets/recalculate",
  "credit-cards", "credit-cards/[id]", "credit-transactions", "credit-transactions/[id]",
  "credit-transactions/[id]/accounting", "credit-transactions/payments", "credit-transactions/payment-due",
  "investments", "investments/[id]", "investments/[id]/entries", "investments/entries/[entryId]",
  "receivables", "receivables/[id]", "receivables/[id]/close",
  "rewards/credit-card", "rewards/conversion", "rewards/frequent-flyer",
  "rewards/hotel-rewards", "rewards/frequent-flyer/history",
  "transaction-groups", "transaction-groups/[id]", "transactions", "transactions/[id]",
  "transactions/[id]/corrections", "transactions/transfer", "workspaces", "workspaces/[id]", "workspaces/switch",
];

for (const resource of resources) {
  test(`financial API rejects invalid or unauthenticated writes to ${resource}`, async () => {
    const route = require(`../app/api/${resource}/route.ts`);
    const methods = ["POST", "PUT", "PATCH"].filter((method) => typeof route[method] === "function");
    assert.ok(methods.length, `${resource} must exercise a mutation handler`);
    for (const method of methods) {
      const before = databaseCalls.length;
      const url = `https://nest.example.test/api/${resource.replace(/\[[^\]]+\]/g, "fixture")}`;
      const request = new NextRequest(url, { method, headers: { origin: "https://nest.example.test", "content-type": "application/json" }, body: "null" });
      const response = await route[method](request, { params: Promise.resolve({ id: "fixture", entryId: "fixture" }) });
      assert.ok([400, 401, 403, 422].includes(response.status), `${method} ${resource} returned ${response.status}`);
      assert.equal(databaseCalls.length, before, "invalid writes must not touch persisted finance data");
      const result = await response.json();
      assert.ok(result.error || result.message, "the client needs a useful error response");
    }
  });
}
