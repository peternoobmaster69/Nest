import assert from "node:assert/strict";
import test from "node:test";
import { createTransactionsPageHarness } from "./transactions-page-harness.mjs";

const harness = await createTransactionsPageHarness();
const { ui, fixtures, requests, navigation, setUrl, show, loaded } = harness;
const { fireEvent, waitFor } = ui;
const latestQuery = () => requests.filter((request) => request.url.pathname === "/api/transactions").at(-1)?.url.searchParams;
const syncedQuery = () => new URL(navigation.at(-1) ?? ui.window.location.href, ui.window.location.origin).searchParams;
const stored = (name, value) => ui.window.sessionStorage.setItem(`nest:view:transactions:${name}`, JSON.stringify(value));

test("an All link clears stale saved and shared date ranges before synchronizing the URL", async () => {
  stored("quick-period", "custom");
  stored("custom-months", ["2020-01"]);
  stored("dates", { from: "2020-01-01", to: "2020-01-31" });
  setUrl("period=all&from=2020-01-01&to=2020-01-31&months=2020-01&source=shared");
  const view = show();
  await loaded(view);
  await waitFor(() => assert.ok(view.getByRole("button", { name: "All", exact: true }).classList.contains("is-active")));
  await waitFor(() => {
    assert.ok(latestQuery());
    for (const key of ["from", "to", "months"]) assert.equal(latestQuery().has(key), false);
    assert.equal(syncedQuery().get("period"), "all");
    for (const key of ["from", "to", "months"]) assert.equal(syncedQuery().has(key), false);
    assert.equal(syncedQuery().get("source"), "shared");
  });
  assert.ok(view.getByText("All Time"));
});

for (const [period, from, to, label] of [
  ["thisMonth", "2026-10-01", "2026-10-31", "Oct"],
  ["lastMonth", "2026-09-01", "2026-09-30", "Sep"],
  ["thisYear", "2026-01-01", "2026-12-31", "This Year"],
]) {
  test(`${period} links replace stale months and send the correct calendar range`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 10, 12) });
    setUrl(`period=${period}&months=2020-01&from=2020-01-01&to=2020-01-31`);
    const view = show();
    await loaded(view);
    await waitFor(() => {
      assert.equal(latestQuery()?.get("from"), from);
      assert.equal(latestQuery()?.get("to"), to);
      assert.equal(latestQuery()?.has("months"), false);
      assert.equal(syncedQuery().get("period"), period);
      for (const key of ["from", "to", "months"]) assert.equal(syncedQuery().has(key), false);
    });
    assert.equal(view.container.querySelector(".period-label-desktop").textContent, label);
  });
}

