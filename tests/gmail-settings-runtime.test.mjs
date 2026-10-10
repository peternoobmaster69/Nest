import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const requests = [], invalidations = [], clients = [], confirmations = [];
const intervals = new Map(), timeouts = new Map();
let responses, routeWorkspaceId, confirmResult, nextTimerId;
mock.module("../components/workspace-provider.tsx", { namedExports: { useWorkspaceId: () => routeWorkspaceId } });
mock.module("../lib/use-money-format.ts", { namedExports: { useMoneyFormat: () => ({ format: (value) => String(value) }) } });
mock.module("next/navigation", { namedExports: {
  usePathname: () => "/w/household/settings", useSearchParams: () => new URLSearchParams(),
} });
mock.module("../components/confirm-dialog.tsx", { namedExports: { useConfirmDialog: () => ({ confirm: async (options) => { confirmations.push(options); return confirmResult; } }) } });
mock.module("../lib/api/client.ts", { namedExports: { apiFetch: async (url, options = {}) => {
  const request = { url, ...options, method: options.method ?? "GET" };
  requests.push(request);
  const key = `${request.method} ${url.split("?")[0]}`;
  assert.ok(responses.has(key), `Unexpected API request: ${key}`);
  const response = responses.get(key);
  if (response instanceof Error) throw response;
  return typeof response === "function" ? response(request) : response;
} } });
const { SettingsPage } = require("../components/settings-page.tsx");
const { useGmailSettings } = require("../hooks/use-gmail-settings.ts");
const connected = (extra = {}) => ({ connected: true, requiresReconnect: false, integration: {
  id: "gmail-one", email: "owner@example.test", scope: "https://www.googleapis.com/auth/gmail.readonly",
  createdAt: "2026-01-01T00:00:00Z", lastSyncedAt: null,
}, ...extra });
const progress = (phase, extra = {}) => ({ phase, progress: 0, message: `Sync ${phase}`, total: 0, current: 0, updatedAt: 1, ...extra });
function createClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (options) => { invalidations.push(options.queryKey); return invalidate(options); };
  return client;
}
function show(section = "automation") {
  const client = createClient();
  const page = (nextSection) => ui.h(QueryClientProvider, { client }, ui.h(SettingsPage, { section: nextSection }));
  const view = ui.render(page(section));
  return { ...view, client, section: (nextSection) => view.rerender(page(nextSection)) };
}
async function sync(view) { ui.fireEvent.click(await view.findByRole("button", { name: "Sync Inbox" })); }
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function tick() { await ui.act(async () => { for (const callback of [...intervals.values()]) callback(); }); }
async function clearProgress() {
  await ui.act(async () => {
    for (const [id, callback] of [...timeouts]) { timeouts.delete(id); callback(); }
  });
}
const syncRequests = () => requests.filter(({ url }) => url === "/api/gmail/sync");
const statusRequests = () => syncRequests().filter(({ method }) => method === "GET");
beforeEach((t) => {
  requests.length = invalidations.length = confirmations.length = 0;
  intervals.clear(); timeouts.clear(); nextTimerId = -1;
  routeWorkspaceId = "household"; confirmResult = true;
  ui.window.location.href = "http://localhost:3100/w/household/settings?tab=automation";
  t.mock.method(ui.window, "setInterval", (callback, delay) => { assert.equal(delay, 1000); const id = nextTimerId--; intervals.set(id, callback); return id; });
  t.mock.method(ui.window, "clearInterval", (id) => intervals.delete(id));
  const setTimeout = ui.window.setTimeout.bind(ui.window), clearTimeout = ui.window.clearTimeout.bind(ui.window);
  t.mock.method(ui.window, "setTimeout", (callback, delay, ...args) => {
    if (delay !== 1200) return setTimeout(callback, delay, ...args);
    const id = nextTimerId--; timeouts.set(id, callback); return id;
  });
  t.mock.method(ui.window, "clearTimeout", (id) => id < 0 ? timeouts.delete(id) : clearTimeout(id));
  responses = new Map([
    ["GET /api/context", { workspaceId: "household", workspaceName: "Household", role: "OWNER", workspaces: [] }],
    ["GET /api/accounts", []], ["GET /api/budgets", []], ["GET /api/credit-transactions/auto-rules", { workspaceId: "household", rules: [] }],
    ["GET /api/gmail/status", connected()],
    ["POST /api/gmail/sync", { queued: false }], ["GET /api/gmail/sync", progress("reading")],
    ["POST /api/gmail/connect", { url: "https://accounts.example.test/authorize" }],
    ["POST /api/gmail/disconnect", { ok: true }],
  ]);
});
afterEach(() => { ui.cleanup(); for (const client of clients.splice(0)) client.clear(); });
after(() => ui.dispose());

