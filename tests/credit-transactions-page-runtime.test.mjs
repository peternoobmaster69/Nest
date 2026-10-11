import assert from "node:assert/strict";
import test from "node:test";
import { createCreditTransactionsHarness, cardFixture, creditFixture, creditResponse, deferred } from "./credit-transactions-page-harness.mjs";

const { ui, fixtures, requests, invalidations, setUrl, element, row, writes, client, holdRefetches, show, loaded, change } = await createCreditTransactionsHarness();
const scope = "household";
const cacheKey = (card = "card-one", year = 2026, month = 9) => ["credit-transactions", scope, card, year, month];

test("card prerequisites link to the selected workspace and also work outside a workspace route", async () => {
  const view = show([]);
  assert.equal(view.getByRole("link", { name: "Add a credit card" }).getAttribute("href"), "/w/household/credit-cards?add=1");
  assert.ok(!view.queryByRole("table"));
  assert.ok(!requests.some(request => request.url.pathname === "/api/credit-transactions"));
  setUrl("", "/credit-transactions");
  view.rerender(element([]));
  assert.equal(view.getByRole("link", { name: "Add a credit card" }).getAttribute("href"), "/credit-cards?add=1");
});

test("a failed list request can be retried without losing the card and period filters", async () => {
  fixtures.set("GET /api/credit-transactions", Response.json({ error: "Offline" }, { status: 503 }));
  const view = show();
  await view.findByRole("heading", { name: "Failed to load transactions" });
  fixtures.set("GET /api/credit-transactions", creditResponse());
  ui.fireEvent.click(view.getByRole("button", { name: "Retry", exact: true }));
  await loaded(view);
  const reads = requests.filter(request => request.url.pathname === "/api/credit-transactions");
  assert.ok(reads.length >= 2);
  assert.deepEqual(Object.fromEntries(reads.at(-1).url.searchParams), { cardId: "card-one", year: "2026", month: "10" });
  assert.ok(reads.every(request => request.headers.get("x-workspace-id") === scope));
  assert.ok(!view.queryByRole("heading", { name: "Failed to load transactions" }));
});

test("the list groups transactions by date and distinguishes charges, refunds, zero amounts, and accounted rows", async () => {
  fixtures.set("GET /api/credit-transactions", creditResponse([
    creditFixture(), creditFixture({ id: "refund", subject: "Refund", amountCents: -300 }),
    creditFixture({ id: "zero", subject: "No charge", amountCents: 0, isAllocated: true, transactionDate: "2026-10-09T00:00:00Z" }),
    creditFixture({ id: "legacy", subject: "Legacy date", transactionDate: "unknown-date" }),
  ]));
  const view = show();
  await loaded(view);
  assert.equal(view.container.querySelectorAll(".cct-date-group-row").length, 3);
  assert.equal(row(view).getByText("$12.00").classList.contains("positive"), true);
  assert.equal(row(view, "Refund").getByText("-$3.00").classList.contains("negative"), true);
  assert.equal(row(view, "No charge").getByText("$0.00").classList.contains("zero"), true);
  assert.equal(row(view, "No charge").getByRole("checkbox").disabled, true);
  assert.ok(!row(view, "No charge").queryByRole("button", { name: "Deduct transaction" }));
  assert.equal(view.getByText("unknown-date").hasAttribute("datetime"), false);
  ui.fireEvent.click(view.getByRole("checkbox", { name: "Unaccounted only" }));
  assert.ok(!view.queryByRole("button", { name: "Edit transaction: No charge" }));
  assert.ok(view.getByRole("button", { name: "Edit transaction: Refund" }));
});

