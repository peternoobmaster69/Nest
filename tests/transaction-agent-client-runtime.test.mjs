import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const calls = [], unexpected = [], clients = [], invalidations = [];
let responses;
mock.module("../lib/workspace-client.ts", { namedExports: {
  async workspaceFetch(url, options = {}) {
    calls.push({ url, method: options.method ?? "GET", cache: options.cache, headers: options.headers, body: options.body && JSON.parse(options.body) });
    if (!responses.length) {
      unexpected.push(url);
      throw new Error(`Unexpected test request: ${url}`);
    }
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return typeof response === "function" ? response() : response;
  },
} });
const { TransactionAgentCard, useTransactionAgent, isActiveDraft, draftSummary, draftPlaceholder } = require("../components/transaction-agent.tsx");
const { setPrivacyMode, MASKED_AMOUNT } = require("../lib/privacy-mode.ts");
const createdAt = "2026-10-10T12:00:00.000Z";
const draft = (overrides = {}) => ({
  draftId: "draft-one", revision: 1, status: "CLARIFY", expiresAt: "2026-10-11T12:00:00.000Z",
  message: "Which sub-account?", choices: [], review: null, messages: [{ role: "assistant", content: "Which sub-account?" }], pending: "budget",
  ...overrides,
});
const session = (overrides = {}) => ({ key: "session-one", createdAt, text: "Deduct $5 for coffee", view: draft(), error: "", needsReload: false, routed: false, ...overrides });
const review = () => ({
  operation: "CREATE", currency: "SGD", before: null,
  after: { accountId: "bank", budgetId: "food", subject: "Coffee", amountCents: 500, direction: "DEBIT", kind: "EXPENSE", date: createdAt },
  balances: [{ id: "food", accountId: "bank", name: "Food", accountName: "DBS", availableCents: 10000, afterCents: 9500 }], warnings: [],
});
const json = (value, status = 200) => Response.json(value, { status });
const given = (...values) => responses.push(...values);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function showHook(workspaceId = "home", enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = options => { invalidations.push(options); return invalidate(options); };
  clients.push(client);
  return ui.renderHook(props => useTransactionAgent(props.workspaceId, props.enabled), {
    initialProps: { workspaceId, enabled },
    wrapper: ({ children }) => ui.h(QueryClientProvider, { client }, children),
  });
}
const settled = async hook => ui.waitFor(() => assert.equal(hook.result.current.busy, false));
async function start(hook, value = draft(), text = "Deduct $5 for coffee", routed = false) {
  given(json(value));
  await ui.act(async () => hook.result.current.start(text, routed));
  await settled(hook);
  return hook.result.current.sessions.at(-1);
}
function showCard(value = session(), options = {}) {
  const actions = [];
  const agent = {
    busy: false,
    run: async (...args) => { actions.push(["run", ...args]); return true; },
    start: (...args) => actions.push(["start", ...args]),
    reload: async (...args) => { actions.push(["reload", ...args]); },
    discard: async (...args) => { actions.push(["discard", ...args]); return true; },
  };
  const props = { session: value, agent, latest: true, typing: false, workspaceId: "home", onNavigate: () => actions.push(["navigate"]), onAskInstead: item => actions.push(["ask", item]), ...options };
  const view = ui.render(ui.h(TransactionAgentCard, props));
  return { ...view, actions, props, update: changes => { Object.assign(props, changes); view.rerender(ui.h(TransactionAgentCard, props)); } };
}

beforeEach(() => {
  calls.length = unexpected.length = invalidations.length = 0;
  responses = [];
  ui.window.sessionStorage.clear();
  setPrivacyMode(false);
});
afterEach(() => {
  ui.cleanup();
  for (const client of clients.splice(0)) client.clear();
  assert.deepEqual(unexpected, [], "a handled network error must not conceal a missing test fixture");
});
after(() => ui.dispose());

