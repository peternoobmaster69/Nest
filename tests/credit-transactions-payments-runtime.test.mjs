import assert from "node:assert/strict";
import test from "node:test";
import { createCreditTransactionsHarness, budgetFixture, creditFixture, creditResponse, deferred } from "./credit-transactions-page-harness.mjs";

const { ui, fixtures, invalidations, writes, client, holdRefetches, show, loaded, setUrl, change } = await createCreditTransactionsHarness();
const key = ["credit-transactions", "household", "card-one", 2026, 9];

for (const [date, label, tone] of [
  [null, "No payment due date set", null],
  ["2026-10-09", "Overdue by 2 days", "overdue"],
  ["2026-10-10", "Overdue by 1 day", "overdue"],
  ["2026-10-11", "Payment due today", "urgent"],
  ["2026-10-12", "Payment due tomorrow", "urgent"],
  ["2026-10-14", "Payment due in 3 days", "urgent"],
  ["2026-10-15", "Payment due in 4 days", null],
]) {
  test(`the due-date summary distinguishes ${label.toLowerCase()}`, async () => {
    fixtures.set("GET /api/credit-transactions", creditResponse([creditFixture({ paymentDueDate: date && `${date}T00:00:00.000Z` })]));
    const view = show();
    await loaded(view);
    await view.findByText(label);
    const badge = view.getByRole("button", { name: "Change payment due date" });
    assert.equal(badge.classList.contains("overdue"), tone === "overdue");
    assert.equal(badge.classList.contains("urgent"), tone === "urgent");
    if (!date) assert.ok(ui.within(badge).getByText("Set date"));
  });
}

test("updating a statement due date changes only matching card, month, and year rows across all cached lists", async () => {
  fixtures.set("PATCH /api/credit-transactions/payment-due", { ok: true, updatedCount: 1 });
  holdRefetches();
  const view = show();
  await loaded(view);
  const rows = [creditFixture(), creditFixture({ id: "other-card", creditCardId: "card-two" }), creditFixture({ id: "other-month", statementMonth: 9 }), creditFixture({ id: "other-year", statementYear: 2025 })];
  const allKey = ["credit-transactions", "household", "all", 2026, -1];
  const otherKey = ["credit-transactions", "household", "card-two", 2026, 9];
  client().setQueryData(allKey, creditResponse(rows));
  client().setQueryData(otherKey, creditResponse([rows[1]]));
  change(view, "Payment due date picker", "2026-11-02");
  await view.findByText("Payment due updated for 1 transaction.");
  assert.deepEqual(writes()[0].body, { cardId: "card-one", statementMonth: 10, statementYear: 2026, paymentDueDate: "2026-11-02T00:00:00.000Z" });
  assert.equal(client().getQueryData(key).transactions[0].paymentDueDate, "2026-11-02T00:00:00.000Z");
  assert.deepEqual(client().getQueryData(allKey).transactions.map(row => row.paymentDueDate), ["2026-11-02T00:00:00.000Z", ...rows.slice(1).map(row => row.paymentDueDate)]);
  assert.equal(client().getQueryData(otherKey).transactions[0].paymentDueDate, rows[1].paymentDueDate);
});

test("due-date updates support clearing the date and report plural or empty statement results", async () => {
  holdRefetches();
  const view = show();
  await loaded(view);
  fixtures.set("PATCH /api/credit-transactions/payment-due", { ok: true, updatedCount: 2 });
  change(view, "Payment due date picker", "");
  await view.findByText("Payment due updated for 2 transactions.");
  assert.equal(writes()[0].body.paymentDueDate, null);
  fixtures.set("PATCH /api/credit-transactions/payment-due", { ok: true, updatedCount: 0 });
  change(view, "Payment due date picker", "2026-11-02");
  await view.findByText("No transactions matched this statement month.");
});

test("a failed due-date update restores the original date and displays the failure", async () => {
  fixtures.set("PATCH /api/credit-transactions/payment-due", Response.json({ error: "Statement changed" }, { status: 409 }));
  const view = show();
  await loaded(view);
  change(view, "Payment due date picker", "2026-11-02");
  await view.findByText("Statement changed");
  assert.equal(view.getByLabelText("Payment due date picker").value, "2026-10-20");
  assert.equal(view.getByRole("button", { name: "Change payment due date" }).disabled, false);
});

test("the date trigger uses the native picker when available and falls back when it is absent or throws", async t => {
  const view = show();
  await loaded(view);
  const picker = view.getByLabelText("Payment due date picker");
  const button = view.getByRole("button", { name: "Change payment due date" });
  const clicks = t.mock.method(picker, "click", () => {});
  let shown = 0;
  Object.defineProperty(picker, "showPicker", { configurable: true, value: () => { shown += 1; } });
  ui.fireEvent.click(button);
  assert.equal(shown, 1);
  assert.equal(clicks.mock.callCount(), 0);
  Object.defineProperty(picker, "showPicker", { configurable: true, value: () => { throw new Error("Unsupported context"); } });
  ui.fireEvent.click(button);
  Object.defineProperty(picker, "showPicker", { configurable: true, value: undefined });
  ui.fireEvent.click(button);
  assert.equal(clicks.mock.callCount(), 2);
  assert.deepEqual(writes(), []);
});

