import assert from "node:assert/strict";
import test from "node:test";
import { resolveGroupMembership } from "../lib/transaction-group-membership.ts";

test("membership changes preserve hidden members, deduplicate originals, and ignore unchanged selections", () => {
  const original = ["visible", "hidden", "removed", "hidden"];
  const changes = { visible: true, unknown: false, added: true, removed: false };
  const result = resolveGroupMembership(original, changes);
  assert.deepEqual([...result.selectedIds], ["visible", "hidden", "added"]);
  assert.deepEqual(result.addTransactionIds, ["added"]);
  assert.deepEqual(result.removeTransactionIds, ["removed"]);
  assert.deepEqual(original, ["visible", "hidden", "removed", "hidden"]);
  assert.deepEqual(changes, { visible: true, unknown: false, added: true, removed: false });
});

test("an untouched empty group requires no membership changes", () => {
  const result = resolveGroupMembership([], {});
  assert.equal(result.selectedIds.size, 0);
  assert.deepEqual(result.addTransactionIds, []);
  assert.deepEqual(result.removeTransactionIds, []);
});
