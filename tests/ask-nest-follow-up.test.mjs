import assert from "node:assert/strict";
import test from "node:test";
import { followUpToUserPrompt, normalizeFollowUpActions } from "../lib/ai/follow-up-prompt.mjs";

test("assistant-style follow-ups become direct user prompts when selected", () => {
  assert.equal(
    followUpToUserPrompt("Do you want me to compare this against Singapore public retirement spending benchmarks?"),
    "Compare this against Singapore public retirement spending benchmarks.",
  );
  assert.equal(
    followUpToUserPrompt("Do you want to test how much extra contribution would create a wider buffer?"),
    "Test how much extra contribution would create a wider buffer.",
  );
  assert.equal(
    followUpToUserPrompt("Would you like me to show the bear scenario?"),
    "Show the bear scenario.",
  );
});

test("question-shaped follow-ups become commands", () => {
  assert.equal(
    followUpToUserPrompt("How does this compare with last year?"),
    "Compare this with last year.",
  );
  assert.equal(followUpToUserPrompt("Why did spending increase?"), "Explain the reason for spending increase.");
  assert.equal(followUpToUserPrompt("What are my largest investments?"), "Show my largest investments.");
  assert.equal(followUpToUserPrompt("Can you break this down by asset class?"), "Break this down by asset class.");
});

test("normalized next actions contain no questions and are deduplicated", () => {
  const actions = normalizeFollowUpActions([
    "Would you like me to show the bear scenario?",
    "Show the bear scenario.",
    "Which accounts need review?",
  ]);
  assert.deepEqual(actions, ["Show the bear scenario.", "Show which accounts need review."]);
  assert.ok(actions.every((action) => !action.includes("?") && /\.$/.test(action)));
});