test("payments require confirmation and record the displayed amount with a unique idempotency key", async t => {
  const pending = deferred();
  const payment = creditFixture({ id: "payment-one", subject: "Card payment", amountCents: -1200, isAllocated: true, transactionDate: "2026-10-11T00:00:00.000Z" });
  const response = { ok: true, paidAmountCents: 1200, outstandingAmountCents: 0, bankTransactionId: "bank-payment", paymentTransaction: payment };
  t.after(() => pending.resolve(Response.json(response)));
  fixtures.set("POST /api/credit-transactions/payments", () => pending.promise);
  holdRefetches();
  const view = show();
  await loaded(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Make payment", exact: true }));
  let confirm = await view.findByRole("dialog", { name: "Confirm card payment" });
  for (const value of ["Household bank · Card fund", "Daily card · Oct 2026", "$12.00", "Home"])
    assert.ok(ui.within(confirm).getByText(value));
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Cancel" }));
  assert.deepEqual(writes(), []);
  ui.fireEvent.click(view.getByRole("button", { name: "Make payment", exact: true }));
  confirm = await view.findByRole("dialog", { name: "Confirm card payment" });
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Make payment", exact: true }));
  await ui.waitFor(() => assert.equal(writes().length, 1));
  assert.deepEqual(writes()[0].body, { cardId: "card-one", statementMonth: 10, statementYear: 2026, amountCents: 1200 });
  assert.match(writes()[0].headers.get("idempotency-key"), /^[a-f\d-]{36}$/);
  assert.equal(view.getByRole("button", { name: "Processing payment" }).disabled, true);
  await ui.act(async () => pending.resolve(Response.json(response)));
  await view.findByText("Payment recorded for $12.00.");
  assert.deepEqual(client().getQueryData(key).transactions.map(row => row.id), ["payment-one", "cafe"]);
  assert.ok(invalidations.some(({ queryKey }) => queryKey[0] === "bank-accounts"));
});

test("payment failures leave the statement payable and explain why recording failed", async () => {
  fixtures.set("POST /api/credit-transactions/payments", Response.json({ error: "Bank balance changed" }, { status: 409 }));
  const view = show();
  await loaded(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Make payment", exact: true }));
  const confirm = await view.findByRole("dialog", { name: "Confirm card payment" });
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Make payment", exact: true }));
  await view.findByText("Bank balance changed");
  assert.equal(view.getByRole("button", { name: "Make payment", exact: true }).disabled, false);
  assert.equal(client().getQueryData(key).transactions.length, 1);
});

test("payments explain the missing default receivable account and subaccount", async () => {
  fixtures.set("GET /api/context", { workspaceId: "household" });
  const view = show();
  await loaded(view);
  const button = view.getByRole("button", { name: "Make payment", exact: true });
  assert.equal(button.disabled, true);
  assert.equal(button.title, "Configure default receivable account and subaccount in Settings");
});

for (const query of ["cardId=all&month=10&year=2026", "cardId=card-one&month=all&year=2026"]) {
  test(`payments require a single card and statement month (${query})`, async () => {
    setUrl(query);
    const view = show();
    await loaded(view);
    assert.ok(!view.queryByRole("button", { name: "Make payment", exact: true }));
    assert.ok(!view.queryByRole("button", { name: "Change payment due date" }));
  });
}

for (const amountCents of [0, -1200]) {
  test(`statements with a ${amountCents} cent balance do not offer another payment`, async () => {
    fixtures.set("GET /api/credit-transactions", creditResponse([creditFixture({ amountCents })]));
    const view = show();
    await loaded(view);
    assert.ok(!view.queryByRole("button", { name: "Make payment", exact: true }));
  });
}

for (const [balance, allocated, total, expected] of [
  [1200, true, 1200, "Perfectly balanced as all things should be"],
  [2400, true, 1200, "Surplus $12.00"],
  [1200, false, 1200, "Totals match — 1 transaction still unaccounted"],
  [0, false, 1200, "Deficit $12.00"],
]) {
  test(`the statement reconciliation summary reports ${expected}`, async () => {
    fixtures.set("GET /api/budgets", [budgetFixture({ id: "card-fund", availableCents: balance })]);
    fixtures.set("GET /api/credit-transactions", creditResponse([creditFixture({ isAllocated: allocated, amountCents: total })]));
    const view = show();
    await loaded(view);
    assert.ok(await view.findByText(expected));
  });
}
