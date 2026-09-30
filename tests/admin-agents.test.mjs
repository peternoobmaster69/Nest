import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AGENT_IDS, defaultAgentConfiguration, enabledAgentTools } from "../lib/ai/agent-catalog.ts";
import { AgentSettingsSchema, AgentConfigurationUpdateSchema } from "../lib/ai/agent-contracts.ts";
import { assertAgentCapability, composeAgentInstructions, scoreAgentOutput, selectAgentExamples } from "../lib/ai/agent-policy.ts";
import { EMPTY_TRANSACTION_INTENT } from "../lib/ai/transaction-agent-contracts.ts";

process.env.DATABASE_URL = "sqlserver://localhost:1433;database=agent_test;user=test;password=test";
process.env.AI_WORKLOAD_ENDPOINT = "https://agent-test.openai.azure.com";
process.env.AI_WORKLOAD_API_KEY = "test-secret-never-returned";
process.env.AI_WORKLOAD_MODEL = "default-deployment";

let records, sequence, providerCalls, uploads, jobCalls, transactionTail;
const clone = (value) => structuredClone(value);
const tables = ["aiAgentConfig", "aiAgentRevision", "aiAgentExample", "aiAgentEvaluation", "aiAgentFineTuneJob"];
const failure = (code) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: "test" });
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      if ("in" in value) return value.in.includes(row[key]);
      if ("notIn" in value) return !value.notIn.includes(row[key]);
    }
    return row[key] === value;
  });
}
function model(name) {
  const find = (where) => records[name].find((row) => matches(row, where));
  const update = (row, data) => {
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
    row.updatedAt = new Date();
    return clone(row);
  };
  return {
    findUnique: async ({ where }) => clone(find(where) ?? null),
    findFirst: async ({ where }) => clone(find(where) ?? null),
    findUniqueOrThrow: async ({ where }) => { const row = find(where); if (!row) throw failure("P2025"); return clone(row); },
    findMany: async ({ where, take } = {}) => clone(records[name].filter((row) => matches(row, where)).slice(0, take ?? 1000)),
    count: async ({ where }) => records[name].filter((row) => matches(row, where)).length,
    create: async ({ data }) => {
      if (records[name].some((row) => row.id === data.id || (name === "aiAgentExample" && row.agentId === data.agentId && row.contentHash === data.contentHash))) throw failure("P2002");
      const row = { id: data.id ?? `record-${++sequence}`, revision: 1, passedCount: 0, providerJobId: null, trainingFileId: null,
        validationFileId: null, fineTunedModel: null, error: null, createdAt: new Date(), updatedAt: new Date(), ...clone(data) };
      records[name].push(row); return clone(row);
    },
    update: async ({ where, data }) => { const row = find(where); if (!row) throw failure("P2025"); return update(row, data); },
    updateMany: async ({ where, data }) => { const rows = records[name].filter((row) => matches(row, where)); rows.forEach((row) => update(row, data)); return { count: rows.length }; },
    deleteMany: async ({ where }) => { const before = records[name].length; records[name] = records[name].filter((row) => !matches(row, where)); return { count: before - records[name].length }; },
    groupBy: async ({ by }) => {
      const groups = new Map();
      for (const row of records[name]) {
        const keys = Object.fromEntries(by.map((key) => [key, row[key]])); const id = JSON.stringify(keys);
        const group = groups.get(id) ?? { ...keys, _count: { _all: 0 } }; group._count._all += 1; groups.set(id, group);
      }
      return [...groups.values()];
    },
  };
}
const db = Object.fromEntries(tables.map((name) => [name, model(name)]));
db.$transaction = (callback) => {
  const result = transactionTail.then(async () => {
    const snapshot = clone(records);
    try { return await callback(db); } catch (error) { records = snapshot; throw error; }
  });
  transactionTail = result.catch(() => {});
  return result;
};
globalThis.prisma = db;
const { getAiWorkloadClient } = await import("../lib/ai/config.ts");
const { getAgentConfiguration } = await import("../lib/ai/agent-runtime.ts");
const { getAgentRegistry, getAgentDetail, saveAgentConfiguration, saveAgentExample, deleteAgentExample } = await import("../lib/ai/agent-store.ts");
const { agentDatasetLine, buildAgentDataset, evaluateAgent, runAgentExample } = await import("../lib/ai/agent-training.ts");
const { startAgentFineTuning, updateAgentFineTuning } = await import("../lib/ai/agent-fine-tuning.ts");
const { answerAskNest } = await import("../lib/ai/ask-nest.ts");
const { interpretTransactionMessage } = await import("../lib/ai/transaction-agent-parser.ts");
const client = getAiWorkloadClient().client;
const answer = { answer: "Review recent records before drawing a conclusion.", highlights: [], evidence_ids: [], follow_up_questions: [], memory_candidates: [] };
const intent = { ...EMPTY_TRANSACTION_INTENT, operation: "CREATE", amount: "10", direction: "DEBIT", subject: "Bus fare", accountQuery: "Transit" };
const settings = (id, overrides = {}) => ({ ...AgentSettingsSchema.strip().parse(defaultAgentConfiguration(id)), revision: 0, ...overrides });
const exampleInput = (overrides = {}) => ({ title: "Review a request", input: "Explain the spending pattern", expectedOutput: JSON.stringify(answer), contextJson: "{}", purpose: "TRAINING", status: "APPROVED", matchMode: "JSON_SUBSET", ...overrides });
const example = (overrides = {}) => ({ id: "example", agentId: "ask-nest", revision: 1, updatedAt: new Date().toISOString(), ...exampleInput(), ...overrides });

