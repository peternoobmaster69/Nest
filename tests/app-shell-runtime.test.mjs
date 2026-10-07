import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, waitFor, within, act } = ui;
const require = createRequire(import.meta.url);
const navigation = [];
const signOutCalls = [];
let pathname;
let fixtures;
let requests;
let client;
const router = { push: (path) => navigation.push(path), replace: (path) => navigation.push(path), refresh() {} };
mock.module("next/navigation", { namedExports: { usePathname: () => pathname, useRouter: () => router } });
mock.module("next-auth/react", { namedExports: { signOut: async (options) => signOutCalls.push(options) } });
mock.module("../components/ask-nest.tsx", { namedExports: { AskNest: () => null } });
mock.module("../components/notification-bell.tsx", { namedExports: { NotificationBell: () => null } });
mock.module("../components/onboarding/workspace-setup-guide-boundary.tsx", { namedExports: { WorkspaceSetupGuideBoundary: () => null } });
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { AppShell } = require("../components/app-shell.tsx");
const { AppSidebar } = require("../components/app-sidebar.tsx");
const { ConfirmDialogProvider } = require("../components/confirm-dialog.tsx");
const { ThemeProvider } = require("../components/theme-provider.tsx");
const { queryKeys } = require("../lib/query-keys.ts");

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: ui.window.localStorage });
const contextData = { workspaceId: "workspace-one", workspaceName: "Household", role: "OWNER", isShared: false };
const workspaces = [
  { id: "workspace-one", name: "Household", baseCurrency: "SGD", role: "OWNER" },
  { id: "workspace-two", name: "Travel", baseCurrency: "USD", role: "EDITOR" },
];
beforeEach(() => {
  pathname = "/w/workspace-one";
  ui.window.history.replaceState(null, "", pathname);
  ui.window.localStorage.clear();
  ui.window.sessionStorage.clear();
  delete ui.window.document.documentElement.dataset.privacy;
  ui.window.happyDOM.setWindowSize({ width: 390, height: 844 });
  navigation.length = 0;
  signOutCalls.length = 0;
  requests = [];
  fixtures = new Map([
    ["/api/context", contextData],
    ["/api/receivables/summary", { count: 3 }],
    ["/api/workspaces", workspaces],
    ["/api/workspaces/switch", { workspaceId: "workspace-two" }],
  ]);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), ui.window.location.href);
    requests.push({ url, method: options.method ?? "GET", body: options.body && JSON.parse(options.body) });
    assert.ok(fixtures.has(url.pathname), `Unexpected request: ${url.pathname}`);
    const fixture = fixtures.get(url.pathname);
    return typeof fixture === "function" ? fixture() : Response.json(fixture);
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
});
afterEach(() => {
  ui.cleanup();
  client.clear();
  globalThis.fetch = originalFetch;
  delete ui.window.caches;
});
after(async () => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
  await ui.dispose();
});

function providers(content) {
  return h(QueryClientProvider, { client }, h(ThemeProvider, null, h(ConfirmDialogProvider, null, content)));
}
function shellProps(overrides = {}) {
  return { title: "Dashboard", currentPath: "/", userName: "Nest Owner", contextData, ...overrides };
}
function show(overrides = {}) {
  return render(providers(h(AppShell, shellProps(overrides), h("h1", null, "Household finances"))));
}
async function openMore(view) {
  fireEvent.click(view.getByRole("button", { name: "Open More menu" }));
  return view.findByRole("dialog", { name: "More", exact: true });
}
async function openDesktopAccount(view) {
  const navigation = within(view.getByLabelText("Primary navigation"));
  fireEvent.click(navigation.getByRole("button", { name: /Nest Owner/ }));
  return navigation.findByRole("region", { name: "Account options" });
}

