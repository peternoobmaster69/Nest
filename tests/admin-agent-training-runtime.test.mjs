import assert from "node:assert/strict";
import test from "node:test";
import { createAgentUiHarness } from "./agent-ui-harness.mjs";

const { ui, require, state, detail, job, show, deferred } = await createAgentUiHarness();
const { AgentFineTuning } = require("../components/admin-agents/agent-fine-tuning.tsx");
const base = "/api/admin/agents/ask-nest";
const ready = (values = {}) => detail("ask-nest", { trainingCount: 12, ...values });

test("fine-tuning explains its prerequisites and exports a local JSONL file without starting a training job", async (t) => {
  const pending = deferred(), downloads = [], revoked = [], fetches = [];
  t.after(() => pending.resolve(new Response("training row\n")));
  t.mock.method(globalThis, "fetch", async (url, options) => { fetches.push({ url, options }); return pending.promise; });
  t.mock.method(URL, "createObjectURL", () => "blob:training-dataset");
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  t.mock.method(ui.window.HTMLAnchorElement.prototype, "click", function () { downloads.push({ href: this.href, download: this.download }); });
  const view = show(AgentFineTuning, { detail: detail("ask-nest", { trainingCount: 0 }), configured: false });
  assert.ok(view.getByRole("button", { name: "Start fine-tuning" }).disabled);
  assert.ok(view.getByRole("button", { name: "Export JSONL" }).disabled);
  assert.ok(view.getByText(/Add 10 more to reach the minimum/));
  assert.ok(view.getByText("Connect the Azure AI provider before starting training."));
  view.rerender(view.element({ detail: ready(), configured: true }));
  assert.ok(!view.getByRole("button", { name: "Start fine-tuning" }).disabled);
  assert.ok(view.getByText("Use complete structured responses and compare results against your evaluation cases."));
  ui.fireEvent.click(view.getByRole("button", { name: "Export JSONL" }));
  await ui.waitFor(() => assert.ok(view.getByRole("button", { name: "Export JSONL" }).disabled));
  await ui.act(async () => pending.resolve(new Response("training row\n")));
  await ui.waitFor(() => assert.deepEqual(downloads, [{ href: "blob:training-dataset", download: "ask-nest-training.jsonl" }]));
  assert.deepEqual(revoked, ["blob:training-dataset"]);
  assert.deepEqual(fetches, [{ url: `${base}/dataset`, options: { cache: "no-store" } }]);
  assert.deepEqual(state.requests, []);
  assert.deepEqual(state.notices, []);
});

test("dataset export failures release the button and show the provider error or a stable fallback", async (t) => {
  let response;
  t.mock.method(globalThis, "fetch", async () => typeof response === "function" ? response() : response);
  const view = show(AgentFineTuning, { detail: ready(), configured: true });
  for (const [value, expected] of [
    [Response.json({ error: "No approved rows" }, { status: 422 }), "No approved rows"],
    [Response.json({}, { status: 500 }), "Dataset export failed."],
    [() => Promise.reject("disconnected"), "Dataset export failed."],
  ]) {
    response = value;
    const count = state.notices.length;
    ui.fireEvent.click(view.getByRole("button", { name: "Export JSONL" }));
    await ui.waitFor(() => assert.equal(state.notices.length, count + 1));
    assert.deepEqual(state.notices.at(-1), { tone: "error", message: expected });
    await ui.waitFor(() => assert.ok(!view.getByRole("button", { name: "Export JSONL" }).disabled));
  }
});

test("training retries retain the same request ID and updated parameters create a new request", async () => {
  state.responses.set(`POST ${base}/fine-tuning`, new Error("Provider timed out"));
  const view = show(AgentFineTuning, { detail: ready(), configured: true });
  ui.fireEvent.change(view.getByLabelText(/^Base model to train/), { target: { value: "gpt-base-model" } });
  ui.fireEvent.click(view.getByRole("button", { name: "Start fine-tuning" }));
  await view.findByText("Provider timed out");
  assert.equal(state.changes, 1);
  ui.fireEvent.click(view.getByRole("button", { name: "Start fine-tuning" }));
  await ui.waitFor(() => assert.equal(state.changes, 2));
  assert.equal(state.requests[0].body.requestId, state.requests[1].body.requestId);
  assert.equal(state.requests[0].body.epochs, "auto");
  assert.equal(state.requests[0].body.trainingType, "Standard");
  assert.equal(state.requests[0].body.revision, 1);
  assert.equal(state.requests[0].body.baseModel, "gpt-base-model");
  assert.match(state.requests[0].body.requestId, /^[a-f\d-]{36}$/);
  ui.fireEvent.change(view.getByLabelText("Training type"), { target: { value: "GlobalStandard" } });
  ui.fireEvent.change(view.getByLabelText("Training epochs"), { target: { value: "5" } });
  state.responses.set(`POST ${base}/fine-tuning`, job());
  ui.fireEvent.click(view.getByRole("button", { name: "Start fine-tuning" }));
  await ui.waitFor(() => assert.equal(state.notices.length, 1));
  assert.notEqual(state.requests[2].body.requestId, state.requests[1].body.requestId);
  assert.equal(state.requests[2].body.epochs, 5);
  assert.equal(state.requests[2].body.trainingType, "GlobalStandard");
  assert.deepEqual(state.notices[0], { tone: "success", message: "Training job submitted to Azure." });
  assert.ok(!view.queryByRole("alert"));
  ui.fireEvent.click(view.getByRole("button", { name: "Start fine-tuning" }));
  await ui.waitFor(() => assert.equal(state.notices.length, 2));
  assert.notEqual(state.requests[3].body.requestId, state.requests[2].body.requestId);
});

