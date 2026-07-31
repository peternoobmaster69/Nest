import assert from "node:assert/strict";
import test from "node:test";
import { followUpToUserPrompt } from "../lib/ai/follow-up-prompt.mjs";

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

test("questions already written in the user's voice stay unchanged", () => {
  assert.equal(
    followUpToUserPrompt("How does this compare with last year?"),
    "How does this compare with last year?",
  );
});
