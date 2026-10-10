import assert from "node:assert/strict";
import test from "node:test";
import { createTransactionsPageHarness, deferred, transactionFixture } from "./transactions-page-harness.mjs";

const harness = await createTransactionsPageHarness();
const { ui, fixtures, requests, invalidations, writes, setUrl, show, loaded } = harness;
const { fireEvent, within, waitFor } = ui;
const holiday = { id: "holiday", budgetId: "food", name: "Holiday", icon: "🧳", transactionCount: 2, incomeCents: 2000, expenseCents: 12000, netCents: -10000 };
const groceries = transactionFixture({ groupId: "holiday", group: holiday });
const refund = transactionFixture({ id: "refund", subject: "Refund", direction: "CREDIT", groupId: "holiday", group: holiday, amountCents: 2000 });
const ticket = transactionFixture({ id: "ticket", subject: "Train ticket", groupId: "commute", group: { id: "commute", name: "Commute", icon: null }, amountCents: 900 });
const detail = (transactions = [groceries, refund, ticket], memberIds = ["groceries", "refund"]) => ({ group: holiday, transactions, memberIds, candidateLimit: 100 });
const groupPage = async (groups = [holiday]) => {
  fixtures.set("GET /api/transaction-groups", groups);
  setUrl("budgetId=food&period=all");
  const view = show();
  await loaded(view);
  if (groups.length) await view.findByRole("button", { name: "Edit Holiday" });
  return view;
};
const createGroup = async (view) => {
  fireEvent.click(view.getByRole("button", { name: "Group", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Select transaction Groceries" }));
  fireEvent.click(view.getByRole("button", { name: "Continue", exact: true }));
  return view.findByRole("dialog", { name: "Create transaction group" });
};
const editGroup = async (view) => {
  fireEvent.click(view.getByRole("button", { name: "Edit Holiday" }));
  return view.findByRole("dialog", { name: "Edit transaction group" });
};
const confirmDelete = async (view, answer = "Confirm") => {
  const confirmation = await view.findByRole("dialog", { name: "Delete transaction group?" });
  await ui.act(async () => fireEvent.click(within(confirmation).getByRole("button", { name: answer, exact: true })));
};

test("creating a group preserves its draft and prevents repeated writes or closing while saving", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(Response.json({ id: "new-group" })));
  fixtures.set("POST /api/transaction-groups", () => pending.promise);
  const view = await groupPage();
  const dialog = await createGroup(view);
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Name", exact: true }), { target: { value: "  Family visit  " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create group", exact: true }));
  await within(dialog).findByRole("button", { name: "Saving…" });
  assert.equal(within(dialog).getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  assert.equal(within(dialog).getByRole("textbox", { name: "Name", exact: true }).disabled, true);
  fireEvent.submit(dialog.querySelector("form"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Close Group Transactions" }));
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(view.getByRole("dialog", { name: "Create transaction group" }));
  assert.equal(writes().length, 1);
  assert.deepEqual(writes()[0].body, { workspaceId: "household", budgetId: "food", name: "Family visit", icon: "🍔", transactionIds: ["groceries"] });
  await ui.act(async () => pending.resolve(Response.json({ id: "new-group" })));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Create transaction group" })));
  assert.ok(!view.queryByRole("button", { name: "Continue", exact: true }));
  assert.ok(invalidations.some(({ queryKey }) => queryKey[0] === "transaction-groups"));
  assert.ok(invalidations.some(({ queryKey }) => queryKey[0] === "transactions"));
});

test("an edit save disables conflicting actions and closing until the mutation completes", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(Response.json({ id: "holiday" })));
  fixtures.set("GET /api/transaction-groups/holiday", detail());
  fixtures.set("PATCH /api/transaction-groups/holiday", () => pending.promise);
  const view = await groupPage();
  const dialog = await editGroup(view);
  await within(dialog).findByText("Train ticket");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
  await within(dialog).findByRole("button", { name: "Saving…" });
  assert.equal(within(dialog).getByRole("button", { name: "Delete group" }).disabled, true);
  assert.equal(within(dialog).getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  assert.equal(within(dialog).getByRole("textbox", { name: "Name", exact: true }).disabled, true);
  assert.equal(within(dialog).getByRole("searchbox").disabled, true);
  assert.ok(within(dialog).getAllByRole("checkbox").every((input) => input.disabled));
  fireEvent.submit(dialog.querySelector("form"));
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(writes().length, 1);
  assert.ok(view.getByRole("dialog", { name: "Edit transaction group" }));
  await ui.act(async () => pending.resolve(Response.json({ id: "holiday" })));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Edit transaction group" })));
});

