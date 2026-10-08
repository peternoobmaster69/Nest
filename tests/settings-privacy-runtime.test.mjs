import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, within, waitFor } = ui;
const require = createRequire(import.meta.url);
let consent;
let summary;
let response;
let clearOffline;
let signOut;
const calls = [];
mock.module("next-auth/react", { namedExports: { signOut: async (options) => { calls.push(["signout", options]); return signOut(); } } });
mock.module("next/navigation", { namedExports: { useRouter: () => ({ replace: (path) => calls.push(["replace", path]), refresh: () => calls.push(["refresh"]) }) } });
mock.module("../components/privacy-consent.tsx", { namedExports: { usePrivacyConsent: () => ({ consent, updateConsent: (value) => calls.push(["consent", value]) }) } });
mock.module("../lib/service-worker-cache.ts", { namedExports: {
  getOfflineStorageSummary: async () => summary,
  clearNestOfflineStorage: async () => { calls.push(["clear"]); await clearOffline(); },
  purgePrivateServiceWorkerCaches: async () => { calls.push(["purge"]); },
} });
mock.module("../lib/workspace-client.ts", { namedExports: { workspaceFetch: async (...args) => { calls.push(["fetch", ...args]); return response(...args); } } });
const { SettingsPrivacyControls } = require("../components/settings-privacy-controls.tsx");
beforeEach(() => {
  calls.length = 0;
  consent = null;
  summary = { supported: false, cacheCount: 0, entryCount: 0 };
  response = async () => { throw new Error("Unexpected network request"); };
  clearOffline = async () => {};
  signOut = async () => {};
});
afterEach(() => ui.cleanup());
after(() => ui.dispose());

test("privacy choices preserve each independent preference and handle browsers without offline storage", async () => {
  const view = render(h(SettingsPrivacyControls));
  await view.findByText("This browser does not expose offline cache storage.");
  assert.equal(view.getByRole("button", { name: "Clear offline files" }).disabled, true);
  const [analytics, performance] = view.getAllByRole("checkbox");
  assert.equal(analytics.checked, false);
  assert.equal(performance.checked, false);
  fireEvent.click(analytics);
  fireEvent.click(performance);
  assert.deepEqual(calls.filter(([type]) => type === "consent"), [
    ["consent", { analytics: true, performance: false }],
    ["consent", { analytics: false, performance: true }],
  ]);
  consent = { analytics: true, performance: true };
  view.rerender(h(SettingsPrivacyControls));
  fireEvent.click(view.getAllByRole("checkbox")[0]);
  fireEvent.click(view.getAllByRole("checkbox")[1]);
  assert.deepEqual(calls.slice(-2), [
    ["consent", { analytics: false, performance: true }],
    ["consent", { analytics: true, performance: false }],
  ]);
  assert.equal(calls.some(([type]) => type === "fetch"), false);
});

test("offline cleanup reports progress, refreshed counts, success, and a retryable browser failure", async () => {
  summary = { supported: true, cacheCount: 1, entryCount: 1 };
  const view = render(h(SettingsPrivacyControls));
  await view.findByText("1 static file in 1 Nest cache.");
  assert.equal(view.getByRole("status").tagName, "OUTPUT");
  let complete;
  clearOffline = () => new Promise((resolve) => { complete = resolve; });
  fireEvent.click(view.getByRole("button", { name: "Clear offline files" }));
  assert.equal(view.getByRole("button", { name: "Clearing..." }).disabled, true);
  summary = { supported: true, cacheCount: 0, entryCount: 0 };
  await ui.act(async () => complete());
  await view.findByText("0 static files in 0 Nest caches.");
  await view.findByText("Offline shell files were cleared. Private finance responses were never stored for offline use.");
  clearOffline = async () => { throw new Error("Cache access denied"); };
  fireEvent.click(view.getByRole("button", { name: "Clear offline files" }));
  await view.findByText("Offline files could not be cleared in this browser.");
  assert.equal(view.getByRole("button", { name: "Clear offline files" }).disabled, false);
  assert.deepEqual(calls, [["clear"], ["clear"]]);
});

for (const [name, disposition, expectedName] of [["provided", 'attachment; filename="my-nest.json"', "my-nest.json"], ["default", null, "nest-account-export.json"]]) {
  test(`account export downloads the ${name} filename and releases its temporary URL`, async (t) => {
    const downloads = [];
    t.mock.method(URL, "createObjectURL", (blob) => { assert.equal(blob.type, "application/json"); return "blob:fixture-export"; });
    const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
    t.mock.method(ui.window.HTMLAnchorElement.prototype, "click", function () { downloads.push({ href: this.href, name: this.download, attached: this.isConnected }); });
    let complete;
    response = () => new Promise((resolve) => { complete = resolve; });
    const view = render(h(SettingsPrivacyControls, { view: "data" }));
    fireEvent.click(view.getByRole("button", { name: "Export my data" }));
    assert.equal(view.getByRole("button", { name: "Preparing..." }).disabled, true);
    await ui.act(async () => complete(Response.json({ profile: { name: "Fixture" } }, { headers: disposition ? { "content-disposition": disposition } : {} })));
    await view.findByText("Your account export was downloaded.");
    assert.deepEqual(downloads, [{ href: "blob:fixture-export", name: expectedName, attached: true }]);
    assert.deepEqual(revoke.mock.calls[0].arguments, ["blob:fixture-export"]);
    assert.equal(document.querySelector('a[download]'), null);
    assert.deepEqual(calls, [["fetch", "/api/profile/export", { cache: "no-store" }]]);
    assert.equal(view.getByRole("button", { name: "Export my data" }).disabled, false);
  });
}

