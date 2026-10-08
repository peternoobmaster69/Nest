import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, within, waitFor, act } = ui;
const require = createRequire(import.meta.url);
const calls = [];
let registrationReply;
mock.module(require.resolve("@simplewebauthn/browser"), { namedExports: {
  startRegistration: async (options) => { calls.push({ action: "register-passkey", options }); return registrationReply(); },
} });
mock.module("next-auth/react", { namedExports: {
  signIn: async (...args) => { calls.push({ action: "signin", args }); },
  signOut: async (...args) => { calls.push({ action: "signout", args }); },
} });
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { renderToString } = require("react-dom/server");
const { SettingsAppAccess } = require("../components/settings-app-access.tsx");
const { rememberInstallPrompt, clearInstallPrompt, getInstallPrompt } = require("../lib/install-prompt.ts");
const { getBrowserPushSubscription, preparePushSubscription } = require("../lib/browser-notifications.ts");
let client;
let fixtures;
let permission;
let standalone;
let currentRegistration;
let currentSubscription;
let registration;
let subscription;
const deferredWork = [];
function property(t, target, name, value, remove = false) {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (remove) delete target[name];
  else Object.defineProperty(target, name, { value, configurable: true, writable: true });
  t.after(() => { if (descriptor) Object.defineProperty(target, name, descriptor); else delete target[name]; });
}
const key = { id: "key-1", name: "Laptop", deviceType: "singleDevice", backedUp: false, createdAt: "2026-10-01T00:00:00Z", lastUsedAt: null };
const session = { sessionId: "session-1", provider: "google", deviceName: "Work laptop", ipAddress: "192.0.2.12", countryCode: "SG", signedInAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-08T00:00:00Z", current: false };
const pushConfiguration = { configured: true, publicKey: "_-4", subscribed: false, subscriptions: [] };
const notificationDevice = { id: "push-1", provider: "Browser device", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z" };
beforeEach((t) => {
  clearInstallPrompt();
  ui.window.localStorage.clear();
  ui.window.history.replaceState(null, "", "/w/home/settings");
  calls.length = 0;
  deferredWork.length = 0;
  permission = "granted";
  standalone = false;
  registrationReply = async () => ({ id: "credential-response" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  property(t, ui.window, "PublicKeyCredential", class {});
  property(t, ui.window, "PushManager", class {});
  const notifications = { requestPermission: async () => { calls.push({ action: "permission" }); return permission; } };
  property(t, globalThis, "Notification", notifications);
  property(t, ui.window, "Notification", notifications);
  t.mock.method(ui.window, "matchMedia", () => ({ matches: standalone }));
  property(t, navigator, "userAgent", "Windows test browser");
  property(t, navigator, "maxTouchPoints", 0);
  property(t, navigator, "standalone", false);
  subscription = {
    endpoint: "https://push.example.test/device-1",
    toJSON: () => ({ endpoint: "https://push.example.test/device-1", keys: { p256dh: "test-public-key", auth: "test-auth-key" } }),
    unsubscribe: async () => { calls.push({ action: "unsubscribe" }); return true; },
  };
  currentSubscription = null;
  registration = { pushManager: {
    getSubscription: async () => { calls.push({ action: "get-subscription" }); return currentSubscription; },
    subscribe: async (options) => { calls.push({ action: "subscribe", options }); currentSubscription = subscription; return subscription; },
  } };
  currentRegistration = registration;
  property(t, navigator, "serviceWorker", {
    getRegistration: async (scope) => { calls.push({ action: "get-registration", scope }); return currentRegistration; },
    register: async (url) => { calls.push({ action: "register-worker", url }); return registration; },
  });
  fixtures = new Map([
    ["GET /api/passkeys", Response.json({ passkeys: [] })],
    ["GET /api/push-subscriptions", Response.json(pushConfiguration)],
    ["GET /api/auth/providers", Response.json({ google: { id: "google", name: "Google", type: "oauth" }, github: { id: "github", name: "GitHub", type: "oauth" }, passkey: { id: "passkey", name: "Passkey", type: "credentials" } })],
    ["GET /api/auth/accounts", Response.json({ providers: ["github"] })],
    ["GET /api/auth/sessions", Response.json({ sessions: [] })],
    ["POST /api/passkeys/register/options", Response.json({ challengeId: "challenge-1", options: { challenge: "options-1" } })],
    ["POST /api/passkeys/register/verify", Response.json({ ok: true })],
    ["PATCH /api/passkeys", Response.json({ ok: true })],
    ["DELETE /api/passkeys", Response.json({ ok: true })],
    ["DELETE /api/auth/sessions", Response.json({ revoked: true, current: false })],
    ["POST /api/push-subscriptions", Response.json({ ok: true })],
    ["DELETE /api/push-subscriptions", Response.json({ ok: true })],
  ]);
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ action: "request", url, ...init, method });
    const fixture = fixtures.get(`${method} ${url}`);
    assert.ok(fixture, `Unexpected request ${method} ${url}`);
    return typeof fixture === "function" ? fixture() : fixture.clone();
  });
});
afterEach(async () => {
  for (const complete of deferredWork) complete(Response.json({}));
  ui.cleanup();
  client.clear();
  clearInstallPrompt();
  await ui.window.happyDOM.abort();
});
after(() => ui.dispose());
const show = () => render(h(QueryClientProvider, { client }, h(SettingsAppAccess)));
const requests = (url, method) => calls.filter((call) => call.action === "request" && call.url === url && call.method === method);
function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  deferredWork.push(resolve);
  return { promise, resolve };
}
async function loaded(view) { await view.findByText("No active sessions were found."); }
function prompt(outcome) {
  return { prompt: async () => { calls.push({ action: "install" }); }, userChoice: Promise.resolve({ outcome }) };
}

