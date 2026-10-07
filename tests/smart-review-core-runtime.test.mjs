import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import * as native from "../lib/ai/smart-review-core.mjs";

const commonjs = createRequire(import.meta.url)("../lib/ai/smart-review-core.mjs");

for (const [format, core] of [["ESM", native], ["CommonJS", commonjs]]) {
  test(`${format}: merchant normalization handles empty, accented, noisy, and long bank descriptions`, () => {
    assert.equal(core.normalizeSmartReviewText(null), "");
    assert.equal(core.normalizeSmartReviewText("  Café & Tea 928374 SG "), "cafe and tea sg");
    assert.equal(core.merchantFingerprint("Acme Acme Grocer VISA POS REF 928374"), "acme grocer");
    assert.equal(core.merchantFingerprint("one two three four five six seven eight nine"), "one two three four five six seven eight");
    for (const value of [null, undefined, "", "   "]) assert.equal(core.displayMerchantName(value), "Transaction");
    assert.equal(core.displayMerchantName("  VISA POS 928374  "), "VISA POS 928374");
    assert.equal(core.displayMerchantName("9".repeat(90)), "9".repeat(80));
    assert.equal(core.displayMerchantName("NTUC IKEA mcdonalds HSBC cafe shop extra"), "NTUC IKEA McDonalds HSBC Cafe Shop");
  });

  test(`${format}: merchant similarity requires meaningful evidence on both sides`, () => {
    assert.equal(core.merchantSimilarity(null, "Acme"), 0);
    assert.equal(core.merchantSimilarity("Acme", "VISA 928374"), 0);
    assert.equal(core.merchantSimilarity("Acme Grocer", "Acme Grocer"), 1);
    assert.equal(core.merchantSimilarity("Acme", "Acme Grocer"), 0.86);
    assert.equal(core.merchantSimilarity("Acme Grocer", "Acme"), 0.86);
    assert.equal(core.merchantSimilarity("Acme Shop", "Other Shop"), 1 / 3);
  });

  test(`${format}: name recommendations remove noise without changing merchant identity`, () => {
    assert.equal(core.merchantNameRecommendation("VISA POS Acme Grocer SG REF 928374"), "Acme Grocer");
    assert.equal(core.merchantNameRecommendation(null, "Acme"), null);
    assert.equal(core.merchantNameRecommendation("Acme", null), null);
    assert.equal(core.merchantNameRecommendation("###", "Acme"), null);
    assert.equal(core.merchantNameRecommendation("Café Shop", "CAFE SHOP"), null);
    assert.equal(core.merchantNameRecommendation("Acme Shop", "Other Shop"), null);
    assert.equal(core.merchantNameRecommendation("Acme Grocer", "Acme POS"), "Acme POS");
    assert.equal(core.merchantNameRecommendation("Acme Grocer SG REF 928374", "Invented"), null);
    assert.equal(core.merchantNameRecommendation("Acme Grocer", "###"), null);
  });

  test(`${format}: strong history requires both repetition and consistency`, () => {
    assert.equal(core.isConsistentHistory(2, 2), false);
    assert.equal(core.isConsistentHistory(3, 0), false);
    assert.equal(core.isConsistentHistory(3, 4), true);
    assert.equal(core.isConsistentHistory(3, 5), false);
    assert.equal(core.hasReceivableLanguage("Claim reimbursement from family"), true);
    assert.equal(core.hasReceivableLanguage("Normal supermarket purchase"), false);
  });
}
