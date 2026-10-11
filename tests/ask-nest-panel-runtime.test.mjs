import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, within, waitFor, act } = ui;
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { AskNest } = require("../components/ask-nest.tsx");
const { useAskNestLauncher } = require("../components/ask-nest-store.ts");
const { ConfirmDialogProvider } = require("../components/confirm-dialog.tsx");
const originalFetch = globalThis.fetch;
let sequence = 0;
let workspaceId, client, responses, requests, unexpected;

function answer(text = "Your recorded balance is $42.", values = {}) {
  return {
    turnId: "saved-answer",
    answer: text,
    highlights: [],
    evidence: [],
    followUpQuestions: [],
    scope: { workspaceName: "Household", currency: "SGD", pageTitle: "Dashboard", asOf: "2026-10-01T12:00:00Z", toolsUsed: [] },
    ...values,
  };
}
function historyTurn(id, values = {}) {
  return { id, question: "Question " + id, answer: answer("Answer " + id, { turnId: id }), createdAt: "2026-10-01T12:00:00Z", ...values };
}
function memory(id = "preference/one", values = {}) {
  return { id, kind: "PREFERENCE", key: "format", content: "Use charts for spending trends", confidence: 1,
    createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", ...values };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function element(properties = {}) {
  return h(QueryClientProvider, { client }, h(ConfirmDialogProvider, null, h(AskNest, {
    currentPath: "/", pageTitle: "Dashboard", workspaceName: "Household", workspaceId, userName: "Taylor Example", ...properties,
  })));
}
function show(properties = {}) { return render(element(properties)); }
async function open(view) {
  fireEvent.click(view.getByRole("button", { name: "Ask Nest", exact: true }));
  const panel = await view.findByRole("dialog", { name: "Ask Nest", exact: true });
  await waitFor(() => assert.equal(within(panel).getByRole("textbox").disabled, false));
  return within(panel);
}
function send(panel, question = "What is my recorded balance?") {
  fireEvent.change(panel.getByRole("textbox"), { target: { value: question } });
  fireEvent.submit(panel.getByRole("textbox").closest("form"));
}
function writes(path = "/api/ai/ask") { return requests.filter((item) => item.method === "POST" && item.url.pathname === path); }
async function showMemory(panel) {
  fireEvent.click(panel.getByRole("button", { name: "Review what Ask Nest remembers" }));
  await panel.findByRole("heading", { name: "What Ask Nest remembers" });
}
async function confirm(view, title, action = "Confirm") {
  const dialog = await view.findByRole("dialog", { name: title, exact: true });
  fireEvent.click(within(dialog).getByRole("button", { name: action, exact: true }));
}

beforeEach(() => {
  workspaceId = "ask-workspace-" + ++sequence;
  ui.window.history.replaceState(null, "", "/w/" + workspaceId);
  ui.window.sessionStorage.clear();
  ui.window.localStorage.clear();
  delete document.documentElement.dataset.privacy;
  const launcher = ui.renderHook(useAskNestLauncher);
  act(() => launcher.result.current[1](false));
  launcher.unmount();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  requests = [];
  unexpected = [];
  responses = new Map([
    ["GET /api/ai/history?limit=10", { turns: [], nextCursor: null }],
    ["POST /api/ai/ask", answer()],
    ["GET /api/ai/memory", { memories: [] }],
  ]);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), ui.window.location.href);
    const request = { url, method: options.method ?? "GET", headers: new Headers(options.headers), body: options.body && JSON.parse(options.body), signal: options.signal };
    requests.push(request);
    const key = request.method + " " + url.pathname + url.search;
    if (!responses.has(key)) unexpected.push(key);
    assert.ok(responses.has(key), "Unexpected API request: " + key);
    const response = responses.get(key);
    return typeof response === "function" ? response(request) : Response.json(response);
  };
});
afterEach(() => {
  ui.cleanup();
  client.clear();
  globalThis.fetch = originalFetch;
  mock.restoreAll();
  assert.deepEqual(unexpected, []);
});
after(() => ui.dispose());

