import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, within } = ui;
const require = createRequire(import.meta.url);
const { ToastProvider, useToast, notifyToast } = require("../components/toast-provider.tsx");
const { SettingsAppIcon } = require("../components/settings-app-icon.tsx");
const { AskNestFab, Nestling } = require("../components/ask-nest-mascot.tsx");

beforeEach(() => {
  ui.window.happyDOM.setURL("http://localhost:3100");
  document.cookie = "nest-app-icon=; Max-Age=0; Path=/";
  document.head.innerHTML = "";
});
afterEach(() => ui.cleanup());
after(() => ui.dispose());

test("toast messages announce their tone, dismiss independently, and expire at the appropriate time", (t) => {
  const timers = [];
  t.mock.method(ui.window, "setTimeout", (callback, delay) => { timers.push({ callback, delay }); return timers.length; });
  let toast;
  function Actions() { toast = useToast(); return h("p", null, "Application"); }
  const view = render(h(ToastProvider, null, h(Actions)));
  ui.act(() => {
    toast.success("Saved changes");
    toast.error("Save failed");
    toast.info("Sync started");
    toast.notify("Default notification");
  });
  assert.equal(view.getAllByRole("status").length, 3);
  const error = view.getByRole("alert");
  assert.equal(error.tagName, "OUTPUT");
  assert.ok(error.classList.contains("toast-error"));
  assert.ok(within(error).getByText("Save failed"));
  assert.deepEqual(timers.map(({ delay }) => delay), [3500, 6000, 3500, 3500]);
  const saved = view.getByText("Saved changes").closest("output");
  assert.ok(saved.classList.contains("toast-success"));
  fireEvent.click(within(saved).getByRole("button", { name: "Dismiss notification" }));
  assert.equal(view.queryByText("Saved changes"), null);
  assert.ok(view.getByRole("alert"));
  ui.act(() => timers[2].callback());
  assert.equal(view.queryByText("Sync started"), null);
  ui.act(() => timers[1].callback());
  assert.equal(view.queryByRole("alert"), null);
  ui.act(() => timers[3].callback());
  assert.equal(view.queryByRole("status"), null);
});

test("external toast notifications keep the newest four messages and unregister on unmount", (t) => {
  const timer = t.mock.method(ui.window, "setTimeout", () => 1);
  notifyToast("No subscriber");
  assert.equal(timer.mock.callCount(), 0);
  const view = render(h(ToastProvider, null, h("p", null, "Application")));
  ui.act(() => {
    for (let index = 0; index < 5; index += 1) notifyToast(`Message ${index}`);
  });
  assert.equal(view.queryByText("Message 0"), null);
  assert.equal(view.getAllByRole("status").length, 4);
  ui.act(() => notifyToast("External error", "error"));
  assert.ok(within(view.getByRole("alert")).getByText("External error"));
  view.unmount();
  const before = timer.mock.callCount();
  notifyToast("After unmount");
  assert.equal(timer.mock.callCount(), before);
});

test("toast hooks explain a missing provider", (t) => {
  t.mock.method(console, "error", () => {});
  function Orphan() { useToast(); return null; }
  assert.throws(() => render(h(Orphan)), /useToast must be used within ToastProvider/);
});

test("the minimized assistant announces each mood and retains independent reopen and dismiss actions", () => {
  const actions = [];
  const ref = { current: null };
  const props = { ref, mood: "idle", status: "Ready to help", onOpen: () => actions.push("open"), onDismiss: () => actions.push("dismiss") };
  const view = render(h(AskNestFab, props));
  assert.equal(view.getByRole("status").tagName, "OUTPUT");
  assert.equal(ref.current, view.getByRole("button", { name: "Reopen Ask Nest. Ready to help" }));
  for (const mood of ["idle", "thinking", "news", "drafting"]) {
    view.rerender(h(AskNestFab, { ...props, mood, status: `${mood} message` }));
    assert.equal(view.getByRole("status").textContent, `${mood} message`);
    assert.ok(view.container.querySelector(`.nestling.is-${mood}[aria-hidden="true"]`));
    assert.equal(Boolean(view.container.querySelector(".ask-nest-fab-badge")), mood === "news" || mood === "drafting");
    fireEvent.click(view.getByRole("button", { name: `Reopen Ask Nest. ${mood} message` }));
    fireEvent.click(view.getByRole("button", { name: "Hide Ask Nest launcher" }));
  }
  assert.deepEqual(actions, Array.from({ length: 4 }, () => ["open", "dismiss"]).flat());
  view.rerender(h(Nestling));
  assert.equal(view.container.querySelector("svg").getAttribute("width"), "44");
  assert.ok(view.container.querySelector(".nestling.is-idle"));
});

