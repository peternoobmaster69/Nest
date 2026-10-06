import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { mock } from "node:test";

const require = createRequire(import.meta.url);
let response;
const requests = [];
mock.module("../lib/workspace-client.ts", { namedExports: { workspaceFetch: async (...args) => { requests.push(args); return response; } } });
const { ApiClientError, apiFetch, classifyMutationFailure, mutationFailureMessage } = require("../lib/api/client.ts");

function online(context, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: value } });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
}

test("API client forwards request options and handles JSON and empty success responses", async () => {
  response = Response.json({ id: "transaction-fixture" });
  const options = { method: "POST", body: "{}" };
  assert.deepEqual(await apiFetch("/api/transactions", options), { id: "transaction-fixture" });
  assert.deepEqual(requests.at(-1), ["/api/transactions", options]);
  response = new Response(null, { status: 204 });
  assert.equal(await apiFetch("/api/transactions"), null);
});

test("API client preserves structured errors and request IDs without relying on a JSON response", async () => {
  response = Response.json({ message: "Invalid amount", code: "INVALID_AMOUNT", requestId: "body-id", issues: { amount: "positive" } }, { status: 422, headers: { "retry-after": "10" } });
  await assert.rejects(apiFetch("/api/transactions"), (error) => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.message, "Invalid amount");
    assert.equal(error.code, "INVALID_AMOUNT");
    assert.equal(error.requestId, "body-id");
    assert.equal(error.retryAfterSeconds, 10);
    assert.deepEqual(error.issues, { amount: "positive" });
    return true;
  });
  response = Response.json({ error: "Denied" }, { status: 403, headers: { "x-request-id": "header-id" } });
  await assert.rejects(apiFetch("/api/transactions"), (error) => error.message === "Denied" && error.requestId === "header-id");
  for (const body of ["invalid JSON", '"a JSON string"', "null", "{}"]) {
    response = new Response(body, { status: 500 });
    await assert.rejects(apiFetch("/api/transactions"), (error) => error.message === "Request failed (500)" && error.requestId === undefined);
  }
});

test("Retry-After accepts HTTP dates and discards malformed dates", async (context) => {
  context.mock.method(Date, "now", () => Date.UTC(2026, 9, 7));
  for (const [header, expected] of [["Wed, 07 Oct 2026 00:00:05 GMT", 5], ["Tue, 06 Oct 2026 00:00:00 GMT", 0], ["invalid", undefined]]) {
    response = new Response("", { status: 503, headers: { "retry-after": header } });
    await assert.rejects(apiFetch("/api/transactions"), (error) => error.retryAfterSeconds === expected);
  }
});

test("mutation errors give the correct recovery advice for offline, permission, conflict, and stale data", (context) => {
  online(context, true);
  for (const [status, kind, phrase] of [[401, "permission", /permission/], [403, "permission", /permission/], [409, "conflict", /changed elsewhere/], [412, "stale", /out of date/], [422, "validation", /fixture/], [503, "offline", /not submitted/], [500, "unknown", /fixture/]]) {
    const error = new ApiClientError("fixture", status, "fixture");
    assert.equal(classifyMutationFailure(error), kind);
    assert.match(mutationFailureMessage(error), phrase);
  }
  assert.equal(classifyMutationFailure(new Error("unknown")), "unknown");
  assert.equal(mutationFailureMessage("unknown"), "The action could not be completed.");
});

test("offline browser state takes precedence over a stale server error", (context) => {
  online(context, false);
  assert.equal(classifyMutationFailure(new ApiClientError("fixture", 403, "FORBIDDEN")), "offline");
});
