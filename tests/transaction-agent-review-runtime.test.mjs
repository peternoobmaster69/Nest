import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent } = ui;
const require = createRequire(import.meta.url);
const { TransactionAgentReview, agentMoney } = require("../components/transaction-agent-review.tsx");
const { setPrivacyMode, MASKED_AMOUNT } = require("../lib/privacy-mode.ts");
beforeEach(() => setPrivacyMode(false));
afterEach(async () => { ui.cleanup(); await ui.window.happyDOM.abort(); });
after(() => ui.dispose());
function draft(overrides = {}, reviewOverrides = {}) {
  return {
    draftId: "draft-1", revision: 1, status: "REVIEW", choices: [], messages: [],
    review: {
      operation: "CREATE", currency: "SGD", before: null,
      after: { subject: "Coffee", amountCents: 500, direction: "DEBIT", date: "2026-10-08T00:00:00Z", budgetId: "daily" },
      balances: [{ id: "daily", name: "Daily", accountName: "Wallet", availableCents: 10_000, afterCents: 9500 }],
      warnings: ["Review your available balance"],
      ...reviewOverrides,
    },
    ...overrides,
  };
}
function show(value = draft(), options = {}) {
  const actions = [];
  const props = { draft: value, locked: false, typing: false, onEdit: (...args) => actions.push(["edit", ...args]), onConfirm: () => actions.push(["confirm"]), ...options };
  const view = render(h(TransactionAgentReview, props));
  return { ...view, actions, props, update: (changes) => view.rerender(h(TransactionAgentReview, { ...props, ...changes })) };
}