for (const [name, userAgent, touchPoints, standalone, guidance] of [
  ["desktop browser", "Mozilla Chrome", 0, false, "The browser tab updates now"],
  ["installed app", "Mozilla Chrome", 0, true, "Your installed app picks up the new icon"],
  ["iPhone", "Mozilla iPhone", 1, false, "Your home screen keeps the icon"],
  ["touch Mac", "Mozilla Macintosh", 5, false, "Your home screen keeps the icon"],
  ["desktop Mac", "Mozilla Macintosh", 0, false, "The browser tab updates now"],
]) {
  test(`icon settings explain how ${name} applies the selected icon`, (t) => {
    t.mock.getter(ui.window.navigator, "userAgent", () => userAgent);
    t.mock.getter(ui.window.navigator, "maxTouchPoints", () => touchPoints);
    t.mock.method(ui.window, "matchMedia", () => ({ matches: standalone }));
    const view = render(h(SettingsAppIcon));
    assert.match(view.getByRole("status").textContent, new RegExp(guidance));
    assert.equal(view.getByRole("status").tagName, "OUTPUT");
    assert.equal(view.getByRole("radio", { name: /Forest/ }).getAttribute("aria-checked"), "true");
    assert.equal(view.queryByText("Saved for this device."), null);
  });
}

test("icon selection persists per device and replaces stale favicons and home-screen icon references", (t) => {
  t.mock.method(ui.window, "matchMedia", () => ({ matches: false }));
  document.cookie = "unrelated=setting; Path=/";
  document.cookie = "nest-app-icon=cream; Path=/";
  document.head.innerHTML = '<link rel="icon" href="/old.svg"><link rel="shortcut icon" href="/shortcut.ico"><link rel="apple-touch-icon" href="/old.png">';
  const view = render(h(SettingsAppIcon));
  assert.equal(view.getByRole("radio", { name: /Cream/ }).getAttribute("aria-checked"), "true");
  for (const [name, id, favicon, apple] of [
    ["Midnight", "midnight", "/icons/midnight/favicon.svg", "/icons/midnight/apple-touch-icon.png"],
    ["Sunrise", "sunrise", "/icons/sunrise/favicon.svg", "/icons/sunrise/apple-touch-icon.png"],
    ["Forest", "classic", "/favicon.svg", "/icons/apple-touch-icon.png"],
  ]) {
    fireEvent.click(view.getByRole("radio", { name: new RegExp(name) }));
    assert.ok(document.cookie.includes(`nest-app-icon=${id}`));
    assert.ok(document.cookie.includes("unrelated=setting"));
    assert.equal(document.querySelectorAll('link[rel="icon"]').length, 1);
    assert.equal(document.querySelector('link[rel="shortcut icon"]'), null);
    assert.equal(document.querySelector('link[rel="icon"]').getAttribute("href"), favicon);
    assert.equal(document.querySelector('link[rel="apple-touch-icon"]').getAttribute("href"), apple);
    assert.equal(view.getByRole("radio", { name: new RegExp(name) }).getAttribute("aria-checked"), "true");
    assert.match(view.getByRole("status").textContent, /Saved for this device/);
  }
  ui.window.happyDOM.setURL("https://localhost:3100");
  const cookies = [];
  t.mock.setter(document, "cookie", (value) => cookies.push(value));
  fireEvent.click(view.getByRole("radio", { name: /Cream/ }));
  assert.deepEqual(cookies, ["nest-app-icon=cream; Path=/; Max-Age=31536000; SameSite=Lax; Secure"]);
});
