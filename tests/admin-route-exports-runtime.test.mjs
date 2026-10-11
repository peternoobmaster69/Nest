import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import { calls, dataCalls, request, require, responseBody, state } from "./finance-route-harness.mjs";

const domainCalls = [];
const results = new Map();
const operation = name => (...args) => {
  domainCalls.push({ name, args });
  const result = results.get(name) ?? { operation: name };
  if (result instanceof Error) throw result;
  return result;
};
mock.module("../lib/server-session.ts", { namedExports: {
  getDatabaseReadyServerSession: async () => state.adminSession,
} });
mock.module("../lib/admin-auth.ts", { namedExports: {
  isAdminEmail: email => email === "admin@example.test",
} });
const { rateLimitResponse } = require("../lib/security-rate-limit.ts");
mock.module("../lib/security-rate-limit.ts", { namedExports: {
  rateLimitResponse,
  enforceDistributedRateLimit: async (_request, options) => { calls.push({ name: "admin-rate", args: [options] }); },
} });
mock.module("../lib/ai/agent-store.ts", { namedExports: Object.fromEntries([
  "getAgentRegistry", "getAgentDetail", "saveAgentConfiguration", "saveAgentExample", "deleteAgentExample",
].map(name => [name, operation(name)])) });
mock.module("../lib/ai/agent-training.ts", { namedExports: Object.fromEntries([
  "loadAgentTrainingSnapshot", "buildAgentDataset", "evaluateAgent",
].map(name => [name, operation(name)])) });
mock.module("../lib/ai/agent-fine-tuning.ts", { namedExports: Object.fromEntries([
  "startAgentFineTuning", "updateAgentFineTuning",
].map(name => [name, operation(name)])) });

const registry = require("../app/api/admin/agents/route.ts");
const agent = require("../app/api/admin/agents/[agentId]/route.ts");
const examples = require("../app/api/admin/agents/[agentId]/examples/route.ts");
const example = require("../app/api/admin/agents/[agentId]/examples/[exampleId]/route.ts");
const dataset = require("../app/api/admin/agents/[agentId]/dataset/route.ts");
const evaluations = require("../app/api/admin/agents/[agentId]/evaluations/route.ts");
const training = require("../app/api/admin/agents/[agentId]/fine-tuning/route.ts");
const trainingJob = require("../app/api/admin/agents/[agentId]/fine-tuning/[jobId]/route.ts");
const context = (overrides = {}) => ({ params: Promise.resolve({ agentId: "ask-nest", exampleId: "example-one", jobId: "job-one", ...overrides }) });
const settings = { revision: 4, enabled: true, instructions: "Explain the sources.", deployment: null, reasoningEffort: "default", maxOutputTokens: 1000, maxToolRounds: 2, maxToolCalls: 4, trainingExampleLimit: 1, capabilities: [] };
const exampleInput = { title: "Transport spending", input: "Review transport", expectedOutput: "Use the ledger", purpose: "TRAINING", status: "DRAFT", matchMode: "CONTAINS" };
const requestId = "adc37a60-53e5-4cb7-af76-010203040506";
const routes = [
  { name: "registry", method: "GET", handler: registry.GET },
  { name: "agent details", method: "GET", handler: agent.GET },
  { name: "configuration", method: "PATCH", handler: agent.PATCH, body: settings },
  { name: "new example", method: "POST", handler: examples.POST, body: exampleInput },
  { name: "example update", method: "PUT", handler: example.PUT, body: { ...exampleInput, revision: 4 } },
  { name: "example deletion", method: "DELETE", handler: example.DELETE, body: { revision: 4 } },
  { name: "dataset", method: "GET", handler: dataset.GET },
  { name: "evaluation", method: "POST", handler: evaluations.POST, body: { requestId, revision: 4, exampleIds: ["example-one"] } },
  { name: "training", method: "POST", handler: training.POST, body: { requestId, revision: 4, baseModel: "gpt-base", trainingType: "Standard" } },
  { name: "training action", method: "POST", handler: trainingJob.POST, body: { action: "refresh" } },
];
beforeEach(() => {
  state.adminSession = { user: { id: "admin", email: "admin@example.test" } };
  domainCalls.length = 0;
  results.clear();
  results.set("loadAgentTrainingSnapshot", { configuration: settings, examples: [exampleInput] });
  results.set("buildAgentDataset", '{"messages":[]}\n');
});

for (const route of routes) {
  test(`the ${route.name} HTTP route rejects unauthenticated and ordinary users before accessing agent data`, async () => {
    for (const [session, status] of [[null, 401], [{ user: { id: "member", email: "member@example.test" } }, 403]]) {
      state.adminSession = session;
      await responseBody(await route.handler(request(route.method, route.body), context()), status);
    }
    assert.deepEqual(domainCalls, []);
    assert.deepEqual(dataCalls("admin-rate"), []);
  });
  if (route.method === "GET") continue;
  test(`the ${route.name} HTTP route validates origin and JSON before writing`, async () => {
    await responseBody(await route.handler(request(route.method, route.body, { headers: { origin: "https://untrusted.example" } }), context()), 403);
    assert.deepEqual(dataCalls("admin-rate"), []);
    for (const [rawBody, status] of [["{", 400], ["{}", 422]])
      await responseBody(await route.handler(request(route.method, undefined, { rawBody }), context()), status);
    assert.deepEqual(domainCalls, []);
  });
}

