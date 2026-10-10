import assert from "node:assert/strict";
import test from "node:test";
import { createAgentUiHarness } from "./agent-ui-harness.mjs";

const { ui, require, state, detail, show, deferred } = await createAgentUiHarness();
const { AdminAgentsPage } = require("../components/admin-agents-page.tsx");
const { AgentSettingsSchema } = require("../lib/ai/agent-contracts.ts");
const { DEFAULT_AGENT_INSTRUCTIONS } = require("../lib/ai/agent-instructions.ts");
const { reconcileSavedAgentDraft } = require("../lib/ai/agent-draft.ts");

function saveConfiguration({ url, body }) {
  const id = url.split("/").at(-1);
  const existing = state.details.get(id);
  const configuration = { ...existing.configuration, ...body, revision: body.revision + 1 };
  state.details.set(id, { ...existing, configuration });
  state.registry.agents = state.registry.agents.map((agent) => agent.configuration.id === id ? { ...agent, configuration } : agent);
  return configuration;
}

test("the agent registry exposes loading and recoverable failure states before rendering its workbench", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(state.registry));
  state.responses.set("GET /api/admin/agents", () => pending.promise);
  const view = show(AdminAgentsPage);
  assert.ok(view.getByRole("heading", { name: "Agents", level: 1 }));
  assert.ok(!view.queryByLabelText("Instructions"));
  await ui.act(async () => pending.resolve(state.registry));
  await view.findByLabelText("Instructions");
  assert.equal(view.getByRole("link", { name: "Agents" }).getAttribute("href"), "/w/workspace-one/admin/agents");
  assert.ok(view.getByText("Azure AI configured"));
  assert.match(view.container.querySelector(".agent-overview").textContent, /3 active agents.*3 approved training examples/);
  view.unmount();

  state.responses.set("GET /api/admin/agents", new Error("Registry unavailable"));
  const failed = show(AdminAgentsPage);
  await failed.findByText("Agents could not be loaded");
  assert.ok(failed.getByText("Registry unavailable"));
  state.responses.set("GET /api/admin/agents", () => state.registry);
  ui.fireEvent.click(failed.getByRole("button", { name: "Retry" }));
  await failed.findByLabelText("Instructions");
  assert.ok(!failed.queryByRole("alert"));
});

test("agent details can be retried independently while their model and catalog remain visible", async (t) => {
  state.responses.set("GET /api/admin/agents/ask-nest", new Error("Detail unavailable"));
  const view = show(AdminAgentsPage);
  await view.findByText("Agent details could not be loaded");
  assert.ok(view.getByText("default-deployment"));
  const pending = deferred();
  t.after(() => pending.resolve(detail()));
  state.responses.set("GET /api/admin/agents/ask-nest", () => pending.promise);
  ui.fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await ui.waitFor(() => assert.ok(!view.queryByText("Detail unavailable")));
  assert.ok(!view.queryByLabelText("Instructions"));
  await ui.act(async () => pending.resolve(detail()));
  await view.findByLabelText("Instructions");
});

test("switching panels and agents preserves each unsaved settings draft", async () => {
  const view = show(AdminAgentsPage);
  await view.findByLabelText("Instructions");
  ui.fireEvent.change(view.getByLabelText("Instructions"), { target: { value: "Ask Nest draft" } });
  ui.fireEvent.click(view.getByRole("button", { name: "Training examples", exact: true }));
  assert.ok(view.getByRole("heading", { name: "Training examples" }));
  ui.fireEvent.click(view.getByRole("button", { name: "Evaluations", exact: true }));
  assert.ok(view.getByText("Add an evaluation case"));
  ui.fireEvent.click(view.getByRole("button", { name: "Fine-tuning", exact: true }));
  assert.ok(view.getByRole("heading", { name: "Model fine-tuning" }));
  ui.fireEvent.click(view.getByRole("button", { name: "Configuration", exact: true }));
  assert.equal(view.getByLabelText("Instructions").value, "Ask Nest draft");
  ui.fireEvent.click(view.getByRole("button", { name: /Transaction assistant.*Turns natural language/ }));
  await view.findByRole("region", { name: "Transaction assistant management" });
  await ui.waitFor(() => assert.ok(!view.queryByLabelText(/^Maximum lookup rounds/)));
  await view.findByLabelText("Instructions");
  ui.fireEvent.change(view.getByLabelText("Instructions"), { target: { value: "Transaction draft" } });
  ui.fireEvent.click(view.getByRole("button", { name: /Ask Nest.*Answers financial questions/ }));
  await ui.waitFor(() => assert.equal(view.getByLabelText("Instructions").value, "Ask Nest draft"));
  assert.ok(view.getByLabelText(/^Maximum lookup rounds/));
  assert.ok(!state.requests.some(({ method }) => method !== "GET"));
});

