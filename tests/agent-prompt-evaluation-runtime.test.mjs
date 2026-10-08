import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test, { beforeEach, mock } from "node:test";
import { getAiWorkloadClient } from "../lib/ai/config.ts";

const datasetUrl = new URL("../evals/agents/prompts.json", import.meta.url).href;
const reportFile = "/virtual/nest-eval/report.json";
const snapshotFile = "/virtual/nest-eval/snapshot.json";
const files = new Map();
const calls = [];
const logs = [];
const databaseReads = [];
let cases;
let provider;
let invocation = 0;
const blockedDatabase = new Proxy({}, { get(_target, name) { databaseReads.push(String(name)); throw new Error("Evaluations must never read workspace data"); } });
mock.module("node:fs/promises", { defaultExport: fs, namedExports: {
  ...fs,
  readFile: async (file, ...options) => {
    if (String(file) === datasetUrl) return JSON.stringify(cases);
    if (files.has(String(file))) return files.get(String(file));
    return fs.readFile(file, ...options);
  },
  writeFile: async (file, contents, ...options) => {
    if (String(file).startsWith("/virtual/nest-eval/")) { files.set(String(file), contents); return; }
    return fs.writeFile(file, contents, ...options);
  },
} });

const transaction = (id, overrides = {}) => ({ id, agentId: "transaction-assistant", input: `Record the bus fare for ${id}`, context: {}, expected: { operation: "CREATE" }, ...overrides });
const advisor = (id, overrides = {}) => ({ id, agentId: "ask-nest", input: `Review my budget for ${id}`, context: { pagePath: "/cio" }, answerPatterns: ["budget"], ...overrides });
const review = (id, overrides = {}) => ({ id, agentId: "smart-review", input: "Review the coffee purchase", context: { transactions: [{ transactionId: "coffee", subject: "Coffee" }] }, expected: { suggestions: [{ transactionId: "coffee" }] }, ...overrides });
const response = (output, overrides = {}) => ({ status: "completed", output: [], output_text: JSON.stringify(output), usage: { total_tokens: 10 }, ...overrides });
const toolCall = (name = "get_budget_plan", argumentsValue = { month: "2026-10" }) => ({ type: "function_call", name, call_id: `call-${calls.length}`, arguments: JSON.stringify(argumentsValue) });
const summary = () => JSON.parse(logs.at(-1));
const report = () => JSON.parse(files.get(reportFile));
beforeEach((t) => {
  const environment = { ...process.env };
  const argv = process.argv;
  const exitCode = process.exitCode;
  const prisma = globalThis.prisma;
  process.env.DATABASE_URL = "sqlserver://127.0.0.1:1433;database=eval_fixture;user=fixture;password=fixture";
  process.env.AI_WORKLOAD_ENDPOINT = "https://provider.example.test";
  process.env.AI_WORKLOAD_API_KEY = "fixture-key";
  process.env.AI_WORKLOAD_MODEL = "fixture-model";
  process.exitCode = 0;
  globalThis.prisma = blockedDatabase;
  cases = [transaction("first")];
  files.clear(); calls.length = 0; logs.length = 0; databaseReads.length = 0;
  provider = async () => response({ operation: "CREATE" });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
  t.mock.method(getAiWorkloadClient().client.responses, "create", async (parameters, options) => {
    calls.push({ parameters: structuredClone(parameters), options });
    return provider(parameters);
  });
  t.mock.method(console, "log", (message) => logs.push(message));
  t.after(() => {
    process.argv = argv; process.exitCode = exitCode; globalThis.prisma = prisma;
    for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
  });
});
async function run(args = []) {
  process.argv = [process.execPath, "evaluate-agent-prompts.mjs", ...args];
  await import(`../scripts/evaluate-agent-prompts.mjs?evaluation-test=${++invocation}`);
}