test("conversation history loads only when opened, locks the composer while loading, and is reused after minimizing", async () => {
  const pending = deferred();
  responses.set("GET /api/ai/history?limit=10", () => pending.promise);
  const view = show();
  assert.equal(requests.length, 0);
  fireEvent.click(view.getByRole("button", { name: "Ask Nest", exact: true }));
  const panel = within(await view.findByRole("dialog", { name: "Ask Nest", exact: true }));
  assert.ok(panel.getByText("Loading conversation history…"));
  assert.equal(panel.getByRole("textbox").disabled, true);
  await act(async () => pending.resolve(Response.json({ turns: [], nextCursor: null })));
  await panel.findByRole("heading", { name: "Hi Taylor, ask about the money already in Nest" });
  assert.equal(panel.getByRole("textbox").disabled, false);
  assert.ok(panel.getByText("Answers from Household"));
  fireEvent.click(panel.getByRole("button", { name: "Minimize Ask Nest" }));
  assert.equal(view.queryByRole("dialog"), null);
  assert.equal(document.documentElement.dataset.askNestMinimized, "true");
  fireEvent.click(view.getByRole("button", { name: /Reopen Ask Nest/ }));
  assert.ok(view.getByRole("dialog", { name: "Ask Nest", exact: true }));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.get("x-workspace-id"), workspaceId);
});

