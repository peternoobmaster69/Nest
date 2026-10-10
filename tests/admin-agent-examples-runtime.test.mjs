import assert from "node:assert/strict";
import test from "node:test";
import { createAgentUiHarness } from "./agent-ui-harness.mjs";

const { ui, require, state, detail, example, show, deferred } = await createAgentUiHarness();
const { AgentExamples } = require("../components/admin-agents/agent-examples.tsx");
const base = "/api/admin/agents/ask-nest/examples";

function fillExample(dialog) {
  const fields = ui.within(dialog);
  for (const [label, value] of [
    ["Title", "Transport example"], ["Use for", "EVALUATION"], ["Status", "APPROVED"],
    ["User request", "Review my transport spending"], ["Expected response", '{"amount":10}'],
    ["Evaluation check", "JSON_SUBSET"], ["Context JSON", '{"toolResults":[]}'],
  ]) ui.fireEvent.change(fields.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
}

test("new examples use an empty form, submit every field, and prevent closing while a save is pending", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve({}));
  state.responses.set(`POST ${base}`, () => pending.promise);
  const view = show(AgentExamples, { detail: detail() });
  assert.ok(view.getByText("Start with a good example"));
  ui.fireEvent.click(view.getByRole("button", { name: "Add the first example" }));
  let dialog = await view.findByRole("dialog", { name: "Add an example" });
  assert.equal(ui.within(dialog).getByLabelText(/^Title/).value, "");
  assert.equal(ui.within(dialog).getByLabelText("Status").value, "DRAFT");
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Cancel" }));
  assert.ok(!view.queryByRole("dialog"));
  ui.fireEvent.click(view.getByRole("button", { name: "Add example", exact: true }));
  dialog = await view.findByRole("dialog", { name: "Add an example" });
  fillExample(dialog);
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Save example" }));
  await ui.waitFor(() => assert.ok(ui.within(dialog).getByRole("button", { name: "Save example" }).disabled));
  assert.ok(ui.within(dialog).getByRole("button", { name: "Cancel" }).disabled);
  assert.ok(ui.within(dialog).getByRole("button", { name: "Close Add an example" }).disabled);
  ui.fireEvent.keyDown(dialog, { key: "Escape" });
  assert.ok(view.getByRole("dialog", { name: "Add an example" }));
  assert.deepEqual(state.requests[0], {
    url: base, method: "POST", headers: { "Content-Type": "application/json" },
    body: { title: "Transport example", purpose: "EVALUATION", status: "APPROVED", input: "Review my transport spending", expectedOutput: '{"amount":10}', matchMode: "JSON_SUBSET", contextJson: '{"toolResults":[]}' },
  });
  await ui.act(async () => pending.resolve({}));
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  assert.equal(state.changes, 1);
  assert.deepEqual(state.notices, [{ tone: "success", message: "Example saved." }]);
});

test("example filtering resets pagination and only matching examples can be edited", async () => {
  const examples = Array.from({ length: 12 }, (_, index) => example(String(index + 1), { status: index % 2 ? "DRAFT" : "APPROVED" }));
  examples.push(example("evaluation", { purpose: "EVALUATION" }));
  const view = show(AgentExamples, { detail: detail("ask-nest", { examples }) });
  assert.equal(view.container.querySelectorAll("article").length, 10);
  assert.ok(view.getByText("Page 1 of 2"));
  ui.fireEvent.click(view.getByRole("button", { name: "Next" }));
  assert.equal(view.container.querySelectorAll("article").length, 3);
  assert.ok(view.getByText("Page 2 of 2"));
  ui.fireEvent.change(view.getByLabelText("Show examples"), { target: { value: "EVALUATION" } });
  assert.equal(view.container.querySelectorAll("article").length, 1);
  assert.ok(view.getByText("Example evaluation"));
  assert.ok(!view.queryByText("Example 11"));
  state.responses.set(`PUT ${base}/evaluation`, {});
  ui.fireEvent.click(view.getByRole("button", { name: "Edit Example evaluation" }));
  const dialog = await view.findByRole("dialog", { name: "Edit example" });
  assert.equal(ui.within(dialog).getByLabelText(/^Title/).value, "Example evaluation");
  assert.equal(ui.within(dialog).getByLabelText(/^User request/).value, "Request evaluation");
  ui.fireEvent.change(ui.within(dialog).getByLabelText(/^Title/), { target: { value: "Updated evaluation" } });
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Save example" }));
  await ui.waitFor(() => assert.equal(state.changes, 1));
  assert.equal(state.requests[0].method, "PUT");
  assert.equal(state.requests[0].body.revision, 2);
  assert.equal(state.requests[0].body.title, "Updated evaluation");
  ui.fireEvent.change(view.getByLabelText("Show examples"), { target: { value: "TRAINING" } });
  assert.ok(view.getByText("Page 1 of 2"));
  assert.equal(view.container.querySelectorAll("article").length, 10);
  view.rerender(view.element({ detail: detail("ask-nest", { examples: [example("evaluation", { purpose: "EVALUATION" })] }) }));
  assert.ok(view.getByText("No examples match this filter."));
});

