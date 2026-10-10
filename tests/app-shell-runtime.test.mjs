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
  assert.ok(!(within(dialog).queryByRole("link", { name: "Transactions", exact: true })));
  assert.ok(within(dialog).getByRole("button", { name: /^Log out/ }));
  assert.equal(ui.window.document.documentElement.dataset.mobileMoreOpen, "true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close More navigation" }));
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(ui.window.document.documentElement.dataset.mobileMoreOpen, undefined);
});

test("workspace visibility settings remove disabled mobile destinations and change the cards target", async () => {
  const view = show({ contextData: { ...contextData, sidebarMoneyPages: { transactions: false, investments: false, creditTransactions: false, rewards: false, receivables: false, budget: false, cio: false } } });
  const primary = within(view.getByRole("navigation", { name: "Primary mobile navigation" }));
  assert.ok(!(primary.queryByRole("link", { name: "Transactions" })));
  assert.ok(!(primary.queryByRole("link", { name: "Investments" })));
  assert.equal(primary.getByRole("link", { name: "Cards" }).getAttribute("href"), "/w/workspace-one/credit-cards");
  const more = within(await openMore(view));
  for (const name of [/^Rewards/, /^Receivables/, /^Budget/, /^Nest CIO/, /^Credit Cards/]) assert.ok(!(more.queryByRole("link", { name })));
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
  fireEvent.click(more.getByRole("option", { name: /Household/ }));
  assert.equal(requests.filter(({ method }) => method === "POST").length, 0);
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
  fireEvent.click(options.getByRole("button", { name: /Household/ }));
  assert.equal(requests.filter(({ method }) => method === "POST").length, 0);
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

test("responsive navigation stays open for inside clicks and closes from the backdrop, close button and Escape", async () => {
  const view = show();
  const sidebar = view.getByLabelText("Primary navigation");
  const open = () => fireEvent.click(view.getByRole("button", { name: "Open navigation" }));
  open();
  assert.equal(sidebar.classList.contains("open"), true);
  fireEvent.mouseDown(sidebar);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  assert.equal(sidebar.classList.contains("open"), true);
  const backdrop = view.container.querySelector(".sidebar-overlay");
  assert.equal(backdrop.getAttribute("aria-hidden"), "true");
  fireEvent.mouseDown(backdrop);
  assert.equal(sidebar.classList.contains("open"), false);
  open();
  fireEvent.click(within(sidebar).getByRole("button", { name: "Close sidebar" }));
  assert.equal(sidebar.classList.contains("open"), false);
  open();
  fireEvent.keyDown(window, { key: "Escape" });
  assert.equal(sidebar.classList.contains("open"), false);
});

test("More ignores inside and trigger pointer events and closes on outside pointer events", async () => {
  const view = show();
  const dialog = await openMore(view);
  fireEvent.pointerDown(dialog);
  fireEvent.pointerDown(view.getByRole("button", { name: "Close More menu" }));
  fireEvent.keyDown(dialog, { key: "ArrowRight" });
  assert.ok(view.getByRole("dialog", { name: "More" }));
  const first = within(dialog).getByRole("button", { name: "Close More navigation" });
  const last = within(dialog).getByRole("button", { name: "Switch to dark mode" });
  first.focus();
  const forward = new ui.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  first.dispatchEvent(forward);
  assert.equal(forward.defaultPrevented, false);
  last.focus();
  const backward = new ui.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  last.dispatchEvent(backward);
  assert.equal(backward.defaultPrevented, false);
  fireEvent.pointerDown(document.body);
  assert.ok(!(view.queryByRole("dialog")));
});

test("More handles a temporarily empty focus list without trapping or throwing", async () => {
  const view = show();
  const dialog = await openMore(view);
  for (const button of dialog.querySelectorAll("button")) button.disabled = true;
  for (const link of dialog.querySelectorAll("a")) link.removeAttribute("href");
  const event = new ui.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  dialog.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(!(view.queryByRole("dialog")));
});

test("More can close when the document had no focused element before it opened", async t => {
  const view = show();
  t.mock.getter(document, "activeElement", () => null);
  const dialog = await openMore(view);
  fireEvent.keyDown(dialog, { key: "Escape" });
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(document.documentElement.dataset.mobileMoreOpen, undefined);
});

test("changing routes closes transient navigation and keeps each active destination accurate", async () => {
  const view = show({ contextData: { ...contextData, isAdmin: true } });
  for (const [path, label] of [
    ["/cio", "Nest CIO"], ["/credit-cards", "Credit Cards"], ["/credit-transactions", "Card Transactions"],
    ["/receivables", "Receivables"], ["/rewards", "Rewards"], ["/investments", "Investments"],
    ["/budgets/plan", "Budget Plan"], ["/settings", "Settings"], ["/admin/jobs", "Admin"],
  ]) {
    view.rerender(providers(h(AppShell, shellProps({ title: label, currentPath: path, contextData: { ...contextData, isAdmin: true } }), h("h1", null, "Household finances"))));
    assert.ok(!(view.queryByRole("dialog")));
    const sidebar = within(view.getByLabelText("Primary navigation"));
    const linkName = label === "Receivables" ? /^Receivables/ : label;
    assert.ok(sidebar.getByRole("link", { name: linkName, exact: true }).classList.contains("on"));
    const more = within(await openMore(view));
    const moreLabel = label === "Budget Plan" ? "Budget" : label;
    if (!["Card Transactions", "Investments"].includes(label)) assert.ok(more.getByRole("link", { name: new RegExp(`^${moreLabel}`) }).classList.contains("is-active"));
  }
  fireEvent.click(within(view.getByRole("dialog", { name: "More" })).getByRole("link", { name: /^Settings/ }));
  assert.ok(!(view.queryByRole("dialog")));
});

test("disabled cards and explicit zero badges override server summaries", async () => {
  fixtures.set("/api/receivables/summary", { count: 99 });
  const view = show({ badgeCounts: { receivables: 0 }, contextData: { ...contextData, sidebarMoneyPages: { creditCards: false } } });
  assert.ok(!(within(view.getByRole("navigation", { name: "Primary mobile navigation" })).queryByRole("link", { name: "Cards" })));
  const sidebar = within(view.getByLabelText("Primary navigation"));
  assert.ok(!(sidebar.queryByRole("link", { name: "Credit Cards" })));
  assert.ok(!(sidebar.queryByRole("link", { name: "Card Transactions" })));
  const dialog = await openMore(view);
  assert.ok(!(dialog.querySelector(".mobile-more-badge")));
  assert.ok(!(view.container.querySelector(".sb-badge")));
});

test("missing workspace metadata keeps URL scoping, readable titles and a fetched receivables count", async () => {
  const view = show({ contextData: { workspaceId: null, workspaceName: null }, title: "Transactions", currentPath: "/transactions", topbarTitle: h("strong", null, "Custom heading") });
  assert.equal(document.title, "Transactions · Nest");
  assert.ok(view.getByText("Custom heading"));
  assert.ok(!(view.queryByRole("navigation", { name: "Breadcrumb" })));
  const dialog = await openMore(view);
  await waitFor(() => assert.equal(dialog.querySelector(".mobile-more-badge")?.textContent, "3"));
  assert.ok(requests.some(({ url }) => url.pathname === "/api/receivables/summary" && url.searchParams.get("workspaceId") === "workspace-one"));
  assert.equal(within(dialog).getByRole("link", { name: /^Settings/ }).getAttribute("href"), "/w/workspace-one/settings");
  assert.ok(within(dialog).getByRole("button", { name: /Workspace Switch workspace in this tab/ }));
});

test("receivables summary failures leave a usable shell without a misleading badge", async () => {
  fixtures.set("/api/receivables/summary", () => Response.json({ error: "Unavailable" }, { status: 503 }));
  const view = show({ contextData: { workspaceId: null, workspaceName: null } });
  await waitFor(() => assert.equal(client.getQueryState(queryKeys.key(["receivables-summary", "workspace-one"]))?.status, "error"));
  const dialog = await openMore(view);
  assert.ok(!(dialog.querySelector(".mobile-more-badge")));
  assert.ok(within(dialog).getByRole("link", { name: /^Receivables/ }));
});

test("unscoped shell links and anonymous account images retain safe presentation defaults", async () => {
  pathname = "/transactions";
  ui.window.history.replaceState(null, "", pathname);
  const view = show({ userName: "", userEmail: "owner@example.test", userImage: "/avatar.png", contextData: { workspaceName: "   " } });
  const primary = within(view.getByRole("navigation", { name: "Primary mobile navigation" }));
  assert.equal(primary.getByRole("link", { name: "Home" }).getAttribute("href"), "/");
  let dialog = await openMore(view);
  assert.equal(within(dialog).getByRole("img", { name: "owner@example.test" }).getAttribute("alt"), "owner@example.test");
  assert.ok(within(dialog).getByRole("link", { name: /Account View profile/ }));
  view.rerender(providers(h(AppShell, shellProps({ userName: "", userEmail: "", userImage: "/avatar.png", contextData: {} }), h("h1", null, "Household finances"))));
  dialog = view.getByRole("dialog", { name: "More" });
  assert.ok(within(dialog).getByRole("img", { name: "User" }));
  assert.ok(!(view.container.querySelector(".mobile-bottom-nav-workspace-name[title]")));
});

test("mobile workspace choices report loading and retrieval errors", async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  t.after(() => act(async () => resolve(Response.json([]))));
  fixtures.set("/api/workspaces", () => pending);
  const view = show();
  const more = within(await openMore(view));
  fireEvent.click(more.getByRole("button", { name: /Switch workspace in this tab/ }));
  assert.ok(more.getByText("Loading workspaces..."));
  await act(async () => resolve(Response.json({ error: "Unavailable" }, { status: 503 })));
  assert.ok(await more.findByText("Workspaces could not be loaded."));
  assert.ok(!(more.queryByRole("option")));
});

test("desktop workspace choices report loading and retrieval errors", async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  t.after(() => act(async () => resolve(Response.json([]))));
  fixtures.set("/api/workspaces", () => pending);
  const view = show();
  const account = within(await openDesktopAccount(view));
  assert.ok(account.getByText("Loading..."));
  await act(async () => resolve(Response.json({ error: "Unavailable" }, { status: 503 })));
  assert.ok(await account.findByText("Workspaces could not be loaded."));
});

