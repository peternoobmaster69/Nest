import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTransactionCategory,
  TRANSACTION_CATEGORY_KEYS,
  TRANSACTION_CATEGORY_LABELS,
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

test("all merchant rule groups retain their word boundaries and specific service priorities", () => {
  const cases = [
    ["GoCar", "TRANSPORT", "RIDE_HAILING"], ["Grab Transport", "TRANSPORT", "RIDE_HAILING"],
    ["EZ Link", "TRANSPORT", "PUBLIC_TRANSIT"], ["Bus ticket", "TRANSPORT", "PUBLIC_TRANSIT"],
    ["Train fare", "TRANSPORT", "PUBLIC_TRANSIT"], ["Go Mart", "GROCERIES", "GROCERY_DELIVERY"],
    ["Supermarket", "GROCERIES", "SUPERMARKET"], ["Café", "DINING", "RESTAURANT_CAFE"],
    ["Water bill", "UTILITIES", "HOUSEHOLD_UTILITY"], ["Geneco", "UTILITIES", "HOUSEHOLD_UTILITY"],
    ["Condo management", "HOUSING", "HOUSING_PAYMENT"], ["Booking.com", "TRAVEL", "FLIGHT_HOTEL"],
    ["Shaw theatres", "ENTERTAINMENT", "MEDIA_GAMING"], ["Xbox", "ENTERTAINMENT", "MEDIA_GAMING"],
    ["Bank fee", "FEES", "FINANCIAL_FEE"], ["Administration fee", "FEES", "FINANCIAL_FEE"],
  ];
  for (const [subject, category, rule] of cases) {
    assert.deepEqual(classify(subject), { category, label: TRANSACTION_CATEGORY_LABELS[category], confidence: "HIGH", source: "TRANSACTION_TEXT", rule });
  }
  for (const subject of ["Transitively Digital", "Maxwell", "Cabinet makers", "Taxidermy", "Steamworks"]) {
    assert.equal(classify(subject).category, "UNKNOWN", subject);
  }
});

test("sub-account aliases handle normalization and whole phrases at either end", () => {
  for (const budgetName of ["Transit", "Bus/MRT", "Transport commute", "Family transport", " Bus / MRT "]) {
    const result = classify("Unrecognized merchant", budgetName);
    assert.equal(result.category, "TRANSPORT", budgetName);
    assert.equal(result.source, "SUB_ACCOUNT_NAME", budgetName);
  }
  for (const budgetName of ["Transported", "Mytransport", "Transportationplus"]) assert.equal(classify("Unrecognized merchant", budgetName).category, "UNKNOWN", budgetName);
  assert.equal(classify("Grab", "Groceries").confidence, "MEDIUM");
  assert.equal(classify("GrabFood", "Transport").category, "DINING");
});

test("empty transactions remain uncategorized and descriptions and notes provide merchant evidence", () => {
  assert.deepEqual(classifyTransactionCategory({}), { category: "UNKNOWN", label: "Uncategorized", confidence: "NONE", source: "NONE", rule: "NO_MATCH" });
  assert.equal(classifyTransactionCategory({ subject: null, details: "Foodpanda", notes: null }).category, "DINING");
  assert.equal(classifyTransactionCategory({ notes: "Guardian pharmacy" }).category, "HEALTHCARE");
});