test("queued Gmail work keeps checking status until it finishes", async () => {
  responses.set("POST /api/gmail/sync", { queued: true, jobId: "job-one" });
  responses.set("GET /api/gmail/sync", progress("queued"));
  const view = show();
  await sync(view);
  await view.findByRole("status", { name: "Gmail inbox sync progress" });
  await ui.waitFor(() => assert.ok(requests.some(({ method, url }) => method === "GET" && url === "/api/gmail/sync")));
  assert.equal(intervals.size, 1);
  assert.ok(view.getByRole("button", { name: "Syncing..." }).disabled);
  responses.set("GET /api/gmail/sync", progress("complete", { progress: 100, message: "Inbox sync complete." }));
  await tick();
  await view.findByText("Inbox sync complete");
  assert.equal(intervals.size, 0);
  assert.ok(!view.queryByRole("status", { name: "Gmail inbox sync progress" }));
  assert.ok(view.getByRole("button", { name: "Sync Inbox" }));
  assert.deepEqual(invalidations, [["gmail-status"], ["credit-transactions"], ["dashboard-summary"]]);
  assert.equal(timeouts.size, 1);
  await clearProgress();
  assert.ok(view.getByText("Inbox sync complete"));
});

test("cancelled Gmail work stops the spinner and leaves a visible result", async () => {
  responses.set("GET /api/gmail/sync", progress("cancelled", { message: "Sync cancelled by user." }));
  const view = show();
  await sync(view);
  await view.findByText(/Sync cancelled by user/);
  assert.ok(!view.queryByRole("status", { name: "Gmail inbox sync progress" }));
  assert.equal(intervals.size, 0);
  assert.ok(!view.getByRole("button", { name: "Sync Inbox" }).disabled);
});

test("slow status requests never overlap and ignore completion after unmount", async (t) => {
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve(progress("complete"))));
  responses.set("GET /api/gmail/sync", () => pending.promise);
  const view = show();
  await sync(view);
  await ui.waitFor(() => assert.equal(intervals.size, 1));
  await tick();
  await tick();
  assert.equal(requests.filter(({ method, url }) => method === "GET" && url === "/api/gmail/sync").length, 1);
  view.unmount();
  assert.equal(intervals.size, 0);
  await ui.act(async () => pending.resolve(progress("complete")));
  assert.equal(invalidations.length, 0);
});

for (const [status, title] of [
  ["connected", "Gmail connected successfully"],
  ["denied", "Gmail permission was denied"],
  ["forbidden", "Gmail callback failed authorization"],
  ["refresh_required", "Google did not return a reusable Gmail authorization"],
  ["unexpected", "Gmail connection failed"],
]) {
  test(`OAuth callback ${status} survives a settings tab change and preserves other URL state`, async () => {
    ui.window.history.replaceState(null, "", `/w/household/settings?tab=workspaces&gmail=${status}&filter=one%20two#bank-accounts`);
    const view = show("workspaces");
    await view.findByText("Currency Display");
    const url = new URL(ui.window.location.href);
    assert.equal(url.searchParams.has("gmail"), false);
    assert.equal(url.searchParams.get("tab"), "workspaces");
    assert.equal(url.searchParams.get("filter"), "one two");
    assert.equal(url.hash, "#bank-accounts");
    view.section("automation");
    await view.findByText(title);
    assert.ok(view.getByRole("button", { name: status === "refresh_required" ? "Reconnect Gmail" : "Sync Inbox" }));
  });
}

test("connection details show read-only scope and workspace staging links", async () => {
  const view = show();
  await view.findByText("owner@example.test");
  assert.match(view.container.textContent, /Never synced/);
  assert.match(view.container.textContent, /Read-only Gmail messages \(Nest cannot send, edit, or delete mail\)/);
  const link = view.getByRole("link", { name: "Open Staging Table" });
  assert.equal(link.getAttribute("href"), "/w/household/credit-alerts");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noreferrer");
  assert.equal(intervals.size, 0);
  assert.equal(syncRequests().length, 0);
});

