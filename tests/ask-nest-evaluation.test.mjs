import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyAskNestIntent } from "../lib/ai/ask-nest-intent.mjs";

const cases = JSON.parse(await readFile(new URL("../evals/ask-nest/golden.json", import.meta.url), "utf8"));

test("Ask Nest golden routing set covers at least 40 representative questions", () => {
  assert.ok(cases.length >= 40);
  assert.ok(cases.filter((item) => item.retrieval).length >= 8);
});

test("Ask Nest deterministic router meets the checked-in quality gate", () => {
  const failures = cases.flatMap((item) => {
    const actual = classifyAskNestIntent(item.question, item.pagePath);
    const toolPassed = item.expectedTool === null
      ? actual.recommendedTools.length === 0 && actual.intent === item.expectedIntent
      : actual.recommendedTools.includes(item.expectedTool);
    const passed = toolPassed
      && actual.needsHybridRetrieval === item.retrieval;
    return passed ? [] : [{ id: item.id, expected: item.expectedTool, actual }];
  });
  assert.deepEqual(failures, []);
});