beforeEach(() => {
  records = Object.fromEntries(tables.map((name) => [name, []])); sequence = 0; providerCalls = []; uploads = []; jobCalls = []; transactionTail = Promise.resolve();
  client.responses.create = async (params) => { providerCalls.push(clone(params)); return { status: "completed", output: [], output_text: JSON.stringify(answer) }; };
  client.responses.parse = async (params) => { providerCalls.push(params); return { status: "completed", output_parsed: clone(intent) }; };
  client.files.create = async ({ file }) => { uploads.push(await file.text()); return { id: `file-${uploads.length}` }; };
  client.fineTuning.jobs.create = async (params) => { jobCalls.push(clone(params)); return { id: "ftjob-test", status: "queued", fine_tuned_model: null, training_file: params.training_file }; };
  client.fineTuning.jobs.list = async () => ({ data: [{ id: "ftjob-test", training_file: "file-1" }] });
  client.fineTuning.jobs.retrieve = async () => ({ id: "ftjob-test", status: "succeeded", fine_tuned_model: "trained-model", error: null });
  client.fineTuning.jobs.cancel = async () => ({ id: "ftjob-test", status: "cancelled", fine_tuned_model: null, error: null });
});

test("all real agents are registered with capabilities and no provider secrets", async () => {
  const registry = await getAgentRegistry();
  assert.deepEqual(registry.agents.map((agent) => agent.configuration.id), AGENT_IDS);
  assert.ok(registry.agents.every((agent) => agent.configuration.capabilities.length));
  assert.equal(registry.provider.model, "default-deployment");
  assert.equal(JSON.stringify(registry).includes(process.env.AI_WORKLOAD_API_KEY), false);
});

test("configuration updates validate capabilities, reject stale revisions, and record their actor", async () => {
  const saved = await saveAgentConfiguration("ask-nest", settings("ask-nest", { capabilities: ["budgets"], deployment: "custom-deployment" }), "admin");
  assert.equal(saved.revision, 1); assert.equal(saved.deployment, "custom-deployment");
  assert.deepEqual([...enabledAgentTools(saved)].sort(), ["get_budget_plan", "get_budget_vs_actual", "explain_reconciliation"].sort());
  assert.equal(records.aiAgentRevision[0].actorUserId, "admin");
  await assert.rejects(saveAgentConfiguration("ask-nest", settings("ask-nest"), "admin"), /changed/);
  await assert.rejects(saveAgentConfiguration("ask-nest", settings("ask-nest", { revision: 1, capabilities: ["write_arbitrary_sql"] }), "admin"), /registered/);
  assert.equal(AgentConfigurationUpdateSchema.safeParse(settings("ask-nest", { maxToolCalls: 999 })).success, false);
});

test("paused Ask Nest stops before any provider or workspace work", async () => {
  await saveAgentConfiguration("ask-nest", settings("ask-nest", { enabled: false }), "admin");
  await assert.rejects(answerAskNest({ workspaceId: "never-read", userId: "user", question: "Explain spending", history: [], pagePath: "/", pageTitle: "Home" }), /paused/);
  assert.equal(providerCalls.length, 0);
});