test("transaction draft summaries and placeholders distinguish pending, reviewed and finished states", () => {
  for (const value of [undefined, null, session({ view: null }), session({ view: draft({ status: "SAVED" }) })]) assert.equal(isActiveDraft(value), false);
  for (const status of ["CLARIFY", "REVIEW"]) assert.equal(isActiveDraft(session({ view: draft({ status }) })), true);
  assert.equal(draftSummary(session({ view: null })), "Drafting a transaction");
  assert.equal(draftSummary(session({ view: draft({ pending: null }) })), "Drafting a transaction");
  for (const [pending, label] of Object.entries({ budget: "Choose a sub-account", amount: "Needs an amount", direction: "Deduct or add?", subject: "Needs a description", date: "Needs a date", target: "Choose the transaction" })) {
    assert.equal(draftSummary(session({ view: draft({ pending }) })), label);
  }
  assert.match(draftSummary(session({ view: draft({ review: review() }) })), /Coffee · SGD\s*5\.00/);
  ui.act(() => setPrivacyMode(true));
  assert.equal(draftSummary(session({ view: draft({ review: review() }) })), `Coffee · ${MASKED_AMOUNT}`);
  assert.equal(draftPlaceholder(session()), "Type a number or sub-account name…");
  assert.equal(draftPlaceholder(session({ view: draft({ pending: null, status: "REVIEW" }) })), "Type a change, like “make it $15”…");
  assert.equal(draftPlaceholder(session({ view: null })), "Reply, or type 12.50 / yesterday…");
});

test("transaction drafting sends explicit messages and revisions and retains one active draft", async () => {
  const hook = showHook();
  assert.deepEqual(hook.result.current.sessions, []);
  await ui.act(async () => hook.result.current.reply("No draft yet"));
  assert.deepEqual(calls, []);
  const first = await start(hook);
  assert.equal(first.routed, false);
  assert.match(first.key, /^[a-f\d-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(first.createdAt)));
  assert.equal(hook.result.current.active.key, first.key);
  assert.equal(ui.window.sessionStorage.getItem("nest:transaction-agent:home"), "draft-one");
  assert.deepEqual(calls[0], { url: "/api/ai/transactions", method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: { action: "start", message: "Deduct $5 for coffee" } });
  await ui.act(async () => hook.result.current.start("A second draft"));
  assert.equal(calls.length, 1);
  given(json(draft({ revision: 2, status: "REVIEW", pending: null, review: review() })));
  await ui.act(async () => hook.result.current.reply("Food"));
  await settled(hook);
  assert.deepEqual(calls[1].body, { action: "message", draftId: "draft-one", revision: 1, message: "Food" });
  assert.equal(hook.result.current.active.view.revision, 2);
});

test("saved drafts refresh financial queries and provide context for the next correction", async () => {
  const hook = showHook();
  const first = await start(hook, draft({ status: "SAVED", savedTransactionId: "saved-one" }));
  assert.equal(hook.result.current.active, null);
  assert.equal(ui.window.sessionStorage.getItem("nest:transaction-agent:home"), null);
  assert.ok(invalidations.length > 0);
  const next = await start(hook, draft({ draftId: "draft-two", status: "REVIEW", review: review() }), "Make that $12", true);
  assert.equal(next.routed, true);
  assert.deepEqual(calls[1].body, { action: "start", message: "Make that $12", previousDraftId: "draft-one" });
  assert.equal(hook.result.current.sessions[0].key, first.key);
  await ui.act(async () => hook.result.current.clearFinished());
  assert.deepEqual(hook.result.current.sessions.map(item => item.key), [next.key]);
});

test("an in-flight draft rejects repeated starts, mutations and manual reloads", async t => {
  const pending = deferred();
  t.after(() => ui.act(async () => pending.resolve(json(draft()))));
  given(() => pending.promise);
  const hook = showHook();
  await ui.act(async () => hook.result.current.start("Coffee"));
  assert.equal(hook.result.current.busy, true);
  const key = hook.result.current.sessions[0].key;
  await ui.act(async () => {
    hook.result.current.start("Duplicate coffee");
    assert.equal(await hook.result.current.run(key, { action: "start", message: "Duplicate" }), false);
    await hook.result.current.reload(key, "draft-one");
  });
  assert.equal(calls.length, 1);
  await ui.act(async () => pending.resolve(json(draft())));
  await settled(hook);
  assert.equal(hook.result.current.sessions.length, 1);
});