test("save failures keep entered values, while reopening a new form clears the failure and prior input", async () => {
  state.responses.set(`POST ${base}`, new Error("Context must be valid JSON"));
  const view = show(AgentExamples, { detail: detail() });
  ui.fireEvent.click(view.getByRole("button", { name: "Add example", exact: true }));
  let dialog = await view.findByRole("dialog");
  fillExample(dialog);
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Save example" }));
  await view.findByText("Context must be valid JSON");
  assert.equal(ui.within(dialog).getByLabelText(/^Title/).value, "Transport example");
  assert.equal(state.changes, 0);
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Close Add an example" }));
  assert.ok(!view.queryByRole("dialog"));
  ui.fireEvent.click(view.getByRole("button", { name: "Add example", exact: true }));
  dialog = await view.findByRole("dialog");
  assert.equal(ui.within(dialog).getByLabelText(/^Title/).value, "");
  assert.ok(!ui.within(dialog).queryByRole("alert"));
});

test("deleting an example requires the confirmation dialog and sends its revision; failures can be retried", async (t) => {
  const view = show(AgentExamples, { detail: detail("ask-nest", { examples: [example("one")] }) });
  ui.fireEvent.click(view.getByRole("button", { name: "Delete Example one" }));
  let dialog = await view.findByRole("dialog", { name: "Delete example" });
  assert.ok(ui.within(dialog).getByText(/Delete “Example one”/));
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Keep example" }));
  assert.equal(state.requests.length, 0);
  ui.fireEvent.click(view.getByRole("button", { name: "Delete Example one" }));
  dialog = await view.findByRole("dialog", { name: "Delete example" });
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Close Delete example" }));
  assert.equal(state.requests.length, 0);
  state.responses.set(`DELETE ${base}/one`, new Error("Example changed elsewhere"));
  ui.fireEvent.click(view.getByRole("button", { name: "Delete Example one" }));
  dialog = await view.findByRole("dialog", { name: "Delete example" });
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Delete example", exact: true }));
  await view.findByText("Example changed elsewhere");
  assert.deepEqual(state.requests[0].body, { revision: 2 });
  assert.equal(state.changes, 0);
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Keep example" }));
  ui.fireEvent.click(view.getByRole("button", { name: "Delete Example one" }));
  dialog = await view.findByRole("dialog", { name: "Delete example" });
  assert.ok(!ui.within(dialog).queryByRole("alert"));
  const pending = deferred();
  t.after(() => pending.resolve({}));
  state.responses.set(`DELETE ${base}/one`, () => pending.promise);
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Delete example", exact: true }));
  await ui.waitFor(() => assert.ok(ui.within(dialog).getByRole("button", { name: "Keep example" }).disabled));
  assert.ok(ui.within(dialog).getByRole("button", { name: "Close Delete example" }).disabled);
  await ui.act(async () => pending.resolve({}));
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  assert.equal(state.changes, 1);
  assert.deepEqual(state.notices, [{ tone: "success", message: "Example deleted." }]);
});
