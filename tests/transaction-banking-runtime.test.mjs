import assert from "node:assert/strict";
import test from "node:test";
import { bankFixture, createTransactionsPageHarness, deferred } from "./transactions-page-harness.mjs";

const harness = await createTransactionsPageHarness();
const { ui, fixtures, requests, setUrl, show, writes, invalidations } = harness;
const { fireEvent, within, waitFor } = ui;
const showBank = async () => {
  setUrl("accountId=bank-home&period=all");
  const view = show();
  await view.findByRole("button", { name: "Edit Household bank balance" });
  return view;
};
const confirm = async (view, title, action) => fireEvent.click(within(await view.findByRole("dialog", { name: title })).getByRole("button", { name: action, exact: true }));

test("a failed reconciliation adjustment shows an error beside the action and can be retried", async () => {
  fixtures.set("PATCH /api/accounts/bank-home", () => Response.json({ error: "Balance service unavailable" }, { status: 500 }));
  const view = await showBank();
  fireEvent.click(view.getByRole("button", { name: "Use sub-account total" }));
  await confirm(view, "Confirm reconciliation adjustment", "Match balance");
  await view.findByRole("alert");
  assert.ok(view.getByText("Balance service unavailable"));
  assert.deepEqual(writes()[0].body, { startingCents: 80000, expectedUpdatedAt: bankFixture().updatedAt });
  fixtures.set("PATCH /api/accounts/bank-home", { id: "bank-home" });
  fireEvent.click(view.getByRole("button", { name: "Use sub-account total" }));
  await confirm(view, "Confirm reconciliation adjustment", "Match balance");
  await waitFor(() => assert.equal(writes().length, 2));
  await waitFor(() => assert.ok(!view.queryByRole("alert")));
  assert.ok(invalidations.some(({ queryKey }) => queryKey[0] === "bank-accounts"));
});