test("settings render on the server and load empty device lists and linked provider choices", async () => {
  const markup = renderToString(h(QueryClientProvider, { client }, h(SettingsAppAccess)));
  assert.match(markup, /Loading passkeys/);
  const view = show();
  assert.ok(view.getByText("Loading active sessions..."));
  await loaded(view);
  assert.ok(view.getByText("No passkeys added yet."));
  assert.equal(view.getByRole("button", { name: "Install", exact: true }).disabled, true);
  assert.equal(view.getByRole("button", { name: "Add Passkey" }).disabled, false);
  assert.equal(view.getByRole("button", { name: "Enable", exact: true }).disabled, false);
  const linked = view.getByText("GitHub").closest(".crud-row");
  assert.ok(within(linked).getByText("Linked"));
  const google = view.getByText("Google").closest(".crud-row");
  fireEvent.click(within(google).getByRole("button", { name: "Link account" }));
  assert.deepEqual(calls.find((call) => call.action === "signin").args, ["google", { callbackUrl: "/settings" }]);
  assert.equal(view.getAllByRole("button", { name: "Link account" }).length, 1);
});

for (const [label, options, expected] of [
  ["iPhone Safari", { userAgent: "iPhone" }, "In Safari, use Share, then Add to Home Screen."],
  ["iPad desktop mode", { userAgent: "Macintosh", touches: 2 }, "In Safari, use Share, then Add to Home Screen."],
  ["Mac desktop", { userAgent: "Macintosh", touches: 0 }, "Your browser will enable installation when the app is eligible."],
  ["installed display mode", { standalone: true }, "Nest is installed on this device."],
  ["installed iOS app", { nativeStandalone: true }, "Nest is installed on this device."],
]) {
  test(`installation guidance reflects ${label}`, async (t) => {
    standalone = Boolean(options.standalone);
    property(t, navigator, "userAgent", options.userAgent ?? "Windows");
    property(t, navigator, "maxTouchPoints", options.touches ?? 0);
    property(t, navigator, "standalone", Boolean(options.nativeStandalone));
    const view = show();
    await loaded(view);
    assert.ok(view.getByText(expected));
    if (expected.startsWith("In Safari")) assert.ok(view.getByText("Browser menu"));
    if (expected.startsWith("Nest is installed")) assert.ok(view.getByText("Installed"));
  });
}

