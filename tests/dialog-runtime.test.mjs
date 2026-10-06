import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, cleanup, window } = ui;
const require = createRequire(import.meta.url);
const { Dialog } = require("../components/ui/dialog.tsx");
const { renderToStaticMarkup } = require("react-dom/server");
afterEach(cleanup);
after(() => ui.dispose());

test("closed and server-rendered dialogs do not render or lock scrolling", () => {
  const view = render(h(Dialog, { open: false, onClose: () => {}, title: "Closed" }, "Content"));
  assert.equal(view.queryByRole("dialog"), null);
  assert.equal(document.body.dataset.modalScrollLock, undefined);
  const original = globalThis.document;
  try {
    delete globalThis.document;
    assert.equal(renderToStaticMarkup(h(Dialog, { open: true, onClose: () => {}, title: "Server" }, "Content")), "");
  } finally {
    globalThis.document = original;
  }
});

test("dialogs name their contents, trap focus, and restore the trigger on close", () => {
  const trigger = document.createElement("button");
  trigger.textContent = "Open";
  document.body.append(trigger);
  trigger.focus();
  let closed = 0;
  const view = render(h(Dialog, { open: true, title: "Edit account", description: "Change the account name", onClose: () => { closed += 1; }, footer: h("button", null, "Save") }, h("input", { "aria-label": "Name", "data-dialog-initial-focus": true })));
  const dialog = view.getByRole("dialog", { name: "Edit account" });
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(document.getElementById(dialog.getAttribute("aria-describedby")).textContent, "Change the account name");
  assert.equal(document.activeElement, view.getByRole("textbox", { name: "Name" }));
  view.getByRole("button", { name: "Save" }).focus();
  fireEvent.keyDown(document, { key: "Tab" });
  assert.equal(document.activeElement, view.getByRole("button", { name: "Close Edit account" }));
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  assert.equal(document.activeElement, view.getByRole("button", { name: "Save" }));
  fireEvent.keyDown(document, { key: "ArrowDown" });
  fireEvent.mouseDown(dialog);
  assert.equal(closed, 0);
  fireEvent.mouseDown(dialog.parentElement);
  assert.equal(closed, 1);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(closed, 2);
  view.unmount();
  assert.equal(document.activeElement, trigger);
  trigger.remove();
});

test("disabled dismissal holds focus and the latest close callback takes effect after re-render", () => {
  let closed = 0;
  const view = render(h(Dialog, { open: true, title: "Working", onClose: () => { closed += 1; }, closeDisabled: true }));
  const dialog = view.getByRole("dialog");
  assert.equal(document.activeElement, dialog);
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.mouseDown(dialog.parentElement);
  assert.equal(closed, 0);
  fireEvent.keyDown(document, { key: "Tab" });
  assert.equal(document.activeElement, dialog);
  view.rerender(h(Dialog, { open: true, title: "Working", onClose: () => { closed += 10; } }));
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(closed, 10);
});

test("nested dialogs retain the viewport lock until the last surface closes", () => {
  const previousOverflow = document.body.style.overflow;
  document.body.style.position = "relative";
  document.documentElement.scrollTop = 32;
  const viewport = new window.EventTarget();
  Object.assign(viewport, { height: 600.5, offsetTop: 10.5 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  const first = render(h(Dialog, { open: true, title: "First", onClose: () => {} }, "One"));
  const second = render(h(Dialog, { open: true, title: "Second", onClose: () => {} }, "Two"));
  assert.equal(document.body.style.position, "fixed");
  assert.equal(document.documentElement.style.getPropertyValue("--visual-viewport-height"), "601px");
  viewport.height = 420;
  viewport.dispatchEvent(new window.Event("resize"));
  assert.equal(document.documentElement.style.getPropertyValue("--visual-viewport-height"), "420px");
  first.unmount();
  assert.equal(document.body.dataset.modalScrollLock, "true");
  second.unmount();
  assert.equal(document.body.dataset.modalScrollLock, undefined);
  assert.equal(document.body.style.position, "relative");
  assert.equal(document.body.style.overflow, previousOverflow);
  assert.equal(document.documentElement.style.getPropertyValue("--visual-viewport-height"), "");
  document.body.style.position = "";
  delete window.visualViewport;
  document.documentElement.scrollTop = 0;
});

test("custom dialog surfaces retain accessible names and support empty-content fallback", () => {
  const view = render(h(Dialog, { open: true, title: "Custom", surface: "custom", onClose: () => {} }, h("section", null, "Content")));
  assert.equal(view.getByRole("dialog", { name: "Custom" }).tagName, "SECTION");
  view.rerender(h(Dialog, { open: true, title: "Custom", surface: "custom", labelledBy: "custom-heading", onClose: () => {} }, h("section", null, h("h2", { id: "custom-heading" }, "Named surface"))));
  assert.equal(view.getByRole("dialog", { name: "Named surface" }).getAttribute("aria-label"), null);
  view.rerender(h(Dialog, { open: true, title: "Fallback", surface: "custom", onClose: () => {} }, "Plain content"));
  assert.equal(view.getByRole("dialog", { name: "Fallback" }).tagName, "DIV");
});
