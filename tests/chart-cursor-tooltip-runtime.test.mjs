import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { ChartCursorTooltip, useChartCursorTooltip } = require("../components/chart-cursor-tooltip.tsx");
afterEach(() => ui.cleanup());
after(() => ui.dispose());

test("chart tooltips translate pointer coordinates and switch sides at the configured container edge", () => {
  const ref = { current: { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400 }) } };
  const hook = ui.renderHook(({ padding }) => useChartCursorTooltip(ref, padding), { initialProps: { padding: undefined } });
  assert.equal(hook.result.current.item, null);
  assert.equal(hook.result.current.position, null);
  ui.act(() => hook.result.current.showAtPointer({ clientX: 320, clientY: 80 }, { id: "boundary" }));
  assert.deepEqual(hook.result.current.position, { x: 220, y: 30, side: "right" });
  assert.deepEqual(hook.result.current.item, { id: "boundary" });
  ui.act(() => hook.result.current.showAtPointer({ clientX: 321, clientY: 95 }, "right-edge"));
  assert.deepEqual(hook.result.current.position, { x: 221, y: 45, side: "left" });
  hook.rerender({ padding: 20 });
  ui.act(() => hook.result.current.showAtLocalPoint(350, 80, "local"));
  assert.deepEqual(hook.result.current.position, { x: 350, y: 80, side: "right" });
  assert.equal(hook.result.current.item, "local");
  ui.act(() => hook.result.current.showAtLocalPoint(390, 90, "local-edge"));
  assert.deepEqual(hook.result.current.position, { x: 390, y: 90, side: "left" });
  ui.act(() => hook.result.current.clear());
  assert.equal(hook.result.current.item, null);
  assert.equal(hook.result.current.position, null);
});

test("tooltip updates tolerate an unmounted container without inventing a position", () => {
  const ref = { current: null };
  const hook = ui.renderHook(() => useChartCursorTooltip(ref));
  ui.act(() => hook.result.current.showAtLocalPoint(20, 30, "not-mounted"));
  assert.equal(hook.result.current.item, null);
  ui.act(() => hook.result.current.showAtPointer({ clientX: 20, clientY: 30 }, "pending-item"));
  assert.equal(hook.result.current.item, "pending-item");
  assert.equal(hook.result.current.position, null);
});

test("tooltip markup preserves positioning, custom classes, content and polite announcements", () => {
  const view = ui.render(ui.h(ChartCursorTooltip, { position: { x: 12.5, y: -8, side: "left" } }, "Income $100"));
  const tooltip = view.getByText("Income $100");
  assert.equal(tooltip.className, "chart-cursor-tooltip left");
  assert.equal(tooltip.style.left, "12.5px");
  assert.equal(tooltip.style.top, "-8px");
  assert.equal(tooltip.getAttribute("aria-live"), "polite");
  view.rerender(ui.h(ChartCursorTooltip, { position: { x: 2, y: 3, side: "right" }, className: "income-detail" }, "Updated income"));
  assert.equal(view.getByText("Updated income").className, "chart-cursor-tooltip right income-detail");
});
