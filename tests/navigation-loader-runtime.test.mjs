import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, act } = ui;
let route;
mock.module("next/navigation", { namedExports: {
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
} });
const require = createRequire(import.meta.url);
const { NavigationLoader } = require("../components/navigation-loader.tsx");
const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
let clock;
let timerId;
const timers = new Map();
const performanceCalls = [];
const events = [];
function preventNavigation(event) { event.preventDefault(); }
function recordPerformance(event) { events.push(event.detail); }
beforeEach((t) => {
  route = { pathname: "/w/home", search: "" };
  ui.window.history.replaceState(null, "", "/w/home");
  clock = 0;
  timerId = 0;
  timers.clear();
  events.length = 0;
  performanceCalls.length = 0;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: {
    now: () => clock,
    clearMarks: (...args) => { performanceCalls.push(["clearMarks", ...args]); },
    mark: (...args) => { performanceCalls.push(["mark", ...args]); },
    measure: (...args) => { performanceCalls.push(["measure", ...args]); },
  } });
  for (const method of ["setTimeout", "setInterval"]) {
    t.mock.method(ui.window, method, (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay, repeating: method === "setInterval" });
      return id;
    });
  }
  for (const method of ["clearTimeout", "clearInterval"]) {
    t.mock.method(ui.window, method, (id) => timers.delete(id));
  }
  document.addEventListener("click", preventNavigation, true);
  ui.window.addEventListener("nest:route-performance", recordPerformance);
});
afterEach(async (t) => {
  ui.cleanup();
  document.removeEventListener("click", preventNavigation, true);
  ui.window.removeEventListener("nest:route-performance", recordPerformance);
  document.querySelectorAll("a[data-fixture]").forEach((anchor) => anchor.remove());
  t.mock.restoreAll();
  Object.defineProperty(globalThis, "performance", performanceDescriptor);
  await ui.window.happyDOM.abort();
});
after(() => ui.dispose());
function tick(delay) {
  clock += delay;
  act(() => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay !== delay) continue;
      if (!timer.repeating) timers.delete(id);
      timer.callback();
    }
  });
}
function link(href, attributes = {}) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.dataset.fixture = "true";
  for (const [key, value] of Object.entries(attributes)) anchor.setAttribute(key, value);
  const label = document.createElement("span");
  label.textContent = "Destination";
  anchor.append(label);
  document.body.append(anchor);
  return label;
}
function changeRoute(view, pathname, search = "") {
  route = { pathname, search };
  ui.window.history.replaceState(null, "", `${pathname}?${search}`);
  view.rerender(h(NavigationLoader));
}

test("navigation beginning at time zero reports one transition, progresses, completes, and hides", () => {
  const view = render(h(NavigationLoader));
  assert.ok(!view.queryByRole("progressbar"));
  const destination = link("/w/home/transactions");
  fireEvent.click(destination);
  let progress = view.getByRole("progressbar", { name: "Loading page" });
  assert.equal(progress.tagName, "PROGRESS");
  assert.equal(progress.value, 18);
  assert.equal(progress.getAttribute("aria-busy"), "true");
  fireEvent.click(destination);
  assert.equal(performanceCalls.filter(([method]) => method === "mark").length, 1);
  assert.equal(timers.size, 2);
  tick(180);
  assert.equal(progress.value, 30);
  assert.equal(view.container.querySelector(".navigation-loader-bar").style.opacity, "1");
  for (let i = 0; i < 60; i += 1) tick(180);
  assert.equal(progress.value, 92);
  changeRoute(view, "/w/home/transactions");
  progress = view.getByRole("progressbar");
  assert.equal(progress.value, 100);
  assert.equal(view.container.querySelector(".navigation-loader-bar").style.opacity, "0");
  assert.equal(events.length, 1);
  assert.equal(events[0].route, "/w/home/transactions");
  assert.equal(events[0].durationMs, clock);
  assert.deepEqual(performanceCalls.find(([method, name]) => method === "measure" && name === "nest-route-transition"), ["measure", "nest-route-transition", "nest-route-start", "nest-route-end"]);
  tick(180);
  assert.equal(view.queryByRole("progressbar"), null);
  assert.equal(timers.size, 0);
});

test("navigation ignores modifiers, downloads, external links, same routes, and non-link targets", () => {
  const view = render(h(NavigationLoader));
  const next = link("/w/home/settings");
  for (const option of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) fireEvent.click(next, option);
  fireEvent.click(link("/w/home/download", { download: "export.csv" }));
  fireEvent.click(link("/w/home/other", { target: "_blank" }));
  fireEvent.click(link("https://example.com/page"));
  fireEvent.click(link("/w/home#section"));
  fireEvent.click(document.body);
  fireEvent.click(document);
  assert.equal(view.queryByRole("progressbar"), null);
  assert.equal(timers.size, 0);
  changeRoute(view, "/w/home/budgets");
  assert.equal(events.length, 0);
  fireEvent.click(link("/w/home/budgets?year=2027", { target: "_self" }));
  assert.equal(view.getByRole("progressbar").value, 18);
  changeRoute(view, "/w/home/budgets", "year=2027");
  assert.equal(events.length, 1);
});

test("stalled navigation clears itself, can restart, and releases all timers and listeners on unmount", () => {
  const view = render(h(NavigationLoader));
  fireEvent.popState(ui.window);
  assert.equal(view.getByRole("progressbar").value, 18);
  tick(15_000);
  assert.equal(view.queryByRole("progressbar"), null);
  assert.equal(timers.size, 0);
  fireEvent.popState(ui.window);
  changeRoute(view, "/w/home/rewards");
  assert.equal(view.getByRole("progressbar").value, 100);
  fireEvent.click(link("/w/home/cio"));
  assert.equal(view.getByRole("progressbar").value, 18);
  assert.equal(timers.size, 2);
  view.unmount();
  assert.equal(timers.size, 0);
  fireEvent.popState(ui.window);
  fireEvent.click(link("/w/home/settings"));
  assert.equal(timers.size, 0);
});

test("unmounting idle and completing loaders clears pending state without emitting another transition", () => {
  const idle = render(h(NavigationLoader));
  idle.unmount();
  const view = render(h(NavigationLoader));
  clock = 100;
  fireEvent.popState(ui.window);
  changeRoute(view, "/w/home/receivables");
  assert.equal(timers.size, 1);
  view.unmount();
  assert.equal(timers.size, 0);
  assert.equal(events.length, 1);
});