for (const [label, failure, message] of [
  ["a server error", json({ error: "Unable to draft right now" }, 503), "Unable to draft right now"],
  ["invalid JSON", new Response("{"), "Could not complete this request."],
  ["an empty response", json(null), "Could not complete this request."],
  ["an error without a message", json({}, 500), "Could not complete this request."],
  ["a network exception", new Error("Network unavailable"), "Network unavailable"],
  ["a non-error rejection", () => Promise.reject("network failure"), "Could not complete this request."],
]) {
  test(`failed draft creation handles ${label} without losing the original request`, async () => {
    const hook = showHook();
    given(failure);
    await ui.act(async () => hook.result.current.start("Original coffee", true));
    await settled(hook);
    const [item] = hook.result.current.sessions;
    assert.equal(item.text, "Original coffee");
    assert.equal(item.routed, true);
    assert.equal(item.error, message);
    assert.equal(item.needsReload, false);
    assert.equal(item.view, null);
    assert.equal(calls.length, 1);
  });
}

for (const status of ["SAVED", "REVIEW"]) {
  test(`a failed confirmation reloads authoritative ${status} state before allowing further action`, async () => {
    const hook = showHook();
    const original = await start(hook, draft({ status: "REVIEW", review: review() }));
    given(new Error("Confirmation response was lost"), json(draft({ status, revision: 2, review: review() })));
    await ui.act(async () => assert.equal(await hook.result.current.run(original.key, { action: "confirm", draftId: "draft-one", revision: 1 }), false));
    await settled(hook);
    const item = hook.result.current.sessions[0];
    assert.equal(item.view.status, status);
    assert.equal(item.needsReload, false);
    assert.equal(item.error, status === "SAVED" ? "" : "Confirmation response was lost");
    assert.deepEqual(calls[2], { url: "/api/ai/transactions?draftId=draft-one", method: "GET", cache: "no-store", headers: undefined, body: undefined });
    assert.equal(ui.window.sessionStorage.getItem("nest:transaction-agent:home"), status === "SAVED" ? null : "draft-one");
  });
}

test("failed confirmation and reconciliation keep the draft locked until a successful manual reload", async () => {
  const hook = showHook();
  const original = await start(hook, draft({ status: "REVIEW", review: review() }));
  given(new Error("Confirmation was interrupted"), new Response("invalid JSON", { status: 503 }));
  await ui.act(async () => hook.result.current.run(original.key, { action: "confirm", draftId: "draft-one", revision: 1 }));
  assert.equal(hook.result.current.sessions[0].needsReload, true);
  assert.equal(hook.result.current.sessions[0].error, "Confirmation was interrupted");
  given(new Error("Still offline"));
  await ui.act(async () => hook.result.current.reload(original.key, "draft-one"));
  assert.equal(hook.result.current.sessions[0].error, "Could not reload the draft. Please try again.");
  assert.equal(hook.result.current.sessions[0].needsReload, true);
  given(json(draft({ status: "REVIEW", revision: 2, review: review() })));
  await ui.act(async () => hook.result.current.reload(original.key, "draft-one"));
  assert.equal(hook.result.current.sessions[0].error, "");
  assert.equal(hook.result.current.sessions[0].needsReload, false);
  assert.equal(hook.result.current.sessions[0].view.revision, 2);
});

test("discarding an active draft cancels the current revision before removing it", async () => {
  const hook = showHook();
  const original = await start(hook);
  given(json(draft({ status: "CANCELLED", revision: 2 })));
  await ui.act(async () => assert.equal(await hook.result.current.discard(original), true));
  assert.deepEqual(calls[1].body, { action: "cancel", draftId: "draft-one", revision: 1 });
  assert.deepEqual(hook.result.current.sessions, []);
  assert.equal(ui.window.sessionStorage.getItem("nest:transaction-agent:home"), null);
});

