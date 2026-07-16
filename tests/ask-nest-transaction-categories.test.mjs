import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTransactionCategory,
  TRANSACTION_CATEGORY_KEYS,
} from "../lib/ai/transaction-categories.mjs";

const classify = (subject, budgetName = "Everyday spending", details = null) => (
  classifyTransactionCategory({ subject, details, notes: null, budgetName })
);

test("transport classification ignores unrelated sub-account names", () => {
  for (const subject of ["SimplyGo", "TransitLink fare", "SMRT", "Train", "Uber", "CDG Zig taxi"]) {
    const result = classify(subject, "Peter personal");
    assert.equal(result.category, "TRANSPORT", subject);
    assert.equal(result.confidence, "HIGH", subject);
    assert.equal(result.source, "TRANSACTION_TEXT", subject);
  }
});

test("multi-service merchants are disambiguated before their parent brand", () => {
  assert.deepEqual(
    [classify("GrabFood").category, classify("GrabMart").category, classify("Grab Ride").category],
    ["DINING", "GROCERIES", "TRANSPORT"],
  );
  assert.equal(classify("GRAB").confidence, "MEDIUM");
  assert.equal(classify("Gojek").confidence, "MEDIUM");
  assert.equal(classify("Uber Eats").category, "DINING");
});

test("the classifier covers common household spending use cases", () => {
  const cases = [
    ["FairPrice", "GROCERIES"],
    ["Starbucks", "DINING"],
    ["SP Services electricity", "UTILITIES"],
    ["M1 mobile bill", "UTILITIES"],
    ["Monthly rent", "HOUSING"],
    ["Shopee", "SHOPPING"],
    ["H&M", "SHOPPING"],
    ["Netflix", "ENTERTAINMENT"],
    ["Dental clinic", "HEALTHCARE"],
    ["Coursera course fee", "EDUCATION"],
    ["Singapore Airlines flight", "TRAVEL"],
    ["AIA insurance premium", "INSURANCE"],
    ["Hair salon", "PERSONAL_CARE"],
    ["Preschool fee", "CHILDCARE"],
    ["Vet clinic", "PETS"],
    ["Foreign transaction fee", "FEES"],
    ["IRAS income tax", "TAXES"],
    ["Red Cross donation", "GIFTS_CHARITY"],
  ];
  for (const [subject, expected] of cases) {
    const result = classify(subject);
    assert.equal(result.category, expected, subject);
    assert.equal(result.confidence, "HIGH", subject);
  }
  assert.ok(TRANSACTION_CATEGORY_KEYS.length >= 15);
});

test("a clearly named sub-account is only a fallback", () => {
  const fallback = classify("Unrecognized merchant 123", "Transport");
  assert.equal(fallback.category, "TRANSPORT");
  assert.equal(fallback.source, "SUB_ACCOUNT_NAME");

  const unrelated = classify("Unrecognized merchant 123", "Peter personal");
  assert.equal(unrelated.category, "UNKNOWN");
  assert.equal(unrelated.confidence, "NONE");
});
