import assert from "node:assert/strict";
import test from "node:test";
import { createTransactionsPageHarness, deferred, transactionResponse } from "./transactions-page-harness.mjs";

const harness = await createTransactionsPageHarness();
const { ui, fixtures, requests, setUrl, show, loaded } = harness;
const { fireEvent, within, waitFor } = ui;
const { TransactionGroupPanel } = harness.require("../components/transactions/transaction-group-panel.tsx");
const groups = [
  { id: "holiday", budgetId: "food", name: "Holiday", icon: "🧳", transactionCount: 3, incomeCents: 2000, expenseCents: 12000, netCents: -10000, firstTransactionDate: "2026-09-01", lastTransactionDate: "2026-10-10" },
  { id: "insurance", budgetId: "food", name: "Insurance", icon: null, transactionCount: 2, incomeCents: 10000, expenseCents: 1000, netCents: 9000, firstTransactionDate: "2026-10-01", lastTransactionDate: "2026-10-31" },
];
const panelProps = (overrides = {}) => ({ budgetName: "Food", groups, activeId: "ALL", loading: false, error: null, canGroup: true, formatAmount: (value) => `$${(value / 100).toFixed(2)}`, onSelect() {}, onToggle() {}, onEdit() {}, onGroup() {}, onRetry() {}, ...overrides });
const panel = (overrides) => ui.h(TransactionGroupPanel, panelProps(overrides));

test("group cards expose separate native controls for selection and editing", async () => {
  const toggled = [], edited = [];
  const view = ui.render(panel({ onToggle: (id) => toggled.push(id), onEdit: (group) => edited.push(group) }));
  const select = view.getByRole("button", { name: "Show Holiday transactions" });
  assert.equal(select.tagName, "BUTTON");
  assert.equal(select.getAttribute("aria-pressed"), "false");
  select.focus();
  await ui.user.keyboard("{Enter}");
  await ui.user.keyboard(" ");
  const edit = view.getByRole("button", { name: "Edit Holiday" });
  edit.focus();
  await ui.user.keyboard("{Enter}");
  assert.deepEqual(toggled, ["holiday", "holiday"]);
  assert.deepEqual(edited, [groups[0]]);
  assert.ok(!view.container.querySelector("button button"));
  assert.ok(view.getByText("$100.00"));
  assert.ok(view.getByText("$-90.00"));
  view.rerender(panel({ activeId: "holiday" }));
  assert.equal(view.getByRole("button", { name: "Clear Holiday filter and show all transactions" }).getAttribute("aria-pressed"), "true");
});

test("the group picker searches normalized names and date ranges, handles no matches, and clears its search after choosing", () => {
  const selected = [];
  const view = ui.render(panel({ onSelect: (id) => selected.push(id) }));
  const trigger = view.getByRole("button", { name: "Browse 2 transaction groups" });
  fireEvent.click(trigger);
  let picker = view.getByRole("dialog", { name: "Find a transaction group" });
  assert.equal(within(picker).getByRole("button", { name: /All groups/ }).getAttribute("aria-pressed"), "true");
  const search = within(picker).getByRole("searchbox", { name: "Search transaction groups" });
  fireEvent.change(search, { target: { value: "  SEPT—2026  " } });
  assert.ok(within(picker).getByRole("button", { name: /Holiday/ }));
  assert.ok(!within(picker).queryByRole("button", { name: /Insurance|All groups/ }));
  fireEvent.change(search, { target: { value: "Not found" } });
  assert.ok(within(picker).getByText("No groups match “Not found”."));
  fireEvent.change(search, { target: { value: "  HOLIDAY " } });
  fireEvent.click(within(picker).getByRole("button", { name: /Holiday/ }));
  assert.deepEqual(selected, ["holiday"]);
  assert.ok(!view.queryByRole("dialog", { name: "Find a transaction group" }));
  view.rerender(panel({ activeId: "holiday", onSelect: (id) => selected.push(id) }));
  fireEvent.click(trigger);
  picker = view.getByRole("dialog", { name: "Find a transaction group" });
  assert.equal(within(picker).getByRole("searchbox").value, "");
  assert.equal(within(picker).getByRole("button", { name: /Holiday/ }).getAttribute("aria-pressed"), "true");
  assert.equal(within(picker).getByRole("button", { name: /All groups/ }).getAttribute("aria-pressed"), "false");
  fireEvent.click(within(picker).getByRole("button", { name: /All groups/ }));
  assert.deepEqual(selected, ["holiday", "ALL"]);
});