test("discarding preserves a draft when cancellation fails and removes finished drafts without a write", async () => {
  const hook = showHook();
  const original = await start(hook);
  given(new Error("Cancel failed"), json(draft()));
  await ui.act(async () => assert.equal(await hook.result.current.discard(original), false));
  assert.equal(hook.result.current.sessions.length, 1);
  given(json(draft({ status: "SAVED" })));
  await ui.act(async () => hook.result.current.reload(original.key, "draft-one"));
  const before = calls.length;
  await ui.act(async () => assert.equal(await hook.result.current.discard(hook.result.current.sessions[0]), true));
  assert.equal(calls.length, before);
  assert.deepEqual(hook.result.current.sessions, []);
});

for (const status of ["CLARIFY", "REVIEW"]) {
  test(`reopening Ask Nest restores a ${status} draft once with an encoded draft id`, async () => {
    ui.window.sessionStorage.setItem("nest:transaction-agent:home", "draft/one two");
    const hook = showHook("home", false);
    assert.equal(calls.length, 0);
    given(json(draft({ status })));
    hook.rerender({ workspaceId: "home", enabled: true });
    await settled(hook);
    const [item] = hook.result.current.sessions;
    assert.equal(item.text, "");
    assert.equal(item.routed, false);
    assert.equal(item.view.status, status);
    assert.equal(calls[0].url, "/api/ai/transactions?draftId=draft%2Fone%20two");
    hook.rerender({ workspaceId: "home", enabled: false });
    hook.rerender({ workspaceId: "home", enabled: true });
    assert.equal(calls.length, 1);
  });
}

for (const [label, response] of [["saved", json(draft({ status: "SAVED" }))], ["expired", json(draft({ status: "EXPIRED" }))], ["missing", json({ error: "Missing draft" }, 404)]]) {
  test(`restoration removes a ${label} draft from local history`, async () => {
    ui.window.sessionStorage.setItem("nest:transaction-agent:home", "old-draft");
    given(response);
    const hook = showHook();
    await settled(hook);
    assert.deepEqual(hook.result.current.sessions, []);
    assert.equal(ui.window.sessionStorage.getItem("nest:transaction-agent:home"), null);
  });
}

test("switching workspaces clears the visible thread and restores only the new workspace draft", async () => {
  const hook = showHook();
  await start(hook);
  ui.window.sessionStorage.setItem("nest:transaction-agent:shared", "shared-draft");
  given(json(draft({ draftId: "shared-draft" })));
  hook.rerender({ workspaceId: "shared", enabled: true });
  await settled(hook);
  assert.equal(hook.result.current.sessions.length, 1);
  assert.equal(hook.result.current.active.view.draftId, "shared-draft");
  assert.equal(calls.at(-1).url, "/api/ai/transactions?draftId=shared-draft");
  assert.equal(ui.window.sessionStorage.getItem("nest:transaction-agent:home"), "draft-one");
});

test("drafting without an explicit workspace uses the active workspace storage slot", async () => {
  const hook = showHook(null);
  await start(hook);
  assert.equal(ui.window.sessionStorage.getItem("nest:transaction-agent:active"), "draft-one");
});

test("session-storage read and write restrictions do not prevent a usable draft", async t => {
  t.mock.method(ui.window.sessionStorage, "getItem", () => { throw new Error("Storage denied"); });
  t.mock.method(ui.window.sessionStorage, "setItem", () => { throw new Error("Storage denied"); });
  const hook = showHook();
  await start(hook);
  assert.equal(hook.result.current.active.view.draftId, "draft-one");
});

test("session-storage removal restrictions do not obscure saved or discarded draft state", async t => {
  ui.window.sessionStorage.setItem("nest:transaction-agent:home", "expired-draft");
  t.mock.method(ui.window.sessionStorage, "removeItem", () => { throw new Error("Storage denied"); });
  given(json(draft({ status: "EXPIRED" })));
  const hook = showHook();
  await settled(hook);
  assert.deepEqual(hook.result.current.sessions, []);
  await start(hook, draft({ status: "SAVED" }));
  assert.equal(hook.result.current.sessions[0].view.status, "SAVED");
});