test("the composer sends bounded recent history and scoped evidence links, then runs a suggested follow-up", async () => {
  const past = [1, 2, 3, 4].map((id) => historyTurn(String(id)));
  responses.set("GET /api/ai/history?limit=10", { turns: [...past, { id: "failed", question: "Unanswered", error: "Earlier failure" }], nextCursor: null });
  const pending = deferred();
  responses.set("POST /api/ai/ask", () => pending.promise);
  const view = show();
  const panel = await open(view);
  const input = panel.getByRole("textbox");
  fireEvent.change(input, { target: { value: "  What is my recorded balance?  " } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  assert.equal(writes().length, 0);
  fireEvent.keyDown(input, { key: "Enter" });
  assert.ok(panel.getByText("Checking your Nest data…"));
  assert.equal(input.disabled, true);
  fireEvent.submit(input.closest("form"));
  assert.equal(writes().length, 1);
  assert.deepEqual(writes()[0].body, { question: "What is my recorded balance?", pagePath: "/", history: past.slice(-3).flatMap((turn) => [
    { role: "user", content: turn.question }, { role: "assistant", content: turn.answer.answer },
  ]) });
  assert.equal(writes()[0].headers.get("x-workspace-id"), workspaceId);
  await act(async () => pending.resolve(Response.json(answer("Your balance is $42.", {
    highlights: [{ label: "Available", value: "$42.00", tone: "positive" }],
    evidence: [
      { id: "internal", label: "Account records", detail: "Recorded balance", href: "/transactions?accountId=one" },
      { id: "external", label: "Reference page", detail: "Currency guidance", href: "https://example.test/reference" },
    ],
    followUpQuestions: ["Show my spending categories"],
    scope: { workspaceName: "Household", currency: "SGD", pageTitle: "Dashboard", asOf: "2026-10-01T12:00:00Z", toolsUsed: ["Financial snapshot"] },
  }))));
  await panel.findByText("Your balance is $42.");
  assert.ok(panel.getByText("Available"));
  assert.equal(panel.getByRole("link", { name: /Account records/ }).getAttribute("href"), "/w/" + workspaceId + "/transactions?accountId=one");
  const external = panel.getByRole("link", { name: /Reference page/ });
  assert.equal(external.getAttribute("target"), "_blank");
  assert.equal(external.getAttribute("rel"), "noreferrer");
  assert.ok(panel.getByText("Sources: Financial snapshot"));
  responses.set("POST /api/ai/ask", answer("Spending is grouped by category."));
  fireEvent.click(panel.getByRole("button", { name: "Run suggested action: Show my spending categories." }));
  await panel.findByText("Spending is grouped by category.");
  assert.equal(writes()[1].body.question, "Show my spending categories.");
  assert.deepEqual(writes()[1].body.history.slice(-2), [
    { role: "user", content: "What is my recorded balance?" }, { role: "assistant", content: "Your balance is $42." },
  ]);
  assert.equal(writes()[1].body.history.length, 6);
});

test("answers finish while minimized and survive navigation without another history request", async () => {
  const pending = deferred();
  responses.set("POST /api/ai/ask", () => pending.promise);
  let view = show();
  const panel = await open(view);
  send(panel);
  fireEvent.keyDown(panel.getByRole("textbox"), { key: "Escape" });
  assert.ok(view.getByRole("button", { name: /Reopen Ask Nest. Working on it/ }));
  assert.equal(writes()[0].signal.aborted, false);
  view.unmount();
  await act(async () => pending.resolve(Response.json(answer("Your answer followed you."))));
  view = show({ currentPath: "/investments", pageTitle: "Investments" });
  fireEvent.click(view.getByRole("button", { name: /Reopen Ask Nest/ }));
  await view.findByText("Your answer followed you.");
  assert.equal(requests.filter(({ method }) => method === "GET").length, 1);
  fireEvent.click(within(view.getByRole("dialog", { name: "Ask Nest", exact: true })).getByRole("button", { name: "Minimize Ask Nest" }));
  fireEvent.click(view.getByRole("button", { name: "Hide Ask Nest launcher" }));
  assert.equal(view.queryByRole("button", { name: /Reopen Ask Nest/ }), null);
  assert.equal(ui.window.sessionStorage.getItem("nest:ask-nest:launcher"), null);
});

test("a new workspace loads its own conversation and does not display the previous workspace's answers", async () => {
  responses.set("GET /api/ai/history?limit=10", { turns: [historyTurn("private")], nextCursor: null });
  let view = show();
  await open(view);
  assert.ok(view.getByText("Answer private"));
  view.unmount();
  workspaceId += "-other";
  ui.window.history.replaceState(null, "", "/w/" + workspaceId);
  responses.set("GET /api/ai/history?limit=10", { turns: [], nextCursor: null });
  view = show({ workspaceName: null, userName: null });
  await open(view);
  assert.ok(view.getByText("Answers from this workspace"));
  assert.ok(view.getByRole("heading", { name: "Ask about the money already in Nest" }));
  assert.equal(view.queryByText("Answer private"), null);
  assert.equal(requests.at(-1).headers.get("x-workspace-id"), workspaceId);
});

test("grounding failures preserve their specific error and let the user edit the failed question", async () => {
  responses.set("POST /api/ai/ask", () => Response.json({ error: "Use a narrower date range.", code: "AI_LOOKUP_LIMIT" }, { status: 422 }));
  const view = show();
  const panel = await open(view);
  send(panel, "Compare all my spending");
  const error = await panel.findByRole("alert");
  assert.ok(within(error).getByText("Lookup limit reached"));
  assert.ok(within(error).getByText("Use a narrower date range."));
  fireEvent.click(within(error).getByRole("button", { name: "Edit question" }));
  assert.equal(panel.getByRole("textbox").value, "Compare all my spending");
  await waitFor(() => assert.equal(document.activeElement, panel.getByRole("textbox")));
  assert.equal(writes().length, 1);
});

test("transient answer failures retry the same question once and replace the failed turn", async () => {
  responses.set("POST /api/ai/ask", () => Response.json({ error: "Try again shortly.", code: "AI_TIMEOUT" }, { status: 503 }));
  const view = show();
  const panel = await open(view);
  send(panel);
  await panel.findByText("Request timed out");
  responses.set("POST /api/ai/ask", answer("The retry succeeded."));
  fireEvent.click(panel.getByRole("button", { name: "Retry same question" }));
  await panel.findByText("The retry succeeded.");
  assert.equal(panel.queryByRole("alert"), null);
  assert.equal(panel.getAllByText("What is my recorded balance?").length, 1);
  assert.deepEqual(writes()[1].body, writes()[0].body);
});

test("workspace authorization failures offer a refresh without silently retrying a financial question", async () => {
  responses.set("POST /api/ai/ask", () => Response.json({ error: "Membership changed.", code: "AI_WORKSPACE_UNAVAILABLE" }, { status: 403 }));
  const reload = mock.method(ui.window.location, "reload", () => {});
  const panel = await open(show());
  send(panel);
  await panel.findByText("Workspace unavailable");
  fireEvent.click(panel.getByRole("button", { name: "Refresh page" }));
  assert.equal(reload.mock.callCount(), 1);
  assert.equal(writes().length, 1);
});

for (const [label, response, expected] of [
  ["invalid JSON", () => new Response("unavailable", { status: 503 }), "Ask Nest could not answer right now."],
  ["empty JSON", () => Response.json(null), "Ask Nest could not answer right now."],
  ["network rejection", () => { throw new TypeError("Network disconnected"); }, "Network disconnected"],
]) {
  test("the panel exposes an actionable error for " + label, async () => {
    responses.set("POST /api/ai/ask", response);
    const panel = await open(show());
    send(panel);
    const error = await panel.findByRole("alert");
    assert.ok(within(error).getByText(expected));
    assert.ok(within(error).getByRole("button", { name: "Retry same question" }));
    assert.equal(panel.getByRole("textbox").disabled, false);
  });
}

test("failed initial history can be retried by reopening without losing access to the composer", async () => {
  responses.set("GET /api/ai/history?limit=10", () => Response.json({ error: "History unavailable" }, { status: 503 }));
  const view = show();
  const panel = await open(view);
  assert.ok(panel.getByText("History unavailable"));
  fireEvent.click(panel.getByRole("button", { name: "Minimize Ask Nest" }));
  responses.set("GET /api/ai/history?limit=10", { turns: [historyTurn("restored")], nextCursor: null });
  fireEvent.click(view.getByRole("button", { name: /Reopen Ask Nest/ }));
  await view.findByText("Answer restored");
  assert.equal(view.queryByText("History unavailable"), null);
  assert.equal(requests.length, 2);
});

test("older history is prepended after retry and a rejected clear preserves the conversation", async () => {
  responses.set("GET /api/ai/history?limit=10", { turns: [historyTurn("recent")], nextCursor: "older/next" });
  responses.set("GET /api/ai/history?limit=10&cursor=older%2Fnext", () => Response.json({ error: "Older history unavailable" }, { status: 503 }));
  const view = show();
  const panel = await open(view);
  fireEvent.click(panel.getByRole("button", { name: "Load older conversations" }));
  await panel.findByText("Older history unavailable");
  responses.set("GET /api/ai/history?limit=10&cursor=older%2Fnext", { turns: [historyTurn("older")], nextCursor: null });
  fireEvent.click(panel.getByRole("button", { name: "Load older conversations" }));
  await panel.findByText("Answer older");
  assert.deepEqual([...view.baseElement.querySelectorAll(".ask-nest-question")].map((item) => item.textContent), ["Question older", "Question recent"]);
  assert.equal(panel.queryByRole("button", { name: "Load older conversations" }), null);
  responses.set("DELETE /api/ai/history", () => Response.json({ error: "Unavailable" }, { status: 503 }));
  fireEvent.click(panel.getByRole("button", { name: "Clear conversation history" }));
  await panel.findByText("Could not clear conversation history.");
  assert.ok(panel.getByText("Answer recent"));
  responses.set("DELETE /api/ai/history", {});
  fireEvent.click(panel.getByRole("button", { name: "Clear conversation history" }));
  await panel.findByRole("heading", { name: "Hi Taylor, ask about the money already in Nest" });
  assert.equal(panel.queryByText("Answer recent"), null);
  assert.equal(panel.queryByText("Could not clear conversation history."), null);
});

for (const rating of ["HELPFUL", "NOT_HELPFUL"]) {
  test("feedback retries retain the answer and save " + rating + " against its server turn id", async () => {
    responses.set("POST /api/ai/feedback", () => Response.json({ error: "Feedback unavailable" }, { status: 503 }));
    const panel = await open(show());
    send(panel);
    await panel.findByText("Your recorded balance is $42.");
    const choose = () => {
      if (rating === "HELPFUL") fireEvent.click(panel.getByRole("button", { name: "Mark this answer as helpful" }));
      else fireEvent.click(panel.getByRole("button", { name: "Wrong figures" }));
    };
    if (rating === "NOT_HELPFUL") {
      const toggle = panel.getByRole("button", { name: "Mark this answer as not useful" });
      fireEvent.click(toggle);
      assert.equal(toggle.getAttribute("aria-expanded"), "true");
      fireEvent.click(toggle);
      assert.equal(panel.queryByRole("button", { name: "Wrong figures" }), null);
      fireEvent.click(toggle);
    }
    choose();
    await panel.findByRole("alert");
    assert.ok(panel.getByText("Your recorded balance is $42."));
    responses.set("POST /api/ai/feedback", {});
    choose();
    await panel.findByText("Feedback saved · " + (rating === "HELPFUL" ? "Helpful" : "Not useful"));
    const feedback = writes("/api/ai/feedback");
    assert.equal(feedback.length, 2);
    assert.deepEqual(feedback[1].body, { turnId: "saved-answer", rating, reason: rating === "HELPFUL" ? null : "WRONG_DATA" });
    assert.equal(panel.queryByRole("alert"), null);
  });
}

test("memory edits validate content, preserve rejected changes, and refresh after a newly remembered preference", async () => {
  const saved = memory();
  const other = memory("instruction", { kind: "INSTRUCTION", content: "Explain totals before details" });
  responses.set("GET /api/ai/memory", { memories: [saved, other] });
  responses.set("PATCH /api/ai/memory", () => Response.json({ error: "Preference could not be updated" }, { status: 503 }));
  const view = show();
  const panel = await open(view);
  await showMemory(panel);
  const editor = await panel.findByLabelText("Edit saved preference");
  const item = within(editor.closest("article"));
  assert.equal(item.getByRole("button", { name: "Save", exact: true }).disabled, true);
  fireEvent.change(editor, { target: { value: " x " } });
  assert.equal(item.getByRole("button", { name: "Save", exact: true }).disabled, true);
  fireEvent.change(editor, { target: { value: "  Use tables for spending trends  " } });
  fireEvent.click(item.getByRole("button", { name: "Save", exact: true }));
  await panel.findByText("Preference could not be updated");
  assert.equal(editor.value, "  Use tables for spending trends  ");
  responses.set("PATCH /api/ai/memory", { memory: { ...saved, content: "Use tables for spending trends" } });
  fireEvent.click(item.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => assert.equal(editor.disabled, false));
  assert.equal(item.getByRole("button", { name: "Save", exact: true }).disabled, true);
  assert.equal(panel.getByLabelText("Edit saved instruction").value, other.content);
  assert.equal(requests.filter(({ method }) => method === "PATCH").at(-1).body.content, "Use tables for spending trends");
  fireEvent.click(panel.getByRole("button", { name: "Back to conversation" }));
  await showMemory(panel);
  assert.equal(requests.filter(({ url }) => url.pathname === "/api/ai/memory" && !url.search).filter(({ method }) => method === "GET").length, 1);
  fireEvent.click(panel.getByRole("button", { name: "Return to Ask Nest conversation" }));
  responses.set("POST /api/ai/ask", answer("I will use concise explanations.", { memoryUpdates: ["Use concise explanations"] }));
  send(panel, "Remember that I prefer concise explanations");
  await panel.findByText("Remembered");
  responses.set("GET /api/ai/memory", { memories: [] });
  await showMemory(panel);
  await panel.findByText("No saved preferences yet");
  assert.equal(requests.filter(({ url, method }) => url.pathname === "/api/ai/memory" && method === "GET").length, 2);
});

test("a failed memory load remains recoverable on the next visit to the memory pane", async () => {
  responses.set("GET /api/ai/memory", () => Response.json({ error: "Preferences unavailable" }, { status: 503 }));
  const panel = await open(show());
  await showMemory(panel);
  await panel.findByText("Preferences unavailable");
  fireEvent.click(panel.getByRole("button", { name: "Back to conversation" }));
  responses.set("GET /api/ai/memory", { memories: [memory()] });
  await showMemory(panel);
  await panel.findByLabelText("Edit saved preference");
  assert.equal(panel.queryByText("Preferences unavailable"), null);
});

for (const all of [false, true]) {
  test("forgetting " + (all ? "all memories" : "one memory") + " requires confirmation and preserves data after rejection", async () => {
    const saved = memory();
    responses.set("GET /api/ai/memory", { memories: [saved] });
    const endpoint = "/api/ai/memory" + (all ? "" : "?id=preference%2Fone");
    responses.set("DELETE " + endpoint, () => Response.json({ error: "Unavailable" }, { status: 503 }));
    const view = show();
    const panel = await open(view);
    await showMemory(panel);
    await panel.findByLabelText("Edit saved preference");
    const title = all ? "Clear Ask Nest memory" : "Forget Ask Nest memory";
    const trigger = () => fireEvent.click(panel.getByRole("button", { name: all ? "Forget everything" : "Forget", exact: true }));
    trigger();
    await confirm(view, title, "Cancel");
    assert.equal(requests.some(({ method }) => method === "DELETE"), false);
    trigger();
    await confirm(view, title);
    await panel.findByText(all ? "Could not clear memory." : "Could not forget memory.");
    assert.equal(panel.getByLabelText("Edit saved preference").value, saved.content);
    responses.set("DELETE " + endpoint, {});
    trigger();
    await confirm(view, title);
    await panel.findByText("No saved preferences yet");
    assert.equal(requests.filter(({ method }) => method === "DELETE").length, 2);
  });
}

test("transaction commands open an unsaved draft, accept short replies, and can be reinterpreted as a read-only question", async () => {
  const draft = { draftId: "draft-one", revision: 1, status: "CLARIFY", pending: "budget", choices: [], messages: [{ role: "assistant", content: "Which sub-account should I use?" }] };
  responses.set("POST /api/ai/transactions", ({ body }) => Response.json({ ...draft, revision: 2, status: body.action === "cancel" ? "CANCELLED" : "CLARIFY" }));
  const panel = await open(show());
  send(panel, "Spent $12 on lunch");
  const reply = await panel.findByRole("textbox", { name: "Reply to the transaction draft" });
  await waitFor(() => assert.equal(reply.disabled, false));
  assert.ok(panel.getByText("Nothing is saved until you press Confirm. Drafts expire after 30 minutes."));
  assert.equal(writes().length, 0);
  fireEvent.change(reply, { target: { value: "2" } });
  fireEvent.keyDown(reply, { key: "Enter" });
  await waitFor(() => assert.equal(reply.disabled, false));
  const draftWrites = writes("/api/ai/transactions");
  assert.deepEqual(draftWrites.map(({ body }) => body.action), ["start", "message"]);
  assert.equal(draftWrites[1].body.message, "2");
  fireEvent.click(panel.getByRole("button", { name: "This was a question" }));
  await panel.findByText("Your recorded balance is $42.");
  assert.equal(writes("/api/ai/transactions").at(-1).body.action, "cancel");
  assert.equal(writes().at(-1).body.question, "Spent $12 on lunch");
  assert.ok(panel.getByRole("button", { name: "Record this instead" }));
  assert.equal(writes("/api/ai/transactions").some(({ body }) => body.action === "confirm"), false);
});