for (const [name, failure, expected] of [
  ["message", () => Response.json({ message: "Export temporarily unavailable", error: "Other" }, { status: 503 }), "Export temporarily unavailable"],
  ["error", () => Response.json({ error: "Export denied" }, { status: 403 }), "Export denied"],
  ["empty response", () => Response.json({}, { status: 500 }), "Your data could not be exported."],
  ["invalid response", () => new Response("Unavailable", { status: 502 }), "Your data could not be exported."],
  ["network exception", () => Promise.reject(new Error("Connection unavailable")), "Connection unavailable"],
  ["non-error exception", () => Promise.reject("unavailable"), "Your data could not be exported."],
]) {
  test(`export ${name} is visible and leaves the action available for retry`, async () => {
    response = failure;
    const view = render(h(SettingsPrivacyControls, { view: "data" }));
    fireEvent.click(view.getByRole("button", { name: "Export my data" }));
    await view.findByText(expected);
    assert.equal(view.getByRole("button", { name: "Export my data" }).disabled, false);
  });
}

function openDelete(view) {
  fireEvent.click(view.getByRole("button", { name: "Delete account", exact: true }));
  return within(view.getByRole("dialog", { name: "Permanently delete your account?" }));
}

test("account deletion requires the exact confirmation, clears a reopened draft, and locks the dialog during the request", async () => {
  const view = render(h(SettingsPrivacyControls, { view: "data" }));
  let dialog = openDelete(view);
  assert.equal(dialog.getByRole("button", { name: "Delete permanently" }).disabled, true);
  fireEvent.change(dialog.getByRole("textbox"), { target: { value: "delete my account" } });
  assert.equal(dialog.getByRole("button", { name: "Delete permanently" }).disabled, true);
  fireEvent.click(dialog.getByRole("button", { name: "Cancel", exact: true }));
  assert.equal(view.queryByRole("dialog"), null);
  dialog = openDelete(view);
  assert.equal(dialog.getByRole("textbox").value, "");
  fireEvent.click(dialog.getByRole("button", { name: "Close Permanently delete your account?" }));
  assert.equal(view.queryByRole("dialog"), null);
  dialog = openDelete(view);
  fireEvent.change(dialog.getByRole("textbox"), { target: { value: "DELETE MY ACCOUNT" } });
  let complete;
  response = () => new Promise((resolve) => { complete = resolve; });
  fireEvent.click(dialog.getByRole("button", { name: "Delete permanently" }));
  assert.equal(dialog.getByRole("button", { name: "Deleting..." }).disabled, true);
  assert.equal(dialog.getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(view.getByRole("dialog"));
  ui.window.localStorage.setItem("private", "value");
  ui.window.sessionStorage.setItem("private", "value");
  await ui.act(async () => complete(Response.json({ deleted: true })));
  await waitFor(() => assert.ok(calls.some(([type]) => type === "signout")));
  const [, url, init] = calls.find(([type]) => type === "fetch");
  assert.equal(url, "/api/profile");
  assert.equal(init.method, "DELETE");
  assert.deepEqual(JSON.parse(init.body), { confirmation: "DELETE MY ACCOUNT" });
  assert.deepEqual(calls.slice(-2), [["purge"], ["signout", { callbackUrl: "/" }]]);
  assert.equal(ui.window.localStorage.length, 0);
  assert.equal(ui.window.sessionStorage.length, 0);
});

test("successful deletion tolerates blocked browser storage and navigates home if sign-out redirects fail", async (t) => {
  t.mock.method(ui.window.localStorage, "clear", () => { throw new Error("Browser storage unavailable"); });
  signOut = async () => { throw new Error("Redirect unavailable"); };
  response = async () => Response.json({ deleted: true });
  const view = render(h(SettingsPrivacyControls, { view: "data" }));
  const dialog = openDelete(view);
  fireEvent.change(dialog.getByRole("textbox"), { target: { value: "DELETE MY ACCOUNT" } });
  fireEvent.click(dialog.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => assert.ok(calls.some(([type]) => type === "refresh")));
  assert.deepEqual(calls.slice(-4), [["purge"], ["signout", { callbackUrl: "/" }], ["replace", "/"], ["refresh"]]);
});

for (const [name, failure, expected] of [
  ["server rejection", () => Response.json({ error: "Transfer workspace ownership first" }, { status: 409 }), "Transfer workspace ownership first"],
  ["empty response", () => Response.json({}, { status: 500 }), "Your account could not be deleted."],
  ["non-error exception", () => Promise.reject("unavailable"), "Your account could not be deleted."],
]) {
  test(`deletion ${name} preserves the session and reports the failure outside the dialog`, async () => {
    response = failure;
    const view = render(h(SettingsPrivacyControls, { view: "data" }));
    const dialog = openDelete(view);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "DELETE MY ACCOUNT" } });
    fireEvent.click(dialog.getByRole("button", { name: "Delete permanently" }));
    await view.findByText(expected);
    assert.equal(view.queryByRole("dialog"), null);
    assert.equal(calls.some(([type]) => type === "purge" || type === "signout"), false);
    assert.equal(view.getByRole("button", { name: "Delete account", exact: true }).disabled, false);
  });
}
