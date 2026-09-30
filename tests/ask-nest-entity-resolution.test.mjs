import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/ai/entity-resolution.ts", import.meta.url), "utf8");
// The pure scoring rules are shared with the transaction assistant.
const matching = await readFile(new URL("../lib/ai/entity-matching.ts", import.meta.url), "utf8");

test("Ask Nest entity resolution is deterministic and workspace-scoped", () => {
  assert.match(source, /resolveAskNestEntity/);
  assert.match(source, /from "\.\/entity-matching"/);
  assert.match(matching, /CONCEPT_GROUPS/);
  assert.doesNotMatch(matching, /prisma|responses\.create|embeddings\.create/);
  assert.match(source, /where: \{ workspaceId, isActive: true \}/);
  assert.match(source, /resolveAskNestAccount/);
  assert.match(source, /resolveAskNestBudget/);
  assert.match(source, /resolveAskNestCard/);
});

test("Ask Nest normalizes known merchant aliases without sending data to a model", () => {
  assert.match(source, /canonicalizeMerchant/);
  assert.match(source, /FairPrice/);
  assert.match(source, /Starbucks/);
  assert.doesNotMatch(source, /responses\.create|embeddings\.create/);
});