test("a single group's picker closes accessibly and restores focus on Escape", () => {
  const view = ui.render(panel({ groups: [groups[0]] }));
  const trigger = view.getByRole("button", { name: "Browse 1 transaction group" });
  fireEvent.click(trigger);
  let picker = view.getByRole("dialog", { name: "Find a transaction group" });
  assert.ok(within(picker).getByText("1 group"));
  fireEvent.mouseDown(picker);
  fireEvent.keyDown(document, { key: "Tab" });
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(document.activeElement === trigger);
  assert.ok(!view.queryByRole("dialog", { name: "Find a transaction group" }));
  fireEvent.click(trigger);
  picker = view.getByRole("dialog", { name: "Find a transaction group" });
  fireEvent.change(within(picker).getByRole("searchbox"), { target: { value: "remember" } });
  fireEvent.mouseDown(document.body);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  fireEvent.click(trigger);
  assert.equal(view.getByRole("searchbox").value, "");
  fireEvent.click(trigger);
  assert.ok(!view.queryByRole("dialog", { name: "Find a transaction group" }));
});

test("the active group scrolls into the card strip, respects reduced motion, and cancels pending work on unmount", (t) => {
  const frames = new Map(), cancelled = [], scrolls = [];
  let frameId = 0, reduced = false;
  t.mock.method(ui.window, "requestAnimationFrame", (callback) => { frames.set(++frameId, callback); return frameId; });
  t.mock.method(ui.window, "cancelAnimationFrame", (id) => { cancelled.push(id); frames.delete(id); });
  t.mock.method(ui.window, "matchMedia", () => ({ matches: reduced }));
  const view = ui.render(panel());
  const strip = view.container.querySelector(".tx-group-cards");
  t.mock.method(strip, "getBoundingClientRect", () => ({ left: 100 }));
  t.mock.method(strip, "scrollTo", (value) => scrolls.push(value));
  Object.defineProperty(strip, "clientWidth", { value: 200, configurable: true });
  strip.scrollLeft = 80;
  t.mock.method(strip.querySelector('[data-group-id="holiday"]'), "getBoundingClientRect", () => ({ left: 330, width: 100 }));
  t.mock.method(strip.querySelector('[data-group-id="insurance"]'), "getBoundingClientRect", () => ({ left: -20, width: 300 }));
  view.rerender(panel({ activeId: "holiday" }));
  frames.get(frameId)();
  assert.deepEqual(scrolls, [{ left: 260, behavior: "smooth" }]);
  reduced = true;
  view.rerender(panel({ activeId: "insurance" }));
  frames.get(frameId)();
  assert.deepEqual(scrolls[1], { left: 0, behavior: "auto" });
  view.rerender(panel({ activeId: "missing" }));
  frames.get(frameId)();
  assert.equal(scrolls.length, 2);
  view.rerender(panel({ groups: [], activeId: "holiday" }));
  assert.equal(frames.size, 0);
  view.rerender(panel({ activeId: "holiday" }));
  const pendingFrame = frameId;
  view.unmount();
  assert.ok(cancelled.includes(pendingFrame));
  assert.equal(frames.size, 0);
});

test("group loading failures offer a working retry and an empty sub-account cannot enter grouping mode", async () => {
  const pending = deferred();
  fixtures.set("GET /api/transaction-groups", () => pending.promise);
  fixtures.set("GET /api/transactions", transactionResponse([]));
  setUrl("budgetId=food&period=all");
  const view = show();
  await view.findByText("Loading groups");
  assert.equal(view.getByRole("button", { name: "Group", exact: true }).disabled, true);
  await ui.act(async () => pending.resolve(Response.json({ error: "Unavailable" }, { status: 500 })));
  const error = await view.findByRole("alert");
  assert.ok(within(error).getByText("Failed to load groups"));
  fixtures.set("GET /api/transaction-groups", []);
  fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
  await view.findByText("No groups yet. Create one to organise related transactions.");
  assert.ok(!view.queryByRole("alert"));
});

test("choosing a group clears dates, toggling it restores all groups, and Group begins transaction selection", async () => {
  fixtures.set("GET /api/transaction-groups", groups);
  setUrl("budgetId=food&period=thisMonth");
  const view = show();
  await loaded(view);
  fireEvent.click(await view.findByRole("button", { name: "Show Holiday transactions" }));
  const latest = () => requests.filter((request) => request.url.pathname === "/api/transactions").at(-1)?.url.searchParams;
  await waitFor(() => {
    assert.equal(latest()?.get("groupId"), "holiday");
    assert.equal(latest()?.has("from"), false);
  });
  fireEvent.click(view.getByRole("button", { name: "Clear Holiday filter and show all transactions" }));
  await waitFor(() => assert.equal(latest()?.has("groupId"), false));
  fireEvent.click(view.getByRole("button", { name: "Browse 2 transaction groups" }));
  const picker = view.getByRole("dialog", { name: "Find a transaction group" });
  fireEvent.click(within(picker).getByRole("button", { name: /Insurance/ }));
  await waitFor(() => assert.equal(latest()?.get("groupId"), "insurance"));
  assert.ok(!view.queryByRole("dialog", { name: "Find a transaction group" }));
  fireEvent.click(view.getByRole("button", { name: "Group", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Select transaction Groceries" }));
  fireEvent.click(view.getByRole("button", { name: "Continue", exact: true }));
  assert.ok(await view.findByRole("dialog", { name: "Create transaction group" }));
});
