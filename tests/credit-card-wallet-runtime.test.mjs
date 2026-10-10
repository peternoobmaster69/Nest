import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { queryKeys } = require("../lib/query-keys.ts");
const requests = [], invalidations = [], clients = [], navigation = [], confirmations = [];
let responses, routeWorkspaceId, searchParams, confirmResult;
const router = { replace: (...args) => navigation.push(args) };
mock.module("next/navigation", { namedExports: { useRouter: () => router, useSearchParams: () => searchParams } });
mock.module("../components/workspace-provider.tsx", { namedExports: { useWorkspaceId: () => routeWorkspaceId } });
mock.module("../lib/confirm-destructive.ts", { namedExports: { confirmDestructiveAction: async (...args) => { confirmations.push(args); return confirmResult; } } });
mock.module("../lib/api/client.ts", { namedExports: { apiFetch: async (url, options = {}) => {
  const request = { url, method: options.method ?? "GET", headers: options.headers, body: options.body && JSON.parse(options.body) };
  requests.push(request);
  const key = `${request.method} ${url.split("?")[0]}`;
  assert.ok(responses.has(key), `Unexpected API request: ${key}`);
  const response = responses.get(key);
  if (response instanceof Error) throw response;
  return typeof response === "function" ? response(request) : response;
} } });
const { CreditCardsPage } = require("../components/credit-cards-page.tsx");
const card = (id, extra = {}) => ({ id, cardName: id === "one" ? "Daily card" : "Travel card", bankName: "DBS Bank", last4Digit: "1234", maskedNumber: "•••• •••• •••• 1234",
  themeKey: "bank-default", expiryMonth: null, expiryYear: null, statementDay: 25, paymentDueDay: 10, notes: null, ...extra });
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (options) => { invalidations.push(options); return invalidate(options); };
  return { ...ui.render(ui.h(QueryClientProvider, { client }, ui.h(CreditCardsPage))), client };
}
function change(view, label, value) { ui.fireEvent.change(view.getByLabelText(label), { target: { value } }); }
function submit(view) { ui.fireEvent.submit(view.getByRole("dialog", { name: "Credit card" }).querySelector("form")); }
async function add(view) { ui.fireEvent.click(await view.findByRole("button", { name: "Add card", exact: true })); }
async function edit(view, name = "Daily card") {
  ui.fireEvent.click(await view.findByRole("button", { name: `Show details for ${name}, ending in 1234` }));
  ui.fireEvent.click(view.getByRole("button", { name: `Edit ${name}`, exact: true }));
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  requests.length = invalidations.length = navigation.length = confirmations.length = 0;
  ui.window.sessionStorage.clear();
  ui.window.innerWidth = 1280;
  routeWorkspaceId = "household";
  searchParams = new URLSearchParams();
  confirmResult = true;
  responses = new Map([
    ["GET /api/context", { workspaceId: "household", workspaceName: "Home", role: "OWNER" }],
    ["GET /api/credit-cards", [card("one")]],
    ["POST /api/credit-cards", { id: "created" }],
    ["PATCH /api/credit-cards/one", card("one")],
    ["DELETE /api/credit-cards/one", { ok: true }],
  ]);
});
afterEach(() => { ui.cleanup(); for (const client of clients.splice(0)) client.clear(); });
after(() => ui.dispose());

test("wallet details use a native button and can be opened and closed from the keyboard", async () => {
  const view = show();
  const toggle = await view.findByRole("button", { name: "Show details for Daily card, ending in 1234" });
  assert.equal(toggle.tagName, "BUTTON");
  assert.ok(!view.queryByRole("button", { name: "Edit Daily card" }));
  toggle.focus();
  await ui.user.keyboard("{Enter}");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.ok(view.getByRole("button", { name: "Edit Daily card" }));
  await ui.user.keyboard(" ");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(!view.queryByRole("button", { name: "Edit Daily card" }));
});

