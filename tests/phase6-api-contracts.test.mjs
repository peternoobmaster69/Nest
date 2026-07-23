import assert from "node:assert/strict";
import test from "node:test";
import { chunkValues } from "../lib/api/batching.ts";
import { decodeCursor, toListEnvelope } from "../lib/api/pagination.ts";
import { ApiClientError, apiFetch } from "../lib/api/client.ts";
import { BulkImportSchema, ImportMaybankSchema } from "../lib/domains/integrations/import-contracts.ts";

test("cursor envelopes expose only the requested page", () => {
  const page = toListEnvelope(
    [{ id: "3", date: "2026-03-03" }, { id: "2", date: "2026-03-02" }, { id: "1", date: "2026-03-01" }],
    2,
    (row) => ({ id: row.id, sortValue: row.date }),
  );
  assert.deepEqual(page.items.map((row) => row.id), ["3", "2"]);
  assert.equal(page.pageInfo.hasMore, true);
  assert.deepEqual(decodeCursor(page.pageInfo.nextCursor), { id: "2", sortValue: "2026-03-02" });
  assert.throws(() => decodeCursor("not-a-cursor"), /Invalid cursor/);
});

test("SQL-safe batching never emits an oversized batch", () => {
  const batches = chunkValues(Array.from({ length: 125 }, (_, index) => index));
  assert.deepEqual(batches.map((batch) => batch.length), [50, 50, 25]);
  assert.deepEqual(batches.flat(), Array.from({ length: 125 }, (_, index) => index));
  assert.throws(() => chunkValues([1], 0), /Batch size/);
});

test("import contracts reject oversized chunks and content", () => {
  const transaction = {
    Direction: "DEBIT",
    Subject: "Test",
    Date: "2026-07-23",
    AmountCents: 100,
  };
  assert.equal(BulkImportSchema.safeParse({
    workspaceId: "workspace",
    accountId: "account",
    budgetId: "budget",
    transactions: Array.from({ length: 250 }, () => transaction),
  }).success, true);
  assert.equal(BulkImportSchema.safeParse({
    workspaceId: "workspace",
    accountId: "account",
    budgetId: "budget",
    transactions: Array.from({ length: 251 }, () => transaction),
  }).success, false);
  assert.equal(ImportMaybankSchema.safeParse({
    creditCardId: "card",
    csvContent: "x".repeat(512 * 1024 + 1),
  }).success, false);
});

test("typed API client preserves conflict and rate-limit metadata", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: "Conflict", code: "CONFLICT", requestId: "request-1" }),
    { status: 409, headers: { "Content-Type": "application/json", "Retry-After": "7" } },
  );
  await assert.rejects(
    () => apiFetch("https://example.test/api"),
    (error) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "CONFLICT");
      assert.equal(error.requestId, "request-1");
      assert.equal(error.retryAfterSeconds, 7);
      return true;
    },
  );
});

