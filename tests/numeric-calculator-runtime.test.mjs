import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { NumericCalculatorInput } = require("../components/numeric-calculator-input.tsx");
afterEach(ui.cleanup);
after(() => ui.dispose());

for (const [expression, result, allowDecimal = true] of [
  ["2 + 3 * 4", "14"], ["-2.50 * +4 + 1", "-9"], ["1 / 8", "0.13"],
  ["8 / 2 * 3", "12"], ["5 - -2", "7"], ["+2+3", "5"], ["2*-3", "-6"],
  ["10 / 3", "3.33"], [".5 + 1", "1.5"], ["4 - 1 - 2", "1"],
  ["3 / 2", "2", false], ["-3 / 2", "-1", false],
]) {
  test(`the calculator applies precedence, signs and rounding to ${expression} (${allowDecimal ? "decimal" : "integer"})`, () => {
    const changes = [];
    const view = ui.render(ui.h(NumericCalculatorInput, { value: expression, allowDecimal, onValueChange: value => changes.push(value), "aria-label": "Amount" }));
    assert.equal(view.getByRole("textbox", { name: "Amount" }).value, expression);
    assert.equal(view.getByRole("textbox").getAttribute("inputmode"), allowDecimal ? "text" : "numeric");
    ui.fireEvent.click(view.getByRole("button", { name: "Calculate expression" }));
    assert.deepEqual(changes, [result]);
  });
}

for (const expression of ["", " ", "2", "2+", "2**3", "--2+3", "2^3", "abc", "(2+3)", "5.", ".", "8/0", "1..2+3", "9".repeat(310) + "+1", "9".repeat(200) + "*" + "9".repeat(200)]) {
  test(`invalid or incomplete input cannot be calculated (${expression.length > 40 ? `overflow ${expression.length}` : JSON.stringify(expression)})`, () => {
    const changes = [];
    const view = ui.render(ui.h(NumericCalculatorInput, { value: expression, onValueChange: value => changes.push(value), "aria-label": "Amount" }));
    assert.equal(view.getByRole("textbox").value, expression);
    assert.equal(view.queryByRole("button", { name: "Calculate expression" }), null);
    assert.deepEqual(changes, []);
  });
}

test("integer-only inputs reject decimal operands and editing preserves the user's text", () => {
  const changes = [];
  const view = ui.render(ui.h(NumericCalculatorInput, { value: "1.5+2", allowDecimal: false, onValueChange: value => changes.push(value), className: "test-amount", "aria-label": "Amount" }));
  assert.equal(view.queryByRole("button"), null);
  ui.fireEvent.change(view.getByRole("textbox"), { target: { value: "5/2" } });
  assert.deepEqual(changes, ["5/2"]);
  assert.ok(view.getByRole("textbox").classList.contains("test-amount"));
});

test("disabled inputs cannot calculate and missing controlled values render as empty text", () => {
  const changes = [];
  const props = { onValueChange: value => changes.push(value), "aria-label": "Amount" };
  const view = ui.render(ui.h(NumericCalculatorInput, { ...props, value: "1+2", disabled: true }));
  assert.ok(view.getByRole("textbox").disabled);
  assert.ok(view.getByRole("button").disabled);
  ui.fireEvent.click(view.getByRole("button"));
  assert.deepEqual(changes, []);
  for (const value of [null, undefined, 42]) {
    view.rerender(ui.h(NumericCalculatorInput, { ...props, value }));
    assert.equal(view.getByRole("textbox").value, value === 42 ? "42" : "");
    assert.equal(view.queryByRole("button"), null);
  }
});
