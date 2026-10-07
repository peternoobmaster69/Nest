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

test("follow-up phrasing handles incomplete questions, punctuation, and bounded action labels", () => {
  for (const value of [undefined, null, "", "   "]) assert.equal(followUpToUserPrompt(value), "Review the available details.");
  const cases = [
    ["Could you show savings?!..", "Show savings."],
    ["Can you ?", "Review the available details."],
    ["Why so high?", "Explain why so high."],
    ["Where did the money go?", "Show where did the money go."],
    ["Could I retire sooner?", "Assess whether I could retire sooner."],
    ["How do accounts compare with savings?", "Compare accounts with savings."],
    ["How do accounts compare", "Show how do accounts compare."],
    ["How do accounts differ?", "Show how do accounts differ."],
    ["How do compare savings", "Show how do compare savings."],
    ["Break down expenses", "Break down expenses."],
    ["Accounts and savings", "Review accounts and savings."],
    ["SHOW  all\naccounts?", "SHOW all accounts."],
  ];
  for (const [question, expected] of cases) assert.equal(followUpToUserPrompt(question), expected, question);
  const bounded = followUpToUserPrompt(`Show ${"x".repeat(400)}`);
  assert.equal(bounded.length, 179);
  assert.ok(bounded.endsWith("."));
  assert.deepEqual(normalizeFollowUpActions(), []);
  assert.equal(normalizeFollowUpActions(["Show a", "Show b", "Show c", "Show d"]).length, 3);
});
