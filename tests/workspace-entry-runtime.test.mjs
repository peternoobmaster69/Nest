import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { mock } from "node:test";

const require = createRequire(import.meta.url);
const accesses = [];
let accessError;
class ApiAuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
mock.module("../lib/workspace-auth.ts", { namedExports: {
  ApiAuthError,
  requireWorkspaceAccess: async (workspaceId) => {
    accesses.push(workspaceId);
    if (accessError) throw accessError;
    return { workspaceId: workspaceId ?? "current-workspace" };
  },
} });
const { GET } = require("../app/entry/route.ts");

test("workspace entry uses a relative redirect that preserves the browser's authenticated origin", async () => {
  for (const origin of ["http://localhost:3100", "http://127.0.0.1:3100", "https://save.example.test"]) {
    const response = await GET(new Request(`${origin}/entry`));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/w/current-workspace");
    assert.equal(accesses.at(-1), undefined);
  }
});

test("workspace entry verifies the requested tenant and retains internal query and fragment state", async () => {
  const params = new URLSearchParams({ workspaceId: " requested-workspace ", next: "/transactions?period=all#history" });
  const response = await GET(new Request(`http://localhost:3100/entry?${params}`));
  assert.equal(accesses.at(-1), "requested-workspace");
  assert.equal(response.headers.get("location"), "/w/requested-workspace/transactions?period=all#history");
});

test("workspace entry does not allow an external destination", async () => {
  for (const next of ["https://attacker.example", "//attacker.example", "/\\attacker.example"]) {
    const response = await GET(new Request(`https://save.example.test/entry?${new URLSearchParams({ next })}`));
    assert.equal(response.headers.get("location"), "/w/current-workspace");
  }
});

test("unauthenticated entry preserves the callback on the same origin", async () => {
  accessError = new ApiAuthError(401, "Unauthorized");
  try {
    const response = await GET(new Request("http://localhost:3100/entry?workspaceId=private&next=%2Fsettings"));
    assert.equal(response.status, 307);
    const location = response.headers.get("location");
    assert.ok(location.startsWith("/login?"));
    const login = new URL(location, "http://127.0.0.1:3100");
    assert.equal(login.origin, "http://127.0.0.1:3100");
    assert.equal(login.searchParams.get("callbackUrl"), "/entry?workspaceId=private&next=%2Fsettings");
  } finally { accessError = undefined; }
});

test("entry distinguishes denied access from internal failures without exposing internals", async () => {
  try {
    accessError = new ApiAuthError(403, "Workspace access denied");
    const denied = await GET(new Request("https://save.example.test/entry"));
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "Workspace access denied" });
    accessError = new Error("private database diagnostic");
    const log = mock.method(console, "error", () => {});
    const unavailable = await GET(new Request("https://save.example.test/entry"));
    assert.equal(unavailable.status, 500);
    assert.deepEqual(await unavailable.json(), { error: "Unable to open workspace" });
    assert.equal(log.mock.callCount(), 1);
    log.mock.restore();
  } finally { accessError = undefined; }
});