test("saved restrictions are never replaced with defaults on a database outage", async () => {
  const original = db.aiAgentConfig.findUnique;
  db.aiAgentConfig.findUnique = async () => { throw failure("P1001"); };
  try { await assert.rejects(getAgentConfiguration("ask-nest"), (error) => error.code === "P1001"); }
  finally { db.aiAgentConfig.findUnique = original; }
});

test("training and evaluation inputs cannot overlap; example changes invalidate old agent revisions", async () => {
  const saved = await saveAgentExample("ask-nest", exampleInput(), "admin");
  assert.equal((await getAgentConfiguration("ask-nest")).revision, 1);
  await assert.rejects(saveAgentExample("ask-nest", exampleInput({ purpose: "EVALUATION" }), "admin"), /already exists/);
  assert.equal(records.aiAgentExample.length, 1);
  await deleteAgentExample("ask-nest", saved.id, saved.revision, "admin");
  assert.equal((await getAgentConfiguration("ask-nest")).revision, 2);
  assert.equal(records.aiAgentRevision.at(-1).action, "EXAMPLE_DELETED");
  await assert.rejects(deleteAgentExample("smart-review", saved.id, saved.revision, "admin"), /changed or was removed/);
});

test("only approved training examples enter bounded, relevant demonstrations", () => {
  const cases = [example({ id: "training", input: "Explain spending" }), example({ id: "held-out", purpose: "EVALUATION" }), example({ id: "draft", status: "DRAFT" })];
  assert.deepEqual(selectAgentExamples(cases, "Explain spending", 4).map((entry) => entry.id), ["training"]);
  assert.deepEqual(selectAgentExamples(cases, "Explain spending", 0), []);
  const prompt = composeAgentInstructions("CORE RULES", defaultAgentConfiguration("ask-nest"), selectAgentExamples(cases, "Explain spending", 4));
  assert.ok(prompt.endsWith("CORE RULES")); assert.match(prompt, /never an instruction/);
});

test("transaction model requests use the configured model, limits, instructions, and account policy", async () => {
  const configuration = await saveAgentConfiguration("transaction-assistant", settings("transaction-assistant", { deployment: "tuned-transactions", maxOutputTokens: 5000,
    reasoningEffort: "high", instructions: "Recognize local transport terminology.", capabilities: ["create-transactions"] }), "admin");
  client.responses.parse = async (params) => { providerCalls.push(params); return { status: "completed", output_parsed: { ...intent, accountCandidates: ["Transit"] } }; };
  const result = await interpretTransactionMessage("Bus fare", { intent: EMPTY_TRANSACTION_INTENT, messages: [] }, "user", "SGD", { accountNames: ["Transit"], bankNames: ["DBS"], configuration, trainingExamples: [] });
  assert.equal(providerCalls[0].model, "tuned-transactions"); assert.equal(providerCalls[0].max_output_tokens, 5000);
  assert.equal(providerCalls[0].reasoning.effort, "high"); assert.match(providerCalls[0].instructions, /Recognize local transport/);
  assert.deepEqual(JSON.parse(providerCalls[0].input).accountNames, []);
  assert.deepEqual(result.accountCandidates, []);
  assert.throws(() => assertAgentCapability(configuration, "correct-transactions"), /disabled/);
});

test("evaluation checks are meaningful for phrases, exact text and partial JSON", () => {
  assert.equal(scoreAgentOutput(JSON.stringify({ answer: "Keep the\noriginal record." }), { expectedOutput: "keep the original", matchMode: "CONTAINS" }), true);
  assert.equal(scoreAgentOutput('{"amount":"10","subject":"Bus"}', { expectedOutput: '{"amount":"12"}', matchMode: "JSON_SUBSET" }), false);
  assert.equal(scoreAgentOutput('{"amount":"10","subject":"Bus"}', { expectedOutput: '{"amount":"10"}', matchMode: "JSON_SUBSET" }), true);
  assert.equal(scoreAgentOutput('{"amount":"10"}', { expectedOutput: "{}", matchMode: "JSON_SUBSET" }), false);
  assert.equal(scoreAgentOutput('{\n  "amount": "10", "subject": "Bus"\n}', { expectedOutput: '{"subject":"Bus","amount":"10"}', matchMode: "EXACT" }), true);
  assert.equal(scoreAgentOutput('{"amount":"10","subject":"Bus"}', { expectedOutput: '{"amount":"10"}', matchMode: "EXACT" }), false);
});

