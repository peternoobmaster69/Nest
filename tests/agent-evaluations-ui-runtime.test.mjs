import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const requests = [], notices = [], clients = [];
let reply, changes, copied, copyError;
mock.module("../lib/api/client.ts", { namedExports: { apiFetch: async (url, options) => {
  requests.push({ url, ...options, body: JSON.parse(options.body) });
  if (reply instanceof Error) throw reply;
  return typeof reply === "function" ? reply() : reply;
} } });
mock.module("../components/toast-provider.tsx", { namedExports: { useToast: () => ({
  success: (message) => notices.push({ tone: "success", message }),
  error: (message) => notices.push({ tone: "error", message }),
}) } });
const { AgentEvaluations } = require("../components/admin-agents/agent-evaluations.tsx");
const example = (id, values = {}) => ({ id, title: `Case ${id}`, purpose: "EVALUATION", status: "APPROVED", matchMode: "CONTAINS", ...values });
const run = (values = {}) => ({ id: "run-one", status: "COMPLETED", revision: 3, passedCount: 1, totalCount: 1, createdAt: "2026-10-09T12:00:00Z", results: [], ...values });
const detail = (values = {}) => ({ configuration: { id: "ask-nest", revision: 3 }, examples: [example("one")], evaluations: [], ...values });
function show(options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const element = (props) => ui.h(QueryClientProvider, { client }, ui.h(AgentEvaluations, { detail: detail(), configured: true, onChanged: async () => { changes++; }, ...props }));
  return { ...ui.render(element(options)), element };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  requests.length = notices.length = 0;
  changes = 0;
  copied = [];
  copyError = null;
  reply = run();
  Object.defineProperty(ui.window.navigator, "clipboard", { configurable: true, value: { writeText: async (value) => {
    if (copyError) throw copyError;
    copied.push(value);
  } } });
});
afterEach(() => { ui.cleanup(); for (const client of clients.splice(0)) client.clear(); });
after(() => ui.dispose());

test("evaluation controls show only approved evaluation cases and enforce the five-case limit", async () => {
  const examples = Array.from({ length: 6 }, (_, index) => example(String(index + 1), { matchMode: ["CONTAINS", "JSON_SUBSET", "EXACT"][index % 3] }));
  const view = show({ detail: detail({ examples: [...examples, example("training", { purpose: "TRAINING" }), example("draft", { status: "DRAFT" })] }) });
  const boxes = view.getAllByRole("checkbox");
  assert.equal(boxes.length, 6);
  assert.ok(boxes.slice(0, 5).every((box) => box.checked && !box.disabled));
  assert.ok(!boxes[5].checked && boxes[5].disabled);
  assert.equal(view.getAllByText("Text check").length, 2);
  assert.equal(view.getAllByText("JSON field check").length, 2);
  assert.equal(view.getAllByText("Exact response check").length, 2);
  assert.ok(!view.queryByText("Case training"));
  assert.ok(!view.queryByText("Case draft"));
  ui.fireEvent.click(boxes[0]);
  assert.ok(!boxes[5].disabled);
  ui.fireEvent.click(boxes[5]);
  assert.ok(view.getByText("5 cases selected · provider usage applies"));
  ui.fireEvent.click(view.getByRole("button", { name: "Run evaluation" }));
  await ui.waitFor(() => assert.equal(notices.length, 1));
  assert.deepEqual(requests[0].body.exampleIds, ["2", "3", "4", "5", "6"]);
  assert.equal(requests[0].body.revision, 3);
  assert.match(requests[0].body.requestId, /^[a-f\d-]{36}$/);
  assert.equal(requests[0].url, "/api/admin/agents/ask-nest/evaluations");
  assert.equal(requests[0].method, "POST");
  assert.equal(changes, 1);
  assert.deepEqual(notices, [{ tone: "success", message: "Evaluation complete: 1 of 1 checks passed." }]);
});

test("empty or unavailable evaluations explain their prerequisites without submitting requests", () => {
  const view = show({ detail: detail({ examples: [] }), configured: false });
  assert.ok(view.getByText("Add an evaluation case"));
  assert.ok(view.getByText("Connect the Azure AI provider to run evaluations."));
  assert.ok(!view.queryByRole("button", { name: "Run evaluation" }));
  view.rerender(view.element({ configured: false }));
  assert.ok(view.getByRole("button", { name: "Run evaluation" }).disabled);
  view.unmount();
  const running = show({ detail: detail({ evaluations: [run({ status: "RUNNING" })] }) });
  assert.ok(running.getByRole("button", { name: "Run evaluation" }).disabled);
  running.unmount();
  const selectable = show();
  assert.ok(selectable.getByText("1 case selected · provider usage applies"));
  ui.fireEvent.click(selectable.getByRole("checkbox"));
  assert.ok(selectable.getByRole("button", { name: "Run evaluation" }).disabled);
  assert.deepEqual(requests, []);
});