for (const outcome of ["accepted", "dismissed"]) {
  test(`the install prompt handles a ${outcome} choice and leaves a clear result`, async () => {
    const choice = deferred();
    rememberInstallPrompt({ ...prompt(outcome), userChoice: choice.promise });
    const view = show();
    await loaded(view);
    assert.ok(view.getByText("Install Nest for faster access from your home screen."));
    fireEvent.click(view.getByRole("button", { name: "Install", exact: true }));
    assert.equal((await view.findByRole("button", { name: "Installing..." })).disabled, true);
    await act(async () => choice.resolve({ outcome }));
    await view.findByText(outcome === "accepted" ? "Nest was installed." : "Installation was cancelled.");
    assert.equal(getInstallPrompt() === null, outcome === "accepted");
    assert.equal(calls.filter((call) => call.action === "install").length, 1);
  });
}

test("an expired install prompt reports browser-menu guidance and remains recoverable", async () => {
  rememberInstallPrompt(prompt("accepted"));
  const view = show();
  await loaded(view);
  act(() => {
    fireEvent.click(view.getByRole("button", { name: "Install", exact: true }));
    clearInstallPrompt();
  });
  await view.findByText("Use your browser menu to install Nest on this device.");
  act(() => rememberInstallPrompt(prompt("accepted")));
  fireEvent.click(view.getByRole("button", { name: "Install", exact: true }));
  await view.findByText("Nest was installed.");
  assert.equal(getInstallPrompt(), null);
});

for (const error of [new Error("Browser refused installation"), "refused"]) {
  test(`installation failures expose ${error instanceof Error ? "the browser error" : "a fallback message"}`, async () => {
    rememberInstallPrompt({ ...prompt("accepted"), prompt: async () => { throw error; } });
    const view = show();
    await loaded(view);
    fireEvent.click(view.getByRole("button", { name: "Install", exact: true }));
    await view.findByText(error instanceof Error ? error.message : "Nest could not be installed.");
    assert.equal(view.getByRole("button", { name: "Install", exact: true }).disabled, false);
  });
}

test("unavailable capabilities disable device actions while failed lists retain readable errors", async (t) => {
  property(t, ui.window, "PublicKeyCredential", undefined, true);
  property(t, ui.window, "Notification", undefined, true);
  fixtures.set("GET /api/passkeys", new Response("invalid JSON", { status: 503 }));
  fixtures.set("GET /api/auth/sessions", Response.json({ error: "Unavailable" }, { status: 503 }));
  fixtures.set("GET /api/auth/providers", Response.json({}));
  fixtures.set("GET /api/push-subscriptions", Response.json({ ...pushConfiguration, configured: false }));
  const view = show();
  await view.findByText("Passkeys could not be loaded.");
  await view.findByText("Active sessions could not be loaded.");
  await view.findByText("No OAuth providers are configured for this deployment.");
  assert.equal(view.getByRole("button", { name: "Add Passkey" }).disabled, true);
  assert.equal(view.getByRole("button", { name: "Enable", exact: true }).disabled, true);
  assert.ok(view.getByText("Notification delivery has not been configured for this deployment."));
  assert.ok(!view.queryByText("No passkeys added yet."));
  assert.ok(!view.queryByText("No active sessions were found."));
});

for (const [endpoint, message] of [["/api/auth/accounts", "Linked accounts could not be loaded."], ["/api/auth/providers", "Sign-in providers could not be loaded."]]) {
  test(`${endpoint} failures explain why linked-account information is unavailable`, async () => {
    fixtures.set(`GET ${endpoint}`, Response.json({ error: "Unavailable" }, { status: 503 }));
    const view = show();
    await view.findByText(message);
    assert.ok(!view.queryByText("No OAuth providers are configured for this deployment."));
    assert.ok(!view.queryByText("Linked", { exact: true }));
  });
}