test("a failed card save is visible and preserves the editable draft for retry", async () => {
  responses.set("POST /api/credit-cards", new Error("Card could not be saved. Please retry."));
  const view = show();
  await view.findByLabelText("1 cards");
  await add(view);
  change(view, "Card Name", "New card");
  change(view, "Last 4 digits", "4567");
  submit(view);
  assert.equal((await view.findByRole("alert")).textContent, "Card could not be saved. Please retry.");
  assert.equal(view.getByLabelText("Card Name").value, "New card");
  assert.ok(!view.getByRole("button", { name: "Add Card", exact: true }).disabled);
  responses.set("POST /api/credit-cards", { id: "created" });
  submit(view);
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  assert.equal(requests.filter(({ method }) => method === "POST").length, 2);
});

test("a pending card save locks the dialog and rejects repeated submissions", async (t) => {
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve({ id: "created" })));
  responses.set("POST /api/credit-cards", () => pending.promise);
  const view = show();
  await view.findByLabelText("1 cards");
  await add(view);
  change(view, "Card Name", "New card");
  change(view, "Last 4 digits", "4567");
  await ui.act(async () => { submit(view); submit(view); });
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1);
  await view.findByRole("button", { name: "Adding..." });
  assert.ok(view.getByLabelText("Card Name").disabled);
  assert.ok(view.getByRole("button", { name: "Cancel" }).disabled);
  assert.ok(view.getByRole("button", { name: "Close Add Credit Card" }).disabled);
  ui.fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(view.getByRole("dialog", { name: "Credit card" }));
  await ui.act(async () => pending.resolve({ id: "created" }));
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
});

test("mobile wallets restore the selected card after loading", async () => {
  ui.window.innerWidth = 390;
  ui.window.sessionStorage.setItem("nest:view:credit-cards:selected", JSON.stringify("two"));
  responses.set("GET /api/credit-cards", [card("one"), card("two")]);
  const view = show();
  await view.findByLabelText("2 cards");
  assert.ok(view.getByRole("button", { name: "Show details for Travel card, ending in 1234" }));
  assert.ok(view.getByRole("button", { name: "Select Daily card, ending in 1234" }));
});

test("card creation preserves optional fields and previews both preset and custom themes", async () => {
  const view = show();
  await view.findByLabelText("1 cards");
  await add(view);
  change(view, "Card Name", "Points card");
  change(view, "Bank", "OCBC Bank");
  change(view, "Last 4 digits", "12x3456");
  assert.equal(view.getByLabelText("Last 4 digits").value, "1234");
  change(view, "Expiry Month", "123");
  change(view, "Expiry Year", "20301");
  assert.equal(view.getByLabelText("Expiry Month").value, "12");
  assert.equal(view.getByLabelText("Expiry Year").value, "2030");
  change(view, "Statement Day", "31");
  change(view, "Payment Due Day", "1");
  change(view, "Notes (optional)", "Travel purchases");
  ui.fireEvent.click(view.getByRole("button", { name: "Use Emerald Wave" }));
  assert.equal(view.getByRole("button", { name: "Use Emerald Wave" }).getAttribute("aria-pressed"), "true");
  ui.fireEvent.click(view.getByRole("button", { name: "Use plain color" }));
  change(view, "Plain card color", "#123456");
  assert.equal(view.getByRole("button", { name: "Use plain color" }).getAttribute("aria-pressed"), "true");
  const preview = view.getByRole("dialog", { name: "Credit card" }).querySelector(".cc-preview");
  assert.ok(preview.textContent.includes("12/30"));
  assert.ok(preview.textContent.includes("•••• •••• •••• 1234"));
  submit(view);
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  assert.deepEqual(requests.find(({ method }) => method === "POST").body, {
    workspaceId: "household", cardName: "Points card", bankName: "OCBC Bank", last4Digit: "1234", themeKey: "custom:#123456",
    expiryMonth: 12, expiryYear: 2030, statementDay: 31, paymentDueDay: 1, notes: "Travel purchases",
  });
  for (const queryKey of [queryKeys.key(["credit-cards", "household"]), queryKeys.key(["credit-transactions"]), queryKeys.key(["dashboard-summary"])]) {
    assert.ok(invalidations.some((item) => JSON.stringify(item.queryKey) === JSON.stringify(queryKey) && item.refetchType === "active"));
  }
});

