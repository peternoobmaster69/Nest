import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, act } = ui;
const require = createRequire(import.meta.url);
const { LandingScrollMotion } = require("../components/landing-scroll-motion.tsx");
const frames = new Map();
const timeouts = new Map();
const observers = [];
let identifier;
let clock;
let reduced;
let position;
const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
const originalPerformance = globalThis.performance;
function define(t, target, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, value });
  t.after(() => { if (descriptor) Object.defineProperty(target, name, descriptor); else delete target[name]; });
}
beforeEach((t) => {
  frames.clear();
  timeouts.clear();
  observers.length = 0;
  identifier = 0;
  clock = 100;
  position = 0;
  reduced = false;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: new Proxy(originalPerformance, {
    get(target, key) {
      if (key === "now") return () => clock;
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) });
  t.mock.method(ui.window, "matchMedia", () => ({ matches: reduced }));
  t.mock.method(ui.window, "requestAnimationFrame", (callback) => { const id = ++identifier; frames.set(id, callback); return id; });
  t.mock.method(ui.window, "cancelAnimationFrame", (id) => frames.delete(id));
  t.mock.method(ui.window, "setTimeout", (callback, delay) => { const id = ++identifier; timeouts.set(id, { callback, delay }); return id; });
  t.mock.method(ui.window, "clearTimeout", (id) => timeouts.delete(id));
  define(t, ui.window, "innerHeight", 800);
  Object.defineProperty(ui.window, "scrollY", { configurable: true, get: () => position });
  define(t, document.documentElement, "scrollHeight", 2400);
  define(t, globalThis, "IntersectionObserver", class {
    observed = new Set();
    disconnected = false;
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe(element) { this.observed.add(element); }
    unobserve(element) { this.observed.delete(element); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
    emit(entries) { act(() => this.callback(entries)); }
  });
});
afterEach(async () => {
  ui.cleanup();
  Object.defineProperty(globalThis, "performance", performanceDescriptor);
  await ui.window.happyDOM.abort();
});
after(() => ui.dispose());
function frame(elapsed = 16) {
  clock += elapsed;
  act(() => {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(clock); }
  });
}
function root(children = []) { return render(h("main", { "data-landing": "" }, ...children)).container.firstElementChild; }
function node(tag, properties) { return h(tag, properties); }
function rect(element, top, height) { element.getBoundingClientRect = () => new ui.window.DOMRect(0, top, 800, height); }

test("landing motion leaves unrelated pages untouched and respects reduced motion before scheduling work", () => {
  const missing = render(h(LandingScrollMotion));
  assert.equal(frames.size, 0);
  assert.equal(observers.length, 0);
  missing.unmount();
  const element = root();
  reduced = true;
  const motion = render(h(LandingScrollMotion));
  assert.equal(element.dataset.motion, "off");
  assert.equal(frames.size, 0);
  assert.equal(timeouts.size, 0);
  motion.unmount();
  assert.equal(element.dataset.motion, undefined);
});

