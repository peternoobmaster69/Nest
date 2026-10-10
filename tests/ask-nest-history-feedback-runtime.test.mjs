import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, dataCalls, given,
  request, require, state,
} from "./finance-route-harness.mjs";

const archiveCalls = [];
let archiveError;
mock.module("../lib/ai/ask-nest-retention.ts", { namedExports: {
  async clearAskNestHistoryPreservingUsage(owner) {
    archiveCalls.push(owner);
    if (archiveError) throw archiveError;
    return { processed: 2, summaries: 1 };
  },
} });
const history = require("../app/api/ai/history/route.ts");
const feedback = require("../app/api/ai/feedback/route.ts");
const read = (query = "") => history.GET(request("GET", undefined, { query: query ? `?${query}` : "" }));
const clear = (options) => history.DELETE(request("DELETE", undefined, options));
const saveFeedback = (body = {}, options) => feedback.POST(request("POST", { turnId: "turn", rating: "HELPFUL", reason: null, ...body }, options));
const createdAt = new Date("2026-10-10T12:00:00.000Z");
const answer = { answer: "Your summary", highlights: [], evidence: [], followUpQuestions: [] };
const turn = (id, overrides = {}) => ({ id, question: `Question ${id}`, answerJson: JSON.stringify({ ...answer, turnId: "stale-id" }), feedbackRating: null, feedbackReason: null, createdAt, ...overrides });

beforeEach((t) => {
  archiveCalls.length = 0;
  archiveError = null;
  t.mock.timers.enable({ apis: ["Date"], now: createdAt });
});

async function bodyOf(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.match(response.headers.get("x-request-id"), /^[a-f\d-]{36}$/);
  return body;
}

