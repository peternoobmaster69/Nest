import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, cleanup } = ui;
afterEach(cleanup);
after(() => ui.dispose());
const require = createRequire(import.meta.url);
const { Button } = require("../components/ui/button.tsx");
const { TextField, SelectField, TextAreaField } = require("../components/ui/form-field.tsx");
const { PageHeader } = require("../components/ui/page-header.tsx");
const { EmptyState, QueryError } = require("../components/ui/query-state.tsx");
const { DataView, MobileDataCard, DataValue } = require("../components/ui/data-view.tsx");
const { RouteLoadingState, RouteErrorState, RouteNotFoundState } = require("../components/ui/route-state.tsx");
const { ModalCloseButton } = require("../components/ui/modal-close-button.tsx");
const { ContributionTrendIndicator } = require("../components/investment-contribution-trend.tsx");

test("buttons preserve action semantics and block clicks while loading or disabled", () => {
  let clicks = 0;
  const view = render(h(Button, { onClick: () => { clicks += 1; } }, "Save"));
  let button = view.getByRole("button", { name: "Save" });
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-busy"), null);
  fireEvent.click(button);
  assert.equal(clicks, 1);
  view.rerender(h(Button, { loading: true, variant: "primary", iconOnly: true, size: "sm", onClick: () => { clicks += 1; } }, "Save"));
  button = view.getByRole("button");
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.ok(button.classList.contains("btn-icon"));
  assert.ok(button.classList.contains("btn-primary"));
  fireEvent.click(button);
  assert.equal(clicks, 1);
  view.rerender(h(Button, { disabled: true, type: "submit", className: "custom" }, "Save"));
  assert.equal(view.getByRole("button").type, "submit");
  assert.equal(view.getByRole("button").className, "custom");
});

for (const [name, Field, role, children] of [
  ["text", TextField, "textbox", null],
  ["select", SelectField, "combobox", h("option", { value: "SGD" }, "SGD")],
  ["textarea", TextAreaField, "textbox", null],
]) {
  test(`${name} fields connect labels, hints, required states, and validation errors`, () => {
    const view = render(h(Field, { label: "Amount", hint: "In cents", required: true }, children));
    let field = view.getByRole(role, { name: "Amount" });
    assert.ok(field.id);
    assert.equal(field.required, true);
    assert.equal(field.getAttribute("aria-describedby"), `${field.id}-hint`);
    assert.equal(view.getByText("In cents").id, `${field.id}-hint`);
    view.rerender(h(Field, { label: "Amount", id: `${name}-amount`, hint: "In cents", error: "Required", className: "custom" }, children));
    field = view.getByRole(role, { name: "Amount" });
    assert.equal(field.id, `${name}-amount`);
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.equal(field.getAttribute("aria-describedby"), `${field.id}-error`);
    assert.equal(view.getByRole("alert").textContent, "Required");
    assert.equal(view.queryByText("In cents"), null);
    assert.ok(field.classList.contains("custom"));
    view.rerender(h(Field, { label: "Amount" }, children));
    assert.equal(view.getByRole(role).getAttribute("aria-describedby"), null);
    assert.equal(view.queryByRole("alert"), null);
  });
}

test("page headers expose optional context, actions, and filters only when supplied", () => {
  const view = render(h(PageHeader, { title: "Transactions" }));
  assert.equal(view.getByRole("heading", { level: 1 }).textContent, "Transactions");
  assert.equal(view.container.querySelector(".page-header-actions"), null);
  view.rerender(h(PageHeader, { title: "Transactions", eyebrow: "Workspace", description: "Current month", actions: h(Button, null, "Add"), filters: h("span", null, "October") }));
  assert.equal(view.getByText("Workspace").className, "page-header-eyebrow");
  assert.equal(view.getByText("October").parentElement.className, "page-header-filters");
  assert.ok(view.getByRole("button", { name: "Add" }));
});

