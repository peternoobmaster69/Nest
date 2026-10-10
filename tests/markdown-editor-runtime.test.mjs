import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { MarkdownEditor } = require("../components/markdown-editor.tsx");
afterEach(ui.cleanup);
after(() => ui.dispose());

test("note calculations preserve commas as sum argument separators", () => {
  const view = ui.render(ui.h(MarkdownEditor, { label: "Notes", value: "sum(1,2)", calculator: true, onChange() {} }));
  assert.ok(view.getByText("= 3"));
});

for (const [value, expected] of [
  ["Total: $1,250 + 750", 2000], ["€5 + £2 + ¥3", 10], ["(1,200 + 3) * 2", 2406],
  ["sum(1,200)", 201], ["sum(10,-5,2.5)", 7.5], ["SUM (1, sum(2, 3), 4)", 10], ["sum()", 0],
  ["-(2 + 3) * 4", -20], ["+ + 3", 3], ["8 / 2 * 3", 12], ["5 + 2 * 3 - 1", 10],
  ["1 - 2 - 3", -4], ["1.", 1], [".5 + 1", 1.5], ["1 / 3", 0.33],
  ["Shopping list\nTotal: 2 * 3\n\n", 6], ["99\n2+3", 5],
]) {
  test(`note calculations preserve precedence, grouping and the last nonempty line (${value.replaceAll("\n", " / ")})`, () => {
    const view = ui.render(ui.h(MarkdownEditor, { label: "Notes", value, calculator: true, onChange() {} }));
    assert.ok(view.getByText(`= ${expected.toLocaleString(undefined, { maximumFractionDigits: 2 })}`));
    assert.equal(view.getByRole("textbox").value, value);
  });
}

for (const value of ["", " \n ", "Words only", "sum", "sum(1", "sum(1,)", "sum(1,,2)", "sum(1 2)", "avg(1,2)", "(1+2", "1+2)", "2 +", ".", "1..2", "3 ^ 2", "1 / 0", "9".repeat(310)]) {
  test(`incomplete or non-finite note calculations retain the note without a misleading total (${value.slice(0, 30)})`, () => {
    const view = ui.render(ui.h(MarkdownEditor, { label: "Notes", value, calculator: true, onChange() {} }));
    assert.equal(view.queryByText(/^=/), null);
    assert.equal(view.getByRole("textbox").value, value);
  });
}

test("notes remain ordinary text when the calculator is disabled and edits preserve formatting", () => {
  const changes = [];
  const view = ui.render(ui.h(MarkdownEditor, { label: "Notes", value: "2+3", className: "test-notes", onChange: value => changes.push(value) }));
  const textbox = view.getByRole("textbox", { name: "Notes" });
  assert.equal(textbox.placeholder, "Add notes...");
  assert.equal(textbox.getAttribute("rows"), "2");
  assert.equal(view.queryByText(/^=/), null);
  assert.ok(textbox.closest("label").classList.contains("test-notes"));
  ui.fireEvent.change(textbox, { target: { value: "- Item\n  Details" } });
  assert.deepEqual(changes, ["- Item\n  Details"]);
});

test("notes grow with measured content and scroll only beyond the configured maximum", t => {
  t.mock.method(ui.window, "getComputedStyle", () => ({ lineHeight: "20px", borderTopWidth: "1px", borderBottomWidth: "1px", paddingTop: "5px", paddingBottom: "5px" }));
  const props = { label: "Notes", onChange() {}, minLines: 2, maxLines: 4, placeholder: "Details" };
  const view = ui.render(ui.h(MarkdownEditor, { ...props, value: "Short" }));
  const textarea = view.getByRole("textbox");
  assert.equal(textarea.style.height, "52px");
  assert.equal(textarea.style.overflowY, "hidden");
  assert.equal(textarea.placeholder, "Details");
  let measuredHeight = 60;
  Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => measuredHeight });
  view.rerender(ui.h(MarkdownEditor, { ...props, value: "Longer note" }));
  assert.equal(textarea.style.height, "60px");
  measuredHeight = 120;
  view.rerender(ui.h(MarkdownEditor, { ...props, value: "Very long note" }));
  assert.equal(textarea.style.height, "92px");
  assert.equal(textarea.style.overflowY, "auto");
  measuredHeight = 92;
  view.rerender(ui.h(MarkdownEditor, { ...props, value: "At the maximum" }));
  assert.equal(textarea.style.height, "92px");
  assert.equal(textarea.style.overflowY, "hidden");
});

test("notes use a readable fallback height when computed font and box metrics are unavailable", t => {
  t.mock.method(ui.window, "getComputedStyle", () => ({ lineHeight: "normal", borderTopWidth: "", borderBottomWidth: "", paddingTop: "", paddingBottom: "" }));
  const view = ui.render(ui.h(MarkdownEditor, { label: "Notes", value: "", onChange() {} }));
  assert.equal(view.getByRole("textbox").style.height, "39px");
});