test("Ask Nest history returns empty private results scoped to the current user and workspace", async () => {
  given("askNestTurn.findMany", []);
  assert.deepEqual(await bodyOf(await read("workspaceId=private&userId=another")), { turns: [], nextCursor: null });
  assert.deepEqual(accessChecks, [{ workspaceId: undefined, minimumRole: undefined }]);
  assert.deepEqual(dataCalls("askNestTurn.findMany"), [{
    where: { workspaceId: "home", userId: "editor" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 11,
    select: { id: true, question: true, answerJson: true, feedbackRating: true, feedbackReason: true, createdAt: true },
  }]);
  assertNoWrites();
});

test("Ask Nest history paginates newest-first storage into chronological turns with authoritative ids", async () => {
  given("askNestTurn.findMany", [turn("newest", { feedbackRating: "HELPFUL" }), turn("older"), turn("extra")]);
  const result = await bodyOf(await read("cursor=previous&limit=2"));
  assert.deepEqual(result, { turns: [
    { id: "older", question: "Question older", answer: { ...answer, turnId: "older" }, feedbackRating: null, feedbackReason: null, createdAt: createdAt.toISOString() },
    { id: "newest", question: "Question newest", answer: { ...answer, turnId: "newest" }, feedbackRating: "HELPFUL", feedbackReason: null, createdAt: createdAt.toISOString() },
  ], nextCursor: "older" });
  const [query] = dataCalls("askNestTurn.findMany");
  assert.deepEqual(query.cursor, { id: "previous" });
  assert.equal(query.skip, 1);
  assert.equal(query.take, 3);
});

test("corrupt saved answers are skipped without losing the storage pagination cursor", async () => {
  given("askNestTurn.findMany", [turn("corrupt", { answerJson: "{" }), turn("extra")]);
  assert.deepEqual(await bodyOf(await read("limit=1")), { turns: [], nextCursor: "corrupt" });
  given("askNestTurn.findMany", [turn("last")]);
  const last = await bodyOf(await read("cursor=corrupt&limit=1"));
  assert.equal(last.turns[0].id, "last");
  assert.equal(last.nextCursor, null);
});

for (const query of ["limit=0", "limit=21", "limit=1.5", "limit=invalid", "cursor=", `cursor=${"x".repeat(1001)}`]) {
  test(`Ask Nest history rejects the invalid query ${query.slice(0, 30)}`, async () => {
    assert.deepEqual(await bodyOf(await read(query), 400), { error: "Invalid history cursor." });
    assert.deepEqual(dataCalls("askNestTurn.findMany"), []);
  });
}

test("clearing Ask Nest history archives usage for the authenticated owner before returning no content", async () => {
  const response = await clear();
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.ok(response.headers.get("x-request-id"));
  assert.deepEqual(archiveCalls, [{ workspaceId: "home", userId: "editor" }]);
  assert.deepEqual(dataCalls("askNestTurn.deleteMany"), []);
});

for (const [label, execute] of [["clearing history", clear], ["saving feedback", options => saveFeedback({}, options)]]) {
  test(`cross-origin requests cannot perform ${label}`, async () => {
    await bodyOf(await execute({ headers: { origin: "https://untrusted.example" } }), 403);
    assert.deepEqual(accessChecks, []);
    assert.deepEqual(archiveCalls, []);
    assertNoWrites();
  });
}

for (const [label, execute, fail, error] of [
  ["reading history", read, failure => given("askNestTurn.findMany", failure), "Could not load Ask Nest history."],
  ["clearing history", clear, failure => { archiveError = failure; }, "Could not clear Ask Nest history."],
  ["saving feedback", saveFeedback, failure => given("askNestTurn.updateMany", failure), "Could not save Ask Nest feedback."],
]) {
  test(`${label} requires membership and hides private storage failures`, async () => {
    state.accessError = new ApiAuthError(401, "Sign-in required");
    assert.equal((await bodyOf(await execute(), 401)).error, "Sign-in required");
    assert.deepEqual(archiveCalls, []);
    assertNoWrites();
    state.accessError = null;
    fail(new Error("private saved conversation details"));
    const result = await bodyOf(await execute(), 500);
    assert.equal(result.error, error);
    assert.doesNotMatch(JSON.stringify(result), /private saved|conversation details/);
  });
}

for (const invalid of [
  { turnId: " " }, { turnId: "x".repeat(1001) }, { rating: "OTHER" },
  { rating: "NOT_HELPFUL", reason: null }, { rating: "HELPFUL", reason: "WRONG_DATA" },
  { rating: "NOT_HELPFUL", reason: "UNKNOWN" }, { workspaceId: "private" },
]) {
  test(`Ask Nest rejects invalid feedback ${JSON.stringify(invalid).slice(0, 80)}`, async () => {
    assert.deepEqual(await bodyOf(await saveFeedback(invalid), 400), { error: "Choose a valid feedback option." });
    assertNoWrites();
  });
}

for (const [label, options, status] of [
  ["malformed JSON", { rawBody: "{" }, 400],
  ["a non-JSON body", { headers: { "content-type": "text/plain" } }, 415],
  ["an oversized body", { headers: { "content-length": "65537" } }, 413],
]) {
  test(`Ask Nest feedback rejects ${label} without saving`, async () => {
    await bodyOf(await saveFeedback({}, options), status);
    assertNoWrites();
  });
}

for (const [rating, reason] of [["HELPFUL", null], ...["WRONG_DATA", "MISUNDERSTOOD", "MISSING_DETAIL", "NO_RESULTS", "OTHER"].map(reason => ["NOT_HELPFUL", reason])]) {
  test(`Ask Nest feedback stores ${rating}/${reason} under the current owner`, async () => {
    given("askNestTurn.updateMany", { count: 1 });
    assert.deepEqual(await bodyOf(await saveFeedback({ turnId: "  turn  ", rating, reason })), { rating, reason });
    assert.deepEqual(dataCalls("askNestTurn.updateMany"), [{
      where: { id: "turn", workspaceId: "home", userId: "editor" },
      data: { feedbackRating: rating, feedbackReason: reason, feedbackAt: createdAt },
    }]);
  });
}

test("feedback for a missing or private turn returns not-found", async () => {
  given("askNestTurn.updateMany", { count: 0 });
  assert.deepEqual(await bodyOf(await saveFeedback(), 404), { error: "This Ask Nest turn is no longer available." });
  assert.deepEqual(dataCalls("askNestTurn.updateMany")[0].where, { id: "turn", workspaceId: "home", userId: "editor" });
});