for (const [scope, text] of [
  [null, "Read-only access to card-alert email metadata and content"],
  ["https://provider.example/mail.read profile https://provider.example/", "mail read, profile, https://provider.example/"],
]) {
  test(`connection scope ${scope ?? "not supplied"} and last sync are readable`, async () => {
    const lastSyncedAt = "2026-05-17T09:30:00Z";
    responses.set("GET /api/gmail/status", connected({ integration: { ...connected().integration, scope, lastSyncedAt } }));
    const view = show();
    await view.findByText(`Data scope: ${text}`);
    assert.ok(view.container.textContent.includes(`Last sync: ${new Date(lastSyncedAt).toLocaleString()}`));
  });
}

test("connect waits for authorization and redirects to the returned provider URL", async (t) => {
  routeWorkspaceId = null;
  responses.set("GET /api/gmail/status", { connected: false, requiresReconnect: false, integration: null });
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve({ url: "https://accounts.example.test/authorize" })));
  responses.set("POST /api/gmail/connect", () => pending.promise);
  const view = show();
  await view.findByText("Not connected.");
  assert.equal(view.getByRole("link", { name: "Open Staging Table" }).getAttribute("href"), "/credit-alerts");
  ui.fireEvent.click(view.getByRole("button", { name: "Connect Gmail" }));
  assert.ok((await view.findByRole("button", { name: "Redirecting..." })).disabled);
  assert.equal(requests.filter(({ url }) => url === "/api/gmail/connect").length, 1);
  await ui.act(async () => pending.resolve({ url: "https://accounts.example.test/authorize" }));
  assert.equal(ui.window.location.href, "https://accounts.example.test/authorize");
});

for (const [failure, expected] of [
  [new Error("Recent authentication required"), "Re-authentication required"],
  ["offline", "Failed to start Gmail connect"],
]) {
  test(`connect failure ${expected} remains actionable`, async () => {
    responses.set("GET /api/gmail/status", { connected: false, integration: null });
    responses.set("POST /api/gmail/connect", () => { throw failure; });
    const view = show();
    ui.fireEvent.click(await view.findByRole("button", { name: "Connect Gmail" }));
    await view.findByText(expected);
    assert.ok(!view.getByRole("button", { name: "Connect Gmail" }).disabled);
    if (failure instanceof Error) assert.ok(view.getByRole("button", { name: "Re-authenticate" }));
    else assert.ok(view.getByRole("alert"));
  });
}

test("reconnect blocks disconnection while provider authorization is pending", async (t) => {
  responses.set("GET /api/gmail/status", connected({ requiresReconnect: true }));
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve({ url: "https://accounts.example.test/reconnect" })));
  responses.set("POST /api/gmail/connect", () => pending.promise);
  const view = show();
  ui.fireEvent.click(await view.findByRole("button", { name: "Reconnect Gmail" }));
  assert.ok((await view.findByRole("button", { name: "Redirecting..." })).disabled);
  assert.ok(view.getByRole("button", { name: "Disconnect" }).disabled);
  ui.fireEvent.click(view.getByRole("button", { name: "Disconnect" }));
  assert.equal(confirmations.length, 0);
  await ui.act(async () => pending.resolve({ url: "https://accounts.example.test/reconnect" }));
  assert.equal(ui.window.location.href, "https://accounts.example.test/reconnect");
});

test("immediate sync summarizes imports, refreshes affected queries and clears only transient progress", async (t) => {
  const pending = deferred();
  const summary = { scannedMessages: 4, processed: 2, duplicates: 1, ignored: 1, failed: 0 };
  t.after(() => ui.act(async () => pending.resolve(summary)));
  responses.set("POST /api/gmail/sync", () => pending.promise);
  const view = show();
  await sync(view);
  await view.findByText("Starting sync...");
  assert.ok(view.getByRole("button", { name: "Syncing..." }).disabled);
  assert.ok(view.getByRole("button", { name: "Disconnect" }).disabled);
  await ui.act(async () => pending.resolve(summary));
  await view.findByText("Inbox sync complete");
  assert.match(view.container.textContent, /Imported 2 new card alerts\. Skipped 1 email already imported\. Ignored 1 unrelated email\./);
  assert.equal(statusRequests().length, 0);
  assert.deepEqual(invalidations, [["gmail-status"], ["credit-transactions"], ["dashboard-summary"]]);
  assert.equal(timeouts.size, 1);
  await clearProgress();
  assert.equal(timeouts.size, 0);
  assert.ok(view.getByText("Inbox sync complete"));
});

