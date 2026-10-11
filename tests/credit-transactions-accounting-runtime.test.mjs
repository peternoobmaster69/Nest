import assert from "node:assert/strict";
import test from "node:test";
import { createCreditTransactionsHarness, bankFixture, budgetFixture, deferred } from "./credit-transactions-page-harness.mjs";

const { ui, fixtures, invalidations, row, writes, client, holdRefetches, show, loaded, change } = await createCreditTransactionsHarness();
const accountingPath = "POST /api/credit-transactions/cafe/accounting";

test("deductions show the ledger effects before confirmation and post the chosen source and destination once", async () => {
  fixtures.set(accountingPath, { ok: true });
  holdRefetches();
  const view = show();
  await loaded(view);
  ui.fireEvent.click(row(view).getByRole("button", { name: "Deduct transaction" }));
  const dialog = await view.findByRole("dialog", { name: "Account for transaction" });
  const form = ui.within(dialog);
  assert.equal(form.getByLabelText("Bank Account").value, "bank-home");
  assert.equal(form.getByLabelText("Sub Account").value, "food");
  assert.equal(form.getByLabelText("Destination Sub Account").value, "card-fund");
  ui.fireEvent.submit(dialog.querySelector("form"));
  let confirm = await view.findByRole("dialog", { name: "Confirm card accounting" });
  for (const text of ["Household bank · Food", "Household bank · Card fund", "$588.00", "$24.00", "Home", "OWNER"])
    assert.ok(ui.within(confirm).getByText(text));
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Cancel" }));
  assert.deepEqual(writes(), []);
  change(form, "Bank Account", "bank-joint");
  assert.equal(form.getByLabelText("Sub Account").value, "travel");
  change(form, "Destination Account", "bank-joint");
  change(form, "Destination Account", "bank-home");
  change(form, "Destination Sub Account", "card-fund");
  ui.fireEvent.submit(dialog.querySelector("form"));
  confirm = await view.findByRole("dialog", { name: "Confirm card accounting" });
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Post accounting entry" }));
  await view.findByText("Credit transaction deducted and marked accounted.");
  assert.ok(!view.queryByRole("dialog"));
  assert.deepEqual(writes()[0].body, { id: "cafe", action: "DEDUCT", accountId: "bank-joint", budgetId: "travel", destinationAccountId: "bank-home", destinationBudgetId: "card-fund" });
  assert.equal(writes()[0].headers.get("idempotency-key"), "credit-account:cafe");
  assert.equal(row(view).getByRole("checkbox").disabled, true);
  for (const name of ["transactions", "receivables", "budgets", "bank-accounts", "receivables-summary", "smart-review"])
    assert.ok(invalidations.some(({ queryKey }) => queryKey[0] === name));
});

test("deductions retain valid prior selections and recover when their account or subaccount is removed", async () => {
  const view = show();
  await loaded(view);
  const open = async () => {
    ui.fireEvent.click(row(view).getByRole("button", { name: "Deduct transaction" }));
    return ui.within(await view.findByRole("dialog", { name: "Account for transaction" }));
  };
  let form = await open();
  change(form, "Bank Account", "bank-joint");
  change(form, "Sub Account", "travel");
  ui.fireEvent.click(form.getByRole("button", { name: "Cancel" }));
  form = await open();
  assert.equal(form.getByLabelText("Bank Account").value, "bank-joint");
  assert.equal(form.getByLabelText("Sub Account").value, "travel");
  ui.fireEvent.click(form.getByRole("button", { name: "Close Deduct Credit Transaction" }));
  await ui.act(async () => {
    client().setQueryData(["bank-accounts", "household"], [bankFixture()]);
    client().setQueryData(["budgets", "household"], [budgetFixture({ id: "replacement", name: "Replacement" })]);
  });
  await view.findByText("Default Subaccount");
  form = await open();
  assert.equal(form.getByLabelText("Bank Account").value, "bank-home");
  assert.equal(form.getByLabelText("Sub Account").value, "replacement");
  assert.equal(form.getByLabelText("Destination Sub Account").value, "replacement");
});