test("desktop account menus close after outside clicks, profile navigation and theme changes", async () => {
  const view = show({ contextData: { ...contextData, isShared: true } });
  const sidebar = view.getByLabelText("Primary navigation");
  let menu = await openDesktopAccount(view);
  fireEvent.mouseDown(menu);
  assert.ok(view.getByRole("region", { name: "Account options" }));
  fireEvent.mouseDown(document.body);
  assert.ok(!(view.queryByRole("region", { name: "Account options" })));
  menu = await openDesktopAccount(view);
  fireEvent.click(within(menu).getByRole("link", { name: "View Profile" }));
  assert.ok(!(view.queryByRole("region", { name: "Account options" })));
  assert.equal(ui.window.sessionStorage.getItem("nest:ui:sidebarOpen"), "0");
  for (const [label, theme] of [["Dark mode", "dark"], ["Light mode", "light"]]) {
    menu = await openDesktopAccount(view);
    fireEvent.click(within(menu).getByRole("button", { name: label }));
    assert.equal(document.documentElement.getAttribute("data-theme"), theme);
    assert.ok(!(view.queryByRole("region", { name: "Account options" })));
  }
  ui.window.happyDOM.setWindowSize({ width: 1500, height: 900 });
  ui.window.sessionStorage.setItem("nest:ui:sidebarOpen", "1");
  fireEvent.click(within(sidebar).getByRole("link", { name: "Transactions", exact: true }));
  menu = await openDesktopAccount(view);
  fireEvent.click(within(menu).getByRole("link", { name: "View Profile" }));
  assert.equal(ui.window.sessionStorage.getItem("nest:ui:sidebarOpen"), "1");
});