test("polling advances through reading and writing even while another settings tab is visible", async () => {
  responses.set("GET /api/gmail/sync", progress("reading", { message: "", progress: 12.6 }));
  const view = show();
  await sync(view);
  await view.findByText("Reading card alerts…");
  assert.equal(view.getByRole("progressbar").value, 12.6);
  assert.ok(view.getByText("13%"));
  view.section("workspaces");
  responses.set("GET /api/gmail/sync", progress("writing", { message: "Saving card alerts.", progress: 104 }));
  await tick();
  view.section("automation");
  await view.findByText("Saving card alerts.");
  assert.equal(view.getByRole("progressbar").value, 100);
  assert.equal(intervals.size, 1);
  responses.set("GET /api/gmail/sync", progress("complete", { message: "Inbox sync complete.", progress: 100 }));
  await tick();
  await view.findByText("Inbox sync complete");
  assert.equal(syncRequests().filter(({ method }) => method === "POST").length, 1);
});

for (const [phase, message, expected] of [
  ["error", "Provider error.", "Provider error"],
  ["idle", "", "No Gmail sync is running"],
]) {
  test(`${phase} status stops polling without refreshing financial data`, async () => {
    responses.set("GET /api/gmail/sync", progress(phase, { message }));
    const view = show();
    await sync(view);
    await view.findByText(expected);
    assert.equal(intervals.size, 0);
    assert.equal(invalidations.length, 0);
    assert.ok(!view.queryByRole("status", { name: "Gmail inbox sync progress" }));
    await clearProgress();
    assert.ok(view.getByText(expected));
  });
}

test("transient status failures retry without submitting another sync", async () => {
  responses.set("GET /api/gmail/sync", new Error("Service temporarily unavailable"));
  const view = show();
  await sync(view);
  await ui.waitFor(() => assert.equal(statusRequests().length, 1));
  assert.equal(intervals.size, 1);
  assert.ok(view.getByRole("status", { name: "Gmail inbox sync progress" }));
  responses.set("GET /api/gmail/sync", progress("complete", { message: "Inbox is up to date." }));
  await tick();
  await view.findByText("Inbox is up to date");
  assert.equal(statusRequests().length, 2);
  assert.equal(syncRequests().filter(({ method }) => method === "POST").length, 1);
});

for (const [failure, expected] of [
  [new Error("Please reconnect Gmail."), "Please reconnect Gmail"],
  ["offline", "Gmail sync failed"],
]) {
  test(`sync submission failure ${expected} is visible and retryable`, async () => {
    responses.set("POST /api/gmail/sync", () => { throw failure; });
    const view = show();
    await sync(view);
    await view.findByText(expected);
    assert.equal(intervals.size, 0);
    assert.equal(statusRequests().length, 0);
    assert.equal(invalidations.length, 0);
    assert.ok(view.getByRole("alert"));
    const button = failure instanceof Error ? "Reconnect Gmail" : "Sync Inbox";
    assert.ok(!view.getByRole("button", { name: button }).disabled);
  });
}

test("a queued authorization error code exposes reconnect even before status details arrive", async (t) => {
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve(progress("error", { errorCode: "GMAIL_RECONNECT_REQUIRED", message: "Authorization expired." }))));
  responses.set("POST /api/gmail/sync", { queued: true, message: "Waiting for authorization.", errorCode: "GMAIL_RECONNECT_REQUIRED" });
  responses.set("GET /api/gmail/sync", () => pending.promise);
  const view = show();
  await sync(view);
  await view.findByRole("button", { name: "Reconnect Gmail" });
  assert.ok(view.getByText("Waiting for authorization."));
  await ui.act(async () => pending.resolve(progress("error", { errorCode: "GMAIL_RECONNECT_REQUIRED", message: "Authorization expired." })));
  await view.findByText("Authorization expired");
  assert.equal(intervals.size, 0);
});