test("transaction cards show pending input, conversation messages and duplicate replies in their original order", () => {
  const view = showCard(session({ view: null }));
  assert.equal(view.container.querySelector(".ask-nest-question").textContent, "Deduct $5 for coffee");
  view.update({ session: session({ text: "", view: null }) });
  assert.equal(view.container.querySelector(".ask-nest-question"), null);
  const messages = [{ role: "user", content: "Coffee" }, { role: "assistant", content: "Which account?" }, { role: "user", content: "Coffee" }];
  view.update({ session: session({ view: draft({ messages }) }) });
  assert.deepEqual(Array.from(view.container.querySelectorAll(".ask-nest-question, .transaction-agent-reply"), node => node.textContent), messages.map(item => item.content));
  assert.ok(view.getByText("Transaction draft · nothing saved yet"));
  view.update({ session: session({ view: draft({ messages: [] }) }) });
  assert.ok(view.getByText("Deduct $5 for coffee"));
});

for (const [status, label] of [["REVIEW", "Transaction draft · nothing saved yet"], ["SAVED", "Saved"], ["CANCELLED", "Draft cancelled"], ["EXPIRED", "Draft expired"]]) {
  test(`transaction cards identify ${status} drafts and retain expiration guidance`, () => {
    const view = showCard(session({ view: draft({ status, message: "Please start a fresh draft" }) }));
    assert.ok(view.getByText(label, { exact: true }));
    assert.equal(Boolean(view.queryByText("Please start a fresh draft")), status === "EXPIRED");
  });
}

test("transaction choices filter labels and details without changing the server selection identifiers", async () => {
  const choices = Array.from({ length: 7 }, (_, index) => ({ kind: "budget", id: `budget-${index}`, label: `Budget ${index + 1}`, detail: index === 6 ? "Special bank" : "Regular bank", suggested: index === 0 }));
  const view = showCard(session({ view: draft({ choices }) }));
  assert.ok(view.getByText("Suggested"));
  const filter = view.getByRole("searchbox", { name: "Find a sub-account or transaction" });
  ui.fireEvent.change(filter, { target: { value: "SPECIAL" } });
  assert.equal(view.queryAllByRole("button").length, 1);
  await ui.act(async () => ui.fireEvent.click(view.getByRole("button", { name: "7. Budget 7 Special bank" })));
  assert.deepEqual(view.actions, [["run", "session-one", { action: "select", draftId: "draft-one", revision: 1, selection: { kind: "budget", id: "budget-6" } }]]);
  assert.equal(filter.value, "");
  assert.equal(view.queryAllByRole("button").length, 7);
});

test("suggested budgets can be expanded explicitly and are hidden for older or inactive drafts", async () => {
  const choices = [{ kind: "budget", id: "food", label: "Food", detail: "DBS", suggested: true }];
  const value = session({ view: draft({ choices }) });
  const view = showCard(value);
  await ui.act(async () => ui.fireEvent.click(view.getByRole("button", { name: "None of these. Show all sub-accounts" })));
  assert.deepEqual(view.actions, [["run", "session-one", { action: "edit", draftId: "draft-one", revision: 1, field: "budget" }]]);
  view.update({ latest: false });
  assert.equal(view.queryByRole("button"), null);
  view.update({ latest: true, session: session({ view: draft({ status: "SAVED", choices }) }) });
  assert.equal(view.queryByRole("button"), null);
  view.update({ session: session({ view: draft({ pending: "target", choices: [{ ...choices[0], kind: "transaction" }] }) }) });
  assert.equal(view.queryByRole("button", { name: "None of these. Show all sub-accounts" }), null);
  assert.ok(view.getByRole("button", { name: /1\. Food/ }));
});