test("new transactions submit exact cents, selected statement fields and an explicit due date, then update cached lists", async t => {
  const pending = deferred();
  t.after(() => pending.resolve(Response.json(creditFixture())));
  fixtures.set("POST /api/credit-transactions", () => pending.promise);
  holdRefetches();
  const view = show();
  await loaded(view);
  const existing = creditFixture();
  client().setQueryData(cacheKey("all"), creditResponse([existing]));
  client().setQueryData(cacheKey("other-card"), creditResponse([]));
  client().setQueryData(cacheKey("all", 2025), creditResponse([]));
  client().setQueryData(cacheKey("all", 2026, 8), creditResponse([]));
  ui.fireEvent.click(view.getByRole("button", { name: "Add card transaction" }));
  const dialog = await view.findByRole("dialog", { name: "Credit card transaction" });
  const form = ui.within(dialog);
  change(form, "Transaction Date", "2026-10-11");
  change(form, "Payment Due Date", "2026-11-01");
  change(form, "Statement Month", "10");
  change(form, "Statement Year", "2026");
  change(form, "Subject", "Lunch");
  change(form, "Amount ($)", "12.34");
  ui.fireEvent.submit(dialog.querySelector("form"));
  await ui.waitFor(() => assert.equal(writes().length, 1));
  assert.equal(form.getByRole("button", { name: "Adding..." }).disabled, true);
  assert.deepEqual(writes()[0].body, { creditCardId: "card-one", transactionDate: "2026-10-11T00:00:00.000Z", paymentDueDate: "2026-11-01T00:00:00.000Z", statementMonth: 10, statementYear: 2026, amountCents: 1234, subject: "Lunch" });
  const created = creditFixture({ id: "lunch", subject: "Lunch", transactionDate: "2026-10-11T00:00:00.000Z", amountCents: 1234 });
  await ui.act(async () => pending.resolve(Response.json(created)));
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  for (const card of ["card-one", "all"]) {
    assert.deepEqual(client().getQueryData(cacheKey(card)).transactions.map(row => row.id), ["lunch", "cafe"]);
    assert.equal(client().getQueryData(cacheKey(card)).cardCounts[0]._count.id, 2);
  }
  for (const key of [cacheKey("other-card"), cacheKey("all", 2025), cacheKey("all", 2026, 8)])
    assert.equal(client().getQueryData(key).transactions.length, 0);
  assert.ok(invalidations.some(({ queryKey }) => queryKey[0] === "dashboard-summary"));
});

test("editing sends the cached revision, permits clearing the due date, and keeps all card caches consistent", async () => {
  const cards = [cardFixture(), cardFixture({ id: "card-two", cardName: "Second card" })];
  const updated = creditFixture({ creditCardId: "card-two", subject: "Corrected cafe", paymentDueDate: null, amountCents: 2500 });
  fixtures.set("PATCH /api/credit-transactions/cafe", updated);
  holdRefetches();
  const view = show(cards);
  await loaded(view);
  client().setQueryData(cacheKey("card-two"), creditResponse([]));
  client().setQueryData(cacheKey("all", 2026, -1), creditResponse());
  ui.fireEvent.click(view.getByRole("button", { name: "Edit transaction: Cafe" }));
  const dialog = await view.findByRole("dialog", { name: "Credit card transaction" });
  const form = ui.within(dialog);
  assert.equal(form.getByLabelText("Amount ($)").value, "12.00");
  change(form, "Credit Card", "card-two");
  change(form, "Payment Due Date", "");
  change(form, "Subject", "Corrected cafe");
  change(form, "Amount ($)", "25");
  ui.fireEvent.submit(dialog.querySelector("form"));
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  assert.equal(writes()[0].body.expectedUpdatedAt, creditFixture().updatedAt);
  assert.equal(writes()[0].body.paymentDueDate, null);
  assert.equal(writes()[0].body.amountCents, 2500);
  assert.equal(client().getQueryData(cacheKey()).transactions.length, 0);
  assert.deepEqual(client().getQueryData(cacheKey("card-two")).transactions, [updated]);
  assert.deepEqual(client().getQueryData(cacheKey("all", 2026, -1)).transactions, [updated]);
  assert.equal(client().getQueryData(cacheKey()).cardCounts.find(row => row.creditCardId === "card-one")._count.id, 0);
});

