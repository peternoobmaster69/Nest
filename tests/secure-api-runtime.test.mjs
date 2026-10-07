import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const { z } = require("zod");
const calls = [];
let auth, recentUser, authFailure;
class AuthError extends Error { constructor(status, message) { super(message); this.status = status; } }
mock.module("../lib/prisma.ts", { namedExports: { prisma: {} } });
mock.module("../lib/workspace-auth.ts", { namedExports: {
  ApiAuthError: AuthError,
  async requireWorkspaceAccess(...args) { calls.push({ type: "auth", args }); if (authFailure) throw authFailure; return auth; },
  async requireRecentAuthentication() { calls.push({ type: "recent" }); return recentUser; },
} });
mock.module("../lib/observability/logger.ts", { namedExports: { logEvent: (...args) => calls.push({ type: "log", args }) } });
const { runSecureApiRoute: run, parseJsonBody, assertSameOriginRequest, ApiRequestError } = require("../lib/api-security.ts");
const request = (path = "/api/fixture", options = {}) => new Request(`https://nest.example.test${path}`, options);
const logs = () => calls.filter(({ type }) => type === "log").map(({ args }) => args);
beforeEach((t) => {
  calls.length = 0; auth = { userId: "owner", workspaceId: "home", role: "OWNER" }; recentUser = "owner"; authFailure = null;
  const previous = process.env.NEXTAUTH_URL;
  t.after(() => { if (previous === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = previous; });
  delete process.env.NEXTAUTH_URL;
});

test("successful public and authenticated routes attach request identity and preserve intentional cache variation", async () => {
  for (const [options, initialHeaders, vary, cache] of [
    [{}, {}, "Cookie", "no-store"],
    [{ noStore: false }, { Vary: "Accept", "Cache-Control": "private, max-age=10" }, "Accept, Cookie", "private, max-age=10"],
    [{ auth: { workspaceId: "home" } }, { Vary: "Accept, cOoKiE" }, "Accept, cOoKiE", "no-store"],
    [{ auth: { workspaceId: "home", minimumRole: "EDITOR", recent: true } }, {}, "Cookie", "no-store"],
  ]) {
    const response = await run(request(), options, async (context) => {
      assert.match(context.requestId, /^[\da-f-]{36}$/);
      assert.equal(context.auth, options.auth ? auth : undefined);
      return Response.json({ requestId: context.requestId }, { headers: initialHeaders });
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("vary"), vary);
    assert.equal(response.headers.get("cache-control"), cache);
    assert.equal(response.headers.get("x-request-id"), (await response.json()).requestId);
    assert.equal(logs().at(-1)[2].outcome, "success");
  }
  assert.deepEqual(calls.filter(({ type }) => type === "auth").map(({ args }) => args), [["home", "VIEWER"], ["home", "EDITOR"]]);
  assert.equal(calls.filter(({ type }) => type === "recent").length, 1);
  const response = await run(request(), {}, async () => new Response(null, { status: 503 }));
  assert.equal(response.status, 503);
  assert.equal(logs().at(-1)[2].outcome, "error");
});

test("cross-origin mutations and mismatched re-authentication never reach the handler", async () => {
  let handled = 0;
  const handler = async () => { handled += 1; return Response.json({ ok: true }); };
  for (const headers of [{ origin: "https://other.example.test" }, { "sec-fetch-site": "cross-site" }]) {
    const response = await run(request("/api/fixture", { method: "POST", headers }), { mutation: true }, handler);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "FORBIDDEN");
  }
  recentUser = "another-user";
  const response = await run(request(), { auth: { recent: true } }, handler);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "Unauthorized");
  assert.equal(handled, 0);
  authFailure = new AuthError(403, "Workspace access denied");
  assert.equal((await run(request(), { auth: {} }, handler)).status, 403);
  assert.equal(handled, 0);
});

