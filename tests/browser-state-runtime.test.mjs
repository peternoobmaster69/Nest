import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent } = ui;
const require = createRequire(import.meta.url);
const { memo } = require("react");
const { ThemeProvider, useTheme } = require("../components/theme-provider.tsx");
const { claimAskNestFlag, releaseAskNestFlag, claimAskNestWorkspace, useAskNestState, useAskNestLauncher } = require("../components/ask-nest-store.ts");
beforeEach(() => {
  ui.window.localStorage.clear();
  ui.window.sessionStorage.clear();
  ui.window.document.head.innerHTML = '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000"><meta name="theme-color" content="#ffffff">';
  ui.window.document.documentElement.dataset.theme = "light";
});
afterEach(async () => { ui.cleanup(); await ui.window.happyDOM.abort(); });
after(() => ui.dispose());

function systemTheme(t, dark) {
  const listeners = new Set();
  const media = { matches: dark, addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) };
  t.mock.method(ui.window, "matchMedia", () => media);
  return {
    listeners,
    change: (matches) => ui.act(() => { media.matches = matches; for (const listener of listeners) listener(); }),
  };
}

function ThemeControl() {
  const { theme, toggleTheme } = useTheme();
  return h("button", { onClick: toggleTheme }, `Theme: ${theme}`);
}

test("the default theme context remains usable outside a provider", () => {
  const view = render(h(ThemeControl));
  fireEvent.click(view.getByRole("button", { name: "Theme: light" }));
  assert.ok(view.getByRole("button", { name: "Theme: light" }));
});

for (const saved of ["light", "dark"]) {
  test(`an explicit ${saved} theme takes precedence over system preferences and updates browser chrome`, (t) => {
    const system = systemTheme(t, saved !== "dark");
    ui.window.localStorage.setItem("nest-theme", saved);
    const view = render(h(ThemeProvider, null, h(ThemeControl)));
    assert.ok(view.getByRole("button", { name: `Theme: ${saved}` }));
    assert.equal(ui.window.document.documentElement.dataset.theme, saved);
    assert.equal(system.listeners.size, 0);
    const next = saved === "dark" ? "light" : "dark";
    fireEvent.click(view.getByRole("button"));
    assert.equal(ui.window.localStorage.getItem("nest-theme"), next);
    assert.equal(ui.window.document.documentElement.dataset.theme, next);
    for (const meta of ui.window.document.querySelectorAll('meta[name="theme-color"]')) assert.equal(meta.content, next === "dark" ? "#2a2723" : "#ffffff");
  });
}

test("the theme follows system changes until the user chooses a preference and removes its listener on unmount", async (t) => {
  const system = systemTheme(t, true);
  ui.window.localStorage.setItem("nest-theme", "obsolete-theme");
  const view = render(h(ThemeProvider, null, h(ThemeControl)));
  assert.ok(view.getByRole("button", { name: "Theme: dark" }));
  assert.equal(ui.window.localStorage.getItem("nest-theme"), null);
  assert.equal(system.listeners.size, 1);
  await system.change(false);
  assert.ok(view.getByRole("button", { name: "Theme: light" }));
  fireEvent.click(view.getByRole("button"));
  assert.ok(view.getByRole("button", { name: "Theme: dark" }));
  await system.change(false);
  assert.ok(view.getByRole("button", { name: "Theme: dark" }));
  view.unmount();
  assert.equal(system.listeners.size, 0);
});

test("storage denial does not prevent reading or toggling the theme", async (t) => {
  const system = systemTheme(t, false);
  t.mock.method(ui.window.localStorage, "getItem", () => { throw new Error("Storage disabled"); });
  t.mock.method(ui.window.localStorage, "setItem", () => { throw new Error("Storage disabled"); });
  const view = render(h(ThemeProvider, null, h(ThemeControl)));
  fireEvent.click(view.getByRole("button", { name: "Theme: light" }));
  assert.equal(ui.window.document.documentElement.dataset.theme, "dark");
  await system.change(false);
  assert.ok(view.getByRole("button", { name: "Theme: dark" }));
});