test("a completed save preserves edits made while the request was pending and rebases their revision", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve());
  state.responses.set("PATCH /api/admin/agents/ask-nest", async (request) => { await pending.promise; return saveConfiguration(request); });
  const view = show(AdminAgentsPage);
  await view.findByLabelText("Instructions");
  ui.fireEvent.submit(view.container.querySelector(".agent-settings-form"));
  assert.ok(!state.requests.some(({ method }) => method === "PATCH"));
  ui.fireEvent.change(view.getByLabelText("Instructions"), { target: { value: "Submitted instructions" } });
  ui.fireEvent.click(view.getByRole("button", { name: "Save configuration" }));
  await ui.waitFor(() => assert.ok(view.getByRole("button", { name: "Save configuration" }).disabled));
  ui.fireEvent.change(view.getByLabelText("Instructions"), { target: { value: "Newer unsaved instructions" } });
  await ui.act(async () => pending.resolve());
  await ui.waitFor(() => assert.equal(state.notices.length, 1));
  assert.equal(view.getByLabelText("Instructions").value, "Newer unsaved instructions");
  assert.ok(view.getByText("Unsaved changes"));
  assert.ok(!view.getByRole("button", { name: "Save configuration" }).disabled);
  assert.ok(!view.queryByText(/saved agent changed while you were editing/));
  state.responses.set("PATCH /api/admin/agents/ask-nest", saveConfiguration);
  ui.fireEvent.click(view.getByRole("button", { name: "Save configuration" }));
  await view.findByText("Saved configuration · revision 3");
  assert.ok(!view.queryByRole("button", { name: "Reload saved settings" }));
  const writes = state.requests.filter(({ method }) => method === "PATCH");
  assert.deepEqual(writes.map(({ body }) => [body.instructions, body.revision]), [["Submitted instructions", 1], ["Newer unsaved instructions", 2]]);
  assert.deepEqual(state.invalidations, [["admin-agents"], ["admin-agents"]]);
  assert.ok(state.notices.every(({ tone, message }) => tone === "success" && message === "Agent configuration saved. New requests use these settings."));
});