test("registry and details preserve the service response, secure headers, and requested registered agent", async () => {
  const listing = { agents: [{ id: "ask-nest" }], provider: { configured: true } };
  results.set("getAgentRegistry", listing);
  assert.deepEqual(await responseBody(await registry.GET(request("GET"))), listing);
  await responseBody(await agent.GET(request("GET"), context({ agentId: "smart-review" })));
  assert.deepEqual(domainCalls, [{ name: "getAgentRegistry", args: [] }, { name: "getAgentDetail", args: ["smart-review"] }]);
  await responseBody(await agent.GET(request("GET"), context({ agentId: "unknown" })), 422);
  assert.equal(domainCalls.length, 2);
  assert.deepEqual(dataCalls("admin-rate"), []);
});

test("configuration changes preserve the revision and record the authenticated administrator", async () => {
  assert.deepEqual(await responseBody(await agent.PATCH(request("PATCH", settings), context())), { operation: "saveAgentConfiguration" });
  assert.deepEqual(domainCalls, [{ name: "saveAgentConfiguration", args: ["ask-nest", settings, "admin"] }]);
  assert.deepEqual(dataCalls("admin-rate"), [{ scope: "admin-agent-write", identifier: "admin", limit: 100, windowMs: 600000 }]);
});

test("example routes accept their larger body allowance, apply defaults, and pass update revisions separately", async () => {
  const rawBody = JSON.stringify(exampleInput) + " ".repeat(90000);
  await responseBody(await examples.POST(request("POST", undefined, { rawBody }), context()), 201);
  await responseBody(await example.PUT(request("PUT", { ...exampleInput, revision: 4 }), context()));
  const response = await example.DELETE(request("DELETE", { revision: 4 }), context());
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(domainCalls, [
    { name: "saveAgentExample", args: ["ask-nest", { ...exampleInput, contextJson: "{}" }, "admin"] },
    { name: "saveAgentExample", args: ["ask-nest", { ...exampleInput, contextJson: "{}" }, "admin", { id: "example-one", revision: 4 }] },
    { name: "deleteAgentExample", args: ["ask-nest", "example-one", 4, "admin"] },
  ]);
});

test("example and training-job identifiers are bounded before reaching their services", async () => {
  for (const id of ["", "x".repeat(192)]) {
    await responseBody(await example.PUT(request("PUT", { ...exampleInput, revision: 1 }), context({ exampleId: id })), 422);
    await responseBody(await example.DELETE(request("DELETE", { revision: 1 }), context({ exampleId: id })), 422);
    await responseBody(await trainingJob.POST(request("POST", { action: "refresh" }), context({ jobId: id })), 422);
  }
  assert.deepEqual(domainCalls, []);
});

test("datasets download JSONL with the selected purpose and a safe agent-specific filename", async () => {
  for (const [query, purpose] of [["", "TRAINING"], ["?purpose=EVALUATION", "EVALUATION"]]) {
    const response = await dataset.GET(request("GET", undefined, { query }), context());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
    assert.equal(response.headers.get("content-disposition"), `attachment; filename="ask-nest-${purpose.toLowerCase()}.jsonl"`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), '{"messages":[]}\n');
    assert.deepEqual(domainCalls.at(-1), { name: "buildAgentDataset", args: [settings, [exampleInput], purpose] });
  }
  await responseBody(await dataset.GET(request("GET", undefined, { query: "?purpose=UNKNOWN" }), context()), 422);
  assert.equal(domainCalls.length, 4);
});

test("evaluation and new training requests use the model allowance and preserve request identity", async () => {
  const evaluation = routes.find(route => route.name === "evaluation");
  const fineTune = routes.find(route => route.name === "training");
  await responseBody(await evaluation.handler(request("POST", evaluation.body), context()));
  await responseBody(await fineTune.handler(request("POST", fineTune.body), context()), 201);
  assert.deepEqual(domainCalls, [
    { name: "evaluateAgent", args: ["ask-nest", evaluation.body, "admin"] },
    { name: "startAgentFineTuning", args: ["ask-nest", { ...fineTune.body, epochs: "auto" }, "admin"] },
  ]);
  assert.deepEqual(dataCalls("admin-rate"), Array.from({ length: 2 }, () => ({ scope: "admin-agent-model", identifier: "admin", limit: 10, windowMs: 600000 })));
});

test("training-job refresh and cancellation target the selected job without starting another training run", async () => {
  for (const action of ["refresh", "cancel"])
    await responseBody(await trainingJob.POST(request("POST", { action }), context()));
  assert.deepEqual(domainCalls, [
    { name: "updateAgentFineTuning", args: ["ask-nest", "job-one", "refresh"] },
    { name: "updateAgentFineTuning", args: ["ask-nest", "job-one", "cancel"] },
  ]);
  assert.ok(dataCalls("admin-rate").every(options => options.scope === "admin-agent-write"));
});

test("route exports retain safe error handling when a domain operation fails", async () => {
  results.set("saveAgentConfiguration", new Error("private database details"));
  const body = await responseBody(await agent.PATCH(request("PATCH", settings), context()), 500);
  assert.doesNotMatch(JSON.stringify(body), /private database/);
});
