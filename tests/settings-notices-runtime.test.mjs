import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, waitFor } = ui;
const require = createRequire(import.meta.url);
const signouts = [];
let signOut = async () => {};
mock.module("next-auth/react", { namedExports: { signOut: async (options) => { signouts.push(options); return signOut(); } } });
const { SettingsOperationNotice } = require("../components/settings/operation-notice.tsx");
const { ActionableAuthenticationMessage, ReauthenticateButton } = require("../components/reauthentication-message.tsx");
afterEach(() => { ui.cleanup(); signouts.length = 0; });
after(() => ui.dispose());

test("settings notices use native status output, announce errors, and preserve optional detail and actions", () => {
  const view = render(h(SettingsOperationNotice, { notice: null }));
  assert.equal(view.container.textContent, "");
  for (const tone of ["success", "info", "warning", "error"]) {
    view.rerender(h(SettingsOperationNotice, { notice: { title: "Operation result", detail: "More information", tone }, className: "custom", requiresReauthentication: true }));
    const message = view.getByRole(tone === "error" ? "alert" : "status");
    assert.equal(message.tagName, "OUTPUT");
    assert.ok(message.classList.contains(`is-${tone}`));
    assert.ok(message.classList.contains("custom"));
    assert.equal(message.getAttribute("aria-live"), "polite");
    assert.ok(view.getByText("More information"));
    assert.ok(view.getByRole("button", { name: "Re-authenticate" }));
  }
  view.rerender(h(SettingsOperationNotice, { notice: { title: "Saved", detail: null, tone: "success" } }));
  assert.equal(view.queryByText("More information"), null);
  assert.equal(view.queryByRole("button"), null);
});

test("authentication messages offer a retryable sign-in action and retain the exact return destination", async () => {
  ui.window.history.replaceState(null, "", "/w/home/settings?tab=access#passkeys");
  const view = render(h(ActionableAuthenticationMessage, { message: null, className: "notice" }));
  assert.equal(view.container.textContent, "");
  view.rerender(h(ActionableAuthenticationMessage, { message: "Ordinary update", className: "notice" }));
  assert.equal(view.getByRole("status").textContent, "Ordinary update");
  view.rerender(h(ActionableAuthenticationMessage, { message: "Try again", className: "notice", role: "alert" }));
  assert.equal(view.getByRole("alert").textContent, "Try again");
  view.rerender(h(ActionableAuthenticationMessage, { message: "Recent authentication required", className: "notice" }));
  assert.ok(view.getByRole("alert").classList.contains("reauthentication-message"));
  let reject;
  signOut = () => new Promise((resolve, rejectPromise) => { reject = rejectPromise; });
  fireEvent.click(view.getByRole("button", { name: "Re-authenticate" }));
  assert.equal(view.getByRole("button", { name: "Redirecting…" }).disabled, true);
  assert.deepEqual(signouts[0], { callbackUrl: "/login?callbackUrl=%2Fw%2Fhome%2Fsettings%3Ftab%3Daccess%23passkeys" });
  await ui.act(async () => reject(new Error("Sign out unavailable")));
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Re-authenticate" }).disabled, false));
  view.unmount();
  signOut = async () => {};
  const standalone = render(h(ReauthenticateButton, { className: "custom-button" }));
  assert.ok(standalone.getByRole("button").classList.contains("custom-button"));
  await ui.act(async () => fireEvent.click(standalone.getByRole("button")));
  assert.equal(standalone.getByRole("button", { name: "Redirecting…" }).disabled, true);
});
