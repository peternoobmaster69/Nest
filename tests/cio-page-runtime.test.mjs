import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createCioUiHarness, deferred, overviewFixture } from "./cio-ui-harness.mjs";

const harness = await createCioUiHarness();
const { ui, require, fixtures, requests, show } = harness;
const { h, fireEvent, within, waitFor } = ui;
const { CioPage } = require("../components/cio-page.tsx");
let session;
mock.module("../lib/require-session.ts", { namedExports: { requireSession: async () => { if (session instanceof Error) throw session; return session; } } });
mock.module("../components/page-frame.tsx", { namedExports: { PageFrame: ({ title, children }) => h("main", { "aria-label": title }, children) } });
const { default: CioRoute } = require("../app/cio/page.tsx");
const { default: Loading } = require("../app/cio/loading.tsx");
const { default: PageError } = require("../app/cio/error.tsx");
const { default: WorkspacePageError } = require("../app/w/[workspaceId]/cio/error.tsx");

test("the CIO page loads the workspace then opens and closes each setup section without persisting cancelled edits", async () => {
  const pending = deferred();
  fixtures.set("GET /api/cio/overview", () => pending.promise);
  const view = show(CioPage);
  assert.equal(view.getByLabelText("Loading Nest CIO overview").getAttribute("aria-busy"), "true");
  assert.equal(view.container.querySelectorAll(".cio-skeleton-metric").length, 5);
  await ui.act(async () => pending.resolve(Response.json({ overview: overviewFixture() })));
  const configure = await view.findByTitle("Configure CIO inputs");
  fireEvent.click(configure);
  let setup = await view.findByRole("dialog", { name: "Set up Nest CIO" });
  assert.ok(within(setup).getByText("Recommended setup"));
  fireEvent.click(within(setup).getByRole("button", { name: "Close Set up Nest CIO" }));
  assert.ok(!view.queryByRole("dialog"));
  for (const [option, title, close] of [
    ["Planning profile", "CIO planning profile", "Cancel"],
    ["Explain your investments", "Describe an investment account", "Cancel"],
    ["Add recurring money", "Recurring planning flows", "Close"],
    ["Set personal guardrails", "Investment policy", "Cancel"],
    ["Add other assets or debts", "Planning assets and debts", "Close"],
  ]) {
    fireEvent.click(configure);
    setup = await view.findByRole("dialog", { name: "Set up Nest CIO" });
    fireEvent.click(within(setup).getByRole("button", { name: new RegExp(option) }));
    const editor = await view.findByRole("dialog", { name: title });
    assert.ok(!view.queryByRole("dialog", { name: "Set up Nest CIO" }));
    fireEvent.click(within(editor).getByRole("button", { name: close, exact: true }));
    await waitFor(() => assert.ok(!view.queryByRole("dialog")));
  }
  fireEvent.click(view.getByRole("button", { name: "Manage flows" }));
  assert.ok(view.getByRole("dialog", { name: "Recurring planning flows" }));
  assert.ok(requests.every((request) => request.method === "GET" && request.headers.get("x-workspace-id") === "household"));
});

test("viewers can read the CIO page but section shortcuts do not open editing dialogs", async () => {
  fixtures.set("GET /api/context", { workspaceId: "household", role: "VIEWER" });
  const view = show(CioPage);
  await view.findByText("You have view-only access. An owner or editor can update CIO assumptions.");
  for (const name of ["Edit policy", "Complete profile", "Manage flows"]) fireEvent.click(view.getByRole("button", { name }));
  assert.ok(!view.queryByRole("dialog"));
  assert.equal(view.getByRole("button", { name: "Generate report" }).disabled, true);
  assert.ok(requests.every((request) => request.method === "GET"));
});

for (const [label, fixture, message] of [
  ["API error", () => Response.json({ error: "Snapshot temporarily unavailable" }, { status: 503 }), "Snapshot temporarily unavailable"],
  ["non-error failure", () => { throw "Offline"; }, "The overview could not be loaded."],
  ["missing overview", { overview: null }, "The overview could not be loaded."],
]) {
  test(`the page can retry after an ${label} without fabricating portfolio values`, async () => {
    fixtures.set("GET /api/cio/overview", fixture);
    const view = show(CioPage);
    await view.findByRole("heading", { name: "Nest CIO is unavailable" });
    assert.ok(view.getByText(message));
    assert.ok(!view.queryByRole("region", { name: "CIO portfolio metrics" }));
    fixtures.set("GET /api/cio/overview", { overview: overviewFixture() });
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await view.findByRole("region", { name: "CIO portfolio metrics" });
    assert.ok(!view.queryByRole("alert"));
    assert.equal(requests.filter((request) => request.url.pathname === "/api/cio/overview").length, 2);
  });
}

test("the CIO route uses the authenticated profile and preserves absent identity fields", async () => {
  for (const [user, expected] of [
    [{ name: "Peter", email: "peter@example.test", image: "https://example.test/avatar.png" }, { userName: "Peter", userEmail: "peter@example.test", userImage: "https://example.test/avatar.png" }],
    [{ name: "", email: "peter@example.test", image: "" }, { userName: "peter@example.test", userEmail: "peter@example.test", userImage: null }],
    [{ name: "", email: "" }, { userName: "User", userEmail: undefined, userImage: null }],
    [undefined, { userName: "User", userEmail: undefined, userImage: null }],
  ]) {
    session = { user };
    const route = await CioRoute();
    const { children, ...props } = route.props;
    assert.deepEqual(props, { title: "Nest CIO", current: "/cio", ...expected });
    assert.equal(children.type, CioPage);
  }
  session = new Error("Sign-in required");
  await assert.rejects(CioRoute(), (error) => error === session);
});

test("route loading and error states remain accessible and retry the failed route", () => {
  const loading = ui.render(h(Loading));
  assert.ok(loading.getByRole("main", { name: "Nest CIO" }));
  assert.equal(loading.getByLabelText("Loading Nest CIO").getAttribute("aria-busy"), "true");
  assert.equal(loading.container.querySelectorAll(".cio-skeleton-metric").length, 5);
  loading.unmount();
  assert.equal(WorkspacePageError, PageError);
  let retries = 0;
  const view = ui.render(h(WorkspacePageError, { reset: () => { retries += 1; } }));
  assert.ok(view.getByRole("alert"));
  assert.ok(view.getByRole("heading", { name: "Nest CIO could not be loaded" }));
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  assert.equal(retries, 1);
  assert.equal(view.getByRole("link", { name: "Open Settings" }).getAttribute("href"), "/settings");
});