test("transaction evaluations apply the same account-suggestion restrictions as live interpretation", async () => {
  client.responses.create = async (params) => { providerCalls.push(clone(params)); return { status: "completed", output: [], output_text: JSON.stringify({ ...intent, accountCandidates: ["Transit"] }) }; };
  const result = await runAgentExample({ ...defaultAgentConfiguration("transaction-assistant"), capabilities: ["create-transactions"] },
    example({ agentId: "transaction-assistant", purpose: "EVALUATION", expectedOutput: '{"accountCandidates":[]}', contextJson: '{"accountNames":["Transit"]}' }), [], "admin");
  assert.equal(result.passed, true);
  assert.deepEqual(JSON.parse(providerCalls[0].input[0].content).accountNames, []);
});

test("Smart Review evaluation filters forbidden candidates and unsupported model destinations", async () => {
  client.responses.create = async (params) => {
    providerCalls.push(clone(params));
    return { status: "completed", output: [], output_text: JSON.stringify({ suggestions: [
      { transactionId: "sample", normalizedMerchant: "New merchant name", candidateKey: "BUDGET:food", rationale: "MERCHANT_CATEGORY" },
      { transactionId: "foreign", normalizedMerchant: "Unknown", candidateKey: "RECEIVABLE", rationale: "RECEIVABLE_LANGUAGE" },
    ] }) };
  };
  const result = await runAgentExample({ ...defaultAgentConfiguration("smart-review"), capabilities: [] }, example({ agentId: "smart-review", purpose: "EVALUATION",
    contextJson: JSON.stringify({ transactions: [{ transactionId: "sample", subject: "Original merchant" }], candidates: [{ key: "BUDGET:food", label: "Food" }, { key: "RECEIVABLE", label: "Reimbursement" }] }),
    expectedOutput: JSON.stringify({ suggestions: [{ transactionId: "sample", normalizedMerchant: "Original merchant", candidateKey: "NO_MATCH", rationale: "NO_CLEAR_MATCH" }] }), matchMode: "EXACT" }), [], "admin");
  assert.equal(result.passed, true);
  assert.deepEqual(JSON.parse(providerCalls[0].input[0].content).candidates, [{ key: "NO_MATCH", label: "No reliable match" }]);
  assert.equal(JSON.parse(result.actualOutput).suggestions.length, 1);
});

test("evaluations replay supplied tools and never dispatch live workspace tools", async () => {
  let round = 0;
  client.responses.create = async (params) => {
    providerCalls.push(clone(params));
    return round++ === 0 ? { status: "completed", output: [{ type: "function_call", name: "get_financial_snapshot", arguments: "{}", call_id: "sample-call" }] }
      : { status: "completed", output: [], output_text: JSON.stringify(answer) };
  };
  const result = await runAgentExample(defaultAgentConfiguration("ask-nest"), example({ purpose: "EVALUATION", contextJson: '{"toolResults":{"get_financial_snapshot":{"ok":true,"sampleOnly":true}}}' }), [], "admin");
  assert.equal(result.passed, true); assert.deepEqual(result.toolsUsed, ["get_financial_snapshot"]);
  assert.ok(providerCalls[1].input.some((item) => item.type === "function_call_output" && item.output.includes("sampleOnly")));
});

test("evaluation cannot call a disabled tool even if the model invents a call", async () => {
  client.responses.create = async () => ({ status: "completed", output: [{ type: "function_call", name: "get_financial_snapshot", arguments: "{}", call_id: "sample-call" }] });
  const result = await runAgentExample({ ...defaultAgentConfiguration("ask-nest"), capabilities: ["budgets"] }, example(), [], "admin");
  assert.equal(result.passed, false); assert.deepEqual(result.toolsUsed, []);
});

