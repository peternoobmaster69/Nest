import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, waitFor } = ui;
const require = createRequire(import.meta.url);
let read;
let update;
let client;
const requests = [];
mock.module("../lib/api/client.ts", { namedExports: { apiFetch: async (url, options = {}) => {
  requests.push({ url, ...options });
  return options.method === "PATCH" ? update() : read();
} } });
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { queryKeys } = require("../lib/query-keys.ts");
const { NotificationBell } = require("../components/notification-bell.tsx");
const key = queryKeys.notifications("home");
const now = new Date("2026-10-08T12:00:00Z");
const response = (items = [], unreadCount = 0) => ({ notifications: { items, pageInfo: { hasMore: false, nextCursor: null } }, unreadCount });
const item = (id, extra = {}) => ({ id, type: "CREDIT_CARD_DUE", title: `Notice ${id}`, message: `Details ${id}`, href: null, readAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), ...extra });
beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  requests.length = 0;
  read = async () => response();
  update = async () => ({ ok: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { ui.cleanup(); client.clear(); await ui.window.happyDOM.abort(); });
after(() => ui.dispose());
function show(workspaceId = "home") { return render(h(QueryClientProvider, { client }, h(NotificationBell, { workspaceId }))); }
function open(view) { fireEvent.click(view.getByRole("button", { name: /^Notifications/ })); return view.getByRole("dialog", { name: "Notifications" }); }
const patches = () => requests.filter(({ method }) => method === "PATCH");

test("notifications stay disabled without a workspace and preserve popover dismissal semantics", async () => {
  const view = show(null);
  assert.equal(view.getByRole("button").getAttribute("aria-expanded"), "false");
  const dialog = open(view);
  assert.equal(dialog.tagName, "DIALOG");
  assert.equal(dialog.open, true);
  assert.ok(view.getByText("All caught up"));
  assert.equal(requests.length, 0);
  fireEvent.mouseDown(dialog);
  fireEvent.keyDown(ui.window, { key: "ArrowDown" });
  assert.ok(view.getByRole("dialog"));
  fireEvent.keyDown(ui.window, { key: "Escape" });
  assert.equal(view.queryByRole("dialog"), null);
  open(view);
  fireEvent.mouseDown(document.body);
  assert.equal(view.queryByRole("dialog"), null);
  open(view);
  fireEvent.click(view.getByRole("button", { name: "Notifications", exact: true }));
  assert.equal(view.queryByRole("dialog"), null);
});

test("notification loading is announced and failed reads can be retried", async () => {
  let reject;
  read = () => new Promise((resolve, fail) => { reject = fail; });
  const view = show();
  open(view);
  assert.equal(view.getByRole("status").textContent, "Loading notifications…");
  assert.equal(requests[0].cache, "no-store");
  await ui.act(async () => reject(new Error("Unavailable")));
  await view.findByText("Notifications couldn’t be loaded.");
  read = async () => response();
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await view.findByText("All caught up");
  assert.equal(requests.length, 2);
});

test("notification badges, timestamps, read state, and link destinations describe the current inbox", async () => {
  const times = [-60_000, 0, 59 * 60_000, 23 * 3_600_000, 6 * 86_400_000, 8 * 86_400_000];
  const items = times.map((age, index) => item(String(index), { updatedAt: new Date(now.getTime() - age).toISOString(), readAt: index === 1 ? now.toISOString() : null, href: index === 0 ? "/entry?workspaceId=home&next=%2Fcredit-transactions" : null }));
  read = async () => response(items, 12);
  const view = show();
  await view.findByRole("button", { name: "Notifications, 12 unread" });
  assert.ok(view.getByText("9+"));
  open(view);
  assert.equal(view.getAllByText("Just now").length, 2);
  for (const label of ["59m ago", "23h ago", "6d ago", new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short" }).format(new Date(now.getTime() - times[5]))]) assert.ok(view.getByText(label));
  assert.equal(view.getByRole("link", { name: /Notice 0/ }).getAttribute("href"), items[0].href);
  assert.equal(view.getByRole("button", { name: /Notice 1/ }).classList.contains("unread"), false);
  fireEvent.click(view.getByRole("button", { name: /Notice 1/ }));
  assert.equal(view.queryByRole("dialog"), null);
  assert.equal(patches().length, 0);
});

test("opening an unread notification updates only that item immediately and refreshes after persistence", async () => {
  const initial = response([item("selected", { href: "/entry?workspaceId=home" }), item("other")], 2);
  read = async () => initial;
  let complete;
  update = () => new Promise((resolve) => { complete = resolve; });
  const view = show();
  await view.findByRole("button", { name: "Notifications, 2 unread" });
  open(view);
  assert.ok(view.getByText("2"));
  fireEvent.click(view.getByRole("link", { name: /Notice selected/ }));
  assert.equal(view.queryByRole("dialog"), null);
  const optimistic = client.getQueryData(key);
  assert.equal(optimistic.unreadCount, 1);
  assert.equal(optimistic.notifications.items[0].readAt, now.toISOString());
  assert.equal(optimistic.notifications.items[1].readAt, null);
  await waitFor(() => assert.equal(patches().length, 1));
  assert.deepEqual(JSON.parse(patches()[0].body), { notificationId: "selected" });
  read = async () => optimistic;
  await ui.act(async () => complete({ ok: true }));
  await waitFor(() => assert.equal(requests.filter(({ method }) => !method).length, 2));
});

test("marking all notifications read preserves existing timestamps and clears the server's full unread count", async () => {
  const earlier = "2026-10-01T00:00:00Z";
  read = async () => response([item("unread"), item("read", { readAt: earlier })], 20);
  let complete;
  update = () => new Promise((resolve) => { complete = resolve; });
  const view = show();
  await view.findByRole("button", { name: "Notifications, 20 unread" });
  open(view);
  fireEvent.click(view.getByRole("button", { name: "Mark all read" }));
  const optimistic = client.getQueryData(key);
  assert.equal(optimistic.unreadCount, 0);
  assert.deepEqual(optimistic.notifications.items.map(({ readAt }) => readAt), [now.toISOString(), earlier]);
  await waitFor(() => assert.equal(patches().length, 1));
  assert.deepEqual(JSON.parse(patches()[0].body), { markAllRead: true });
  read = async () => optimistic;
  await ui.act(async () => complete({ ok: true }));
  await view.findByText("You’re up to date");
});

test("failed notification writes refetch authoritative unread state", async () => {
  const initial = response([item("one")], 1);
  read = async () => initial;
  update = async () => { throw new Error("Write unavailable"); };
  const view = show();
  await view.findByRole("button", { name: "Notifications, 1 unread" });
  open(view);
  fireEvent.click(view.getByRole("button", { name: /Notice one/ }));
  await waitFor(() => assert.equal(requests.filter(({ method }) => !method).length, 2));
  await view.findByRole("button", { name: "Notifications, 1 unread" });
  assert.equal(client.getQueryData(key).notifications.items[0].readAt, null);
});

for (const state of ["already read", "removed item", "zero count", "removed cache"]) {
  test(`opening a stale notification handles ${state} without decrementing another item's unread count`, async () => {
    read = async () => response([item("one"), item("two")], 2);
    let complete;
    update = () => new Promise((resolve) => { complete = resolve; });
    const view = show();
    await view.findByRole("button", { name: "Notifications, 2 unread" });
    open(view);
    const action = view.getByRole("button", { name: /Notice one/ });
    ui.act(() => {
      if (state === "removed cache") client.removeQueries({ queryKey: key });
      else if (state === "removed item") client.setQueryData(key, response([item("two")], 1));
      else if (state === "already read") client.setQueryData(key, response([item("one", { readAt: now.toISOString() }), item("two")], 1));
      else client.setQueryData(key, response([item("one"), item("two")], 0));
      fireEvent.click(action);
    });
    const current = client.getQueryData(key);
    if (state === "removed cache") assert.equal(current, undefined);
    else assert.equal(current.unreadCount, state === "zero count" ? 0 : 1);
    await waitFor(() => assert.equal(patches().length, 1));
    await ui.act(async () => complete({ ok: true }));
  });
}

test("mark-all still persists safely when its query cache disappears before the click", async () => {
  read = async () => response([item("one")], 1);
  let complete;
  update = () => new Promise((resolve) => { complete = resolve; });
  const view = show();
  await view.findByRole("button", { name: "Notifications, 1 unread" });
  open(view);
  const action = view.getByRole("button", { name: "Mark all read" });
  ui.act(() => { client.removeQueries({ queryKey: key }); fireEvent.click(action); });
  assert.equal(client.getQueryData(key), undefined);
  await waitFor(() => assert.deepEqual(JSON.parse(patches()[0].body), { markAllRead: true }));
  await ui.act(async () => complete({ ok: true }));
});