test("prompt snapshots cover the three real agent schemas and merge edit context without provider or database calls", async () => {
  cases = [transaction("edit", { context: { previousIntent: { amount: "12", subject: "Bus" } } }), review("review"), advisor("advice")];
  await run(["--snapshot", snapshotFile]);
  assert.deepEqual(summary(), { cases: 3, agents: ["transaction-assistant", "smart-review", "ask-nest"], providerCalls: 0, valid: true });
  const requests = JSON.parse(files.get(snapshotFile));
  assert.deepEqual(requests.map(({ id }) => id), ["edit", "review", "advice"]);
  const previous = JSON.parse(requests[0].input).previousIntent;
  assert.equal(previous.amount, "12");
  assert.equal(previous.subject, "Bus");
  assert.equal(previous.direction, null);
  assert.ok(requests.every((request) => request.schema.type === "object" && request.maxOutputTokens > 0));
  assert.deepEqual(requests[0].tools, []);
  assert.deepEqual(requests[1].tools, []);
  assert.ok(requests[2].tools.some(({ name }) => name === "get_budget_plan"));
  assert.match(requests[2].instructions, /SGD/);
  assert.deepEqual(calls, []);
  assert.deepEqual(databaseReads, []);
});

test("prompt replay preserves a saved request and rejects mismatched snapshot IDs", async () => {
  await run(["--snapshot", snapshotFile]);
  const stored = JSON.parse(files.get(snapshotFile));
  stored[0].instructions = "Reviewed prompt version";
  files.set(snapshotFile, JSON.stringify(stored));
  await run(["--from", snapshotFile, "--snapshot", "/virtual/nest-eval/replayed.json"]);
  assert.deepEqual(JSON.parse(files.get("/virtual/nest-eval/replayed.json")), stored);
  stored[0].id = "different";
  files.set(snapshotFile, JSON.stringify(stored));
  await assert.rejects(run(["--from", snapshotFile]), /Snapshot and case IDs must match/);
  assert.equal(calls.length, 0);
});

test("invalid evaluation definitions cannot call a provider or write a report", async () => {
  for (const [dataset, error] of [[ [transaction("same"), transaction("same")], /Case IDs must be unique/ ], [ [transaction("empty", { expected: undefined })], /needs a substantive assertion/ ], [ [advisor("invalid", { answerPatterns: ["["] })], /invalid answer pattern/ ]]) {
    cases = dataset;
    await assert.rejects(run(["--live", "--output", reportFile]), error);
  }
  assert.equal(calls.length, 0);
  assert.equal(files.has(reportFile), false);
});