test("blank names and unavailable workspace context never create a card", async () => {
  const view = show();
  await view.findByLabelText("1 cards");
  await add(view);
  change(view, "Card Name", "   ");
  submit(view);
  assert.equal(requests.filter(({ method }) => method === "POST").length, 0);
  ui.fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  responses.set("GET /api/context", { workspaceId: null });
  await ui.act(async () => view.client.refetchQueries({ queryKey: queryKeys.key(["app-context", "household"]) }));
  await add(view);
  change(view, "Card Name", "New card");
  submit(view);
  assert.equal(requests.filter(({ method }) => method === "POST").length, 0);
});

test("edits populate existing card details, clear optional values, and recover from save failures", async (t) => {
  responses.set("GET /api/credit-cards", [card("one", { themeKey: "custom:#123456", expiryMonth: 3, expiryYear: 2030, notes: "Original notes" })]);
  responses.set("PATCH /api/credit-cards/one", new Error("Update rejected"));
  const view = show();
  await edit(view);
  assert.equal(view.getByLabelText("Expiry Month").value, "3");
  assert.equal(view.getByLabelText("Expiry Year").value, "2030");
  assert.equal(view.getByLabelText("Notes (optional)").value, "Original notes");
  assert.equal(view.getByLabelText("Plain card color").value, "#123456");
  change(view, "Expiry Month", "");
  change(view, "Expiry Year", "");
  change(view, "Notes (optional)", "");
  ui.fireEvent.click(view.getByRole("button", { name: "Use Bank Auto" }));
  submit(view);
  assert.equal((await view.findByRole("alert")).textContent, "Update rejected");
  assert.ok(!view.getByRole("button", { name: "Save Changes" }).disabled);
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve(card("one"))));
  responses.set("PATCH /api/credit-cards/one", () => pending.promise);
  submit(view);
  await view.findByRole("button", { name: "Saving..." });
  for (const label of ["Card Name", "Bank", "Expiry Month", "Expiry Year", "Statement Day", "Payment Due Day", "Plain card color"]) {
    assert.ok(view.getByLabelText(label).disabled);
  }
  assert.ok(view.getByRole("button", { name: "Delete Card" }).disabled);
  assert.ok(view.getByRole("button", { name: "Use Emerald Wave" }).disabled);
  await ui.act(async () => pending.resolve(card("one")));
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  const edits = requests.filter(({ method }) => method === "PATCH");
  assert.equal(edits.length, 2);
  assert.deepEqual(edits[0].body, { cardName: "Daily card", bankName: "DBS Bank", last4Digit: "1234", themeKey: "bank-default",
    expiryMonth: null, expiryYear: null, statementDay: 25, paymentDueDay: 10, notes: null });
  assert.deepEqual(edits[0].body, edits[1].body);
});

test("an edit with missing optional data uses defaults and can save new dates and notes", async () => {
  responses.set("GET /api/credit-cards", [card("one", { bankName: null, themeKey: null })]);
  const view = show();
  await edit(view);
  assert.equal(view.getByLabelText("Bank").value, "DBS Bank");
  assert.equal(view.getByLabelText("Expiry Month").value, "");
  assert.equal(view.getByLabelText("Expiry Year").value, "");
  assert.equal(view.getByRole("button", { name: "Use Bank Auto" }).getAttribute("aria-pressed"), "true");
  change(view, "Expiry Month", "11");
  change(view, "Expiry Year", "2031");
  change(view, "Notes (optional)", "Updated notes");
  submit(view);
  await ui.waitFor(() => assert.ok(!view.queryByRole("dialog")));
  const { body } = requests.find(({ method }) => method === "PATCH");
  assert.equal(body.expiryMonth, 11);
  assert.equal(body.expiryYear, 2031);
  assert.equal(body.notes, "Updated notes");
});