test("a failed desktop workspace switch clears progress and leaves the existing route intact", async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  t.after(() => act(async () => resolve(Response.json({}, { status: 503 }))));
  fixtures.set("/api/workspaces/switch", () => pending);
  const view = show();
  let account = within(await openDesktopAccount(view));
  fireEvent.click(await account.findByRole("button", { name: /Travel/ }));
  assert.ok(view.getByText("Switching workspace..."));
  account = within(await openDesktopAccount(view));
  const target = account.getByRole("button", { name: /Travel/ });
  assert.equal(target.disabled, true);
  assert.ok(target.querySelector(".sb-workspace-spinner"));
  await act(async () => resolve(Response.json({ error: "Unavailable" }, { status: 503 })));
  await waitFor(() => assert.ok(!(view.queryByText("Switching workspace..."))));
  assert.equal(navigation.length, 0);
  assert.equal(target.disabled, false);
});

test("desktop workspace switching works without a pre-existing destination cache", async () => {
  const view = show();
  const account = within(await openDesktopAccount(view));
  fireEvent.click(await account.findByRole("button", { name: /Travel/ }));
  await waitFor(() => assert.deepEqual(navigation, ["/w/workspace-two"]));
  await waitFor(() => assert.ok(!(view.queryByText("Switching workspace..."))));
  assert.equal(client.getQueryData(queryKeys.context("workspace-two")), undefined);
});