test("deductions require an available source and may use the workspace destination implicitly", async () => {
  fixtures.set("GET /api/context", { workspaceId: "household" });
  fixtures.set("GET /api/accounts", []);
  fixtures.set("GET /api/budgets", []);
  fixtures.set(accountingPath, { ok: true });
  holdRefetches();
  const view = show();
  await loaded(view);
  ui.fireEvent.click(row(view).getByRole("button", { name: "Deduct transaction" }));
  const dialog = await view.findByRole("dialog", { name: "Account for transaction" });
  const form = ui.within(dialog);
  ui.fireEvent.submit(dialog.querySelector("form"));
  assert.ok(!view.queryByRole("dialog", { name: "Confirm card accounting" }));
  assert.deepEqual(writes(), []);
  await ui.act(async () => client().setQueryData(["bank-accounts", "household"], [bankFixture()]));
  await ui.within(form.getByLabelText("Bank Account")).findByRole("option", { name: "Household bank" });
  change(form, "Bank Account", "bank-home");
  ui.fireEvent.submit(dialog.querySelector("form"));
  assert.deepEqual(writes(), []);
  await ui.act(async () => client().setQueryData(["budgets", "household"], [budgetFixture()]));
  await form.findByRole("option", { name: "Food" });
  change(form, "Sub Account", "food");
  ui.fireEvent.submit(dialog.querySelector("form"));
  const confirm = await view.findByRole("dialog", { name: "Confirm card accounting" });
  assert.ok(ui.within(confirm).getByText("Daily card"));
  assert.ok(ui.within(confirm).getByText("Current workspace"));
  assert.ok(ui.within(confirm).getByText("EDITOR"));
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Post accounting entry" }));
  await view.findByText("Credit transaction deducted and marked accounted.");
  assert.deepEqual(writes()[0].body, { id: "cafe", action: "DEDUCT", accountId: "bank-home", budgetId: "food" });
});

test("receivables preserve cents, notes and dates and derive a leap-year month end when the transaction date changes", async () => {
  fixtures.set(accountingPath, { ok: true });
  holdRefetches();
  const view = show();
  await loaded(view);
  ui.fireEvent.click(row(view).getByRole("button", { name: "Create receivable" }));
  const dialog = await view.findByRole("dialog", { name: "Create receivable" });
  const form = ui.within(dialog);
  assert.equal(form.getByLabelText("Receivable Date").value, "2026-10-31");
  assert.equal(form.getByLabelText("Title").value, "Cafe");
  change(form, "Txn Date", "2028-02-15");
  assert.equal(form.getByLabelText("Receivable Date").value, "2028-02-29");
  change(form, "Receivable Date", "2028-03-10");
  change(form, "Title", "Shared dinner");
  change(form, "Amount ($)", "20.15");
  change(form, "Notes", "**Split** with family");
  ui.fireEvent.submit(dialog.querySelector("form"));
  await view.findByText("Receivable created and credit transaction marked accounted.");
  assert.ok(!view.queryByRole("dialog"));
  assert.deepEqual(writes()[0].body, { id: "cafe", action: "RECEIVABLE", receivableDate: "2028-03-10T00:00:00.000Z", transactionDate: "2028-02-15T00:00:00.000Z", amountCents: 2015, title: "Shared dinner", notes: "**Split** with family", accountId: "bank-home", budgetId: "card-fund" });
});