test("tool-free live evaluations score output, preserve request limits, and handle a final single-case batch", async () => {
  cases = [transaction("one"), transaction("two"), transaction("three")];
  await run(["--live", "--output", reportFile]);
  assert.equal(process.exitCode, 0);
  assert.deepEqual(summary(), { model: "fixture-model", passed: 3, total: 3, completed: 3, tokens: 30 });
  assert.equal(report().results.length, 3);
  assert.match(report().datasetHash, /^[a-f0-9]{64}$/);
  assert.ok(report().results.every((result) => result.passed && result.calls.length === 0 && result.promptHash.length === 64));
  for (const { parameters, options } of calls) {
    assert.equal(parameters.tool_choice, "none");
    assert.equal(parameters.parallel_tool_calls, false);
    assert.equal(parameters.store, false);
    assert.equal(parameters.text.format.strict, true);
    assert.deepEqual(parameters.include, ["reasoning.encrypted_content"]);
    assert.equal(options.maxRetries, 0);
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.deepEqual(databaseReads, []);
});

test("tool rounds replay only supplied synthetic fixtures and score required tool arguments", async () => {
  cases = [advisor("budget", { tools: [{ name: "get_budget_plan", arguments: { month: "2026-10" } }], context: { pagePath: "/cio", toolResults: { get_budget_plan: { ok: true, budget: "Synthetic budget" } } } })];
  await run(["--snapshot", snapshotFile]);
  const requests = JSON.parse(files.get(snapshotFile));
  requests[0].initialToolChoice = "required";
  files.set(snapshotFile, JSON.stringify(requests));
  provider = async () => calls.length === 1 ? response(null, { output: [toolCall()] }) : response({ answer: "Your budget is supported by the fixture." });
  await run(["--live", "--from", snapshotFile, "--output", reportFile]);
  assert.equal(process.exitCode, 0);
  assert.deepEqual(calls.map(({ parameters }) => parameters.tool_choice), ["required", "auto"]);
  assert.equal(calls[0].parameters.input.length, 1);
  const result = calls[1].parameters.input.find(({ type }) => type === "function_call_output");
  assert.deepEqual(JSON.parse(result.output), { ok: true, budget: "Synthetic budget" });
  assert.equal(report().results[0].checks.expectedTools, true);
  assert.equal(report().results[0].tokens, 20);
  assert.deepEqual(databaseReads, []);
});

test("missing tool evidence produces an explicit synthetic failure without reading real data", async () => {
  cases = [advisor("missing", { context: {} }), advisor("empty", { context: { toolResults: {} } })];
  provider = async (parameters) => parameters.input.length === 1
    ? response(null, { output: [toolCall()], usage: undefined })
    : response({ answer: "No budget evidence is available." }, { usage: { total_tokens: 0 } });
  await run(["--live", "--output", reportFile]);
  assert.equal(process.exitCode, 0);
  assert.equal(report().tokens, 0);
  const supplied = calls.filter(({ parameters }) => parameters.input.length > 1);
  assert.equal(supplied.length, 2);
  for (const { parameters } of supplied) {
    assert.deepEqual(JSON.parse(parameters.input.at(-1).output), { ok: false, error: "No sample evidence is available for this tool." });
  }
  assert.deepEqual(databaseReads, []);
});

test("rescoring applies field, tool, language, and complete-review assertions while retaining provider failures", async () => {
  cases = [
    transaction("valid", { nonEmptyFields: ["clarification"], tools: [{ name: "get_budget_plan", arguments: { month: "2026-10" } }] }),
    transaction("wrong-type", { nonEmptyFields: ["clarification"], tools: [{ name: "get_budget_plan", arguments: { month: "2026-10" } }] }),
    transaction("blank", { nonEmptyFields: ["clarification"] }),
    transaction("extra-tool", { noTools: true }),
    advisor("forbidden", { forbiddenPatterns: ["guaranteed"] }),
    advisor("missing-answer", { noTools: true, forbiddenPatterns: ["guaranteed"] }),
    review("partial-review"), review("complete-review"), review("absent-review"),
    transaction("provider-failure"),
    advisor("tool-name", { tools: [{ name: "get_budget_plan" }] }),
  ];
  const results = [
    { output: { operation: "CREATE", clarification: "Which account?" }, calls: [{ name: "get_budget_plan", arguments: { month: "2026-10" } }] },
    { output: { operation: "UPDATE", clarification: 3 }, calls: [{ name: "get_budget_plan", arguments: { month: "2026-09" } }] },
    { output: { operation: "CREATE", clarification: " " } },
    { output: { operation: "CREATE" }, calls: [{ name: "unexpected", arguments: {} }] },
    { output: { answer: "Guaranteed return" } },
    { output: {} },
    { output: { suggestions: [] } },
    { output: { suggestions: [{ transactionId: "coffee" }] } },
    { output: {} },
    { passed: false, error: "Timed out" },
    { output: { answer: "Review the budget" }, calls: [{ name: "different", arguments: {} }, { name: "get_budget_plan", arguments: {} }] },
  ].map((result, index) => ({ id: cases[index].id, calls: [], ...result }));
  const original = { model: "reviewed-model", total: cases.length, results };
  files.set("/virtual/nest-eval/prior.json", JSON.stringify(original));
  await run(["--rescore", "/virtual/nest-eval/prior.json", "--output", reportFile]);
  const rescored = report();
  assert.equal(rescored.passed, 3);
  assert.equal(rescored.results[0].passed, true);
  assert.equal(rescored.results[1].checks.expectedFields, false);
  assert.equal(rescored.results[1].checks.requiredValues, false);
  assert.equal(rescored.results[1].checks.expectedTools, false);
  assert.equal(rescored.results[2].checks.requiredValues, false);
  assert.equal(rescored.results[3].checks.noExtraTools, false);
  assert.equal(rescored.results[4].checks.noForbiddenContent, false);
  assert.equal(rescored.results[5].checks.answerContent, false);
  assert.equal(rescored.results[5].checks.noForbiddenContent, true);
  assert.equal(rescored.results[6].checks.completeReview, false);
  assert.equal(rescored.results[7].passed, true);
  assert.equal(rescored.results[8].checks.completeReview, false);
  assert.deepEqual(rescored.results[9], results[9]);
  assert.equal(rescored.results[10].checks.expectedTools, true);
  assert.ok(Number.isFinite(Date.parse(rescored.rescoredAt)));
  await run(["--rescore", "/virtual/nest-eval/prior.json"]);
  assert.deepEqual(summary(), { model: "reviewed-model", passed: 3, total: 11, providerCalls: 0, rescored: true });
  files.set("/virtual/nest-eval/prior.json", JSON.stringify({ results: [] }));
  await assert.rejects(run(["--rescore", "/virtual/nest-eval/prior.json"]), /Report and case IDs must match/);
  assert.equal(calls.length, 0);
});

for (const [name, result, errorName] of [
  ["incomplete response", response({}, { status: "incomplete" }), "Error"],
  ["invalid JSON", response({}, { output_text: "invalid JSON" }), "SyntaxError"],
]) {
  test(`live evaluations fail closed on ${name}`, async () => {
    provider = async () => result;
    await run(["--live", "--output", reportFile]);
    assert.equal(process.exitCode, 1);
    assert.equal(report().passed, 0);
    assert.equal(report().results[0].error, errorName);
    assert.equal(report().results[0].status, null);
    assert.equal(calls.length, 1);
  });
}

for (const [name, outputs, expectedRecorded] of [
  ["unregistered tools", () => [toolCall("delete_workspace")], 0],
  ["excess tool calls", () => Array.from({ length: 9 }, () => toolCall()), 8],
]) {
  test(`live evaluations stop ${name} before any application tool can run`, async () => {
    cases = [advisor("bounded")];
    provider = async () => response(null, { output: outputs() });
    await run(["--live", "--output", reportFile]);
    assert.equal(process.exitCode, 1);
    assert.equal(calls.length, 1);
    assert.equal(report().results[0].calls.length, expectedRecorded);
    assert.equal(report().results[0].error, "Error");
    assert.deepEqual(databaseReads, []);
  });
}

test("tool round limits force a final answer and fail when the provider continues requesting tools", async () => {
  cases = [advisor("bounded")];
  provider = async () => response(null, { output: [toolCall()] });
  await run(["--live", "--output", reportFile]);
  assert.equal(process.exitCode, 1);
  assert.deepEqual(calls.map(({ parameters }) => parameters.tool_choice), ["auto", "auto", "auto", "auto", "none"]);
  assert.equal(report().results[0].calls.length, 5);
  assert.equal(report().results[0].error, "Error");
});

for (const status of [401, 403, 404]) {
  test(`a batch of provider ${status} errors stops the remaining paid evaluations`, async () => {
    cases = Array.from({ length: 5 }, (_, index) => transaction(`case-${index}`));
    provider = async () => { throw Object.assign(new Error("Provider refused the request"), { status }); };
    await run(["--live", "--output", reportFile]);
    assert.equal(process.exitCode, 1);
    assert.equal(calls.length, 2);
    assert.equal(report().completed, 2);
    assert.equal(report().total, 5);
    assert.ok(report().results.every((result) => result.status === status));
  });
}

test("non-authentication failures retain later cases and a successful run can omit a report file", async () => {
  cases = [transaction("first"), transaction("second"), transaction("third")];
  provider = async (parameters) => {
    if (parameters.input[0].content.includes("third")) return response({ operation: "CREATE" });
    throw Object.assign(new Error("Rate limited"), { status: 429 });
  };
  await run(["--live", "--output", reportFile]);
  assert.equal(report().completed, 3);
  assert.equal(report().passed, 1);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
  cases = [transaction("only")];
  provider = async () => response({ operation: "CREATE" });
  await run(["--live"]);
  assert.equal(process.exitCode, 0);
  assert.equal(summary().passed, 1);
});