test("theme context identity stays stable through unrelated parent renders", (t) => {
  systemTheme(t, false);
  let renders = 0;
  const Consumer = memo(function Consumer() {
    const { theme, toggleTheme } = useTheme();
    renders += 1;
    return h("button", { onClick: toggleTheme }, `Theme: ${theme}`);
  });
  const content = () => h(ThemeProvider, null, h(Consumer));
  const view = render(content());
  const before = renders;
  view.rerender(content());
  assert.equal(renders, before);
  fireEvent.click(view.getByRole("button"));
  assert.ok(view.getByRole("button", { name: "Theme: dark" }));
  assert.equal(renders, before + 1);
});

test("history request claims can be retried and reset only on a known workspace change", () => {
  assert.equal(claimAskNestFlag("history"), true);
  assert.equal(claimAskNestFlag("history"), false);
  claimAskNestWorkspace(null);
  claimAskNestWorkspace("home");
  assert.equal(claimAskNestFlag("history"), false);
  releaseAskNestFlag("history");
  assert.equal(claimAskNestFlag("history"), true);
  claimAskNestWorkspace("home");
  assert.equal(claimAskNestFlag("history"), false);
  claimAskNestWorkspace("travel");
  assert.equal(claimAskNestFlag("history"), true);
});

test("conversation state survives remounts, not workspace changes, while launcher pinning stays tab-local", (t) => {
  ui.window.sessionStorage.setItem("nest:ask-nest:launcher", "true");
  claimAskNestWorkspace("state-first");
  function StateControl({ name, initial = 0 }) {
    const [value, setValue] = useAskNestState("counter", initial);
    const [pinned, setPinned] = useAskNestLauncher();
    return h("section", { "aria-label": name },
      h("button", { onClick: () => setValue((previous) => previous + 1) }, `${name}: ${value}`),
      h("button", { onClick: () => setValue(value) }, `${name}: keep`),
      h("button", { onClick: () => setPinned(!pinned) }, `${name}: ${pinned ? "unpin" : "pin"}`),
    );
  }
  const view = render(h("main", null, h(StateControl, { name: "one" }), h(StateControl, { name: "two" })));
  assert.ok(view.getByRole("button", { name: "one: unpin" }));
  fireEvent.click(view.getByRole("button", { name: "one: 0" }));
  assert.ok(view.getByRole("button", { name: "two: 1" }));
  fireEvent.click(view.getByRole("button", { name: "two: keep" }));
  view.rerender(h(StateControl, { name: "remounted", initial: 7 }));
  assert.ok(view.getByRole("button", { name: "remounted: 1" }));
  fireEvent.click(view.getByRole("button", { name: "remounted: unpin" }));
  assert.equal(ui.window.sessionStorage.getItem("nest:ask-nest:launcher"), null);
  claimAskNestWorkspace("state-second");
  view.rerender(h(StateControl, { name: "new-workspace", initial: 3 }));
  assert.ok(view.getByRole("button", { name: "new-workspace: 3" }));
  fireEvent.click(view.getByRole("button", { name: "new-workspace: pin" }));
  assert.equal(ui.window.sessionStorage.getItem("nest:ask-nest:launcher"), "true");
  t.mock.method(ui.window.sessionStorage, "removeItem", () => { throw new Error("Storage denied"); });
  t.mock.method(ui.window.sessionStorage, "setItem", () => { throw new Error("Storage denied"); });
  fireEvent.click(view.getByRole("button", { name: "new-workspace: unpin" }));
  assert.ok(view.getByRole("button", { name: "new-workspace: pin" }));
  fireEvent.click(view.getByRole("button", { name: "new-workspace: pin" }));
  assert.ok(view.getByRole("button", { name: "new-workspace: unpin" }));
});

test("launcher initialization tolerates blocked session storage after a reload", (t) => {
  delete require.cache[require.resolve("../components/ask-nest-store.ts")];
  const freshStore = require("../components/ask-nest-store.ts");
  t.mock.method(ui.window.sessionStorage, "getItem", () => { throw new Error("Storage denied"); });
  function Launcher() {
    const [pinned, setPinned] = freshStore.useAskNestLauncher();
    return h("button", { onClick: () => setPinned(true) }, pinned ? "Pinned" : "Pin");
  }
  const view = render(h(Launcher));
  fireEvent.click(view.getByRole("button", { name: "Pin", exact: true }));
  assert.ok(view.getByRole("button", { name: "Pinned" }));
});
