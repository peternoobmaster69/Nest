import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const requests = [];
let response;
mock.module("../lib/workspace-client.ts", { namedExports: { workspaceFetch: async (url, options) => {
  requests.push({ url, ...options, body: JSON.parse(options.body) });
  if (response instanceof Error) throw response;
  return response;
} } });
const require = createRequire(import.meta.url);
const { saveEarnTransaction } = require("../components/rewards/earn-history-client.ts");
const input = { frequentFlyerId: "miles", date: "2026-10-09", miles: 1200 };
beforeEach(() => { requests.length = 0; response = new Response(null, { status: 204 }); });

test("earned miles are posted at UTC midnight and absent expiry or title values retain their API meaning", async () => {
  assert.equal(await saveEarnTransaction(input, "POST"), undefined);
  assert.deepEqual(requests, [{ url: "/api/rewards/frequent-flyer/history", method: "POST", headers: { "Content-Type": "application/json" }, body: { type: "earn", frequentFlyerId: "miles", date: "2026-10-09T00:00:00.000Z", miles: 1200, expiryDate: null } }]);
  assert.deepEqual(input, { frequentFlyerId: "miles", date: "2026-10-09", miles: 1200 });
});

test("updating earned miles retains the record identity and normalizes both dates", async () => {
  await saveEarnTransaction({ ...input, id: "earn-one", title: "Flight credit", expiryDate: "2029-10-09" }, "PATCH");
  assert.equal(requests[0].method, "PATCH");
  assert.deepEqual(requests[0].body, { type: "earn", frequentFlyerId: "miles", id: "earn-one", date: "2026-10-09T00:00:00.000Z", miles: 1200, title: "Flight credit", expiryDate: "2029-10-09T00:00:00.000Z" });
});

test("server rejections preserve a useful message even when error JSON is absent or malformed", async () => {
  for (const [method, rejected, message] of [
    ["POST", Response.json({ error: "Insufficient permission" }, { status: 403 }), "Insufficient permission"],
    ["POST", Response.json({}, { status: 500 }), "Failed to add earn transaction"],
    ["PATCH", Response.json(null, { status: 503 }), "Failed to update earn transaction"],
    ["PATCH", new Response("Service unavailable", { status: 503 }), "Failed to update earn transaction"],
  ]) {
    response = rejected;
    await assert.rejects(saveEarnTransaction(input, method), { message });
  }
  response = new Error("Network unavailable");
  await assert.rejects(saveEarnTransaction(input, "POST"), (error) => error === response);
});

test("invalid dates fail before a rewards request is sent", async () => {
  await assert.rejects(saveEarnTransaction({ ...input, date: "invalid" }, "POST"), RangeError);
  await assert.rejects(saveEarnTransaction({ ...input, expiryDate: "invalid" }, "PATCH"), RangeError);
  assert.equal(requests.length, 0);
});