test("shared group filters survive account hydration and changing the bank clears incompatible filters", async () => {
  fixtures.set("GET /api/transaction-groups", [{ id: "weekly", budgetId: "food", name: "Weekly shop", icon: null, transactionCount: 1, incomeCents: 0, expenseCents: 1200, netCents: -1200 }]);
  setUrl("budgetId=food&groupId=weekly&period=all");
  const view = show();
  await view.findByRole("button", { name: "Clear Weekly shop filter and show all transactions" });
  await waitFor(() => {
    assert.equal(latestQuery()?.get("accountId"), "bank-home");
    assert.equal(latestQuery()?.get("budgetId"), "food");
    assert.equal(latestQuery()?.get("groupId"), "weekly");
  });
  fireEvent.click(view.getByRole("button", { name: "Choose bank", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Joint bank", exact: true }));
  await waitFor(() => {
    assert.equal(latestQuery()?.get("accountId"), "bank-joint");
    assert.equal(latestQuery()?.has("budgetId"), false);
    assert.equal(latestQuery()?.has("groupId"), false);
    assert.equal(syncedQuery().has("budgetId"), false);
    assert.equal(syncedQuery().has("groupId"), false);
  });
  assert.ok(!view.queryByRole("button", { name: "Edit Food", exact: true }));
});

test("navigating between shared links rejects a sub-account from another bank", async () => {
  setUrl("budgetId=food&period=all");
  const view = show();
  await loaded(view);
  await waitFor(() => assert.equal(latestQuery()?.get("budgetId"), "food"));
  setUrl("accountId=bank-joint&budgetId=food&groupId=weekly&period=all");
  view.rerender(harness.element());
  await waitFor(() => {
    assert.equal(latestQuery()?.get("accountId"), "bank-joint");
    assert.equal(latestQuery()?.has("budgetId"), false);
    assert.equal(latestQuery()?.has("groupId"), false);
  });
  assert.ok(view.getByRole("button", { name: "Show transactions from all sub-accounts" }).getAttribute("aria-pressed") === "true");
});

test("Ask Nest names select accessible accounts and a missing date selection clears saved dates", async () => {
  stored("quick-period", "custom");
  stored("dates", { from: "2020-01-01" });
  setUrl("view=ask-nest&accountName=+dbs+&budgetName=+FOOD+&search=+Groceries+");
  const view = show();
  await loaded(view);
  await waitFor(() => {
    assert.equal(latestQuery()?.get("accountId"), "bank-home");
    assert.equal(latestQuery()?.get("budgetId"), "food");
    assert.equal(latestQuery()?.get("search"), "Groceries");
    assert.equal(latestQuery()?.has("from"), false);
    assert.equal(syncedQuery().get("period"), "all");
  });
  assert.equal(view.getByPlaceholderText("Search transactions...").value, "Groceries");
});

test("custom-month links are normalized and quick controls replace them with shareable period filters", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 10, 12) });
  setUrl("months=2026-10,invalid,2026-08,2026-10&from=2020-01-01");
  const view = show();
  await loaded(view);
  await waitFor(() => {
    assert.equal(latestQuery()?.get("months"), "2026-08,2026-10");
    assert.equal(latestQuery()?.has("from"), false);
    assert.equal(syncedQuery().get("period"), "custom");
  });
  assert.ok(view.getByText("2 Months"));
  fireEvent.click(view.getByRole("button", { name: "Sep", exact: true }));
  await waitFor(() => {
    assert.equal(latestQuery()?.get("from"), "2026-09-01");
    assert.equal(latestQuery()?.get("to"), "2026-09-30");
    assert.equal(latestQuery()?.has("months"), false);
    assert.equal(syncedQuery().get("period"), "lastMonth");
  });
  fireEvent.click(view.getByRole("button", { name: "All", exact: true }));
  await waitFor(() => assert.equal(syncedQuery().get("period"), "all"));
  assert.equal(latestQuery().has("from"), false);
});

test("a link without date filters keeps the saved date range while applying the search", async () => {
  stored("quick-period", "custom");
  stored("dates", { to: "2026-10-31" });
  setUrl("search=Groceries");
  const view = show();
  await loaded(view);
  await waitFor(() => {
    assert.equal(latestQuery()?.get("to"), "2026-10-31");
    assert.equal(latestQuery()?.get("search"), "Groceries");
    assert.equal(latestQuery()?.has("from"), false);
    assert.equal(syncedQuery().get("period"), "custom");
  });
});

test("a new visit defaults to this month, while returning to a saved All view keeps every date", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 10, 12) });
  setUrl("");
  const first = show();
  await loaded(first);
  await waitFor(() => {
    assert.equal(latestQuery()?.get("from"), "2026-10-01");
    assert.equal(latestQuery()?.get("to"), "2026-10-31");
  });
  fireEvent.click(first.getByRole("button", { name: "All", exact: true }));
  await waitFor(() => assert.equal(latestQuery()?.has("from"), false));
  first.unmount();
  const returning = show();
  await loaded(returning);
  await waitFor(() => {
    assert.equal(latestQuery()?.has("from"), false);
    assert.equal(latestQuery()?.has("to"), false);
    assert.ok(returning.getByRole("button", { name: "All", exact: true }).classList.contains("is-active"));
  });
});

test("unrelated links preserve saved view preferences and a date-only link replaces the range", async () => {
  stored("quick-period", null);
  stored("search", "Groceries");
  setUrl("source=bookmark");
  const view = show();
  await loaded(view);
  await waitFor(() => assert.equal(latestQuery()?.get("search"), "Groceries"));
  assert.equal(view.getByPlaceholderText("Search transactions...").value, "Groceries");
  setUrl("from=2026-09-02&to=2026-10-15");
  view.rerender(harness.element());
  await waitFor(() => {
    assert.equal(latestQuery()?.get("from"), "2026-09-02");
    assert.equal(latestQuery()?.get("to"), "2026-10-15");
    assert.equal(latestQuery()?.has("search"), false);
  });
  assert.equal(view.getByPlaceholderText("Search transactions...").value, "");
});
