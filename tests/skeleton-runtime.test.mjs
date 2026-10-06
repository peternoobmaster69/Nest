import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test, { after, afterEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, cleanup } = ui;
afterEach(cleanup);
after(() => ui.dispose());
const require = createRequire(import.meta.url);
const { Skeleton } = require("../components/ui/Skeleton.tsx");
const { AppShellSkeleton, EmptyState, LoadingDots, SidebarSkeleton } = require("../components/ui-skeleton.tsx");

test("skeleton dimensions remain stable and decorative content is hidden from assistive technology", () => {
  const view = render(h(Skeleton));
  const placeholder = view.container.firstElementChild;
  assert.equal(placeholder.getAttribute("aria-hidden"), "true");
  assert.equal(placeholder.className, "skeleton");
  view.rerender(h(Skeleton, { width: 120, height: "2rem", borderRadius: "8px", className: "account-placeholder" }));
  assert.equal(placeholder.style.width, "120px");
  assert.equal(placeholder.style.height, "2rem");
  assert.equal(placeholder.style.borderRadius, "8px");
  assert.ok(placeholder.classList.contains("account-placeholder"));
});

for (const filename of readdirSync(new URL("../components/skeletons/", import.meta.url)).filter((file) => file.endsWith(".tsx"))) {
  const components = require(`../components/skeletons/${filename}`);
  for (const [name, Component] of Object.entries(components)) {
    test(`${name} renders placeholders without exposing active form controls`, () => {
      const view = render(h(Component));
      assert.ok(view.container.querySelectorAll(".skeleton").length > 0);
      for (const span of view.container.querySelectorAll("span.skeleton")) {
        assert.equal(span.getAttribute("aria-hidden"), "true");
      }
      for (const control of view.container.querySelectorAll("button, input, select, textarea")) {
        assert.equal(control.disabled, true, `${name} must not allow actions on loading data`);
      }
      assert.equal(view.container.querySelectorAll("a[href], [contenteditable=true]").length, 0);
    });
  }
}

test("hotel reward placeholders reflect hotel cards without enabling actions", () => {
  const { RewardsCardGridSkeleton } = require("../components/skeletons/RewardsSkeleton.tsx");
  const view = render(h(RewardsCardGridSkeleton, { variant: "hotel" }));
  assert.equal(view.container.querySelectorAll(".rewards-item-card").length, 2);
  assert.equal(view.container.querySelectorAll("button:not(:disabled)").length, 0);
});

test("shell loading state communicates progress and keeps navigation inactive", () => {
  const view = render(h(AppShellSkeleton));
  assert.equal(view.container.firstElementChild.getAttribute("aria-busy"), "true");
  assert.equal(view.container.firstElementChild.getAttribute("aria-live"), "polite");
  assert.ok(view.getByText("Loading"));
  assert.equal(view.queryAllByRole("link").length, 0);
  view.rerender(h(AppShellSkeleton, { title: "Accounts" }));
  assert.ok(view.getByText("Accounts"));
  view.rerender(h(SidebarSkeleton));
  assert.ok(view.getByText("Money"));
  assert.ok(view.getByText("Workspace"));
  assert.equal(view.queryAllByRole("button").length, 0);
});

test("empty states preserve an actionable recovery path and loading dots accept presentation classes", () => {
  let clicks = 0;
  const view = render(h(EmptyState, { icon: "💰", title: "No transactions" }));
  assert.ok(view.getByRole("heading", { name: "No transactions" }));
  assert.equal(view.queryByRole("button"), null);
  view.rerender(h(EmptyState, {
    icon: "💰", title: "No transactions", description: "Start with your first expense",
    action: h("button", { onClick: () => { clicks += 1; } }, "Add expense"),
  }));
  assert.ok(view.getByText("Start with your first expense"));
  fireEvent.click(view.getByRole("button", { name: "Add expense" }));
  assert.equal(clicks, 1);
  view.rerender(h(LoadingDots));
  assert.equal(view.container.firstElementChild.children.length, 3);
  view.rerender(h(LoadingDots, { className: "inline-progress" }));
  assert.ok(view.container.firstElementChild.classList.contains("inline-progress"));
});
