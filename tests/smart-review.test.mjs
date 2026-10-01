import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readAppStyles } from "./read-app-styles.mjs";
import {
  displayMerchantName,
  hasReceivableLanguage,
  isConsistentHistory,
  merchantNameRecommendation,
  merchantFingerprint,
  merchantSimilarity,
} from "../lib/ai/smart-review-core.mjs";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("Smart Review normalizes noisy merchant text without retaining reference numbers", () => {
  assert.equal(merchantFingerprint("VISA POS FAIRPRICE XTRA SG REF 928374"), "fairprice xtra");
  assert.equal(displayMerchantName("VISA POS FAIRPRICE XTRA SG REF 928374"), "Fairprice Xtra");
  assert.equal(displayMerchantName("OCBC POSB HSBC DBS UOB CIMB"), "OCBC POSB HSBC DBS UOB CIMB");
  assert.equal(displayMerchantName("NTUC FAIRPRICE PTE LTD"), "NTUC Fairprice PTE LTD");
  assert.equal(displayMerchantName("McDonald"), "McDonald");
  assert.equal(merchantNameRecommendation("McDonald", "Mcdonald"), null);
  assert.equal(merchantNameRecommendation("VISA POS McDonald SG REF 928374", "McDonald"), "McDonald");
  assert.equal(merchantNameRecommendation("Fairprice Xtra", "FairPrice Xtra"), null);
  assert.ok(merchantSimilarity("McDonald", "MCDONALD'S") >= 0.85);
  assert.ok(merchantSimilarity("FAIRPRICE XTRA #123", "Visa FairPrice Xtra Singapore") >= 0.85);
  assert.ok(merchantSimilarity("FAIRPRICE XTRA", "SINGTEL MOBILE BILL") < 0.25);
});

test("Smart Review reserves strong history for repeated consistent accounting", () => {
  assert.equal(isConsistentHistory(3, 4), true);
  assert.equal(isConsistentHistory(2, 2), false);
  assert.equal(isConsistentHistory(5, 7), false);
  assert.equal(hasReceivableLanguage("Dinner split with family - reimbursement"), true);
  assert.equal(hasReceivableLanguage("Dinner at restaurant"), false);
});

test("Smart Review uses categorized ledger history and named sub-accounts before model assistance", async () => {
  const review = await source("lib/ai/smart-review.ts");

  assert.match(review, /prisma\.transaction\.findMany/);
  assert.match(review, /creditCardTransactionId: null/);
  assert.match(review, /categorizedTransactionCandidates/);
  assert.match(review, /findNamedBudgetMatch/);
  assert.match(review, /already categorized under/);
  assert.match(review, /merchant name closely matches/);
  assert.doesNotMatch(review, /No consistent prior accounting or matching rule was found/);
});

test("Smart Review remains read-only until the existing accounting route approves a fresh suggestion", async () => {
  const review = await source("lib/ai/smart-review.ts");
  const reviewRoute = await source("app/api/ai/smart-review/route.ts");
  const accountingRoute = await source("app/api/credit-transactions/[id]/accounting/route.ts");

  assert.match(reviewRoute, /requireWorkspaceAccess\(\)/);
  assert.match(reviewRoute, /transactionIds:[\s\S]*?max\(250\)/);
  assert.match(review, /store: false/);
  assert.doesNotMatch(review, /creditCardTransaction\.(?:create|update|delete)/);
  assert.doesNotMatch(reviewRoute, /creditCardTransaction\.(?:create|update|delete)/);
  assert.match(accountingRoute, /getSmartReviewFingerprint/);
  assert.match(accountingRoute, /suggestion is stale/);
  assert.match(accountingRoute, /claimCreditCardTransaction/);
  assert.match(accountingRoute, /executePosting/);
});

test("Smart Review is scoped to unaccounted transactions and uses accounted history as evidence", async () => {
  const review = await source("lib/ai/smart-review.ts");
  const component = await source("components/credit-transactions-page.tsx");
  const types = await source("lib/ai/smart-review-types.ts");
  const styles = await readAppStyles(root);

  assert.match(review, /id: \{ in: params\.transactionIds \}, isAllocated: false/);
  assert.match(review, /workspaceId: params\.workspaceId, isAllocated: true/);
  assert.match(review, /!transaction\.isAllocated &&[\s\S]*?confidence === "STRONG_MATCH"/);
  assert.match(component, /filteredTransactions\.filter\(\(transaction\) => !transaction\.isAllocated\)/);
  assert.match(component, /isSmartReviewMode &&[\s\S]*?!tx\.isAllocated &&[\s\S]*?reviewSuggestion/);
  assert.doesNotMatch(component, /already accounted|Open posting|currentAccounting/);
  assert.doesNotMatch(types, /ACCOUNTED_ALIGNED|ACCOUNTED_MISMATCH|ACCOUNTED_UNVERIFIED/);
  assert.match(styles, /\.cct-smart-review-body\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.cct-smart-review-body\s*\{[\s\S]*?grid-template-columns: 1fr/);
});

test("Smart Review suggestions expose concrete name and accounting actions", async () => {
  const review = await source("lib/ai/smart-review.ts");
  const component = await source("components/credit-transactions-page.tsx");
  const styles = await readAppStyles(root);

  assert.match(component, /Transaction name updated to/);
  assert.match(component, /"Update name"/);
  assert.match(component, /Boolean\(reviewSuggestion\?\.nameRecommendation\)/);
  assert.match(component, /\{hasNameRecommendation \? \([\s\S]*?Name recommendation[\s\S]*?\) : null\}/);
  assert.doesNotMatch(component, /Name check|No name change suggested/);
  assert.match(component, /Review &amp; apply/);
  assert.match(component, /\sDeduct\s/);
  assert.match(component, /\sCreate receivable\s/);
  assert.match(component, />Dismiss all</);
  assert.match(component, /ready to approve/);
  assert.match(component, /a category/);
  assert.doesNotMatch(component, /\{smartReviewCounts\.strong\} strong/);
  assert.doesNotMatch(component, /smart-review-provider-note|providerMessage/);
  assert.doesNotMatch(review, /AI-assisted matching was limited/);
  assert.match(review, /return displayMerchantName\(generated\)/);
  assert.match(styles, /\.cct-smart-review-summary-actions\s*\{[^}]*display:\s*flex/s);
});