test("mobile primary destinations and More links retain the current tenant", async () => {
  const view = show();
  const primary = within(view.getByRole("navigation", { name: "Primary mobile navigation" }));
  for (const [name, path] of [["Home", ""], ["Transactions", "/transactions"], ["Cards", "/credit-transactions"], ["Investments", "/investments"]]) {
    assert.equal(primary.getByRole("link", { name, exact: true }).getAttribute("href"), `/w/workspace-one${path}`);
  }
  assert.equal(ui.window.document.title, "Household · Dashboard");
  const dialog = await openMore(view);
  assert.equal(within(dialog).getByRole("link", { name: /^Rewards/ }).getAttribute("href"), "/w/workspace-one/rewards");
  assert.equal(within(dialog).queryByRole("link", { name: "Transactions", exact: true }), null);
  assert.ok(within(dialog).getByRole("button", { name: /^Log out/ }));
  assert.equal(ui.window.document.documentElement.dataset.mobileMoreOpen, "true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close More navigation" }));
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(ui.window.document.documentElement.dataset.mobileMoreOpen, undefined);
});

test("workspace visibility settings remove disabled mobile destinations and change the cards target", async () => {
  const view = show({ contextData: { ...contextData, sidebarMoneyPages: { transactions: false, investments: false, creditTransactions: false, rewards: false, receivables: false, budget: false, cio: false } } });
  const primary = within(view.getByRole("navigation", { name: "Primary mobile navigation" }));
  assert.equal(primary.queryByRole("link", { name: "Transactions" }), null);
  assert.equal(primary.queryByRole("link", { name: "Investments" }), null);
  assert.equal(primary.getByRole("link", { name: "Cards" }).getAttribute("href"), "/w/workspace-one/credit-cards");
  const more = within(await openMore(view));
  for (const name of [/^Rewards/, /^Receivables/, /^Budget/, /^Nest CIO/, /^Credit Cards/]) assert.equal(more.queryByRole("link", { name }), null);
  assert.ok(more.getByRole("link", { name: /^Settings/ }));
});

test("More traps keyboard focus, closes on Escape, and returns focus to its trigger", async () => {
  const view = show();
  const trigger = view.getByRole("button", { name: "Open More menu" });
  trigger.focus();
  const dialog = await openMore(view);
  const first = within(dialog).getByRole("button", { name: "Close More navigation" });
  const last = within(dialog).getByRole("button", { name: "Switch to dark mode" });
  await waitFor(() => assert.ok(ui.window.document.activeElement === first));
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  assert.ok(ui.window.document.activeElement === last);
  fireEvent.keyDown(last, { key: "Tab" });
  assert.ok(ui.window.document.activeElement === first);
  fireEvent.keyDown(first, { key: "Escape" });
  assert.ok(!view.queryByRole("dialog"));
  assert.ok(ui.window.document.activeElement === trigger);
});

test("mobile workspace switching preserves the destination and waits for a successful server response", async () => {
  pathname = "/w/workspace-one/transactions";
  ui.window.history.replaceState(null, "", `${pathname}?period=all#history`);
  fixtures.set("/api/workspaces/switch", () => Response.json({ error: "Unavailable" }, { status: 503 }));
  const view = show({ title: "Transactions", currentPath: "/transactions" });
  const more = within(await openMore(view));
  fireEvent.click(more.getByRole("button", { name: /Switch workspace in this tab/ }));
  const option = await more.findByRole("option", { name: /Travel/ });
  assert.equal(more.getByRole("option", { name: /Household/ }).getAttribute("aria-selected"), "true");
  fireEvent.click(option);
  await waitFor(() => assert.equal(requests.filter(({ method }) => method === "POST").length, 1));
  await waitFor(() => assert.equal(option.disabled, false));
  assert.equal(navigation.length, 0);
  assert.ok(view.getByRole("dialog", { name: "More" }));
  fixtures.set("/api/workspaces/switch", { workspaceId: "workspace-two" });
  fireEvent.click(option);
  await waitFor(() => assert.deepEqual(navigation, ["/w/workspace-two/transactions?period=all#history"]));
  assert.ok(!view.queryByRole("dialog"));
  assert.deepEqual(requests.filter(({ method }) => method === "POST").map(({ body }) => body), [{ workspaceId: "workspace-two" }, { workspaceId: "workspace-two" }]);
});