test("the bank balance field is labelled and a pending save keeps the editor and its draft open", async () => {
  const pending = deferred();
  fixtures.set("PATCH /api/accounts/bank-home", () => pending.promise);
  const view = await showBank();
  fireEvent.click(view.getByRole("button", { name: "Edit Household bank balance" }));
  const dialog = await view.findByRole("dialog", { name: "Edit bank balance" });
  const balance = within(dialog).getByRole("textbox", { name: "Balance (SGD)" });
  assert.equal(balance.value, "1000.00");
  fireEvent.change(balance, { target: { value: "950.75" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Balance" }));
  const confirmation = await view.findByRole("dialog", { name: "Confirm bank balance adjustment" });
  assert.ok(within(confirmation).getByText("Home"));
  assert.equal(writes().length, 0);
  fireEvent.click(within(confirmation).getByRole("button", { name: "Update balance", exact: true }));
  await within(dialog).findByRole("button", { name: "Saving..." });
  assert.equal(within(dialog).getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  assert.equal(within(dialog).getByRole("textbox", { name: "Balance (SGD)" }).disabled, true);
  fireEvent.submit(dialog.querySelector("form"));
  assert.equal(writes().length, 1);
  assert.ok(!view.queryByRole("dialog", { name: "Confirm bank balance adjustment" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Close Edit Bank Balance" }));
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(view.getByRole("dialog", { name: "Edit bank balance" }));
  assert.deepEqual(writes()[0].body, { startingCents: 95075, expectedUpdatedAt: bankFixture().updatedAt });
  await ui.act(async () => pending.resolve(Response.json({ id: "bank-home" })));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Edit bank balance" })));
  assert.ok(invalidations.some(({ queryKey }) => queryKey[0] === "dashboard-summary"));
  assert.ok(requests.some((request) => request.method === "PATCH" && request.headers.get("x-workspace-id") === "household"));
});

test("the bank picker exposes the selected option and closes on Escape, outside clicks, or a second toggle", async () => {
  const view = await showBank();
  const selector = within(view.container.querySelector(".bank-selector-row"));
  const trigger = selector.getByRole("button", { name: "Choose bank" });
  fireEvent.click(trigger);
  let options = selector.getByRole("group", { name: "Bank options" });
  assert.equal(within(options).getByRole("button", { name: "Household bank" }).getAttribute("aria-pressed"), "true");
  fireEvent.mouseDown(options);
  fireEvent.keyDown(document, { key: "ArrowDown" });
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(!selector.queryByRole("group", { name: "Bank options" }));
  assert.equal(document.activeElement, trigger);
  fireEvent.click(trigger);
  fireEvent.mouseDown(document.body);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  assert.ok(!selector.queryByRole("group", { name: "Bank options" }));
  fireEvent.click(trigger);
  options = selector.getByRole("group", { name: "Bank options" });
  fireEvent.click(within(options).getByRole("button", { name: "Joint bank" }));
  await selector.findByRole("button", { name: "Edit Joint bank balance" });
  assert.ok(selector.getByText("BNK"));
  fireEvent.click(trigger);
  fireEvent.click(selector.getByRole("button", { name: "All banks" }));
  await selector.findByText("ALL");
  assert.ok(!selector.queryByRole("button", { name: /Edit .* balance/ }));
  fireEvent.click(trigger);
  assert.equal(selector.getByRole("button", { name: "All banks" }).getAttribute("aria-pressed"), "true");
  fireEvent.click(trigger);
  fireEvent.click(within(view.container.querySelector(".tx-reconciliation")).getByRole("button", { name: "Choose bank" }));
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
});

test("bank logos fall back to bank initials on failure and different banks retain their own logo state", async () => {
  fixtures.set("GET /api/accounts", [bankFixture(), bankFixture({ id: "bank-joint", name: "OCBC account", bankName: null })]);
  const view = await showBank();
  const selector = within(view.container.querySelector(".bank-selector-row"));
  const logo = selector.getByRole("img", { name: "DBS Bank" });
  assert.ok(logo.classList.contains("bank-logo-img-dbs"));
  fireEvent.error(logo);
  assert.ok(selector.getByText("DBS"));
  fireEvent.click(selector.getByRole("button", { name: "Choose bank" }));
  fireEvent.click(selector.getByRole("button", { name: "OCBC account" }));
  const ocbcLogo = await selector.findByRole("img", { name: "OCBC Bank" });
  assert.equal(ocbcLogo.classList.contains("bank-logo-img-dbs"), false);
  fireEvent.click(selector.getByRole("button", { name: "Choose bank" }));
  fireEvent.click(selector.getByRole("button", { name: "Household bank" }));
  assert.ok(selector.getByText("DBS"));
  assert.ok(!selector.queryByRole("img", { name: "DBS Bank" }));
});

test("a removed bank closes the available choices and reconciliation disappears when balances agree", async () => {
  const view = await showBank();
  const selector = within(view.container.querySelector(".bank-selector-row"));
  fireEvent.click(selector.getByRole("button", { name: "Choose bank" }));
  fixtures.set("GET /api/accounts", [bankFixture({ currentBalanceCents: 80000, linkedBudgetTotalCents: 80000, discrepancyCents: 0 })]);
  await ui.act(async () => harness.client().invalidateQueries({ queryKey: ["bank-accounts", "household"] }));
  await waitFor(() => {
    assert.ok(!selector.queryByRole("group", { name: "Bank options" }));
    assert.ok(!selector.queryByRole("button", { name: "Choose bank" }));
    assert.ok(!view.container.querySelector(".tx-reconciliation"));
  });
});

test("over-allocated accounts explain the mismatch and cancelled balance confirmations never write", async () => {
  fixtures.set("GET /api/accounts", [bankFixture({ currentBalanceCents: 50000 })]);
  const view = await showBank();
  assert.ok(view.getByText("$300.00 over-allocated"));
  assert.ok(view.getByText("Sub-accounts exceed the bank balance."));
  fireEvent.click(view.getByRole("button", { name: "Use sub-account total" }));
  await confirm(view, "Confirm reconciliation adjustment", "Cancel");
  assert.equal(writes().length, 0);
  fireEvent.click(view.getByRole("button", { name: "Edit bank", exact: true }));
  let dialog = view.getByRole("dialog", { name: "Edit bank balance" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Balance" }));
  await confirm(view, "Confirm bank balance adjustment", "Cancel");
  assert.equal(writes().length, 0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
  assert.ok(!view.queryByRole("dialog", { name: "Edit bank balance" }));
  fireEvent.click(view.getByRole("button", { name: "Edit bank", exact: true }));
  dialog = view.getByRole("dialog", { name: "Edit bank balance" });
  assert.equal(within(dialog).getByRole("textbox", { name: "Balance (SGD)" }).value, "500.00");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close Edit Bank Balance" }));
});

test("invalid balances cannot be submitted and a zero bank balance is accepted", async () => {
  fixtures.set("PATCH /api/accounts/bank-home", { id: "bank-home" });
  const view = await showBank();
  fireEvent.click(view.getByRole("button", { name: "Edit Household bank balance" }));
  const dialog = view.getByRole("dialog", { name: "Edit bank balance" });
  const balance = within(dialog).getByRole("textbox", { name: "Balance (SGD)" });
  for (const value of ["", " ", "-1", "12+1", "invalid", "1e100"]) {
    fireEvent.change(balance, { target: { value } });
    assert.equal(within(dialog).getByRole("button", { name: "Save Balance" }).disabled, true);
    assert.equal(balance.getAttribute("aria-invalid"), "true");
    fireEvent.submit(dialog.querySelector("form"));
    assert.ok(!view.queryByRole("dialog", { name: "Confirm bank balance adjustment" }));
  }
  assert.ok(within(dialog).getByText("Enter a valid balance of zero or more."));
  assert.equal(writes().length, 0);
  fireEvent.change(balance, { target: { value: "0" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Balance" }));
  await confirm(view, "Confirm bank balance adjustment", "Update balance");
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Edit bank balance" })));
  assert.equal(writes()[0].body.startingCents, 0);
});

test("a stale balance form keeps the draft and reloads the latest version before another reviewed save", async () => {
  fixtures.set("PATCH /api/accounts/bank-home", () => Response.json({ error: "Stale version" }, { status: 412 }));
  const view = await showBank();
  fireEvent.click(view.getByRole("button", { name: "Edit Household bank balance" }));
  const dialog = view.getByRole("dialog", { name: "Edit bank balance" });
  const balance = within(dialog).getByRole("textbox", { name: "Balance (SGD)" });
  fireEvent.change(balance, { target: { value: "950.75" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Balance" }));
  await confirm(view, "Confirm bank balance adjustment", "Update balance");
  await within(dialog).findByRole("alert");
  assert.equal(balance.value, "950.75");
  fixtures.set("GET /api/accounts", () => Response.json({ error: "Temporarily unavailable" }, { status: 503 }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Reload latest" }));
  await waitFor(() => assert.ok(harness.client().getQueryState(["bank-accounts", "household"])?.status === "error"));
  assert.equal(balance.value, "950.75");
  const latest = bankFixture({ currentBalanceCents: 90000, updatedAt: "2026-10-11T00:00:00.000Z" });
  fixtures.set("GET /api/accounts", [latest]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Reload latest" }));
  await waitFor(() => assert.ok(!within(dialog).queryByRole("alert")));
  assert.equal(balance.value, "950.75");
  fixtures.set("PATCH /api/accounts/bank-home", { id: "bank-home" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Balance" }));
  const confirmation = await view.findByRole("dialog", { name: "Confirm bank balance adjustment" });
  assert.ok(within(confirmation).getByText("$50.75"));
  fireEvent.click(within(confirmation).getByRole("button", { name: "Update balance", exact: true }));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Edit bank balance" })));
  assert.deepEqual(writes()[1].body, { startingCents: 95075, expectedUpdatedAt: latest.updatedAt });
});

test("reloading a stale reconciliation uses current balances without opening an editor", async () => {
  fixtures.set("PATCH /api/accounts/bank-home", () => Response.json({ error: "Stale version" }, { status: 412 }));
  const view = await showBank();
  fireEvent.click(view.getByRole("button", { name: "Use sub-account total" }));
  await confirm(view, "Confirm reconciliation adjustment", "Match balance");
  await view.findByRole("alert");
  fixtures.set("GET /api/accounts", [bankFixture({ currentBalanceCents: 80000 })]);
  fireEvent.click(view.getByRole("button", { name: "Reload latest" }));
  await waitFor(() => assert.ok(!view.queryByRole("alert")));
  assert.ok(!view.queryByRole("dialog", { name: "Edit bank balance" }));
  assert.ok(!view.container.querySelector(".tx-reconciliation"));
});

test("reloading an account that is no longer available closes the stale editor", async () => {
  fixtures.set("PATCH /api/accounts/bank-home", () => Response.json({ error: "Stale version" }, { status: 412 }));
  const view = await showBank();
  fireEvent.click(view.getByRole("button", { name: "Edit Household bank balance" }));
  const dialog = view.getByRole("dialog", { name: "Edit bank balance" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Balance" }));
  await confirm(view, "Confirm bank balance adjustment", "Update balance");
  await within(dialog).findByRole("alert");
  fixtures.set("GET /api/accounts", []);
  fireEvent.click(within(dialog).getByRole("button", { name: "Reload latest" }));
  await waitFor(() => assert.ok(!view.queryByRole("dialog", { name: "Edit bank balance" })));
});