test("known failures preserve safe details, validation issues, retry hints, and no-store even on cacheable routes", async () => {
  const validation = z.object({ name: z.string().min(1) }).safeParse({ name: "" }).error;
  for (const [error, status, code, level, retryAfter] of [
    [new ApiRequestError(409, "The record changed", "RECORD_CHANGED"), 409, "RECORD_CHANGED", "info", null],
    [new AuthError(401, "Sign in"), 401, "UNAUTHENTICATED", "info", null],
    [validation, 422, "UNPROCESSABLE_ENTITY", "info", null],
    [Object.assign(new Error("Too many"), { retryAfter: 12 }), 429, "RATE_LIMITED", "warn", "12"],
    [Object.assign(new Error("Connection unavailable"), { code: "P1001" }), 503, "DATABASE_UNAVAILABLE", "error", "5"],
  ]) {
    const response = await run(request(), { noStore: false }, async () => { throw error; });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), retryAfter);
    const payload = await response.json();
    assert.equal(payload.code, code);
    if (status === 422) assert.ok(payload.issues.fieldErrors.name.length);
    if (status !== 429) assert.equal(payload.requestId, response.headers.get("x-request-id"));
    assert.equal(logs().at(-1)[0], level);
    assert.equal(logs().at(-1)[1], "api.request");
  }
});

test("unexpected failures return a stable public error and log diagnostics only through the redacting logger", async () => {
  for (const [error, options, expected] of [[new Error("private internals"), {}, "Request failed"], ["private internals", { errorMessage: "Could not save" }, "Could not save"]]) {
    const response = await run(request("/api/fixture?token=private"), options, async () => { throw error; });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, expected);
    const [unhandled, requestLog] = logs().toReversed();
    assert.equal(unhandled[1], "api.unhandled_error");
    assert.equal(unhandled[2].error, error);
    assert.equal(requestLog[2].errorType, error instanceof Error ? "Error" : "UnknownError");
    assert.equal(requestLog[2].route, "/api/fixture");
  }
});

test("same-origin validation respects the configured canonical origin and permits same-site requests without an Origin", () => {
  assert.doesNotThrow(() => assertSameOriginRequest(request()));
  assert.doesNotThrow(() => assertSameOriginRequest(request("/api/fixture", { headers: { origin: "https://nest.example.test" } })));
  process.env.NEXTAUTH_URL = " https://canonical.example.test/path ";
  assert.doesNotThrow(() => assertSameOriginRequest(request("/api/fixture", { headers: { origin: "https://canonical.example.test" } })));
  assert.throws(() => assertSameOriginRequest(request("/api/fixture", { headers: { origin: "https://nest.example.test" } })), { status: 403 });
});

test("JSON parsing accepts structured media types and enforces declared and actual UTF-8 byte limits", async () => {
  const schema = z.object({ title: z.string() });
  const body = JSON.stringify({ title: "£" });
  for (const contentType of ["application/json", " Application/JSON ; charset=utf-8", "application/problem+json"]) {
    const input = request("/api/fixture", { method: "POST", body, headers: { "content-type": contentType } });
    assert.deepEqual(await parseJsonBody(input, schema), { title: "£" });
  }
  for (const headers of [{}, { "content-type": "text/plain" }]) {
    await assert.rejects(parseJsonBody(request("/api/fixture", { method: "POST", body, headers }), schema), { status: 415 });
  }
  await assert.rejects(parseJsonBody(request("/api/fixture", { method: "POST", body, headers: { "content-type": "application/json", "content-length": "1000" } }), schema, 100), { status: 413 });
  await assert.rejects(parseJsonBody(request("/api/fixture", { method: "POST", body, headers: { "content-type": "application/json", "content-length": "invalid" } }), schema, body.length), { status: 413 });
  await assert.rejects(parseJsonBody(request("/api/fixture", { method: "POST", body: "{", headers: { "content-type": "application/json" } }), schema), { status: 400 });
  await assert.rejects(parseJsonBody(request("/api/fixture", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), schema), z.ZodError);
});