test("query errors offer retry when available and empty states render the given action", () => {
  let retries = 0;
  const view = render(h(QueryError, {}));
  assert.match(view.getByRole("alert").textContent, /Something went wrong/);
  assert.equal(view.queryByRole("button"), null);
  view.rerender(h(QueryError, { title: "Unavailable", message: "Retry safely", onRetry: () => { retries += 1; } }));
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  assert.equal(retries, 1);
  assert.ok(view.getByText("Retry safely"));
  view.rerender(h(EmptyState, { title: "No accounts" }));
  assert.ok(view.getByRole("heading", { name: "No accounts" }));
  view.rerender(h(EmptyState, { title: "No accounts", description: "Add your first", action: h(Button, null, "Create"), icon: h("span", null, "Custom icon") }));
  assert.ok(view.getByText("Custom icon"));
  assert.ok(view.getByText("Add your first"));
  assert.ok(view.getByRole("button", { name: "Create" }));
});

test("data views preserve their accessible structure and value priority", () => {
  const view = render(h(DataView, {}, h(MobileDataCard, {}, h(DataValue, { label: "Balance" }, "$10"))));
  assert.equal(view.getByRole("article").className, "mobile-data-card");
  assert.equal(view.getByText("Balance").parentElement.className, "data-value data-value-normal");
  view.rerender(h(DataView, { className: "custom", "aria-label": "Balances" }, h(MobileDataCard, { className: "important" }, h(DataValue, { label: "Balance", priority: "high" }, "$10"))));
  assert.equal(view.getByLabelText("Balances").className, "data-view custom");
  assert.equal(view.getByRole("article").className, "mobile-data-card important");
  assert.equal(view.getByText("Balance").parentElement.className, "data-value data-value-high");
});

test("route states provide retry and navigation without exposing internal errors", () => {
  let resets = 0;
  const view = render(h(RouteLoadingState));
  assert.equal(view.getByRole("main").getAttribute("aria-busy"), "true");
  view.rerender(h(RouteLoadingState, { label: "Loading accounts" }));
  assert.ok(view.getByRole("heading", { name: "Loading accounts" }));
  view.rerender(h(RouteErrorState, { reset: () => { resets += 1; } }));
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  assert.equal(resets, 1);
  assert.equal(view.getByRole("link", { name: "Open Settings" }).getAttribute("href"), "/settings");
  view.rerender(h(RouteErrorState, { reset: () => {}, title: "Custom error" }));
  assert.ok(view.getByRole("heading", { name: "Custom error" }));
  view.rerender(h(RouteNotFoundState));
  assert.equal(view.getByRole("link", { name: "Go to dashboard" }).getAttribute("href"), "/");
});

test("modal close buttons are named and respect disabled state", () => {
  let closed = 0;
  const view = render(h(ModalCloseButton, { onClick: () => { closed += 1; } }));
  fireEvent.click(view.getByRole("button"));
  assert.equal(closed, 1);
  view.rerender(h(ModalCloseButton, { label: "Close settings", disabled: true, className: "custom", onClick: () => { closed += 1; } }));
  fireEvent.click(view.getByRole("button", { name: "Close settings" }));
  assert.equal(closed, 1);
});

test("contribution trends are absent without a comparison and label both directions", () => {
  const view = render(h(ContributionTrendIndicator, { currentCents: 100, previousYear: 2025 }));
  assert.equal(view.container.textContent, "");
  view.rerender(h(ContributionTrendIndicator, { currentCents: 100, previousCents: 100, previousYear: 2025 }));
  assert.equal(view.container.textContent, "");
  view.rerender(h(ContributionTrendIndicator, { currentCents: 200, previousCents: 100, previousYear: 2025 }));
  assert.ok(view.getByRole("img", { name: "Increased from 2025" }).classList.contains("is-up"));
  view.rerender(h(ContributionTrendIndicator, { currentCents: 50, previousCents: 100, previousYear: 2025 }));
  assert.ok(view.getByRole("img", { name: "Decreased from 2025" }).classList.contains("is-down"));
});
