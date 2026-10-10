import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import { calls, dataCalls, request, require, responseBody, state } from "./finance-route-harness.mjs";

const { Prisma } = require("@prisma/client");
const { APIError } = require("openai");
const { AiConfigurationError } = require("../lib/ai/config.ts");
const { rateLimitResponse } = require("../lib/security-rate-limit.ts");
mock.module("../lib/server-session.ts", { namedExports: {
  async getDatabaseReadyServerSession() { calls.push({ name: "admin-session", args: [] }); return state.adminSession; },
} });
mock.module("../lib/admin-auth.ts", { namedExports: {
  isAdminEmail(email) { return email === "admin@example.test"; },
} });
mock.module("../lib/security-rate-limit.ts", { namedExports: {
  rateLimitResponse,
  async enforceDistributedRateLimit(_request, options) {
    calls.push({ name: "admin-rate", args: [options] });
    if (state.rateError) throw state.rateError;
  },
} });
const { runAdminAgentRoute, agentRouteId } = require("../lib/ai/agent-admin-api.ts");
beforeEach(() => {
  state.adminSession = { user: { id: "admin", email: "admin@example.test" } };
  state.rateError = null;
});
const handle = actor => { calls.push({ name: "handler", args: [actor] }); return Promise.resolve(Response.json({ actor })); };
const run = (options = {}, handler = handle, req = request(options.mutation ? "POST" : "GET")) => runAdminAgentRoute(req, options, handler);

for (const session of [null, {}, { user: {} }]) {
  test(`agent management requires a signed-in user (${JSON.stringify(session)})`, async () => {
    state.adminSession = session;
    assert.equal((await responseBody(await run(), 401)).error, "Sign in to continue.");
    assert.deepEqual(dataCalls("handler"), []);
    assert.deepEqual(dataCalls("admin-rate"), []);
  });
}

test("ordinary users cannot reach administrator agent actions", async () => {
  state.adminSession.user.email = "member@example.test";
  assert.equal((await responseBody(await run({ mutation: true }), 403)).error, "Administrator access is required.");
  assert.deepEqual(dataCalls("handler"), []);
  assert.deepEqual(dataCalls("admin-rate"), []);
});

test("administrator reads receive secure headers without spending the mutation allowance", async () => {
  assert.deepEqual(await responseBody(await run()), { actor: "admin" });
  assert.deepEqual(dataCalls("admin-rate"), []);
});

for (const modelCall of [false, true]) {
  test(`administrator ${modelCall ? "model calls" : "configuration writes"} use their own bounded rate allowance`, async () => {
    await responseBody(await run({ mutation: true, modelCall }));
    assert.deepEqual(dataCalls("admin-rate"), [{ scope: modelCall ? "admin-agent-model" : "admin-agent-write", identifier: "admin", limit: modelCall ? 10 : 100, windowMs: 600000 }]);
    assert.deepEqual(dataCalls("handler"), ["admin"]);
  });
}

test("cross-origin administrator writes stop before the session or model provider is read", async () => {
  await responseBody(await run({ mutation: true }, handle, request("POST", {}, { headers: { origin: "https://untrusted.example" } })), 403);
  assert.deepEqual(dataCalls("admin-session"), []);
  assert.deepEqual(dataCalls("handler"), []);
});

test("rate limits keep their retry delay and never execute the requested mutation", async () => {
  state.rateError = Object.assign(new Error("Too many requests"), { retryAfter: 42 });
  const response = await run({ mutation: true });
  assert.equal(response.headers.get("retry-after"), "42");
  await responseBody(response, 429);
  assert.deepEqual(dataCalls("handler"), []);
});

for (const [error, status, expected] of [
  [new Prisma.PrismaClientKnownRequestError("private schema details", { code: "P2021", clientVersion: "test" }), 503, "latest database migration"],
  [new Prisma.PrismaClientKnownRequestError("private query details", { code: "P2010", clientVersion: "test" }), 500, "temporarily unavailable"],
  [new AiConfigurationError("private connection details"), 503, "Configure the Azure AI connection"],
  [new APIError(429, {}, "private quota details", undefined), 429, "Azure could not complete"],
  [new APIError(500, {}, "private provider details", undefined), 502, "Azure could not complete"],
  [new Error("private server details"), 500, "temporarily unavailable"],
]) {
  test(`administrator provider failures expose actionable, safe ${status} responses (${error.name}: ${error.code ?? error.status ?? "unknown"})`, async () => {
    const body = await responseBody(await run({}, async () => { throw error; }), status);
    assert.match(body.error, new RegExp(expected));
    assert.doesNotMatch(JSON.stringify(body), /private .* details/);
  });
}

test("agent route parameters accept registered agents and reject arbitrary identifiers", async () => {
  for (const agentId of ["ask-nest", "smart-review", "transaction-assistant"]) {
    assert.equal(await agentRouteId({ params: Promise.resolve({ agentId }) }), agentId);
  }
  await assert.rejects(agentRouteId({ params: Promise.resolve({ agentId: "arbitrary-agent" }) }), error => error.name === "ZodError");
});