test("cancelling deletion preserves the card and confirmed deletion reports failures before retrying", async (t) => {
  const view = show();
  await edit(view);
  confirmResult = false;
  ui.fireEvent.click(view.getByRole("button", { name: "Delete Card" }));
  await ui.waitFor(() => assert.equal(confirmations.length, 1));
  assert.ok(!requests.some(({ method }) => method === "DELETE"));
  assert.ok(view.getByRole("dialog", { name: "Credit card" }));
  confirmResult = true;
  responses.set("DELETE /api/credit-cards/one", new Error("Card cannot be deleted yet"));
  ui.fireEvent.click(view.getByRole("button", { name: "Delete Card" }));
  assert.equal((await view.findByRole("alert")).textContent, "Card cannot be deleted yet");
  assert.equal(confirmations[1][0], "Delete this credit card?");
  assert.deepEqual(confirmations[1][2].workspace, { name: "Home", role: "OWNER" });
  assert.match(confirmations[1][2].reversal, /Transactions already posted to the ledger remain/);
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve({ ok: true })));
  responses.set("DELETE /api/credit-cards/one", () => pending.promise);
  const remove = view.getByRole("button", { name: "Delete Card" });
  await ui.act(async () => { ui.fireEvent.click(remove); ui.fireEvent.click(remove); });
  await view.findByRole("button", { name: "Deleting..." });
  assert.equal(requests.filter(({ method }) => method === "DELETE").length, 2);
  assert.ok(view.getByRole("button", { name: "Save Changes" }).disabled);
  assert.ok(view.getByRole("button", { name: "Cancel" }).disabled);
  responses.set("GET /api/credit-cards", []);
  await ui.act(async () => pending.resolve({ ok: true }));
  await view.findByRole("heading", { name: "No credit cards yet" });
  assert.ok(!view.queryByRole("dialog"));
});

test("closing and reopening a failed edit clears its error and resets the form", async () => {
  responses.set("GET /api/context", { workspaceId: "household" });
  responses.set("PATCH /api/credit-cards/one", new Error("Old edit failed"));
  const view = show();
  await edit(view);
  submit(view);
  await view.findByRole("alert");
  confirmResult = false;
  ui.fireEvent.click(view.getByRole("button", { name: "Delete Card" }));
  await ui.waitFor(() => assert.equal(confirmations.length, 1));
  assert.deepEqual(confirmations[0][2].workspace, { name: "Current workspace", role: "EDITOR" });
  ui.fireEvent.click(view.getByRole("button", { name: "Close Edit Credit Card" }));
  await add(view);
  assert.ok(!view.queryByRole("alert"));
  assert.equal(view.getByLabelText("Card Name").value, "");
  assert.equal(view.getByLabelText("Last 4 digits").value, "");
  ui.fireEvent.click(view.getByRole("button", { name: "Cancel" }));
});

for (const workspaceId of [null, "household"]) {
  test(`add-card links preserve unrelated query parameters ${workspaceId ? "inside" : "outside"} a workspace`, async () => {
    routeWorkspaceId = workspaceId;
    searchParams = new URLSearchParams(workspaceId ? "add=1&from=statement" : "add=1");
    const view = show();
    await view.findByRole("dialog", { name: "Credit card" });
    assert.deepEqual(navigation, [[workspaceId ? "/w/household/credit-cards?from=statement" : "/credit-cards", { scroll: false }]]);
    assert.equal(view.getByLabelText("Card Name").value, "");
    ui.fireEvent.click(view.getByRole("button", { name: "Close Add Credit Card" }));
    assert.ok(!view.queryByRole("dialog"));
    assert.equal(navigation.length, 1);
  });
}

test("loading failures offer retry and an empty wallet opens a fresh card form", async () => {
  responses.set("GET /api/credit-cards", new Error("Unavailable"));
  const view = show();
  await view.findByText("Failed to load cards");
  assert.ok(!view.queryByLabelText("0 cards"));
  responses.set("GET /api/credit-cards", []);
  ui.fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await view.findByRole("heading", { name: "No credit cards yet" });
  ui.fireEvent.click(view.getByRole("button", { name: "+ Add Your First Card" }));
  assert.ok(view.getByRole("dialog", { name: "Credit card" }));
  ui.fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  assert.ok(!requests.some(({ method }) => method !== "GET"));
});