test("settings edits retain their types, support recommendations and history, and send only validated configuration fields", async () => {
  const initial = detail();
  initial.configuration.revision = 3;
  initial.configuration.instructions = "Custom instructions";
  initial.configuration.deployment = "custom-deployment";
  const historical = { ...AgentSettingsSchema.strip().parse(initial.configuration), instructions: "Historical instructions" };
  initial.revisions = [
    { revision: 3, action: "CONFIGURATION", settings: historical, createdAt: "2026-10-01T12:00:00Z" },
    { revision: 2, action: "CONFIGURATION", settings: historical, createdAt: "2026-09-01T12:00:00Z" },
    { revision: 1, action: "EXAMPLE_CREATED", settings: historical, createdAt: "2026-08-01T12:00:00Z" },
  ];
  state.details.set("ask-nest", initial);
  state.responses.set("PATCH /api/admin/agents/ask-nest", saveConfiguration);
  const view = show(AdminAgentsPage);
  await view.findByLabelText("Instructions");
  assert.ok(view.getByText("custom-deployment"));
  assert.equal(view.getAllByRole("button", { name: "Load settings" }).length, 1);
  ui.fireEvent.click(view.getByRole("button", { name: "Load settings" }));
  assert.equal(view.getByLabelText("Instructions").value, "Historical instructions");
  ui.fireEvent.click(view.getByRole("button", { name: "Use recommended instructions" }));
  assert.equal(view.getByLabelText("Instructions").value, DEFAULT_AGENT_INSTRUCTIONS["ask-nest"]);
  assert.ok(view.getByRole("button", { name: "Use recommended instructions" }).disabled);
  ui.fireEvent.click(view.getByRole("switch", { name: "Agent enabled" }));
  assert.ok(view.getByRole("switch", { name: "Agent paused" }));
  ui.fireEvent.change(view.getByLabelText("Model deployment"), { target: { value: "temporary-model" } });
  ui.fireEvent.change(view.getByLabelText("Model deployment"), { target: { value: "" } });
  for (const [label, value] of [["Reasoning effort", "high"], ["Response token allowance", "6000"], ["Training examples per request", "2"], ["Maximum lookup rounds", "4"], ["Maximum data lookups", "8"]]) {
    ui.fireEvent.change(view.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
  }
  const capability = view.getByRole("checkbox", { name: /Cash flow and spending/ });
  ui.fireEvent.click(capability);
  assert.ok(!capability.checked);
  ui.fireEvent.click(capability);
  assert.ok(capability.checked);
  ui.fireEvent.click(view.getByRole("checkbox", { name: /Credit cards/ }));
  ui.fireEvent.click(view.getByRole("button", { name: "Save configuration" }));
  await view.findByText("Saved configuration · revision 4");
  const body = state.requests.find(({ method }) => method === "PATCH").body;
  assert.deepEqual(body, {
    ...AgentSettingsSchema.strip().parse(initial.configuration), instructions: DEFAULT_AGENT_INSTRUCTIONS["ask-nest"], enabled: false,
    deployment: null, reasoningEffort: "high", maxOutputTokens: 6000, trainingExampleLimit: 2, maxToolRounds: 4, maxToolCalls: 8,
    capabilities: [...initial.configuration.capabilities.filter((id) => id !== "cards" && id !== "cash-flow"), "cash-flow"], revision: 3,
  });
});

test("save failures retain drafts and stale revisions require an explicit reload", async () => {
  state.responses.set("PATCH /api/admin/agents/ask-nest", new Error("Configuration changed elsewhere"));
  const view = show(AdminAgentsPage);
  await view.findByLabelText("Instructions");
  ui.fireEvent.change(view.getByLabelText("Instructions"), { target: { value: "Unsaved local text" } });
  ui.fireEvent.click(view.getByRole("button", { name: "Save configuration" }));
  await view.findByText("Configuration changed elsewhere");
  assert.equal(view.getByLabelText("Instructions").value, "Unsaved local text");
  state.details.get("ask-nest").configuration = { ...state.details.get("ask-nest").configuration, revision: 2, instructions: "Remote administrator text" };
  await ui.act(async () => view.client.refetchQueries({ queryKey: ["admin-agents", "ask-nest"] }));
  await view.findByText(/saved agent changed while you were editing/);
  assert.ok(view.getByRole("button", { name: "Save configuration" }).disabled);
  ui.fireEvent.click(view.getByRole("button", { name: "Reload saved settings" }));
  assert.equal(view.getByLabelText("Instructions").value, "Remote administrator text");
  assert.ok(!view.queryByRole("alert"));
  assert.ok(!view.queryByText(/saved agent changed while you were editing/));
  assert.ok(view.getByRole("button", { name: "Save configuration" }).disabled);
});

test("registry summaries handle paused or missing entries and an unconfigured default model", async () => {
  state.registry.agents = [state.registry.agents[0]];
  state.registry.provider = { configured: false, model: null };
  const view = show(AdminAgentsPage);
  await view.findByLabelText("Instructions");
  assert.match(view.container.querySelector(".agent-overview").textContent, /1 active agent.*1 approved training example/);
  assert.ok(view.getByText("Azure AI not configured"));
  assert.ok(view.getByText("Default model"));
  assert.equal(view.getByLabelText("Model deployment").placeholder, "Use the default deployment");
  assert.equal(view.getAllByText("Paused").length, 2);
  assert.equal(view.getAllByText("0 capabilities · 0 examples").length, 2);
});

test("recent running evaluations request three-second refreshes and stop polling after their deadline", async (t) => {
  const now = Date.UTC(2026, 9, 10, 0, 0);
  t.mock.method(Date, "now", () => now);
  const run = (id, status, age) => ({ id, status, revision: 1, passedCount: 0, totalCount: 1, createdAt: new Date(now - age).toISOString(), results: [] });
  state.details.get("ask-nest").evaluations = [run("complete", "COMPLETED", 1000), run("recent", "RUNNING", 1000)];
  const view = show(AdminAgentsPage);
  await view.findByLabelText("Instructions");
  const query = view.client.getQueryCache().find({ queryKey: ["admin-agents", "ask-nest"] });
  assert.equal(query.options.refetchInterval(query), 3000);
  state.details.get("ask-nest").evaluations = [run("expired", "RUNNING", 180000)];
  await ui.act(async () => view.client.refetchQueries({ queryKey: ["admin-agents", "ask-nest"] }));
  assert.equal(query.options.refetchInterval(query), false);
});

test("save reconciliation clears the submitted draft and preserves newer settings without mutating them", () => {
  const submitted = { settings: AgentSettingsSchema.strip().parse(detail().configuration), revision: 1 };
  assert.equal(reconcileSavedAgentDraft(undefined, submitted, 2), undefined);
  assert.equal(reconcileSavedAgentDraft(submitted, submitted, 2), undefined);
  const newer = { settings: { ...submitted.settings, instructions: "New edits" }, revision: 1 };
  const reconciled = reconcileSavedAgentDraft(newer, submitted, 2);
  assert.deepEqual(reconciled, { settings: newer.settings, revision: 2 });
  assert.equal(newer.revision, 1);
  assert.equal(reconciled.settings, newer.settings);
});