test("failed group details can be retried without losing the edited name", async () => {
  fixtures.set("GET /api/transaction-groups/holiday", () => Response.json({ error: "Transaction search unavailable" }, { status: 500 }));
  const view = await groupPage();
  const dialog = await editGroup(view);
  await within(dialog).findByText("Transaction search unavailable");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Name", exact: true }), { target: { value: "Saved draft" } });
  assert.equal(within(dialog).getByRole("button", { name: "Save", exact: true }).disabled, true);
  fixtures.set("GET /api/transaction-groups/holiday", detail());
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry", exact: true }));
  await within(dialog).findByText("Train ticket");
  assert.equal(within(dialog).getByRole("textbox", { name: "Name", exact: true }).value, "Saved draft");
  assert.equal(within(dialog).getByRole("button", { name: "Save", exact: true }).disabled, false);
  assert.ok(!within(dialog).queryByRole("alert"));
});

test("a failed new group can be retried and switching to an existing group clears the old failure", async () => {
  fixtures.set("POST /api/transaction-groups", () => Response.json({ error: "Group creation unavailable" }, { status: 500 }));
  fixtures.set("PATCH /api/transaction-groups/holiday", () => Response.json({ error: "Group membership unavailable" }, { status: 500 }));
  const view = await groupPage([{ ...holiday, icon: null }]);
  const dialog = await createGroup(view);
  const name = within(dialog).getByRole("textbox", { name: "Name", exact: true });
  fireEvent.change(name, { target: { value: "   " } });
  assert.equal(within(dialog).getByRole("button", { name: "Create group", exact: true }).disabled, true);
  fireEvent.submit(dialog.querySelector("form"));
  assert.equal(writes().length, 0);
  fireEvent.change(name, { target: { value: "Annual shopping" } });
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Group icon" }), { target: { value: "🧾" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create group", exact: true }));
  assert.ok(await within(dialog).findByRole("alert"));
  assert.equal(name.value, "Annual shopping");
  assert.equal(writes()[0].body.icon, "🧾");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Group", exact: true }), { target: { value: "holiday" } });
  assert.ok(!within(dialog).queryByRole("alert"));
  assert.ok(!within(dialog).queryByRole("textbox", { name: "Name", exact: true }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add to group", exact: true }));
  assert.ok(await within(dialog).findByText("Group membership unavailable"));
  fixtures.set("PATCH /api/transaction-groups/holiday", { id: "holiday" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add to group", exact: true }));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Create transaction group" })));
  assert.deepEqual(writes().map(({ method, body }) => ({ method, body })), [
    { method: "POST", body: { workspaceId: "household", budgetId: "food", name: "Annual shopping", icon: "🧾", transactionIds: ["groceries"] } },
    { method: "PATCH", body: { addTransactionIds: ["groceries"] } },
    { method: "PATCH", body: { addTransactionIds: ["groceries"] } },
  ]);
});

test("cancelling a new group keeps row selection and reopening discards the abandoned form", async () => {
  const view = await groupPage([]);
  let dialog = await createGroup(view);
  assert.ok(!within(dialog).queryByRole("combobox", { name: "Group", exact: true }));
  const originalName = within(dialog).getByRole("textbox", { name: "Name", exact: true }).value;
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Name", exact: true }), { target: { value: "Abandoned" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
  assert.ok(!view.queryByRole("dialog", { name: "Create transaction group" }));
  assert.equal(view.getByRole("button", { name: "Continue", exact: true }).disabled, false);
  fireEvent.click(view.getByRole("button", { name: "Continue", exact: true }));
  dialog = await view.findByRole("dialog", { name: "Create transaction group" });
  assert.equal(within(dialog).getByRole("textbox", { name: "Name", exact: true }).value, originalName);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close Group Transactions" }));
  assert.ok(!view.queryByRole("dialog", { name: "Create transaction group" }));
  assert.equal(writes().length, 0);
});

test("changing sub-account closes a group draft before its selected rows are cleared", async () => {
  const view = await groupPage();
  await createGroup(view);
  setUrl("budgetId=savings&period=all");
  view.rerender(harness.element());
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Create transaction group" })));
  assert.ok(!view.queryByRole("button", { name: "Continue", exact: true }));
  assert.equal(writes().length, 0);
});