test("mobile selection, card flipping, and browse controls adapt to resizing and removed cards", async () => {
  responses.set("GET /api/credit-cards", [card("two"), card("one")]);
  const view = show();
  await view.findByLabelText("2 cards");
  assert.ok(!view.queryByRole("button", { name: /Browse all/ }));
  ui.fireEvent.click(view.getByRole("button", { name: "Show details for Daily card, ending in 1234" }));
  ui.window.innerWidth = 390;
  ui.fireEvent(ui.window, new ui.window.Event("resize"));
  ui.fireEvent.click(view.getByRole("button", { name: "Select Travel card, ending in 1234" }));
  assert.equal(ui.window.sessionStorage.getItem("nest:view:credit-cards:selected"), JSON.stringify("two"));
  const daily = view.getByRole("button", { name: "Select Daily card, ending in 1234" }).closest(".cc-card-wrapper");
  assert.ok(!daily.classList.contains("flipped"));
  ui.fireEvent.click(view.getByRole("button", { name: "Show details for Travel card, ending in 1234" }));
  assert.ok(view.getByRole("button", { name: "Edit Travel card" }));
  ui.fireEvent.click(view.getByRole("button", { name: "Browse all 2 cards" }));
  assert.equal(view.getByRole("button", { name: "Stack cards" }).getAttribute("aria-expanded"), "true");
  assert.equal(view.container.querySelector(".cc-card-wrapper .cc-card-name").textContent, "Daily card");
  ui.fireEvent.click(view.getByRole("button", { name: "Stack cards" }));
  assert.equal(view.container.querySelector(".cc-card-wrapper .cc-card-name").textContent, "Travel card");
  await ui.act(async () => view.client.setQueryData(queryKeys.key(["credit-cards", "household"]), [card("one")]));
  await view.findByLabelText("1 cards");
  assert.ok(view.getByRole("button", { name: "Show details for Daily card, ending in 1234" }));
  assert.ok(!view.queryByRole("button", { name: /Browse all/ }));
  await ui.act(async () => view.client.setQueryData(queryKeys.key(["credit-cards", "household"]), []));
  await view.findByRole("heading", { name: "No credit cards yet" });
});

test("wallet rendering handles stored themes, expiry dates, issuer logos, and legacy card metadata", async () => {
  const cards = [
    card("one", { cardName: "Points", themeKey: "emerald-wave", expiryMonth: 3, expiryYear: 2030, notes: "Travel benefits" }),
    card("two", { cardName: "Custom", themeKey: "custom:#123456" }),
    card("three", { cardName: "Legacy", bankName: "Example Credit", themeKey: "old-theme", last4Digit: "", maskedNumber: "legacy-mask" }),
    card("four", { cardName: "Unbranded", bankName: null, themeKey: null }),
    card("five", { cardName: "HSBC", bankName: "HSBC", themeKey: null }),
    card("six", { cardName: "Unknown issuer", bankName: "Example Credit", themeKey: "bank-default" }),
    card("seven", { cardName: "Null issuer", bankName: null, themeKey: undefined }),
  ];
  responses.set("GET /api/credit-cards", cards);
  const view = show();
  await view.findByLabelText("7 cards");
  const points = view.getByRole("button", { name: "Show details for Points, ending in 1234" }).closest(".cc-card-wrapper");
  assert.deepEqual(ui.within(points).getAllByText("03/30").map((node) => node.textContent), ["03/30", "03/30"]);
  const custom = view.getByRole("button", { name: "Show details for Custom, ending in 1234" }).closest(".cc-card-wrapper");
  assert.match(custom.querySelector(".cc-card-front").getAttribute("style"), /123456|18, 52, 86/);
  ui.fireEvent.error(ui.within(points).getByAltText("DBS Bank"));
  assert.equal(points.querySelector(".cc-bank-fallback").textContent, "DB");
  assert.ok(!ui.within(points).queryByAltText("DBS Bank"));
  ui.fireEvent.click(ui.within(points).getByRole("button", { name: "Show details for Points, ending in 1234" }));
  assert.ok(ui.within(points).getByText("Travel benefits"));
  assert.equal(points.querySelector(".cc-card-back").getAttribute("aria-hidden"), "false");
  await ui.act(async () => view.client.setQueryData(queryKeys.key(["credit-cards", "household"]), cards.map((value) => value.id === "one" ? { ...value, bankName: "OCBC Bank" } : value)));
  assert.ok(await view.findByAltText("OCBC Bank"));
  ui.window.innerWidth = 390;
  ui.fireEvent(ui.window, new ui.window.Event("resize"));
  const legacy = view.getByRole("button", { name: "Select Legacy, ending in" }).closest(".cc-card-wrapper");
  assert.equal(legacy.querySelector(".cc-card-number").textContent, "legacy-mask");
  assert.equal(legacy.querySelector(".cc-bank-fallback").textContent, "EC");
});