test("cross-workspace receivables wait for the selected workspace's budgets and submit its source IDs", async t => {
  const pendingBudgets = deferred();
  t.after(() => pendingBudgets.resolve(Response.json([])));
  const householdAccounts = fixtures.get("GET /api/accounts");
  const householdBudgets = fixtures.get("GET /api/budgets");
  fixtures.set("GET /api/accounts", ({ url }) => Response.json(url.searchParams.get("workspaceId") === "shared" ? [bankFixture({ id: "family-bank", name: "Family bank" })] : householdAccounts));
  fixtures.set("GET /api/budgets", ({ url }) => url.searchParams.get("workspaceId") === "shared" ? pendingBudgets.promise : Response.json(householdBudgets));
  fixtures.set(accountingPath, { ok: true });
  holdRefetches();
  const view = show();
  await loaded(view);
  ui.fireEvent.click(row(view).getByRole("button", { name: "Create receivable" }));
  const dialog = await view.findByRole("dialog", { name: "Create receivable" });
  const form = ui.within(dialog);
  ui.fireEvent.click(form.getByRole("checkbox", { name: "Deduct from another workspace" }));
  ui.fireEvent.submit(dialog.querySelector("form"));
  assert.deepEqual(writes(), []);
  assert.equal(form.getByLabelText("Bank Account").disabled, true);
  assert.ok(!form.queryByRole("option", { name: "Home", exact: true }));
  change(form, "Deduction Workspace", "shared");
  await form.findByRole("option", { name: "Family bank" });
  change(form, "Bank Account", "family-bank");
  ui.fireEvent.submit(dialog.querySelector("form"));
  assert.deepEqual(writes(), []);
  await ui.act(async () => pendingBudgets.resolve(Response.json([
    budgetFixture({ id: "family-food", accountId: "family-bank", name: "Family food" }),
    budgetFixture({ id: "family-travel", accountId: "family-bank", name: "Family travel" }),
  ])));
  await ui.waitFor(() => assert.equal(form.getByLabelText("Sub Account").value, "family-food"));
  change(form, "Sub Account", "family-travel");
  ui.fireEvent.submit(dialog.querySelector("form"));
  await view.findByText("Receivable created and credit transaction marked accounted.");
  assert.equal(writes()[0].body.accountId, "family-bank");
  assert.equal(writes()[0].body.budgetId, "family-travel");
});

test("turning off cross-workspace deductions clears their fields and cancellation never posts a receivable", async () => {
  const view = show();
  await loaded(view);
  ui.fireEvent.click(row(view).getByRole("button", { name: "Create receivable" }));
  let dialog = await view.findByRole("dialog", { name: "Create receivable" });
  let form = ui.within(dialog);
  ui.fireEvent.click(form.getByRole("checkbox", { name: "Deduct from another workspace" }));
  change(form, "Deduction Workspace", "shared");
  ui.fireEvent.click(form.getByRole("checkbox", { name: "Deduct from another workspace" }));
  assert.ok(!form.queryByLabelText("Deduction Workspace"));
  ui.fireEvent.click(form.getByRole("checkbox", { name: "Deduct from another workspace" }));
  assert.equal(form.getByLabelText("Deduction Workspace").value, "");
  ui.fireEvent.click(form.getByRole("button", { name: "Cancel" }));
  ui.fireEvent.click(row(view).getByRole("button", { name: "Create receivable" }));
  dialog = await view.findByRole("dialog", { name: "Create receivable" });
  form = ui.within(dialog);
  assert.equal(form.getByRole("checkbox", { name: "Deduct from another workspace" }).checked, false);
  ui.fireEvent.click(form.getByRole("button", { name: "Close Create Receivable" }));
  assert.deepEqual(writes(), []);
});

test("receivable failures keep the form open and display the API error without marking the row accounted", async () => {
  fixtures.set(accountingPath, Response.json({ error: "Source account unavailable" }, { status: 422 }));
  const view = show();
  await loaded(view);
  ui.fireEvent.click(row(view).getByRole("button", { name: "Create receivable" }));
  const dialog = await view.findByRole("dialog", { name: "Create receivable" });
  ui.fireEvent.submit(dialog.querySelector("form"));
  await view.findByText("Source account unavailable");
  assert.ok(view.getByRole("dialog", { name: "Create receivable" }));
  assert.equal(client().getQueryData(["credit-transactions", "household", "card-one", 2026, 9]).transactions[0].isAllocated, false);
  assert.equal(ui.within(dialog).getByRole("button", { name: "Create Receivable", exact: true }).disabled, false);
});