test("group edits preserve unseen members and explicit changes while searching, including a pending search", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(Response.json(detail([ticket], ["groceries", "refund", "hidden"]))));
  fixtures.set("GET /api/transaction-groups/holiday", ({ url }) => {
    if (url.searchParams.get("search") === "ticket") return pending.promise;
    if (url.searchParams.has("search")) return Response.json(detail([], ["groceries", "refund", "hidden"]));
    return Response.json(detail([groceries, refund, ticket, transactionFixture({ id: "cash", subject: "Cash" })], ["groceries", "refund", "hidden"]));
  });
  fixtures.set("PATCH /api/transaction-groups/holiday", { id: "holiday" });
  const view = await groupPage();
  const dialog = await editGroup(view);
  await within(dialog).findByText("Train ticket");
  assert.ok(within(dialog).getByText("3 selected"));
  assert.ok(within(dialog).getByText("📌 Commute"));
  assert.ok(within(dialog).getByText("+$20.00"));
  const groceriesCheckbox = within(dialog).getByRole("checkbox", { name: /Groceries/ });
  fireEvent.click(groceriesCheckbox);
  fireEvent.click(groceriesCheckbox);
  fireEvent.click(groceriesCheckbox);
  const ticketCheckbox = within(dialog).getByRole("checkbox", { name: /Train ticket/ });
  fireEvent.click(ticketCheckbox);
  fireEvent.click(ticketCheckbox);
  fireEvent.click(ticketCheckbox);
  const search = within(dialog).getByRole("searchbox");
  fireEvent.change(search, { target: { value: " ticket " } });
  await waitFor(() => assert.ok(requests.some(({ url }) => url.searchParams.get("search") === "ticket")));
  await waitFor(() => assert.equal(ticketCheckbox.disabled, true));
  assert.ok(within(dialog).getByText("3 selected"));
  assert.equal(within(dialog).getByRole("button", { name: "Save", exact: true }).disabled, true);
  await ui.act(async () => pending.resolve(Response.json(detail([ticket], ["groceries", "refund", "hidden"]))));
  await waitFor(() => assert.equal(within(dialog).getAllByRole("checkbox").length, 1));
  assert.equal(within(dialog).getByRole("checkbox", { name: /Train ticket/ }).checked, true);
  fireEvent.change(search, { target: { value: "no matches" } });
  await within(dialog).findByText("No matching transactions.");
  assert.ok(within(dialog).getByText("3 selected"));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Name", exact: true }), { target: { value: "  Family trip  " } });
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Group icon" }), { target: { value: "🎁" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Edit transaction group" })));
  assert.deepEqual(writes()[0].body, { name: "Family trip", icon: "🎁", addTransactionIds: ["ticket"], removeTransactionIds: ["groceries"] });
});

test("search failures retain membership counts and drafts, and retry uses the current search", async () => {
  fixtures.set("GET /api/transaction-groups/holiday", ({ url }) => url.searchParams.has("search")
    ? Response.json({ error: "Search temporarily unavailable" }, { status: 500 })
    : Response.json(detail()));
  const view = await groupPage([{ ...holiday, icon: null }]);
  const dialog = await editGroup(view);
  await within(dialog).findByText("Train ticket");
  assert.equal(within(dialog).getByRole("combobox", { name: "Group icon" }).value, "📌");
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Train ticket/ }));
  fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "train" } });
  await within(dialog).findByText("Search temporarily unavailable");
  assert.ok(within(dialog).getByText("3 selected"));
  fixtures.set("GET /api/transaction-groups/holiday", detail([ticket]));
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry", exact: true }));
  await within(dialog).findByText("Train ticket");
  assert.equal(within(dialog).getByRole("checkbox", { name: /Train ticket/ }).checked, true);
  assert.equal(requests.filter(({ url }) => url.pathname.endsWith("/holiday")).at(-1).url.searchParams.get("search"), "train");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
  assert.equal(writes().length, 0);
});