test("desktop account options expose expanded state and switch to the selected workspace", async () => {
  const view = show();
  const sidebar = within(view.getByLabelText("Primary navigation"));
  const trigger = sidebar.getByRole("button", { name: /Nest Owner/ });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  const options = within(await openDesktopAccount(view));
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const target = await options.findByRole("button", { name: /Travel/ });
  assert.equal(options.getByRole("button", { name: /Household/ }).disabled, true);
  assert.equal(options.getAllByRole("button", { name: "Log Out" }).length, 1);
  client.setQueryData(queryKeys.context("workspace-two"), { workspaceId: "workspace-two", workspaceName: "Outdated name" });
  fireEvent.click(target);
  await waitFor(() => assert.deepEqual(navigation, ["/w/workspace-two"]));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.ok(!view.queryByRole("region", { name: "Account options" }));
});

for (const mobile of [true, false]) {
  test(`${mobile ? "mobile" : "desktop"} logout supports cancellation and purges private caches before signing out`, async () => {
    const deleted = [];
    Object.defineProperty(ui.window, "caches", { configurable: true, value: {
      keys: async () => ["nest-fixture-read", "nest-shell-static"],
      delete: async (name) => { deleted.push(name); assert.equal(signOutCalls.length, 0); return true; },
    } });
    const view = show();
    async function askToLogout() {
      const options = within(mobile ? await openMore(view) : await openDesktopAccount(view));
      fireEvent.click(options.getByRole("button", { name: /^Log out/i }));
      return within(await view.findByRole("dialog", { name: "Log out of Nest?" }));
    }
    let confirm = await askToLogout();
    fireEvent.click(confirm.getByRole("button", { name: "Cancel", exact: true }));
    assert.equal(deleted.length, 0);
    assert.equal(signOutCalls.length, 0);
    confirm = await askToLogout();
    fireEvent.click(confirm.getByRole("button", { name: "Log out", exact: true }));
    await waitFor(() => assert.deepEqual(signOutCalls, [{ callbackUrl: "/" }]));
    assert.deepEqual(deleted, ["nest-fixture-read"]);
  });
}

test("theme and privacy actions update device preferences without navigating", async () => {
  const view = show();
  fireEvent.click(view.getByRole("button", { name: "Hide amounts" }));
  assert.equal(ui.window.document.documentElement.dataset.privacy, "on");
  assert.equal(ui.window.localStorage.getItem("nest-privacy-mode"), "on");
  fireEvent.click(view.getByRole("button", { name: "Show amounts" }));
  assert.equal(ui.window.document.documentElement.dataset.privacy, undefined);
  const more = within(await openMore(view));
  fireEvent.click(more.getByRole("button", { name: "Switch to dark mode" }));
  assert.equal(ui.window.document.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(ui.window.localStorage.getItem("nest-theme"), "dark");
  fireEvent.click(more.getByRole("button", { name: "Switch to light mode" }));
  assert.equal(ui.window.localStorage.getItem("nest-theme"), "light");
  assert.equal(navigation.length, 0);
});

test("the standalone sidebar loads the workspace and closes responsive navigation after following a link", async () => {
  const view = render(providers(h(AppSidebar, { userName: "Nest Owner", currentPath: "/transactions" })));
  const sidebar = await view.findByLabelText("Primary navigation");
  await within(sidebar).findByRole("button", { name: /Household/ });
  assert.equal(within(sidebar).getByRole("link", { name: "Transactions", exact: true }).getAttribute("href"), "/w/workspace-one/transactions");
  fireEvent.click(within(sidebar).getByRole("link", { name: "Transactions", exact: true }));
  assert.equal(ui.window.sessionStorage.getItem("nest:ui:sidebarOpen"), "0");
  assert.ok(requests.some(({ url }) => url.pathname === "/api/context"));
});

test("scroll-to-top appears only on a long, scrolled page and restores main-content focus", async () => {
  const view = show();
  const scroller = view.container.querySelector(".body");
  Object.defineProperties(scroller, { scrollHeight: { value: 3000 }, clientHeight: { value: 600 } });
  scroller.scrollTop = 800;
  await act(async () => {
    fireEvent.scroll(scroller);
    await new Promise((resolve) => ui.window.requestAnimationFrame(resolve));
  });
  const button = view.getByRole("button", { name: "Scroll to top" });
  fireEvent.click(button);
  await waitFor(() => assert.equal(scroller.scrollTop, 0));
  assert.ok(ui.window.document.activeElement === view.getByRole("main"));
});