test("passkeys can be named, cancelled, added, renamed, and removed with mutation-specific controls", async () => {
  fixtures.set("GET /api/passkeys", Response.json({ passkeys: [key, { ...key, id: "key-2", name: null, backedUp: true, lastUsedAt: "2026-10-06" }, { ...key, id: "key-3", name: "Synced", deviceType: "multiDevice" }] }));
  const view = show();
  await loaded(view);
  assert.ok(view.getByText(/^Device-bound passkey · Added/));
  assert.ok(view.getByText(/^Synced passkey · Added .* · Last used/));
  fireEvent.click(view.getByRole("button", { name: "Rename passkey", exact: true }));
  assert.ok(view.getByRole("textbox", { name: "Name for passkey" }).value);
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Rename Laptop" }));
  fireEvent.click(view.getByRole("button", { name: "Add Passkey" }));
  assert.ok(!view.queryByRole("textbox", { name: "Name for Laptop" }));
  const name = view.getByRole("textbox", { name: "Passkey name" });
  assert.ok(name.value);
  assert.equal(name.maxLength, 80);
  fireEvent.change(name, { target: { value: "  " } });
  fireEvent.submit(name.closest("form"));
  assert.equal(view.getByRole("button", { name: "Continue" }).disabled, true);
  assert.equal(requests("/api/passkeys/register/options", "POST").length, 0);
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  fireEvent.click(view.getByRole("button", { name: "Add Passkey" }));
  fireEvent.change(view.getByRole("textbox", { name: "Passkey name" }), { target: { value: "  New security key  " } });
  const verify = deferred();
  fixtures.set("POST /api/passkeys/register/verify", () => verify.promise);
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  assert.equal((await view.findByRole("button", { name: "Adding..." })).disabled, true);
  assert.equal(view.getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  await waitFor(() => assert.equal(requests("/api/passkeys/register/verify", "POST").length, 1));
  assert.deepEqual(JSON.parse(requests("/api/passkeys/register/verify", "POST")[0].body), { challengeId: "challenge-1", name: "New security key", response: { id: "credential-response" } });
  assert.deepEqual(calls.find((call) => call.action === "register-passkey").options, { optionsJSON: { challenge: "options-1" } });
  await act(async () => verify.resolve(Response.json({ ok: true })));
  await view.findByText("Passkey added. You can now use it to sign in.");
  assert.ok(!view.queryByRole("textbox", { name: "Passkey name" }));
  fireEvent.click(view.getByRole("button", { name: "Rename Laptop" }));
  const edit = view.getByRole("textbox", { name: "Name for Laptop" });
  fireEvent.change(edit, { target: { value: " " } });
  fireEvent.submit(edit.closest("form"));
  assert.equal(view.getByRole("button", { name: "Save", exact: true }).disabled, true);
  fireEvent.change(edit, { target: { value: "  Personal laptop  " } });
  const rename = deferred();
  fixtures.set("PATCH /api/passkeys", () => rename.promise);
  fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
  assert.equal((await view.findByRole("button", { name: "Saving..." })).disabled, true);
  assert.equal(view.getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  assert.deepEqual(JSON.parse(requests("/api/passkeys", "PATCH")[0].body), { id: key.id, name: "Personal laptop" });
  await act(async () => rename.resolve(Response.json({ ok: true })));
  await view.findByText("Passkey name updated.");
  const remove = deferred();
  fixtures.set("DELETE /api/passkeys", () => remove.promise);
  fireEvent.click(view.getByRole("button", { name: "Remove Laptop" }));
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Remove Laptop" }).disabled, true));
  assert.equal(view.getByRole("button", { name: "Rename Laptop" }).disabled, true);
  assert.deepEqual(JSON.parse(requests("/api/passkeys", "DELETE")[0].body), { id: key.id });
  await act(async () => remove.resolve(Response.json({ ok: true })));
  await view.findByText("Passkey removed.");
});

test("session details retain provider and location fallbacks and revoking the current device signs out", async (t) => {
  const original = Intl.DisplayNames.prototype.of;
  t.mock.method(Intl.DisplayNames.prototype, "of", function (code) { return code === "ZZ" ? undefined : original.call(this, code); });
  fixtures.set("GET /api/auth/sessions", Response.json({ sessions: [
    session,
    { ...session, sessionId: "2", deviceName: "Phone", provider: "passkey", countryCode: null, ipAddress: null, current: true },
    { ...session, sessionId: "3", deviceName: "Unknown device", provider: null, countryCode: "invalid-code" },
    { ...session, sessionId: "4", deviceName: "Region fallback", countryCode: "ZZ" },
  ] }));
  const view = show();
  await view.findByText("Work laptop");
  assert.ok(view.getByText("Singapore · 192.0.2.12"));
  assert.ok(view.getByText("Country unavailable · IP unavailable"));
  assert.ok(view.getByText("invalid-code · 192.0.2.12"));
  assert.ok(view.getByText("ZZ · 192.0.2.12"));
  assert.ok(view.getByText(/^Passkey · Last active/));
  assert.ok(view.getByText(/^Sign-in provider unavailable · Last active/));
  const revoke = deferred();
  fixtures.set("DELETE /api/auth/sessions", () => revoke.promise);
  fireEvent.click(within(view.getByText("Work laptop").closest(".settings-passkey-item")).getByRole("button", { name: "Sign out" }));
  assert.equal((await view.findByRole("button", { name: "Signing out..." })).disabled, true);
  assert.ok(view.getAllByRole("button", { name: "Sign out", exact: true }).every((button) => button.disabled));
  assert.deepEqual(JSON.parse(requests("/api/auth/sessions", "DELETE")[0].body), { sessionId: session.sessionId });
  await act(async () => revoke.resolve(Response.json({ revoked: true, current: false })));
  await view.findByText("Work laptop was signed out.");
  fixtures.set("DELETE /api/auth/sessions", Response.json({ revoked: true, current: true }));
  fireEvent.click(within(view.getByText("Phone").closest(".settings-passkey-item")).getByRole("button", { name: "Sign out" }));
  await waitFor(() => assert.ok(calls.some((call) => call.action === "signout")));
  assert.deepEqual(calls.find((call) => call.action === "signout").args, [{ callbackUrl: "/" }]);
});

test("notification setup persists the browser subscription and disable waits for server deletion before unsubscribing", async () => {
  currentRegistration = undefined;
  const view = show();
  await loaded(view);
  const enable = deferred();
  fixtures.set("POST /api/push-subscriptions", () => enable.promise);
  fireEvent.click(view.getByRole("button", { name: "Enable", exact: true }));
  assert.equal((await view.findByRole("button", { name: "Enabling..." })).disabled, true);
  await waitFor(() => assert.equal(requests("/api/push-subscriptions", "POST").length, 1));
  assert.deepEqual(JSON.parse(requests("/api/push-subscriptions", "POST")[0].body), subscription.toJSON());
  const subscribe = calls.find((call) => call.action === "subscribe");
  assert.equal(subscribe.options.userVisibleOnly, true);
  assert.deepEqual([...subscribe.options.applicationServerKey], [255, 238]);
  assert.ok(calls.some((call) => call.action === "register-worker" && call.url === "/sw.js"));
  currentRegistration = registration;
  fixtures.set("GET /api/push-subscriptions", Response.json({ ...pushConfiguration, subscribed: true }));
  await act(async () => enable.resolve(Response.json({ ok: true })));
  await view.findByText("Notifications enabled.");
  const disable = deferred();
  fixtures.set("DELETE /api/push-subscriptions", () => disable.promise);
  fireEvent.click(await view.findByRole("button", { name: "Disable", exact: true }));
  assert.equal((await view.findByRole("button", { name: "Disabling..." })).disabled, true);
  await waitFor(() => assert.equal(requests("/api/push-subscriptions", "DELETE").length, 1));
  assert.deepEqual(JSON.parse(requests("/api/push-subscriptions", "DELETE")[0].body), { endpoint: subscription.endpoint });
  assert.ok(!calls.some((call) => call.action === "unsubscribe"));
  fixtures.set("GET /api/push-subscriptions", Response.json(pushConfiguration));
  await act(async () => disable.resolve(Response.json({ ok: true })));
  await view.findByText("Notifications disabled.");
  assert.equal(calls.filter((call) => call.action === "unsubscribe").length, 1);
});

test("revoking an older notification device only removes the selected subscription", async () => {
  fixtures.set("GET /api/push-subscriptions", Response.json({ ...pushConfiguration, subscriptions: [notificationDevice, { ...notificationDevice, id: "push-2", provider: "Another browser" }] }));
  const view = show();
  await loaded(view);
  const revoke = deferred();
  fixtures.set("DELETE /api/push-subscriptions", () => revoke.promise);
  fireEvent.click(within(view.getByText("Browser device").closest(".settings-passkey-item")).getByRole("button", { name: "Revoke" }));
  assert.equal((await view.findByRole("button", { name: "Revoking..." })).disabled, true);
  assert.equal(view.getByRole("button", { name: "Revoke", exact: true }).disabled, true);
  assert.deepEqual(JSON.parse(requests("/api/push-subscriptions", "DELETE")[0].body), { subscriptionId: notificationDevice.id });
  await act(async () => revoke.resolve(Response.json({ ok: true })));
  await view.findByText("Notification device revoked.");
  assert.ok(!calls.some((call) => call.action === "unsubscribe"));
});

for (const [operation, endpoint, fallback] of [
  ["add", "POST /api/passkeys/register/options", "Passkey could not be added."],
  ["rename", "PATCH /api/passkeys", "Passkey name could not be updated."],
  ["remove", "DELETE /api/passkeys", "Passkey could not be removed."],
  ["session", "DELETE /api/auth/sessions", "The device could not be signed out."],
  ["revoke", "DELETE /api/push-subscriptions", "The notification device could not be revoked."],
  ["enable", "POST /api/push-subscriptions", "Notifications could not be enabled."],
  ["disable", "DELETE /api/push-subscriptions", "Notifications could not be disabled."],
]) {
  for (const error of [new Error("Please try again"), "offline"]) {
    test(`${operation} failures remain visible for ${error instanceof Error ? "server errors" : "non-error rejections"}`, async () => {
      fixtures.set("GET /api/passkeys", Response.json({ passkeys: [key] }));
      fixtures.set("GET /api/auth/sessions", Response.json({ sessions: [session] }));
      fixtures.set("GET /api/push-subscriptions", Response.json({ ...pushConfiguration, subscribed: operation === "disable", subscriptions: [notificationDevice] }));
      fixtures.set(endpoint, async () => { throw error; });
      currentSubscription = subscription;
      const view = show();
      await view.findByText("Work laptop");
      if (operation === "add") {
        fireEvent.click(view.getByRole("button", { name: "Add Passkey" }));
        fireEvent.click(view.getByRole("button", { name: "Continue" }));
      } else if (operation === "rename") {
        fireEvent.click(view.getByRole("button", { name: "Rename Laptop" }));
        fireEvent.click(view.getByRole("button", { name: "Save", exact: true }));
      } else {
        const labels = { remove: "Remove Laptop", session: "Sign out", revoke: "Revoke", enable: "Enable", disable: "Disable" };
        fireEvent.click(view.getByRole("button", { name: labels[operation], exact: true }));
      }
      await view.findByText(error instanceof Error ? error.message : fallback);
      assert.ok(!calls.some((call) => call.action === "unsubscribe"));
      assert.equal(view.getByRole("button", { name: "Add Passkey" }).disabled, operation === "add");
    });
  }
}

test("push helpers validate configuration and permission before contacting the service worker", async () => {
  for (const configuration of [undefined, { ...pushConfiguration, configured: false }, { ...pushConfiguration, publicKey: "" }]) {
    await assert.rejects(preparePushSubscription(configuration, true), /not configured/);
  }
  await assert.rejects(preparePushSubscription(pushConfiguration, false), /does not support/);
  assert.equal(calls.length, 0);
  for (const denied of ["denied", "default"]) {
    permission = denied;
    await assert.rejects(preparePushSubscription(pushConfiguration, true), /permission was not granted/);
  }
  assert.ok(!calls.some((call) => call.action === "get-registration"));
  permission = "granted";
  currentSubscription = subscription;
  assert.equal(await preparePushSubscription(pushConfiguration, true), subscription);
  assert.ok(!calls.some((call) => call.action === "subscribe"));
  assert.equal(await getBrowserPushSubscription(), subscription);
  currentSubscription = null;
  await assert.rejects(getBrowserPushSubscription(), /not enabled in this browser/);
  currentRegistration = undefined;
  await assert.rejects(getBrowserPushSubscription(), /not enabled in this browser/);
});