test("stale transaction edits show the conflict and reload the latest list on request", async () => {
  fixtures.set("PATCH /api/credit-transactions/cafe", Response.json({ error: "Changed elsewhere", code: "STALE_WRITE" }, { status: 409 }));
  const view = show();
  await loaded(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Edit transaction: Cafe" }));
  const dialog = await view.findByRole("dialog", { name: "Credit card transaction" });
  ui.fireEvent.submit(dialog.querySelector("form"));
  await view.findByText("A newer version is available");
  assert.ok(view.getByRole("dialog", { name: "Credit card transaction" }));
  fixtures.set("GET /api/credit-transactions", creditResponse([creditFixture({ subject: "Latest cafe" })]));
  ui.fireEvent.click(view.getByRole("button", { name: "Reload latest" }));
  await view.findByRole("button", { name: "Edit transaction: Latest cafe" });
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(writes().length, 1);
});

for (const missing of ["Credit Card", "Transaction Date", "Subject", "Amount ($)", "Statement Month", "Statement Year"]) {
  test(`a new transaction cannot be submitted without ${missing.toLowerCase()}`, async () => {
    const view = show();
    await loaded(view);
    ui.fireEvent.click(view.getByRole("button", { name: "Add card transaction" }));
    const dialog = await view.findByRole("dialog", { name: "Credit card transaction" });
    const form = ui.within(dialog);
    change(form, "Subject", "Lunch");
    change(form, "Amount ($)", "10");
    change(form, missing, "");
    ui.fireEvent.submit(dialog.querySelector("form"));
    assert.deepEqual(writes(), []);
    assert.ok(view.getByRole("dialog", { name: "Credit card transaction" }));
  });
}

test("new entries can omit a due date and failed saves retain their editable values", async () => {
  setUrl("cardId=all&month=all&year=2026");
  fixtures.set("POST /api/credit-transactions", Response.json({ error: "Save unavailable" }, { status: 503 }));
  const view = show();
  await loaded(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Add card transaction" }));
  const dialog = await view.findByRole("dialog", { name: "Credit card transaction" });
  const form = ui.within(dialog);
  assert.equal(form.getByLabelText("Credit Card").value, "card-one");
  assert.equal(form.getByLabelText("Statement Month").value, "10");
  change(form, "Subject", "Lunch");
  change(form, "Amount ($)", "10");
  ui.fireEvent.submit(dialog.querySelector("form"));
  await view.findByText("Your changes were not saved");
  assert.ok(!Object.hasOwn(writes()[0].body, "paymentDueDate"));
  assert.equal(form.getByLabelText("Subject").value, "Lunch");
  assert.equal(form.getByRole("button", { name: "Add Transaction", exact: true }).disabled, false);
  ui.fireEvent.click(form.getByRole("button", { name: "Close Add Credit Card Transaction" }));
  assert.ok(!view.queryByRole("dialog"));
});

test("marking a row accounted sends its current revision and clears the unaccounted filter when none remain", async () => {
  setUrl("cardId=card-one&month=10&year=2026&unaccounted=true");
  fixtures.set("PATCH /api/credit-transactions/cafe", creditFixture({ isAllocated: true }));
  holdRefetches();
  const view = show();
  await loaded(view);
  assert.equal(view.getByRole("checkbox", { name: "Unaccounted only" }).checked, true);
  ui.fireEvent.click(row(view).getByRole("checkbox", { name: "Cafe accounted" }));
  await ui.waitFor(() => assert.equal(row(view).getByRole("checkbox").disabled, true));
  assert.deepEqual(writes()[0].body, { isAllocated: true, expectedUpdatedAt: creditFixture().updatedAt });
  assert.ok(!view.queryByRole("checkbox", { name: "Unaccounted only" }));
  assert.equal(ui.window.sessionStorage.getItem("nest:view:credit-transactions:unaccounted"), "false");
  assert.equal(client().getQueryData(cacheKey()).cardCounts[0]._count.id, 0);
});

test("deleting a card record requires confirmation, updates cached rows, and closes its edit form", async () => {
  fixtures.set("DELETE /api/credit-transactions/cafe", { ok: true });
  holdRefetches();
  const view = show();
  await loaded(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Delete transaction: Cafe" }));
  let confirm = await view.findByRole("dialog", { name: "Delete credit card transaction?" });
  assert.ok(ui.within(confirm).getByText("Cafe"));
  assert.ok(ui.within(confirm).getByText("Home"));
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Cancel" }));
  assert.deepEqual(writes(), []);
  ui.fireEvent.click(view.getByRole("button", { name: "Edit transaction: Cafe" }));
  const edit = await view.findByRole("dialog", { name: "Credit card transaction" });
  ui.fireEvent.click(ui.within(edit).getByRole("button", { name: "Delete", exact: true }));
  confirm = await view.findByRole("dialog", { name: "Delete credit card transaction?" });
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Delete permanently" }));
  await ui.waitFor(() => assert.ok(ui.within(edit).getByRole("button", { name: "Deleting..." })));
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  assert.deepEqual(writes().map(({ method, url }) => [method, url.pathname]), [["DELETE", "/api/credit-transactions/cafe"]]);
  assert.ok(!view.queryByRole("button", { name: "Edit transaction: Cafe" }));
  assert.equal(client().getQueryData(cacheKey()).transactions.length, 0);
});

test("a failed deletion restores the row controls so the user can retry", async () => {
  fixtures.set("DELETE /api/credit-transactions/cafe", Response.json({ error: "Delete unavailable" }, { status: 503 }));
  const view = show();
  await loaded(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Delete transaction: Cafe" }));
  const confirm = await view.findByRole("dialog", { name: "Delete credit card transaction?" });
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Delete permanently" }));
  await ui.waitFor(() => assert.equal(writes().length, 1));
  await ui.waitFor(() => assert.equal(view.getByRole("button", { name: "Delete transaction: Cafe" }).disabled, false));
  assert.ok(!view.container.querySelector(".cct-row-deleting"));
});