test("busy or uncertain drafts lock choices while older cards do not announce current progress", () => {
  const choices = [{ kind: "budget", id: "food", label: "Food", detail: "DBS", suggested: true }];
  const view = showCard(session({ needsReload: true, view: draft({ choices }) }));
  assert.equal(view.container.firstElementChild.getAttribute("aria-busy"), "true");
  for (const button of view.queryAllByRole("button")) assert.equal(button.disabled, true);
  view.update({ session: session({ view: null }), agent: { ...view.props.agent, busy: true } });
  assert.ok(view.getByText("Preparing a draft…", { exact: false }));
  view.update({ session: session() });
  assert.ok(view.getByText("Updating the draft…", { exact: false }));
  view.update({ latest: false });
  assert.equal(view.queryByText("Updating the draft…", { exact: false }), null);
  assert.equal(view.container.firstElementChild.getAttribute("aria-busy"), "false");
});

test("review-card edits and confirmation send only the selected draft revision", async () => {
  const view = showCard(session({ view: draft({ status: "REVIEW", pending: null, review: review() }) }));
  ui.fireEvent.click(view.getByRole("button", { name: "Edit description" }));
  ui.fireEvent.change(view.getByLabelText("New description"), { target: { value: "Lunch" } });
  await ui.act(async () => ui.fireEvent.submit(view.getByLabelText("New description").closest("form")));
  await ui.act(async () => ui.fireEvent.click(view.getByRole("button", { name: "Confirm transaction" })));
  assert.deepEqual(view.actions, [
    ["run", "session-one", { action: "edit", draftId: "draft-one", revision: 1, field: "subject", value: "Lunch" }],
    ["run", "session-one", { action: "confirm", draftId: "draft-one", revision: 1 }],
  ]);
  view.update({ latest: false });
  assert.equal(view.queryByRole("button", { name: "Edit description" }), null);
  assert.equal(view.getByRole("button", { name: "Confirm transaction" }).disabled, true);
  view.update({ latest: true, typing: true });
  assert.equal(view.getByRole("button", { name: "Confirm transaction" }).disabled, true);
});

test("saved transaction links retain workspace scoping and deferred actions run only from the latest card", async () => {
  const value = session({ view: draft({ status: "SAVED", savedTransactionId: "saved/id", nextRequest: "Add salary" }) });
  const view = showCard(value);
  const link = view.getByRole("link", { name: "View saved transaction" });
  assert.equal(link.getAttribute("href"), "/w/home/transactions?transactionId=saved%2Fid");
  ui.fireEvent.click(link);
  await ui.act(async () => ui.fireEvent.click(view.getByRole("button", { name: "Continue with: Add salary" })));
  assert.deepEqual(view.actions, [["navigate"], ["start", "Add salary"]]);
  view.update({ workspaceId: null, latest: false });
  assert.equal(view.getByRole("link", { name: "View saved transaction" }).getAttribute("href"), "/transactions?transactionId=saved%2Fid");
  assert.equal(view.queryByRole("button", { name: "Continue with: Add salary" }), null);
});

test("automatically routed drafts can return to questions until a review has been prepared", async () => {
  const value = session({ routed: true });
  const view = showCard(value);
  await ui.act(async () => ui.fireEvent.click(view.getByRole("button", { name: "This was a question" })));
  assert.deepEqual(view.actions, [["ask", value]]);
  view.update({ session: session({ routed: true, view: draft({ status: "REVIEW", review: review() }) }) });
  assert.equal(view.queryByRole("button", { name: "This was a question" }), null);
});

test("draft errors offer reconciliation or an explicit retry preserving the original message", async () => {
  const view = showCard(session({ error: "Lost connection", needsReload: true }));
  assert.match(view.getByRole("alert").textContent, /Lost connection/);
  await ui.act(async () => ui.fireEvent.click(view.getByRole("button", { name: "Reload draft" })));
  assert.deepEqual(view.actions, [["reload", "session-one", "draft-one"]]);
  const failed = session({ view: null, error: "Could not start", routed: true });
  view.update({ session: failed });
  await ui.act(async () => ui.fireEvent.click(view.getByRole("button", { name: "Try again" })));
  assert.deepEqual(view.actions.slice(1), [["discard", failed], ["start", "Deduct $5 for coffee", true]]);
  view.update({ agent: { ...view.props.agent, busy: true } });
  assert.equal(view.getByRole("button", { name: "Try again" }).disabled, true);
});