test("transaction review presents the exact amounts and balance impact and only confirms after review", () => {
  const view = show();
  assert.ok(view.getByRole("heading", { name: "Review new transaction" }));
  assert.match(view.getByText("Amount").parentElement.textContent, /SGD\s*5\.00/);
  assert.match(view.getByText("Sub-account").parentElement.textContent, /Daily · Wallet/);
  assert.match(view.container.querySelector(".transaction-agent-balances").textContent, /100\.00 → SGD\s*95\.00/);
  assert.ok(view.getByText("Review your available balance"));
  assert.equal(view.getByRole("group", { name: "Deduct or add" }).tagName, "FIELDSET");
  fireEvent.click(view.getByRole("button", { name: "Deduct", exact: true }));
  assert.deepEqual(view.actions, []);
  fireEvent.click(view.getByRole("button", { name: "Add", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Change", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Confirm transaction" }));
  assert.deepEqual(view.actions, [["edit", "direction", "CREDIT"], ["edit", "budget"], ["confirm"]]);
  const changed = draft();
  changed.review.after.direction = "CREDIT";
  view.update({ draft: changed });
  assert.equal(view.getByRole("button", { name: "Add", exact: true }).getAttribute("aria-pressed"), "true");
  fireEvent.click(view.getByRole("button", { name: "Add", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Deduct", exact: true }));
  assert.deepEqual(view.actions.at(-1), ["edit", "direction", "DEBIT"]);
  assert.equal(view.actions.length, 4);
});

test("description, amount, and date edits are trimmed, stay explicit, and block confirmation while open", () => {
  const view = show();
  for (const [field, label, initial, value] of [["subject", "description", "Coffee", "  Lunch  "], ["amount", "amount", "5.00", " 12.50 "], ["date", "date", "2026-10-08", "2026-10-09"]]) {
    fireEvent.click(view.getByRole("button", { name: `Edit ${label}` }));
    const input = view.getByLabelText(`New ${label}`);
    assert.equal(input.value, initial);
    assert.equal(document.activeElement, input);
    assert.equal(input.maxLength, 120);
    assert.equal(input.type, field === "date" ? "date" : "text");
    assert.equal(input.inputMode, field === "amount" ? "decimal" : "");
    assert.equal(view.getByRole("button", { name: "Confirm transaction" }).disabled, true);
    fireEvent.keyDown(input, { key: "x" });
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form"));
    assert.deepEqual(view.actions.at(-1), ["edit", field, value.trim()]);
    assert.equal(view.queryByLabelText(`New ${label}`), null);
    assert.equal(view.getByRole("button", { name: "Confirm transaction" }).disabled, false);
  }
});

test("blank, unchanged, cancelled, and escaped edits leave the reviewed transaction intact", () => {
  const view = show();
  for (const value of [" ", " Coffee "]) {
    fireEvent.click(view.getByRole("button", { name: "Edit description" }));
    const input = view.getByLabelText("New description");
    fireEvent.change(input, { target: { value } });
    fireEvent.click(view.getByRole("button", { name: "Apply" }));
    assert.equal(view.queryByLabelText("New description"), null);
  }
  fireEvent.click(view.getByRole("button", { name: "Edit amount" }));
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Edit date" }));
  const input = view.getByLabelText("New date");
  let escaped = false;
  const listener = () => { escaped = true; };
  document.addEventListener("keydown", listener);
  fireEvent.keyDown(input, { key: "Escape" });
  document.removeEventListener("keydown", listener);
  assert.equal(escaped, false);
  assert.equal(view.queryByLabelText("New date"), null);
  assert.deepEqual(view.actions, []);
});

test("corrections retain before details, saved entries are immutable, and absent accounts have a readable fallback", () => {
  const before = { subject: "Original coffee", amountCents: 600, direction: "DEBIT", date: "2026-10-07", budgetId: "daily" };
  const value = draft({}, { operation: "UPDATE", before });
  const view = show(value);
  assert.ok(view.getByRole("heading", { name: "Review correction" }));
  assert.match(view.container.querySelector(".transaction-agent-before").textContent, /Original coffee · Deduct SGD\s*6\.00 · 2026-10-07 · Daily/);
  fireEvent.click(view.getByRole("button", { name: "Confirm correction" }));
  assert.deepEqual(view.actions, [["confirm"]]);
  view.update({ draft: draft({ status: "SAVED" }, { operation: "UPDATE", before: { ...before, direction: "CREDIT", budgetId: "missing" } }) });
  assert.ok(view.getByRole("heading", { name: "Saved" }));
  assert.ok(view.getByText("Balance impact at the time of saving"));
  assert.match(view.container.querySelector(".transaction-agent-before").textContent, /Add SGD\s*6\.00.*Unassigned/);
  assert.equal(view.queryByText("Review your available balance"), null);
  assert.equal(view.queryByRole("button"), null);
});

test("locked, typing, non-review, and private states preserve transaction safeguards", () => {
  const view = show(draft({}, { balances: [], warnings: [] }), { locked: true });
  assert.equal(view.queryByRole("button", { name: "Edit description" }), null);
  assert.equal(view.getByRole("button", { name: "Confirm transaction" }).disabled, true);
  const credit = draft();
  credit.review.after.direction = "CREDIT";
  view.update({ draft: credit, locked: true });
  assert.ok(view.getByText("Add", { exact: true }));
  view.update({ locked: false, typing: true });
  assert.equal(view.getByRole("button", { name: "Confirm transaction" }).disabled, true);
  assert.ok(view.getByText("Send your message first. It may change the review."));
  view.update({ draft: draft({ status: "EXPIRED" }) });
  assert.equal(view.queryByRole("button"), null);
  ui.act(() => setPrivacyMode(true));
  assert.equal(agentMoney(1234, "SGD"), MASKED_AMOUNT);
  assert.equal(view.getByText("Amount").parentElement.querySelector("dd span").textContent, MASKED_AMOUNT);
  assert.doesNotMatch(view.container.querySelector(".transaction-agent-balances").textContent, /100\.00/);
  ui.act(() => setPrivacyMode(false));
  assert.match(agentMoney(-1234, "SGD"), /-SGD\s*12\.34/);
});
