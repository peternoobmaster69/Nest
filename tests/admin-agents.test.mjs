import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AGENT_IDS, defaultAgentConfiguration, enabledAgentTools } from "../lib/ai/agent-catalog.ts";
import { AgentSettingsSchema, AgentConfigurationUpdateSchema } from "../lib/ai/agent-contracts.ts";
import { assertAgentCapability, composeAgentInstructions, scoreAgentOutput, selectAgentExamples } from "../lib/ai/agent-policy.ts";
import { EMPTY_TRANSACTION_INTENT } from "../lib/ai/transaction-agent-contracts.ts";
import { AGENT_PROMPT_VERSION, DEFAULT_AGENT_INSTRUCTIONS, LEGACY_AGENT_INSTRUCTIONS } from "../lib/ai/agent-instructions.ts";
import { ensureCioDataDate } from "../lib/ai/cio-grounding.ts";

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
const { getAgentRegistry, getAgentDetail, saveAgentConfiguration, saveAgentExample, deleteAgentExample, stableAgentJson, agentHash, serializeAgentEvaluation } = await import("../lib/ai/agent-store.ts");
const { upgradeLegacyAgentInstructions } = await import("../lib/ai/agent-prompt-upgrade.ts");
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
  db.workspace = { findUnique: async () => ({ name: "Sample workspace", baseCurrency: "SGD" }) };
  db.user = { findUnique: async () => ({ name: "Sample user" }) };
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

test("prompt upgrades need no records when an agent already uses registry defaults", async () => {
  assert.deepEqual(await upgradeLegacyAgentInstructions("admin", true), AGENT_IDS.map(id => ({ id, status: "default", revision: 0 })));
  assert.equal(records.aiAgentConfig.length, 0);
  assert.equal(records.aiAgentRevision.length, 0);
});

test("prompt upgrades preview by default, preserve custom settings, and write one audited revision", async () => {
  const saved = await saveAgentConfiguration("ask-nest", settings("ask-nest", {
    instructions: LEGACY_AGENT_INSTRUCTIONS["ask-nest"], enabled: false, deployment: "household-deployment",
    capabilities: ["investments"], reasoningEffort: "high", maxOutputTokens: 5500, maxToolRounds: 5, maxToolCalls: 9, trainingExampleLimit: 2,
  }), "admin");
  const custom = await saveAgentConfiguration("transaction-assistant", settings("transaction-assistant", {
    instructions: `${LEGACY_AGENT_INSTRUCTIONS["transaction-assistant"]}\nPreserve our custom terminology.`,
  }), "admin");
  await saveAgentConfiguration("smart-review", settings("smart-review"), "admin");
  assert.deepEqual((await upgradeLegacyAgentInstructions("upgrade-admin")).map(result => result.status), ["pending", "custom", "current"]);
  assert.equal(records.aiAgentRevision.length, 3);
  assert.deepEqual(await getAgentConfiguration("ask-nest"), saved);

  assert.deepEqual((await upgradeLegacyAgentInstructions("upgrade-admin", true)).map(result => result.status), ["updated", "custom", "current"]);
  const updated = await getAgentConfiguration("ask-nest");
  assert.deepEqual(AgentSettingsSchema.strip().parse(updated), { ...AgentSettingsSchema.strip().parse(saved), instructions: DEFAULT_AGENT_INSTRUCTIONS["ask-nest"] });
  assert.equal(updated.revision, saved.revision + 1);
  assert.deepEqual(await getAgentConfiguration("transaction-assistant"), custom);
  assert.equal(records.aiAgentRevision.at(-1).actorUserId, "upgrade-admin");
  assert.equal(records.aiAgentRevision.at(-1).action, "CONFIGURATION");
  assert.equal(JSON.parse(records.aiAgentRevision.at(-1).settingsJson).instructions, DEFAULT_AGENT_INSTRUCTIONS["ask-nest"]);
  assert.deepEqual((await upgradeLegacyAgentInstructions("upgrade-admin", true)).map(result => result.status), ["current", "custom", "current"]);
  assert.equal(records.aiAgentRevision.length, 4);
});

test("prompt upgrades preserve an administrator edit made after the preview read", async () => {
  const saved = await saveAgentConfiguration("ask-nest", settings("ask-nest", { instructions: LEGACY_AGENT_INSTRUCTIONS["ask-nest"] }), "admin");
  const original = db.aiAgentConfig.findMany;
  db.aiAgentConfig.findMany = async (query) => {
    const snapshot = await original(query);
    await saveAgentConfiguration("ask-nest", { ...AgentSettingsSchema.strip().parse(saved), revision: saved.revision, instructions: "A newer custom instruction." }, "editing-admin");
    return snapshot;
  };
  try {
    const results = await upgradeLegacyAgentInstructions("upgrade-admin", true);
    assert.deepEqual(results[0], { id: "ask-nest", status: "conflict", revision: 1 });
    assert.equal((await getAgentConfiguration("ask-nest")).instructions, "A newer custom instruction.");
    assert.equal(records.aiAgentRevision.length, 2);
    assert.equal(records.aiAgentRevision.at(-1).actorUserId, "editing-admin");
  } finally { db.aiAgentConfig.findMany = original; }
});

