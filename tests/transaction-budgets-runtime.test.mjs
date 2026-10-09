import assert from "node:assert/strict";
import test from "node:test";
import { bankFixture, budgetFixture, createTransactionsPageHarness, deferred } from "./transactions-page-harness.mjs";

const harness = await createTransactionsPageHarness();
const { ui, fixtures, show, loaded, writes, invalidations } = harness;
const { fireEvent, within, waitFor } = ui;
const input = (dialog, name, value) => fireEvent.change(within(dialog).getByRole("textbox", { name }), { target: { value } });
const invalidatedRoots = () => invalidations.map(({ queryKey }) => queryKey[0]);

test("creating a savings sub-account trims the name, converts its limit, and refreshes balances after success", async () => {
  const pending = deferred();
  fixtures.set("POST /api/budgets", () => pending.promise);
  const view = show();
  await loaded(view);
  fireEvent.click(view.getByRole("button", { name: "Add new sub-account" }));
  const dialog = await view.findByRole("dialog", { name: "Sub-account" });
  assert.equal(within(dialog).getByRole("button", { name: "Create", exact: true }).disabled, true);
  input(dialog, "Name", "  Emergency fund  ");
  input(dialog, "Monthly Limit (optional)", "123.45");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Bank Account" }), { target: { value: "bank-joint" } });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Mark as savings (included in net worth)" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create", exact: true }));
  await within(dialog).findByRole("button", { name: "Creating..." });
  assert.deepEqual(writes()[0].body, { workspaceId: "household", name: "Emergency fund", targetCents: 12345, accountId: "bank-joint", icon: "🛡️", isSavings: true });
  assert.equal(writes()[0].headers.get("x-workspace-id"), "household");
  await ui.act(async () => pending.resolve(Response.json({ id: "new-budget" }, { status: 201 })));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Sub-account" })));
  for (const root of ["budgets", "bank-accounts", "dashboard-summary", "cio"]) assert.ok(invalidatedRoots().includes(root));
  fireEvent.click(view.getByRole("button", { name: "Add new sub-account" }));
  const fresh = view.getByRole("dialog", { name: "Sub-account" });
  assert.equal(within(fresh).getByRole("textbox", { name: "Name" }).value, "");
  assert.equal(within(fresh).getByRole("checkbox").checked, false);
  fireEvent.click(within(fresh).getByRole("button", { name: "Cancel", exact: true }));
});