test("disconnect confirmation can be cancelled and includes account, workspace, and reversal details", async () => {
  confirmResult = false;
  const view = show();
  ui.fireEvent.click(await view.findByRole("button", { name: "Disconnect" }));
  await ui.waitFor(() => assert.equal(confirmations.length, 1));
  assert.deepEqual(confirmations[0].workspace, { name: "Household", role: "OWNER" });
  assert.deepEqual(confirmations[0].details, [
    { label: "Google account", value: "owner@example.test" },
    { label: "Existing transactions", value: "Kept in Nest" },
    { label: "Future inbox sync", value: "Stopped" },
  ]);
  assert.equal(confirmations[0].destructive, true);
  assert.match(confirmations[0].reversal, /reconnect Gmail later/);
  assert.equal(requests.filter(({ url }) => url === "/api/gmail/disconnect").length, 0);
});

test("disconnect clears polling, ignores late progress and refreshes connection status", async (t) => {
  const pendingStatus = deferred(), pendingDisconnect = deferred();
  t.after(() => ui.act(async () => { pendingStatus.resolve(progress("complete")); pendingDisconnect.resolve({ ok: true }); }));
  responses.set("GET /api/gmail/sync", () => pendingStatus.promise);
  responses.set("POST /api/gmail/disconnect", () => pendingDisconnect.promise);
  const view = show();
  await sync(view);
  await ui.waitFor(() => assert.equal(intervals.size, 1));
  ui.fireEvent.click(view.getByRole("button", { name: "Disconnect" }));
  await ui.waitFor(() => assert.ok(view.getByRole("button", { name: "Disconnect" }).disabled));
  assert.ok(view.getByRole("button", { name: "Syncing..." }).disabled);
  responses.set("GET /api/gmail/status", { connected: false, requiresReconnect: false, integration: null });
  await ui.act(async () => pendingDisconnect.resolve({ ok: true }));
  await view.findByText("Gmail disconnected");
  await view.findByRole("button", { name: "Connect Gmail" });
  assert.equal(intervals.size, 0);
  assert.equal(timeouts.size, 0);
  await ui.act(async () => pendingStatus.resolve(progress("complete", { message: "Inbox sync complete." })));
  assert.ok(view.getByText("Gmail disconnected"));
  assert.deepEqual(invalidations, [["gmail-status"]]);
});

for (const [failure, expected] of [
  [new Error("Recent authentication required"), "Re-authentication required"],
  ["offline", "Failed to disconnect Gmail"],
]) {
  test(`disconnect failure ${expected} retains the connection for retry`, async () => {
    responses.set("POST /api/gmail/disconnect", () => { throw failure; });
    const view = show();
    ui.fireEvent.click(await view.findByRole("button", { name: "Disconnect" }));
    await view.findByText(expected);
    assert.ok(view.getByText("owner@example.test"));
    assert.ok(!view.getByRole("button", { name: "Disconnect" }).disabled);
    assert.equal(invalidations.length, 0);
  });
}

test("disconnect confirmation uses safe defaults while workspace and account metadata are absent", async () => {
  confirmResult = false;
  const client = createClient();
  const hook = ui.renderHook(() => useGmailSettings({ workspaceId: null }), {
    wrapper: ({ children }) => ui.h(QueryClientProvider, { client }, children),
  });
  await ui.act(async () => hook.result.current.confirmDisconnectGmail());
  assert.deepEqual(confirmations[0].workspace, { name: "Current workspace", role: "OWNER" });
  assert.equal(confirmations[0].details[0].value, "Connected account");
  assert.equal(requests.length, 0);
});

for (const role of ["EDITOR", "VIEWER", undefined]) {
  test(`${role ?? "unknown"} workspace access does not expose owner Gmail controls or load Gmail metadata`, async () => {
    responses.set("GET /api/context", { workspaceId: "household", role, workspaces: [] });
    const view = show();
    await ui.waitFor(() => assert.equal(view.client.getQueryState(["app-context", "household"]).status, "success"));
    assert.ok(!view.queryByText("Gmail Card Alerts"));
    assert.equal(requests.filter(({ url }) => url.startsWith("/api/gmail/")).length, 0);
  });
}

test("terminal cleanup timers are removed when settings unmounts", async () => {
  responses.set("GET /api/gmail/sync", progress("complete"));
  const view = show();
  await sync(view);
  await view.findByText("Sync complete");
  assert.equal(timeouts.size, 1);
  view.unmount();
  assert.equal(timeouts.size, 0);
  assert.equal(intervals.size, 0);
});