test("prompt upgrades propagate unexpected write failures and roll back their audit revision", async (t) => {
  const saved = await saveAgentConfiguration("ask-nest", settings("ask-nest", { instructions: LEGACY_AGENT_INSTRUCTIONS["ask-nest"] }), "admin");
  const original = db.aiAgentConfig.updateMany;
  t.after(() => { db.aiAgentConfig.updateMany = original; });
  for (const error of [new Error("Storage unavailable"), Object.assign(new Error("Service unavailable"), { status: 503 }), "connection closed"]) {
    db.aiAgentConfig.updateMany = () => Promise.reject(error);
    await assert.rejects(upgradeLegacyAgentInstructions("upgrade-admin", true), (failure) => failure === error);
    assert.deepEqual(await getAgentConfiguration("ask-nest"), saved);
    assert.equal(records.aiAgentRevision.length, 1);
  }
});

test("agent content hashes ignore object insertion order while preserving array order and values", () => {
  const first = { z: [1, { b: true, a: null }, undefined], a: "quoted\"text" };
  const reordered = { a: "quoted\"text", z: [1, { a: null, b: true }, undefined] };
  assert.equal(stableAgentJson(first), '{"a":"quoted\\"text","z":[1,{"a":null,"b":true},null]}');
  assert.equal(stableAgentJson(undefined), "null");
  assert.equal(stableAgentJson(false), "false");
  assert.equal(agentHash(first), agentHash(reordered));
  assert.notEqual(agentHash(first), agentHash({ ...reordered, z: [...reordered.z].reverse() }));
  assert.notEqual(agentHash(first), agentHash({ ...reordered, a: "different" }));
  assert.match(agentHash(first), /^[a-f\d]{64}$/);
});

test("evaluation serialization marks only running work at the three-minute deadline as interrupted", (t) => {
  const now = Date.UTC(2026, 9, 10, 0, 0);
  t.mock.method(Date, "now", () => now);
  for (const [status, age, expected] of [["RUNNING", 179999, "RUNNING"], ["RUNNING", 180000, "INTERRUPTED"], ["COMPLETED", 180000, "COMPLETED"]]) {
    const createdAt = new Date(now - age);
    assert.deepEqual(serializeAgentEvaluation({
      id: "evaluation", revision: 4, datasetHash: "snapshot", status, passedCount: 1, totalCount: 2, resultsJson: '[{"passed":true}]', createdAt,
    }), { id: "evaluation", revision: 4, datasetHash: "snapshot", status: expected, passedCount: 1, totalCount: 2, results: [{ passed: true }], createdAt: createdAt.toISOString() });
  }
});

test("configuration writes reject tool limits that cannot cover the requested lookup rounds", async () => {
  await assert.rejects(saveAgentConfiguration("ask-nest", settings("ask-nest", { maxToolRounds: 5, maxToolCalls: 4 }), "admin"),
    (error) => error.status === 422 && /allowance/.test(error.message));
  assert.equal(records.aiAgentConfig.length, 0);
  assert.equal(records.aiAgentRevision.length, 0);
});

test("configuration conflicts and unavailable storage do not leave partial revisions", async (t) => {
  const saved = await saveAgentConfiguration("ask-nest", settings("ask-nest"), "admin");
  const original = db.aiAgentConfig.updateMany;
  t.after(() => { db.aiAgentConfig.updateMany = original; });
  db.aiAgentConfig.updateMany = async () => ({ count: 0 });
  await assert.rejects(saveAgentConfiguration("ask-nest", settings("ask-nest", { revision: saved.revision }), "admin"),
    (error) => error.status === 409 && /changed/.test(error.message));
  for (const code of ["P2034", "P1001"]) {
    const error = failure(code);
    db.aiAgentConfig.updateMany = () => Promise.reject(error);
    await assert.rejects(saveAgentConfiguration("ask-nest", settings("ask-nest", { revision: saved.revision }), "admin"),
      (caught) => code === "P2034" ? caught.status === 409 : caught === error);
  }
  assert.equal(records.aiAgentRevision.length, 1);
  assert.deepEqual(await getAgentConfiguration("ask-nest"), saved);
});