test("an evaluation uses held-out cases and replays a retried request without a second provider call", async () => {
  const training = await saveAgentExample("ask-nest", exampleInput(), "admin");
  const heldOut = await saveAgentExample("ask-nest", exampleInput({ input: "Review a different spending pattern", purpose: "EVALUATION" }), "admin");
  const revision = (await getAgentConfiguration("ask-nest")).revision;
  await assert.rejects(evaluateAgent("ask-nest", { requestId: randomUUID(), revision, exampleIds: [training.id] }, "admin"), /evaluation cases/);
  const input = { requestId: randomUUID(), revision, exampleIds: [heldOut.id] };
  const result = await evaluateAgent("ask-nest", input, "admin");
  assert.equal(result.status, "COMPLETED"); assert.equal(result.passedCount, 1);
  assert.equal((await evaluateAgent("ask-nest", input, "admin")).id, result.id); assert.equal(providerCalls.length, 1);
  assert.equal((await getAgentDetail("ask-nest")).evaluations.length, 1);
});

test("JSONL export excludes drafts and held-out cases and requires full structured outputs", () => {
  const configuration = defaultAgentConfiguration("ask-nest");
  const lines = buildAgentDataset(configuration, [example(), example({ id: "held-out", purpose: "EVALUATION" }), example({ id: "draft", status: "DRAFT" })], "TRAINING").trim().split("\n");
  assert.equal(lines.length, 1); assert.deepEqual(JSON.parse(JSON.parse(lines[0]).messages.at(-1).content), answer);
  assert.throws(() => agentDatasetLine(configuration, example({ expectedOutput: "A fragment" })), /complete JSON response/);
  assert.throws(() => agentDatasetLine(configuration, example({ contextJson: '{"toolResults":{"get_financial_snapshot":{"balance":100}}}' })), /uses tool evidence/);
  assert.throws(() => agentDatasetLine(configuration, example({ expectedOutput: JSON.stringify({ ...answer, evidence_ids: ["snapshot"] }) })), /uses tool evidence/);
});

async function seedTraining() {
  for (let index = 0; index < 10; index += 1) await saveAgentExample("transaction-assistant", exampleInput({ input: `Deduct ${index + 1} for bus fare`, expectedOutput: JSON.stringify({ ...intent, amount: String(index + 1) }) }), "admin");
  return { requestId: randomUUID(), revision: (await getAgentConfiguration("transaction-assistant")).revision, baseModel: "gpt-4.1-2025-04-14", trainingType: "Standard", epochs: "auto" };
}

test("fine-tuning requires ten examples and only submits one job for a repeated request", async () => {
  await assert.rejects(startAgentFineTuning("transaction-assistant", { requestId: randomUUID(), revision: 0, baseModel: "gpt-4.1", trainingType: "Standard", epochs: "auto" }, "admin"), /at least 10/);
  assert.equal(uploads.length, 0);
  const input = await seedTraining();
  const result = await startAgentFineTuning("transaction-assistant", input, "admin");
  assert.equal(result.status, "QUEUED"); assert.equal(uploads[0].trim().split("\n").length, 10);
  assert.equal(jobCalls[0].trainingType, "Standard");
  await startAgentFineTuning("transaction-assistant", input, "admin");
  assert.equal(jobCalls.length, 1); assert.equal(uploads.length, 1);
  const finished = await updateAgentFineTuning("transaction-assistant", result.id, "refresh");
  assert.equal(finished.status, "SUCCEEDED"); assert.equal(finished.fineTunedModel, "trained-model");
  assert.equal((await getAgentConfiguration("transaction-assistant")).deployment, null, "Azure models need an explicit deployment before activation");
});

test("an ambiguous provider timeout is reconciled instead of submitting duplicate training", async () => {
  const input = await seedTraining();
  let attempts = 0;
  client.fineTuning.jobs.create = async () => { attempts += 1; throw new Error("Connection interrupted after request send"); };
  const result = await startAgentFineTuning("transaction-assistant", input, "admin");
  assert.equal(result.status, "UNKNOWN");
  await startAgentFineTuning("transaction-assistant", input, "admin"); assert.equal(attempts, 1);
  const reconciled = await updateAgentFineTuning("transaction-assistant", result.id, "refresh");
  assert.equal(reconciled.providerJobId, "ftjob-test"); assert.equal(reconciled.status, "SUCCEEDED");
});

test("new provider states keep the single-active-training-job limit", async () => {
  const input = await seedTraining();
  await startAgentFineTuning("transaction-assistant", input, "admin");
  records.aiAgentFineTuneJob[0].status = "PAUSED";
  await assert.rejects(startAgentFineTuning("transaction-assistant", { ...input, requestId: randomUUID() }, "admin"), /still active/);
  assert.equal(jobCalls.length, 1);
  assert.equal(uploads.length, 1);
});