test("updating a sub-account closes its editor instead of switching to a new-account form", async () => {
  fixtures.set("PATCH /api/budgets/food", { id: "food" });
  const view = show();
  await loaded(view);
  fireEvent.click(view.getByRole("button", { name: "Edit Food", exact: true }));
  const dialog = await view.findByRole("dialog", { name: "Sub-account" });
  assert.equal(within(dialog).getByRole("textbox", { name: "Monthly Limit (optional)" }).value, "100.00");
  input(dialog, "Name", "  Household food  ");
  input(dialog, "Monthly Limit (optional)", "");
  fireEvent.click(within(dialog).getByRole("button", { name: "Select icon 🥬" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => assert.equal(writes().length, 1));
  assert.deepEqual(writes()[0].body, { name: "Household food", targetCents: 0, icon: "🥬", isSavings: false });
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Sub-account" })));
  assert.ok(invalidatedRoots().includes("bank-accounts"));
});

test("deleting a sub-account requires confirmation, refreshes balances, and closes the editor", async () => {
  fixtures.set("DELETE /api/budgets/food", { deleted: true });
  const view = show();
  await loaded(view);
  fireEvent.click(view.getByRole("button", { name: "Edit Food", exact: true }));
  const dialog = await view.findByRole("dialog", { name: "Sub-account" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete", exact: true }));
  const cancel = await view.findByRole("dialog", { name: "Delete sub-account?" });
  assert.equal(writes().length, 0);
  assert.ok(within(cancel).getByText("Home"));
  fireEvent.click(within(cancel).getByRole("button", { name: "Cancel", exact: true }));
  assert.equal(writes().length, 0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete", exact: true }));
  const confirmation = await view.findByRole("dialog", { name: "Delete sub-account?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Confirm", exact: true }));
  await waitFor(() => assert.equal(writes().length, 1));
  assert.equal(writes()[0].method, "DELETE");
  assert.equal(writes()[0].url.pathname, "/api/budgets/food");
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Sub-account" })));
  assert.ok(invalidatedRoots().includes("budgets"));
});

for (const operation of ["create", "update", "delete"]) {
  test(`${operation} failures remain visible and preserve the sub-account form for a retry`, async () => {
    const endpoint = operation === "create" ? "POST /api/budgets" : `${operation === "update" ? "PATCH" : "DELETE"} /api/budgets/food`;
    fixtures.set(endpoint, () => Response.json({ error: "The account could not be changed" }, { status: 409 }));
    const view = show();
    await loaded(view);
    fireEvent.click(view.getByRole("button", { name: operation === "create" ? "Add new sub-account" : "Edit Food", exact: true }));
    const dialog = await view.findByRole("dialog", { name: "Sub-account" });
    input(dialog, "Name", "Keep my changes");
    const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: { create: "Create", update: "Save", delete: "Delete" }[operation], exact: true }));
    submit();
    if (operation === "delete") fireEvent.click(within(await view.findByRole("dialog", { name: "Delete sub-account?" })).getByRole("button", { name: "Confirm", exact: true }));
    await within(dialog).findByRole("alert");
    assert.ok(within(dialog).getByText("The account could not be changed"));
    assert.equal(within(dialog).getByRole("textbox", { name: "Name" }).value, "Keep my changes");
    assert.equal(writes().length, 1);
    fixtures.set(endpoint, { id: "saved" });
    submit();
    if (operation === "delete") fireEvent.click(within(await view.findByRole("dialog", { name: "Delete sub-account?" })).getByRole("button", { name: "Confirm", exact: true }));
    await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Sub-account" })));
    assert.equal(writes().length, 2);
    assert.deepEqual(writes()[0].body, writes()[1].body);
  });
}

test("a pending sub-account save keeps the editor stable until the server finishes", async () => {
  const pending = deferred();
  fixtures.set("PATCH /api/budgets/food", () => pending.promise);
  const view = show();
  await loaded(view);
  fireEvent.click(view.getByRole("button", { name: "Edit Food", exact: true }));
  const dialog = await view.findByRole("dialog", { name: "Sub-account" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
  await within(dialog).findByRole("button", { name: "Saving..." });
  assert.equal(within(dialog).getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  assert.equal(within(dialog).getByRole("button", { name: "Delete", exact: true }).disabled, true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close Edit Sub-Account" }));
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(view.getByRole("dialog", { name: "Sub-account" }));
  await ui.act(async () => pending.resolve(Response.json({ id: "food" })));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Sub-account" })));
});

test("savings flags set the savings icon and preserve existing custom icons when disabled", async () => {
  fixtures.set("GET /api/budgets", [budgetFixture({ isSavings: true, icon: "💼" })]);
  fixtures.set("PATCH /api/budgets/food", { id: "food" });
  const view = show();
  await loaded(view);
  fireEvent.click(view.getByRole("button", { name: "Edit Food", exact: true }));
  const dialog = view.getByRole("dialog", { name: "Sub-account" });
  const savings = within(dialog).getByRole("checkbox");
  assert.equal(savings.checked, true);
  assert.ok(!within(dialog).queryByText("Icon", { exact: true }));
  fireEvent.click(savings);
  assert.ok(within(dialog).getByRole("button", { name: "Select icon 💼" }).classList.contains("on"));
  fireEvent.click(savings);
  fireEvent.click(savings);
  assert.ok(!dialog.querySelector(".icon-chip.on"), "Disabling the automatic savings icon clears it");
  fireEvent.click(savings);
  input(dialog, "Monthly Limit (optional)", "56.78");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Sub-account" })));
  assert.deepEqual(writes()[0].body, { name: "Food", targetCents: 5678, icon: "🛡️", isSavings: true });
});

test("a single bank is preselected and a new sub-account cannot be created without a bank", async () => {
  fixtures.set("GET /api/accounts", [bankFixture()]);
  const view = show();
  await loaded(view);
  fireEvent.click(view.getByRole("button", { name: "Add new sub-account" }));
  let dialog = view.getByRole("dialog", { name: "Sub-account" });
  assert.ok(!within(dialog).queryByRole("combobox", { name: "Bank Account" }));
  input(dialog, "Name", "  ");
  assert.equal(within(dialog).getByRole("button", { name: "Create", exact: true }).disabled, true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close New Sub-Account" }));
  fixtures.set("GET /api/accounts", []);
  await ui.act(async () => harness.client().invalidateQueries({ queryKey: ["bank-accounts", "household"] }));
  await waitFor(() => assert.ok(!view.queryByRole("button", { name: "Edit Household bank balance" })));
  fireEvent.click(view.getByRole("button", { name: "Add new sub-account" }));
  dialog = view.getByRole("dialog", { name: "Sub-account" });
  input(dialog, "Name", "New account");
  assert.equal(within(dialog).getByRole("button", { name: "Create", exact: true }).disabled, true);
  assert.equal(writes().length, 0);
});

test("a bank removed during editing cannot be used to create a sub-account", async () => {
  const view = show();
  await loaded(view);
  fireEvent.click(view.getByRole("button", { name: "Add new sub-account" }));
  const dialog = view.getByRole("dialog", { name: "Sub-account" });
  input(dialog, "Name", "Preserve this draft");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Bank Account" }), { target: { value: "bank-joint" } });
  fixtures.set("GET /api/accounts", [bankFixture()]);
  await ui.act(async () => harness.client().invalidateQueries({ queryKey: ["bank-accounts", "household"] }));
  await waitFor(() => assert.equal(within(dialog).getByRole("button", { name: "Create", exact: true }).disabled, true));
  assert.equal(within(dialog).getByRole("textbox", { name: "Name" }).value, "Preserve this draft");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Bank Account" }), { target: { value: "bank-home" } });
  assert.equal(within(dialog).getByRole("button", { name: "Create", exact: true }).disabled, false);
  assert.equal(writes().length, 0);
});

for (const failure of [new Error(""), "Connection unavailable"]) {
  test(`sub-account failures with ${failure instanceof Error ? "an empty message" : "a non-error rejection"} have a readable fallback`, async () => {
    fixtures.set("POST /api/budgets", () => { throw failure; });
    const view = show();
    await loaded(view);
    fireEvent.click(view.getByRole("button", { name: "Add new sub-account" }));
    const dialog = view.getByRole("dialog", { name: "Sub-account" });
    input(dialog, "Name", "Fallback account");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create", exact: true }));
    await within(dialog).findByText("The sub-account could not be changed.");
    assert.equal(within(dialog).getByRole("button", { name: "Create", exact: true }).disabled, false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
    fireEvent.click(view.getByRole("button", { name: "Add new sub-account" }));
    assert.ok(!within(view.getByRole("dialog", { name: "Sub-account" })).queryByRole("alert"));
  });
}

test("pending deletion disables both save and close until its outcome is known", async () => {
  const pending = deferred();
  fixtures.set("DELETE /api/budgets/food", () => pending.promise);
  const view = show();
  await loaded(view);
  fireEvent.click(view.getByRole("button", { name: "Edit Food", exact: true }));
  const dialog = view.getByRole("dialog", { name: "Sub-account" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete", exact: true }));
  fireEvent.click(within(await view.findByRole("dialog", { name: "Delete sub-account?" })).getByRole("button", { name: "Confirm", exact: true }));
  assert.equal((await within(dialog).findByRole("button", { name: "Deleting..." })).disabled, true);
  assert.equal(within(dialog).getByRole("button", { name: "Save", exact: true }).disabled, true);
  assert.equal(within(dialog).getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  assert.equal(within(dialog).getByRole("group", { name: "Sub-account details" }).disabled, true);
  await ui.act(async () => pending.resolve(Response.json({ error: "Account still has a balance" }, { status: 409 })));
  await within(dialog).findByText("Account still has a balance");
  assert.equal(within(dialog).getByRole("button", { name: "Save", exact: true }).disabled, false);
});