test("example updates enforce their agent and revision and can edit an existing full dataset", async (t) => {
  const saved = await saveAgentExample("ask-nest", exampleInput(), "admin");
  const original = db.aiAgentExample.count;
  t.after(() => { db.aiAgentExample.count = original; });
  db.aiAgentExample.count = async () => 250;
  await assert.rejects(saveAgentExample("ask-nest", exampleInput({ input: "A new request" }), "admin"),
    (error) => error.status === 422 && /250/.test(error.message));
  const changed = await saveAgentExample("ask-nest", exampleInput({ title: "Updated example" }), "editor", { id: saved.id, revision: saved.revision });
  assert.equal(changed.revision, saved.revision + 1);
  assert.equal(changed.title, "Updated example");
  assert.equal(records.aiAgentExample.length, 1);
  assert.equal(records.aiAgentRevision.at(-1).action, "EXAMPLE_UPDATED");
  assert.equal(records.aiAgentRevision.at(-1).actorUserId, "editor");
  const audits = records.aiAgentRevision.length;
  for (const [id, revision] of [["ask-nest", saved.revision], ["smart-review", changed.revision]]) {
    await assert.rejects(saveAgentExample(id, exampleInput(), "admin", { id: saved.id, revision }), (error) => error.status === 409);
  }
  assert.equal(records.aiAgentRevision.length, audits);
  assert.equal(records.aiAgentExample[0].title, "Updated example");
});

test("JSON field expectations reject invalid or empty assertions while scalar and text checks remain usable", async () => {
  for (const expectedOutput of ["{", "{}", "[]"]) {
    await assert.rejects(saveAgentExample("ask-nest", exampleInput({ expectedOutput }), "admin"),
      (error) => error.status === 422 && /non-empty/.test(error.message));
  }
  for (const [expectedOutput, matchMode] of [["null", "JSON_SUBSET"], ['"expected"', "JSON_SUBSET"], ["any text", "CONTAINS"]]) {
    const saved = await saveAgentExample("ask-nest", exampleInput({ expectedOutput, matchMode, input: `Request ${expectedOutput}` }), "admin");
    assert.equal(saved.expectedOutput, expectedOutput);
    assert.equal(saved.matchMode, matchMode);
  }
  assert.equal(records.aiAgentExample.length, 3);
  assert.equal(records.aiAgentRevision.length, 3);
});

test("registry and detail counts keep approved training, held-out evaluations, and drafts separate", async () => {
  for (const [purpose, status, input] of [
    ["TRAINING", "APPROVED", "Training example"], ["TRAINING", "DRAFT", "Training draft"],
    ["EVALUATION", "APPROVED", "Evaluation example"], ["EVALUATION", "DRAFT", "Evaluation draft"],
  ]) {
    await saveAgentExample("ask-nest", exampleInput({ purpose, status, input }), "admin");
  }
  await saveAgentExample("smart-review", exampleInput({ input: "Another agent example" }), "admin");
  const registry = await getAgentRegistry();
  const agent = registry.agents.find(({ configuration }) => configuration.id === "ask-nest");
  assert.deepEqual([agent.trainingCount, agent.evaluationCount, agent.draftCount], [1, 1, 2]);
  const detail = await getAgentDetail("ask-nest");
  assert.deepEqual([detail.trainingCount, detail.evaluationCount, detail.draftCount], [1, 1, 2]);
  assert.equal(detail.examples.length, 4);
  assert.ok(detail.examples.every(({ agentId }) => agentId === "ask-nest"));
  assert.equal(detail.revisions.length, 4);
  assert.ok(detail.revisions.every(({ action }) => action === "EXAMPLE_CREATED"));
});

test("mixed conceptual and personal questions retain permitted tools on the first model request", async () => {
  await saveAgentConfiguration("ask-nest", settings("ask-nest", { capabilities: ["investments"], trainingExampleLimit: 0 }), "admin");
  const result = await answerAskNest({ workspaceId: "sample", userId: "sample", question: "What does today's money mean, and what is my retirement target in today's money?", history: [], pagePath: "/cio", pageTitle: "CIO" });
  assert.deepEqual(result.diagnostics.recommendedTools, [], "The conceptual routing hint must not disable evidence gathering");
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].tool_choice, "auto");
  assert.ok(providerCalls[0].tools.some(tool => tool.name === "run_cio_retirement_projection"));
  assert.equal(providerCalls[0].tools.some(tool => tool.name === "get_financial_snapshot"), false);
  assert.equal(result.diagnostics.promptVersion, AGENT_PROMPT_VERSION);
});