test("pending evaluations disable choices until the result is available", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(run()));
  reply = () => pending.promise;
  const view = show();
  ui.fireEvent.click(view.getByRole("button", { name: "Run evaluation" }));
  await view.findByText("Running with sample data…");
  assert.ok(view.getByRole("checkbox").disabled);
  assert.ok(view.getByRole("button", { name: /Run evaluation/ }).disabled);
  await ui.act(async () => pending.resolve(run({ status: "RUNNING" })));
  await ui.waitFor(() => assert.deepEqual(notices, [{ tone: "success", message: "Evaluation is running." }]));
  assert.equal(changes, 1);
  assert.ok(!view.getByRole("checkbox").disabled);
});

test("failed evaluations retain their request ID on retry and clear it after success", async () => {
  reply = new Error("Provider unavailable");
  const view = show();
  ui.fireEvent.click(view.getByRole("button", { name: "Run evaluation" }));
  assert.equal((await view.findByRole("alert")).textContent, "Provider unavailable");
  assert.equal(changes, 1);
  const firstId = requests[0].body.requestId;
  reply = run();
  ui.fireEvent.click(view.getByRole("button", { name: "Run evaluation" }));
  await ui.waitFor(() => assert.equal(notices.length, 1));
  assert.equal(requests[1].body.requestId, firstId);
  assert.ok(!view.queryByRole("alert"));
  ui.fireEvent.click(view.getByRole("button", { name: "Run evaluation" }));
  await ui.waitFor(() => assert.equal(notices.length, 2));
  assert.notEqual(requests[2].body.requestId, firstId);
  assert.equal(changes, 3);
});

test("changed selections or saved revisions create a distinct evaluation request", async () => {
  reply = new Error("Retry after provider recovery");
  const original = detail({ examples: [example("one"), example("two")] });
  const view = show({ detail: original });
  ui.fireEvent.click(view.getByRole("button", { name: "Run evaluation" }));
  await view.findByRole("alert");
  ui.fireEvent.click(view.getByRole("checkbox", { name: /Case two/ }));
  ui.fireEvent.click(view.getByRole("button", { name: "Run evaluation" }));
  await ui.waitFor(() => assert.equal(changes, 2));
  assert.deepEqual(requests[1].body.exampleIds, ["one"]);
  assert.notEqual(requests[1].body.requestId, requests[0].body.requestId);
  view.rerender(view.element({ detail: { ...original, configuration: { id: "ask-nest", revision: 4 } } }));
  ui.fireEvent.click(view.getByRole("button", { name: "Run evaluation" }));
  await ui.waitFor(() => assert.equal(changes, 3));
  assert.equal(requests[2].body.revision, 4);
  assert.notEqual(requests[2].body.requestId, requests[1].body.requestId);
  view.rerender(view.element({ detail: detail({ examples: [example("two")] }) }));
  assert.ok(view.getByRole("button", { name: "Run evaluation" }).disabled);
});

test("evaluation history shows completion, interrupted runs, revision changes and safe response text", async () => {
  const actualOutput = '<script>untrusted()</script>\nSample answer';
  const result = { exampleId: "good", title: "Income check", passed: true, durationMs: 1250, explanation: "Expected text found", expectedOutput: "Income", actualOutput, toolsUsed: ["get_summary", "list_transactions"] };
  const evaluations = [
    run({ totalCount: 2, results: [result, { ...result, exampleId: "bad", title: "Spending check", passed: false, actualOutput: "", toolsUsed: [], explanation: "Provider returned no answer" }] }),
    run({ id: "interrupted", status: "INTERRUPTED", revision: 2 }),
    run({ id: "running", status: "RUNNING" }),
  ];
  const view = show({ detail: detail({ evaluations }) });
  assert.ok(view.getByText("1 / 2 passed"));
  assert.ok(view.getByText("Completed"));
  assert.ok(view.getByText("Run interrupted"));
  assert.ok(view.getByText("Interrupted"));
  assert.ok(view.getByText("Evaluation running"));
  assert.ok(view.getByText("In progress"));
  assert.ok(view.getByText(/Revision 2.*agent has changed/));
  assert.deepEqual([...view.container.querySelectorAll("details")].map((node) => node.open), [true, false, false]);
  assert.ok(view.getByText("No completed response."));
  assert.ok(view.getByText("Sample tools used: get_summary, list_transactions"));
  assert.equal(view.getAllByText("1.3s").length, 2);
  assert.ok(!view.container.querySelector("script"));
  assert.ok([...view.container.querySelectorAll("pre")].some((node) => node.textContent === actualOutput));
  assert.equal(view.container.querySelectorAll(".is-good").length, 1);
  assert.equal(view.container.querySelectorAll(".is-bad").length, 1);
  const copy = view.getByRole("button", { name: "Copy response for Income check" });
  ui.fireEvent.click(copy);
  await ui.waitFor(() => assert.deepEqual(copied, [actualOutput]));
  assert.deepEqual(notices[0], { tone: "success", message: "Response copied." });
  copyError = new Error("Clipboard denied");
  ui.fireEvent.click(copy);
  await ui.waitFor(() => assert.equal(notices.length, 2));
  assert.deepEqual(notices[1], { tone: "error", message: "The response could not be copied. Select and copy the text instead." });
  assert.deepEqual(requests, []);
});