test("switching between failed updates and deletion shows only the current failure", async () => {
  fixtures.set("GET /api/transaction-groups/holiday", detail());
  fixtures.set("PATCH /api/transaction-groups/holiday", () => Response.json({ error: "Update unavailable" }, { status: 500 }));
  fixtures.set("DELETE /api/transaction-groups/holiday", () => Response.json({ error: "Deletion unavailable" }, { status: 500 }));
  const view = await groupPage();
  const dialog = await editGroup(view);
  await within(dialog).findByText("Train ticket");
  const name = within(dialog).getByRole("textbox", { name: "Name", exact: true });
  fireEvent.change(name, { target: { value: "  " } });
  fireEvent.submit(dialog.querySelector("form"));
  assert.equal(writes().length, 0);
  fireEvent.change(name, { target: { value: "Keep this name" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
  await within(dialog).findByText("Update unavailable");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
  await confirmDelete(view, "Cancel");
  assert.equal(writes().length, 1);
  assert.ok(within(dialog).getByText("Update unavailable"));
  await waitFor(() => assert.equal(within(dialog).getByRole("button", { name: "Delete group" }).disabled, false));
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
  await confirmDelete(view);
  await within(dialog).findByText("Deletion unavailable");
  assert.ok(!within(dialog).queryByText("Update unavailable"));
  assert.equal(name.value, "Keep this name");
  fixtures.set("PATCH /api/transaction-groups/holiday", { id: "holiday" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Edit transaction group" })));
  assert.deepEqual(writes().map(({ method }) => method), ["PATCH", "DELETE", "PATCH"]);
});

test("deleting a group blocks other actions, preserves transactions, and clears its active filter", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(Response.json({ deleted: true })));
  fixtures.set("GET /api/transaction-groups/holiday", detail());
  fixtures.set("DELETE /api/transaction-groups/holiday", () => pending.promise);
  const view = await groupPage();
  fireEvent.click(view.getByRole("button", { name: "Show Holiday transactions" }));
  const dialog = await editGroup(view);
  await within(dialog).findByText("Train ticket");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
  const confirmation = await view.findByRole("dialog", { name: "Delete transaction group?" });
  assert.ok(within(confirmation).getByText("Home"));
  assert.ok(within(confirmation).getByText(/transactions are not deleted/));
  fireEvent.click(within(confirmation).getByRole("button", { name: "Confirm", exact: true }));
  await within(dialog).findByRole("button", { name: "Deleting…" });
  assert.equal(within(dialog).getByRole("button", { name: "Save", exact: true }).disabled, true);
  assert.equal(within(dialog).getByRole("button", { name: "Close Edit Group" }).disabled, true);
  fireEvent.submit(dialog.querySelector("form"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(view.getByRole("dialog", { name: "Edit transaction group" }));
  fixtures.set("GET /api/transaction-groups", []);
  await ui.act(async () => pending.resolve(Response.json({ deleted: true })));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Edit transaction group" })));
  await waitFor(() => assert.equal(requests.filter(({ url }) => url.pathname === "/api/transactions").at(-1).url.searchParams.has("groupId"), false));
  assert.deepEqual(writes().map(({ method, url }) => `${method} ${url.pathname}`), ["DELETE /api/transaction-groups/holiday"]);
  assert.ok(view.getByRole("button", { name: "Correct transaction Groceries" }));
});

test("the editor also rejects a deletion requested programmatically while a save is pending", async (t) => {
  const pending = deferred();
  t.after(() => pending.resolve(Response.json({ id: "holiday" })));
  fixtures.set("GET /api/transaction-groups/holiday", detail());
  fixtures.set("PATCH /api/transaction-groups/holiday", () => pending.promise);
  const { QueryClientProvider } = harness.require("@tanstack/react-query");
  const { useTransactionGroupEditor } = harness.require("../components/transactions/use-transaction-group-editor.ts");
  const { registerConfirmHandler } = harness.require("../lib/confirm-destructive.ts");
  let confirmationRequests = 0;
  registerConfirmHandler(async () => { confirmationRequests++; return true; });
  t.after(() => registerConfirmHandler(null));
  let closed = 0;
  const editor = ui.renderHook(() => useTransactionGroupEditor({ group: holiday, workspaceId: "household", workspace: { name: "Home", role: "OWNER" }, onClose: () => closed++, onDeleted() {} }), {
    wrapper: ({ children }) => ui.h(QueryClientProvider, { client: harness.client() }, children),
  });
  await waitFor(() => assert.equal(editor.result.current.canSave, true));
  ui.act(() => editor.result.current.submit({ preventDefault() {} }));
  await waitFor(() => assert.equal(editor.result.current.busy, true));
  await ui.act(async () => editor.result.current.confirmDelete());
  assert.equal(confirmationRequests, 0);
  assert.deepEqual(writes().map(({ method }) => method), ["PATCH"]);
  await ui.act(async () => pending.resolve(Response.json({ id: "holiday" })));
  await waitFor(() => assert.equal(closed, 1));
});

test("an empty selection cannot create or add to a group", () => {
  const { QueryClientProvider } = harness.require("@tanstack/react-query");
  const { TransactionGroupCreateDialog } = harness.require("../components/transactions/transaction-group-create-dialog.tsx");
  const view = ui.render(ui.h(QueryClientProvider, { client: harness.client() }, ui.h(TransactionGroupCreateDialog, {
    workspaceId: "household", budgetId: "food", budgetName: "Food", transactionIds: [], groups: [holiday],
    defaults: { suggestedName: "Selected expenses", icon: "📌", placeholder: "Group name" }, onClose() {}, onSaved() {},
  })));
  const dialog = view.getByRole("dialog", { name: "Create transaction group" });
  assert.equal(within(dialog).getByRole("button", { name: "Create group", exact: true }).disabled, true);
  fireEvent.submit(dialog.querySelector("form"));
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Group", exact: true }), { target: { value: "holiday" } });
  assert.equal(within(dialog).getByRole("button", { name: "Add to group", exact: true }).disabled, true);
  fireEvent.submit(dialog.querySelector("form"));
  assert.equal(writes().length, 0);
});