test("provider-declined and ambiguous training submissions display actionable status messages", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(job("unknown", { status: "UNKNOWN", error: null })));
  state.responses.set(`POST ${base}/fine-tuning`, () => pending.promise);
  const view = show(AgentFineTuning, { detail: ready(), configured: true });
  ui.fireEvent.change(view.getByLabelText(/^Base model to train/), { target: { value: "gpt-base" } });
  ui.fireEvent.click(view.getByRole("button", { name: "Start fine-tuning" }));
  await ui.waitFor(() => assert.ok(view.getByRole("button", { name: "Start fine-tuning" }).disabled));
  await ui.act(async () => pending.resolve(job("unknown", { status: "UNKNOWN", error: null })));
  await ui.waitFor(() => assert.equal(state.notices.length, 1));
  assert.deepEqual(state.notices[0], { tone: "error", message: "Review the training job status." });
  state.responses.set(`POST ${base}/fine-tuning`, job("failed", { status: "FAILED", error: "Quota exhausted" }));
  ui.fireEvent.click(view.getByRole("button", { name: "Start fine-tuning" }));
  await ui.waitFor(() => assert.equal(state.notices.length, 2));
  assert.deepEqual(state.notices[1], { tone: "error", message: "Quota exhausted" });
  assert.equal(state.changes, 2);
});

test("training history renders model deployments and terminal states, and active jobs can be refreshed or cancelled", async (t) => {
  const jobs = [
    job("active", { status: "VALIDATING_FILES" }),
    job("unknown", { providerJobId: null, status: "UNKNOWN", error: "Confirmation pending" }),
    job("complete", { status: "SUCCEEDED", fineTunedModel: "fine-tuned-model" }),
    job("failed", { status: "FAILED", error: "Training failed" }),
    job("cancelled", { status: "CANCELLED" }),
  ];
  const view = show(AgentFineTuning, { detail: ready({ fineTuningJobs: jobs }), configured: true });
  assert.ok(view.getByRole("button", { name: "Start fine-tuning" }).disabled);
  assert.ok(view.getByText("Refresh or finish the existing job before starting another."));
  assert.ok(view.getByText("validating files"));
  assert.ok(view.getByText("Confirmation pending"));
  assert.ok(view.getByText("Training failed"));
  assert.ok(view.getByText("fine-tuned-model"));
  assert.equal(view.getByRole("link", { name: "Open Microsoft Foundry" }).href, "https://ai.azure.com/");
  assert.equal(view.getAllByRole("button", { name: "Refresh status" }).length, 2);
  assert.equal(view.getAllByRole("button", { name: "Cancel training" }).length, 1);
  const pending = deferred();
  t.after(() => pending.resolve(job("active")));
  state.responses.set(`POST ${base}/fine-tuning/active`, () => pending.promise);
  ui.fireEvent.click(view.getAllByRole("button", { name: "Refresh status" })[0]);
  await ui.waitFor(() => assert.ok(view.getAllByRole("button", { name: "Refresh status" })[0].disabled));
  assert.ok(!view.getAllByRole("button", { name: "Refresh status" })[1].disabled);
  assert.ok(view.getByRole("button", { name: "Cancel training" }).disabled);
  await ui.act(async () => pending.resolve(job("active")));
  await ui.waitFor(() => assert.equal(state.changes, 1));
  assert.deepEqual(state.requests[0].body, { action: "refresh" });
  state.responses.set(`POST ${base}/fine-tuning/active`, new Error("Cancellation unavailable"));
  ui.fireEvent.click(view.getByRole("button", { name: "Cancel training" }));
  await view.findByText("Cancellation unavailable");
  assert.deepEqual(state.requests[1].body, { action: "cancel" });
  assert.equal(state.changes, 1);
  state.responses.set(`POST ${base}/fine-tuning/active`, job("active", { status: "CANCELLED" }));
  ui.fireEvent.click(view.getByRole("button", { name: "Cancel training" }));
  await ui.waitFor(() => assert.equal(state.changes, 2));
  assert.ok(!view.queryByRole("alert"));
  view.rerender(view.element({ detail: detail("transaction-assistant", { trainingCount: 12, fineTuningJobs: jobs.slice(2) }), configured: true }));
  assert.ok(!view.getByRole("button", { name: "Start fine-tuning" }).disabled);
  assert.ok(!view.queryByRole("button", { name: "Refresh status" }));
  assert.ok(!view.queryByText(/Ask Nest exports support/));
});
