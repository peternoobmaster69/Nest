import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { TransactionBudgetGrid } = require("../components/transactions/transaction-budget-grid.tsx");
const { fireEvent, waitFor } = ui;
const budgets = Array.from({ length: 20 }, (_, index) => ({ id: `budget-${index}`, name: `Budget ${index}`, icon: "⭐", availableCents: index * 100, receivableReservedCents: 0 }));
let viewportWidth, reducedMotion, selections, edits, receivables;
const props = (overrides = {}) => ({ budgets, activeId: "ALL", totalCents: 19000, formatAmount: (cents) => `$${(cents / 100).toFixed(2)}`, onSelect: (id) => selections.push(id), onEdit: (budget) => edits.push(budget), onReceivables: (id) => receivables.push(id), ...overrides });
const show = (overrides) => ui.render(ui.h(TransactionBudgetGrid, props(overrides)));
const cards = (view) => view.container.querySelectorAll(".tx-account-card");

beforeEach((t) => {
  viewportWidth = 1280;
  reducedMotion = false;
  selections = []; edits = []; receivables = [];
  ui.window.sessionStorage.clear();
  t.mock.method(ui.window, "matchMedia", (query) => ({ matches: query.includes("reduced-motion") ? reducedMotion : viewportWidth <= Number(/max-width: (\d+)/.exec(query)[1]) }));
});
afterEach(() => ui.cleanup());
after(() => ui.dispose());

test("sub-account selection, editing, and receivables are separate native keyboard controls", async () => {
  const food = { id: "food", name: "Food", availableCents: 60000, receivableReservedCents: 12000 };
  const view = show({ budgets: [food], activeId: "food", totalCents: 60000 });
  const select = view.getByRole("button", { name: "Show transactions from Food" });
  assert.equal(select.tagName, "BUTTON");
  assert.equal(select.getAttribute("aria-pressed"), "true");
  assert.ok(!select.querySelector("button"));
  select.focus();
  await ui.user.keyboard("{Enter}");
  await ui.user.keyboard(" ");
  assert.deepEqual(selections, ["food", "food"]);
  const edit = view.getByRole("button", { name: "Edit Food", exact: true });
  edit.focus();
  await ui.user.keyboard("{Enter}");
  const reserved = view.getByRole("button", { name: "Show receivable breakdown for Food" });
  reserved.focus();
  await ui.user.keyboard(" ");
  assert.deepEqual(edits, [food]);
  assert.deepEqual(receivables, ["food"]);
  assert.deepEqual(selections, ["food", "food"], "Secondary actions must not also change the transaction filter");
  fireEvent.click(view.getByRole("button", { name: "Show transactions from all sub-accounts" }));
  assert.deepEqual(selections, ["food", "food", "ALL"]);
  assert.ok(view.getByText("($120.00)"));
  assert.ok(!view.queryByRole("button", { name: /Show all/ }));
});

test("collapsed cards preserve the active sub-account across desktop, tablet, and mobile widths", async () => {
  const view = show({ activeId: "budget-19" });
  assert.equal(cards(view).length, 16);
  assert.ok(view.getByRole("button", { name: "Show transactions from Budget 19", exact: true }));
  assert.ok(!view.queryByRole("button", { name: "Show transactions from Budget 14", exact: true }));
  for (const [width, count] of [[900, 12], [390, 6], [1280, 16]]) {
    viewportWidth = width;
    fireEvent(ui.window, new ui.window.Event("resize"));
    await waitFor(() => assert.equal(cards(view).length, count));
    assert.ok(view.getByRole("button", { name: "Show transactions from Budget 19", exact: true }));
  }
  fireEvent.click(view.getByRole("button", { name: "Show all 20 sub-accounts" }));
  assert.equal(cards(view).length, 21);
  assert.equal(view.getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded"), "true");
  fireEvent.click(view.getByRole("button", { name: "Show fewer" }));
  assert.equal(cards(view).length, 16);
  view.rerender(ui.h(TransactionBudgetGrid, props({ activeId: "budget-2" })));
  assert.ok(view.getByRole("button", { name: "Show transactions from Budget 2", exact: true }));
  assert.ok(!view.queryByRole("button", { name: "Show transactions from Budget 19", exact: true }));
});

test("returning to an expanded grid restores the preference and releases the resize listener", async (t) => {
  ui.window.sessionStorage.setItem("nest:view:transactions:subaccounts-expanded", "true");
  const add = t.mock.method(ui.window, "addEventListener");
  const remove = t.mock.method(ui.window, "removeEventListener");
  const view = show();
  await waitFor(() => assert.equal(cards(view).length, 21));
  const listener = add.mock.calls.find(({ arguments: args }) => args[0] === "resize").arguments[1];
  view.unmount();
  assert.ok(remove.mock.calls.some(({ arguments: args }) => args[0] === "resize" && args[1] === listener));
});

test("height transitions clear clipping on completion, cancellation, and unmount", (t) => {
  const view = show();
  const grid = view.container.querySelector("#tx-account-grid-wrap");
  t.mock.method(grid, "getBoundingClientRect", () => ({ height: cards(view).length * 10 }));
  const animations = [];
  grid.animate = t.mock.fn((frames, options) => {
    const animation = { frames, options, onfinish: null, oncancel: null, cancel: t.mock.fn(() => animation.oncancel()) };
    animations.push(animation);
    return animation;
  });
  fireEvent.click(view.getByRole("button", { name: "Show all 20 sub-accounts" }));
  assert.equal(grid.style.overflow, "hidden");
  assert.deepEqual(animations[0].frames, [{ height: "160px" }, { height: "210px" }]);
  assert.deepEqual(animations[0].options, { duration: 240, easing: "ease-in-out" });
  animations[0].onfinish();
  assert.equal(grid.style.overflow, "");
  fireEvent.click(view.getByRole("button", { name: "Show fewer" }));
  assert.equal(animations[0].cancel.mock.callCount(), 1);
  assert.equal(grid.style.overflow, "hidden");
  animations[1].oncancel();
  assert.equal(grid.style.overflow, "");
  view.unmount();
  assert.equal(animations[1].cancel.mock.callCount(), 1);
});

test("reduced motion expands the grid immediately even when its height changes", (t) => {
  reducedMotion = true;
  const view = show();
  const grid = view.container.querySelector("#tx-account-grid-wrap");
  t.mock.method(grid, "getBoundingClientRect", () => ({ height: cards(view).length * 10 }));
  grid.animate = t.mock.fn();
  fireEvent.click(view.getByRole("button", { name: "Show all 20 sub-accounts" }));
  assert.equal(cards(view).length, 21);
  assert.equal(grid.animate.mock.callCount(), 0);
  assert.equal(grid.style.overflow, "");
});

test("empty, zero, and overdrawn accounts keep their balances visible without an inapplicable receivables action", () => {
  const view = show({ budgets: [], totalCents: 0 });
  assert.equal(cards(view).length, 1);
  assert.ok(view.getByText("$0.00").classList.contains("zero"));
  assert.ok(!view.queryByRole("button", { name: /Show all/ }));
  view.rerender(ui.h(TransactionBudgetGrid, props({ budgets: [
    { id: "negative", name: "Overdraft", availableCents: -1500, receivableReservedCents: 100 },
    { id: "zero", name: "Empty", availableCents: 0 },
  ], totalCents: -1500 })));
  assert.equal(cards(view).length, 3);
  assert.ok(!view.queryByRole("button", { name: /Show receivable breakdown/ }));
  assert.equal(view.getAllByText("$-15.00").length, 2);
  assert.ok(view.getAllByText("$-15.00").every((element) => element.classList.contains("negative")));
});
