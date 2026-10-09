import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, beforeEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

export async function createCioDialogHarness() {
  const ui = await createReactHarness();
  const require = createRequire(import.meta.url);
  const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
  const { ConfirmDialogProvider } = require("../components/confirm-dialog.tsx");
  const { setPrivacyMode } = require("../lib/privacy-mode.ts");
  const fixtures = new Map();
  const requests = [];
  const events = [];
  let client;
  beforeEach((t) => {
    fixtures.clear();
    requests.length = 0;
    events.length = 0;
    ui.window.history.replaceState(null, "", "/w/household/cio");
    setPrivacyMode(false);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
    t.mock.method(globalThis, "fetch", async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3100");
      const method = init.method ?? "GET";
      const request = { url, method, body: init.body && JSON.parse(init.body), headers: new Headers(init.headers) };
      requests.push(request);
      const key = method === "GET" ? url.pathname : `${method} ${url.pathname}`;
      assert.ok(fixtures.has(key), `Missing request fixture: ${key}`);
      const fixture = fixtures.get(key);
      return typeof fixture === "function" ? fixture(request) : Response.json(fixture);
    });
  });
  afterEach(async () => { ui.cleanup(); client.clear(); await ui.window.happyDOM.abort(); });
  after(() => ui.dispose());
  const element = (Component, props = {}) => ui.h(QueryClientProvider, { client }, ui.h(ConfirmDialogProvider, null, ui.h(Component, {
    open: true, workspaceId: "household", currency: "SGD", onClose: () => events.push("close"), onSaved: () => events.push("saved"), ...props,
  })));
  return {
    ui, require, fixtures, requests, events,
    client: () => client,
    element,
    show: (Component, props) => ui.render(element(Component, props)),
    fill: (view, name, value) => ui.fireEvent.change(view.getByLabelText(name), { target: { value } }),
    writes: () => requests.filter(({ method }) => method !== "GET"),
  };
}