test("a standalone sidebar recovers from a failed context query without losing URL-scoped navigation", async () => {
  fixtures.set("/api/context", () => Response.json({ error: "Unavailable" }, { status: 503 }));
  const view = render(providers(h(AppSidebar, { userName: "Nest Owner", currentPath: "/transactions" })));
  assert.ok(view.container.querySelector(".sb-skeleton-scroll"));
  await waitFor(() => assert.equal(client.getQueryState(queryKeys.context("workspace-one"))?.status, "error"));
  const sidebar = within(view.getByLabelText("Primary navigation"));
  assert.equal(sidebar.getByRole("link", { name: "Transactions", exact: true }).getAttribute("href"), "/w/workspace-one/transactions");
  assert.ok(sidebar.getByRole("button", { name: /Workspace/ }));
});

test("a standalone sidebar keeps receivables accessible after its summary request fails", async () => {
  fixtures.set("/api/receivables/summary", () => Response.json({ error: "Unavailable" }, { status: 503 }));
  const view = render(providers(h(AppSidebar, { userName: "Nest Owner", currentPath: "/receivables", contextData })));
  await waitFor(() => assert.equal(client.getQueryState(queryKeys.key(["receivables-summary", "workspace-one"]))?.status, "error"));
  const link = view.getByRole("link", { name: "Receivables", exact: true });
  assert.equal(link.getAttribute("href"), "/w/workspace-one/receivables");
  assert.ok(!link.querySelector(".sb-badge"));
});

test("the sidebar mobile logout action asks for confirmation and supports cancellation", async () => {
  const view = show();
  const sidebar = view.getByLabelText("Primary navigation");
  fireEvent.click(within(sidebar).getByRole("button", { name: "Log Out", exact: true }));
  const dialog = await view.findByRole("dialog", { name: "Log out of Nest?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(signOutCalls.length, 0);
});

test("explicit context loading keeps sidebar controls inactive until metadata is ready", () => {
  const view = show({ contextLoading: true });
  assert.ok(view.container.querySelector(".sb-skeleton-scroll"));
  assert.ok(!(within(view.getByLabelText("Primary navigation")).queryByRole("button", { name: /Nest Owner/ })));
});

test("scroll visibility coalesces rapid events and cancels queued work on unmount", async () => {
  const view = show();
  const scroller = view.container.querySelector(".body");
  Object.defineProperties(scroller, { scrollHeight: { value: 3000 }, clientHeight: { value: 600 } });
  scroller.scrollTop = 800;
  fireEvent.scroll(scroller);
  fireEvent.scroll(scroller);
  fireEvent.resize(window);
  view.unmount();
  await act(async () => new Promise(resolve => window.requestAnimationFrame(resolve)));
  assert.ok(!document.getElementById("main-content"));
});