test("Ask Nest retains a complete multi-part explanation while respecting disabled tools", async () => {
  const explanation = `A bank account represents the cash held with a bank. A sub-account assigns a purpose to part of that same cash, such as regular bills, groceries, or a future purchase. The two views answer different questions: the bank view shows where the money sits, while the sub-account view shows what it is intended to cover. Adding both balances together would count the same money twice.

A useful review starts with upcoming commitments and the cash assigned to them. Check whether bills are already covered, whether a card statement still needs to be paid, and whether the remaining allocations match the household's priorities. Moving an allocation between sub-accounts changes its purpose; it does not create income or make the household wealthier. A review should explain that distinction before recommending a change.

Card activity needs its own context. A purchase records spending, a reservation assigns cash to pay for that spending, and settling the statement pays the obligation. Those stages should be reconciled so that the same purchase is not treated as several separate expenses. A pending reimbursement also differs from available cash: another person may owe the household money, but that money has not arrived until repayment is recorded.

For decisions that depend on personal balances or dates, use the current records and their coverage. A missing transaction or an unavailable statement does not prove that no spending occurred. If evidence is incomplete, explain the supported parts of the answer and identify the particular record needed to complete the review. Keep general explanations separate from findings about the household, and avoid turning a plausible example into a claimed fact about its accounts.`;
  assert.ok(explanation.length > 1600);
  await saveAgentConfiguration("ask-nest", settings("ask-nest", { capabilities: [], trainingExampleLimit: 0 }), "admin");
  client.responses.create = async (params) => { providerCalls.push(clone(params)); return { status: "completed", output: [], output_text: JSON.stringify({ ...answer, answer: explanation }) }; };
  const result = await answerAskNest({ workspaceId: "sample", userId: "sample", question: "Explain bank accounts, sub-accounts, card settlements and reimbursements, and how they fit into a household review.", history: [], pagePath: "/", pageTitle: "Home" });
  assert.equal(result.answer.answer, explanation);
  assert.equal(ensureCioDataDate(explanation, [{ ok: true, domain: "CIO", asOfDate: "2026-10-01" }]), `${explanation} Data date: 2026-10-01.`);
  assert.deepEqual(providerCalls[0].tools, []);
  assert.equal(providerCalls[0].tool_choice, "none");
  assert.ok(providerCalls[0].text.format.schema.properties.answer.maxLength >= explanation.length);
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

test("empty-array expectations reject unwanted suggestions and nested evidence", () => {
  const expectation = { expectedOutput: '{"accountCandidates":[]}', matchMode: "JSON_SUBSET" };
  assert.equal(scoreAgentOutput('{"accountCandidates":[]}', expectation), true);
  assert.equal(scoreAgentOutput('{"accountCandidates":["Invented account"]}', expectation), false);
  assert.equal(scoreAgentOutput('{"accountCandidates":null}', expectation), false);
  assert.equal(scoreAgentOutput('{"suggestions":[{"evidence":["invented"]}]}', { expectedOutput: '{"suggestions":[{"evidence":[]}]}', matchMode: "JSON_SUBSET" }), false);
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

test("Smart Review rejects fabricated candidate keys even when budget suggestions are enabled", async () => {
  client.responses.create = async (params) => {
    providerCalls.push(clone(params));
    return { status: "completed", output: [], output_text: JSON.stringify({ suggestions: [
      { transactionId: "sample", normalizedMerchant: "Cafe", candidateKey: "BUDGET:invented", rationale: "MERCHANT_CATEGORY" },
    ] }) };
  };
  const result = await runAgentExample(defaultAgentConfiguration("smart-review"), example({ agentId: "smart-review", purpose: "EVALUATION",
    contextJson: JSON.stringify({ transactions: [{ transactionId: "sample", subject: "Cafe" }], candidates: [{ key: "BUDGET:food", label: "Food" }] }),
    expectedOutput: JSON.stringify({ suggestions: [{ transactionId: "sample", candidateKey: "NO_MATCH", rationale: "NO_CLEAR_MATCH" }] }),
  }), [], "admin");
  assert.equal(result.passed, true);
  assert.ok(JSON.parse(providerCalls[0].input[0].content).candidates.some(candidate => candidate.key === "BUDGET:food"));
});

test("evaluations replay supplied tools and never dispatch live workspace tools", async () => {
  let round = 0;
  client.responses.create = async (params) => {
    providerCalls.push(clone(params));
    return round++ === 0 ? { status: "completed", output: [{ type: "reasoning", id: "sample-reasoning", summary: [], encrypted_content: "synthetic-encrypted-context" }, { type: "function_call", name: "get_financial_snapshot", arguments: "{}", call_id: "sample-call" }] }
      : { status: "completed", output: [], output_text: JSON.stringify(answer) };
  };
  const result = await runAgentExample(defaultAgentConfiguration("ask-nest"), example({ purpose: "EVALUATION", contextJson: '{"toolResults":{"get_financial_snapshot":{"ok":true,"sampleOnly":true}}}' }), [], "admin");
  assert.equal(result.passed, true); assert.deepEqual(result.toolsUsed, ["get_financial_snapshot"]);
  assert.deepEqual(providerCalls[0].include, ["reasoning.encrypted_content"]);
  assert.ok(providerCalls[1].input.some((item) => item.type === "reasoning" && item.encrypted_content === "synthetic-encrypted-context"));
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
