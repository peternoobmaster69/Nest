import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, fireEvent, within } = ui;
const require = createRequire(import.meta.url);
const { TransactionMonthList } = require("../components/transactions/transaction-month-list.tsx");
afterEach(() => ui.cleanup());
after(() => ui.dispose());

const transaction = (overrides = {}) => ({ id: "income", subject: "Salary", date: "2026-10-09T00:00:00", amountCents: 12345, direction: "CREDIT", ...overrides });
const group = (overrides = {}) => ({ monthKey: "2026-10", monthLabel: "October 2026", totalIncome: 12345, totalExpense: 6000, transactions: [transaction()], ...overrides });
const props = (overrides = {}) => ({ groups: [group()], summaries: new Map(), useServerSummaries: false, deletingIds: [], selectedIds: [], targetId: null, grouping: false, formatAmount: (cents) => `${(cents / 100).toFixed(2)} SGD`, onActivate: () => {}, ...overrides });

test("monthly totals use scoped server summaries when requested and fall back to the loaded groups", () => {
  const groups = [group(), group({ monthKey: "2026-09", monthLabel: "September 2026", totalIncome: 0, totalExpense: 0, transactions: [] })];
  const summaries = new Map([["2026-10", { incomeCents: 100000, expenseCents: 300000 }]]);
  const view = ui.render(h(TransactionMonthList, props({ groups, summaries })));
  let header = view.getByText("October 2026").parentElement;
  assert.ok(within(header).getByText("+123.45 SGD"));
  assert.ok(within(header).getByText("−60.00 SGD"));
  assert.equal(view.getByText("September 2026").parentElement.querySelector(".tx-month-summary").textContent, "");
  view.rerender(h(TransactionMonthList, props({ groups, summaries, useServerSummaries: true })));
  header = view.getByText("October 2026").parentElement;
  assert.ok(within(header).getByText("+1000.00 SGD"));
  assert.ok(within(header).getByText("−3000.00 SGD"));
  assert.equal(view.getByText("September 2026").parentElement.querySelector(".tx-month-summary").textContent, "");
  view.rerender(h(TransactionMonthList, props({ groups: [group()], useServerSummaries: true })));
  assert.ok(within(view.getByText("October 2026").parentElement).getByText("+123.45 SGD"));
  view.rerender(h(TransactionMonthList, props({ groups: [] })));
  assert.equal(view.container.textContent, "");
});

test("transaction rows are native buttons with correction history, grouping labels, and deep-link highlighting", () => {
  const credit = transaction({ hasCorrectionHistory: true, group: { name: "Payroll", icon: "💼" } });
  const debit = transaction({ id: "debit", subject: "Lunch", direction: "DEBIT", amountCents: 1500, group: { name: "Food", icon: null } });
  const zero = transaction({ id: "zero", subject: "Adjustment", amountCents: 0 });
  const groups = [group({ transactions: [credit, debit, zero] })];
  const activated = [];
  const base = props({ groups, targetId: "debit", onActivate: (row) => activated.push(row) });
  const view = ui.render(h(TransactionMonthList, base));
  const creditButton = view.getByRole("button", { name: "Correct transaction Salary; correction history available" });
  assert.equal(creditButton.tagName, "BUTTON");
  assert.equal(creditButton.type, "button");
  assert.equal(creditButton.getAttribute("aria-pressed"), null);
  assert.ok(within(creditButton).getByText("Corrected"));
  assert.ok(within(creditButton).getByText("💼 Payroll"));
  assert.equal(within(creditButton).getByText("+123.45 SGD").className, "tx-recent-amount positive");
  const debitButton = view.getByRole("button", { name: "Correct transaction Lunch" });
  assert.ok(debitButton.classList.contains("is-deep-linked"));
  assert.equal(debitButton.id, "transaction-debit");
  assert.ok(within(debitButton).getByText("📌 Food"));
  assert.equal(within(debitButton).getByText("−15.00 SGD").className, "tx-recent-amount negative");
  assert.equal(view.getByText("+0.00 SGD").className, "tx-recent-amount zero");
  assert.equal(creditButton.querySelector(".tx-recent-arrow").textContent, "→");
  assert.equal(debitButton.querySelector(".tx-recent-arrow").textContent, "←");
  fireEvent.click(creditButton);
  assert.equal(activated[0], credit);
  view.rerender(h(TransactionMonthList, { ...base, grouping: true, selectedIds: [credit.id] }));
  const selected = view.getByRole("button", { name: "Deselect transaction Salary" });
  const unselected = view.getByRole("button", { name: "Select transaction Lunch" });
  assert.equal(selected.getAttribute("aria-pressed"), "true");
  assert.equal(unselected.getAttribute("aria-pressed"), "false");
  assert.ok(selected.classList.contains("is-selected"));
  assert.ok(selected.querySelector(".tx-recent-arrow.select.is-selected svg"));
  assert.equal(unselected.querySelector(".tx-recent-arrow").textContent, "");
  fireEvent.click(selected);
  fireEvent.click(unselected);
  assert.deepEqual(activated, [credit, credit, debit]);
});

test("keyboard activation uses Enter and Space while deleting rows cannot be focused or activated", async () => {
  const credit = transaction();
  const deleting = transaction({ id: "deleting", subject: "Removed record" });
  const debit = transaction({ id: "debit", subject: "Lunch", direction: "DEBIT" });
  const activated = [];
  let submitted = 0;
  const view = ui.render(h("form", { onSubmit: (event) => { event.preventDefault(); submitted += 1; } }, h(TransactionMonthList, props({ groups: [group({ transactions: [credit, deleting, debit] })], deletingIds: [deleting.id], onActivate: (row) => activated.push(row) }))));
  const removed = view.getByRole("button", { name: "Correct transaction Removed record" });
  assert.equal(removed.disabled, true);
  assert.ok(removed.classList.contains("crud-row-deleting"));
  fireEvent.click(removed);
  await ui.user.tab();
  assert.equal(document.activeElement, view.getByRole("button", { name: "Correct transaction Salary" }));
  await ui.user.keyboard("{Enter}");
  await ui.user.keyboard(" ");
  await ui.user.keyboard("x");
  await ui.user.tab();
  assert.equal(document.activeElement, view.getByRole("button", { name: "Correct transaction Lunch" }));
  await ui.user.keyboard("{Enter}");
  assert.deepEqual(activated, [credit, credit, debit]);
  assert.equal(submitted, 0);
});

test("local midnight dates omit a time and timestamps retain their time-of-day context", () => {
  const dates = ["2026-10-09T00:00:00", "2026-10-09T12:00:00", "2026-10-09T00:01:00", "2026-10-09T00:00:01"];
  const rows = dates.map((date, index) => transaction({ id: `date-${index}`, subject: `Date ${index}`, date }));
  const view = ui.render(h(TransactionMonthList, props({ groups: [group({ transactions: rows })] })));
  const shown = rows.map((row) => view.getByRole("button", { name: `Correct transaction ${row.subject}` }).querySelector(".tx-recent-date").textContent);
  assert.doesNotMatch(shown[0], /\d+:\d+/);
  for (const text of shown.slice(1)) assert.match(text, /\d+:\d+/);
  assert.ok(shown.every((text) => text.includes("2026")));
});
