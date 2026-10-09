import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, beforeEach, mock } from "node:test";

export const require = createRequire(import.meta.url);
export const calls = [];
export const accessChecks = [];
export const state = {};
let responses;
const unexpected = [];

export class ApiAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function given(name, ...values) {
  responses.set(name, [...values]);
}

export function invocations(name) {
  return calls.filter((call) => call.name === name);
}

function invoke(name, args) {
  calls.push({ name, args, inPosting: state.inPosting, inTransaction: state.inTransaction });
  const values = responses.get(name);
  if (!values?.length) {
    unexpected.push(name);
    throw new Error(`Unexpected fixture call: ${name}`);
  }
  const value = values.shift();
  if (value instanceof Error) throw value;
  return typeof value === "function" ? value(...args) : value;
}

const models = new Map();
export const prisma = new Proxy({}, {
  get(_target, name) {
    if (name === "$transaction") return async (callback, options) => {
      calls.push({ name: "$transaction", args: [options] });
      state.inTransaction = true;
      try { return await callback(prisma); } finally { state.inTransaction = false; }
    };
    if (name.startsWith("$")) return async (...args) => invoke(name, args);
    if (!models.has(name)) models.set(name, new Proxy({}, {
      get(_model, method) { return async (...args) => invoke(`${name}.${method}`, args); },
    }));
    return models.get(name);
  },
});

mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/workspace-auth.ts", { namedExports: {
  ApiAuthError,
  async requireWorkspaceAccess(workspaceId, minimumRole) {
    accessChecks.push({ workspaceId, minimumRole });
    const error = state.accessError ?? state.workspaceErrors.get(workspaceId);
    if (error) throw error;
    return { workspaceId: workspaceId ?? "home", userId: "editor", role: minimumRole ?? "VIEWER" };
  },
  async requireSensitiveWorkspaceAction(workspaceId) {
    accessChecks.push({ workspaceId, sensitive: true });
    if (state.accessError) throw state.accessError;
    return { workspaceId, userId: "owner", role: "OWNER" };
  },
  async requireRecentAuthentication() { throw new Error("Unexpected recent-authentication check"); },
} });
mock.module("../lib/observability/logger.ts", { namedExports: {
  logEvent(...args) { calls.push({ name: "log", args }); },
} });
mock.module("../lib/active-workspace.ts", { namedExports: {
  async getActiveWorkspaceCookie() { return state.activeCookie; },
  setActiveWorkspaceCookie(response, workspaceId) {
    calls.push({ name: "cookie.set", args: [workspaceId] });
    return response;
  },
  clearActiveWorkspaceCookie(response) {
    calls.push({ name: "cookie.clear", args: [] });
    return response;
  },
} });
mock.module("../lib/ai/smart-review.ts", { namedExports: {
  async getSmartReviewFingerprint(...args) { return invoke("smartReview.fingerprint", args); },
  isSmartReviewGeneratedAtFresh(...args) { return invoke("smartReview.fresh", args); },
} });

const ledger = require("../lib/posting-service.ts");
export const { PostingConflictError, PostingValidationError } = ledger;
mock.module("../lib/domains/ledger/index.ts", { namedExports: {
  ...ledger,
  async executePosting(operation, callback) {
    calls.push({ name: "posting", args: [operation] });
    if (state.postingError) throw state.postingError;
    if (state.replayedPosting) return state.replayedPosting;
    state.inPosting = true;
    try {
      return { result: await callback(prisma, "posting-group"), postingGroupId: "posting-group", replayed: false };
    } finally { state.inPosting = false; }
  },
  async reverseLedgerTransaction(...args) { return invoke("ledger.reverse", args); },
  async correctLedgerTransaction(...args) { return invoke("ledger.correct", args); },
} });

beforeEach((t) => {
  calls.length = 0;
  accessChecks.length = 0;
  unexpected.length = 0;
  responses = new Map();
  Object.assign(state, {
    accessError: null, workspaceErrors: new Map(), activeCookie: null,
    postingError: null, replayedPosting: null, inPosting: false, inTransaction: false,
  });
  const previous = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = "https://nest.example.test";
  t.after(() => {
    if (previous === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previous;
  });
});
afterEach(() => assert.deepEqual(unexpected, [], "No route failure may hide a missing test fixture"));

export function request(method, body, { query = "", headers = {}, rawBody } = {}) {
  return new Request(`https://nest.example.test/api/finance/record${query}`, {
    method,
    headers: { "content-type": "application/json", origin: "https://nest.example.test", "idempotency-key": "operation-once", ...headers },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}
export const context = (id = "record") => ({ params: Promise.resolve({ id }) });

export async function responseBody(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.match(response.headers.get("x-request-id"), /^[a-f\d-]{36}$/);
  return body;
}

export function dataCalls(name) {
  return invocations(name).map(({ args: [query] }) => query);
}

export function assertNoWrites() {
  assert.deepEqual(calls.filter(({ name }) => /\.(?:create|update|delete|upsert)/.test(name) || name === "$executeRaw" || name === "posting"), []);
}