test("landing scenes update within their bounds, condense navigation, and throttle duplicate scroll frames", () => {
  const element = root([
    node("nav", { className: "lp-nav" }), node("div", { className: "lp-progress" }),
    node("section", { "data-scene": "pin", "data-steps": "3" }),
    node("section", { "data-scene": "exit" }), node("section", { "data-scene": "track" }),
  ]);
  const [pin, exit, track] = element.querySelectorAll("section");
  rect(pin, -400, 1600);
  rect(exit, -400, 800);
  rect(track, 400, 800);
  const motion = render(h(LandingScrollMotion));
  assert.equal(element.dataset.motion, "on");
  assert.equal(frames.size, 2);
  observers[1].emit([pin, exit, track].map((target) => ({ target, isIntersecting: true })));
  fireEvent.scroll(ui.window);
  fireEvent.resize(ui.window);
  assert.equal(frames.size, 2);
  frame();
  assert.equal(element.dataset.intro, "on");
  assert.equal(pin.style.getPropertyValue("--p"), "0.5");
  assert.equal(pin.dataset.active, "1");
  assert.equal(exit.style.getPropertyValue("--p"), "0.5");
  assert.equal(track.style.getPropertyValue("--p"), "0.25");
  assert.equal(element.querySelector(".lp-progress").style.getPropertyValue("--page"), "0");
  fireEvent.scroll(ui.window);
  frame();
  assert.equal(pin.dataset.active, "1");
  rect(pin, -420, 1600);
  position = 900;
  fireEvent.scroll(ui.window);
  frame();
  assert.equal(pin.dataset.active, "1");
  assert.equal(element.querySelector("nav").dataset.scrolled, "true");
  assert.equal(element.querySelector(".lp-progress").style.getPropertyValue("--page"), "0.563");
  rect(pin, -2000, 1600);
  rect(exit, 100, 800);
  rect(track, -1000, 800);
  position = 3000;
  fireEvent.resize(ui.window);
  frame();
  assert.equal(pin.style.getPropertyValue("--p"), "1");
  assert.equal(pin.dataset.active, "2");
  assert.equal(exit.style.getPropertyValue("--p"), "0");
  assert.equal(track.style.getPropertyValue("--p"), "1");
  assert.equal(element.querySelector(".lp-progress").style.getPropertyValue("--page"), "1");
  observers[1].emit([{ target: pin, isIntersecting: false }]);
  rect(pin, 0, 1600);
  position = -100;
  frame();
  assert.equal(pin.style.getPropertyValue("--p"), "1");
  assert.equal(element.querySelector("nav").dataset.scrolled, "false");
  assert.equal(element.querySelector(".lp-progress").style.getPropertyValue("--page"), "0");
  for (const timer of timeouts.values()) { assert.equal(timer.delay, 2400); timer.callback(); }
  assert.equal(element.dataset.intro, undefined);
  motion.unmount();
  assert.equal(frames.size, 0);
  assert.equal(timeouts.size, 0);
  assert.ok(observers.every((observer) => observer.disconnected));
  fireEvent.scroll(ui.window);
  fireEvent.resize(ui.window);
  assert.equal(frames.size, 0);
});

test("off-screen reveals count formatted amounts once and restore final text after unmounting mid-animation", (t) => {
  const element = root([
    h("section", { "data-reveal": "" }, h("span", { "data-count": "" }, "Always visible 99")),
    h("section", { "data-reveal": "" }, ...["SGD 2,500.50", "-25 items", "No amount", ""].map((text, index) => h("span", { key: index, "data-count": "" }, text))),
  ]);
  const [visible, hidden] = element.querySelectorAll("section");
  rect(visible, 100, 100);
  rect(hidden, 900, 100);
  const empty = hidden.lastElementChild;
  define(t, empty, "textContent", null);
  const motion = render(h(LandingScrollMotion));
  assert.equal(visible.classList.contains("is-revealed"), true);
  assert.equal(hidden.classList.contains("is-revealed"), false);
  const observer = observers[0];
  assert.equal(observer.observed.has(visible), false);
  assert.equal(observer.observed.has(hidden), true);
  observer.emit([{ target: hidden, isIntersecting: false }]);
  assert.equal(hidden.classList.contains("is-revealed"), false);
  observer.emit([{ target: hidden, isIntersecting: true }]);
  assert.equal(observer.observed.has(hidden), false);
  assert.equal(hidden.classList.contains("is-revealed"), true);
  const scheduled = frames.size;
  observer.emit([{ target: hidden, isIntersecting: true }]);
  assert.equal(frames.size, scheduled);
  frame(550);
  assert.equal(hidden.children[0].textContent, "SGD 2,187.94");
  assert.equal(hidden.children[1].textContent, "-22 items");
  assert.equal(hidden.children[2].textContent, "No amount");
  assert.equal(visible.textContent, "Always visible 99");
  motion.unmount();
  assert.equal(hidden.children[0].textContent, "SGD 2,500.50");
  assert.equal(hidden.children[1].textContent, "-25 items");
  assert.equal(frames.size, 0);
});

test("completed number animations retain their exact original suffix and deep-page hydration skips the hero intro", () => {
  position = 900;
  const element = root([h("section", { "data-reveal": "" }, h("span", { "data-count": "" }, "12 months"))]);
  const section = element.querySelector("section");
  rect(section, 1000, 100);
  const motion = render(h(LandingScrollMotion));
  observers[0].emit([{ target: section, isIntersecting: true }]);
  frame(1100);
  assert.equal(element.dataset.intro, undefined);
  assert.equal(section.textContent, "12 months");
  assert.equal(frames.size, 0);
  fireEvent.resize(ui.window);
  assert.equal(frames.size, 1);
  motion.unmount();
  assert.equal(frames.size, 0);
});
