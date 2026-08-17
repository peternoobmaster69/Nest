import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCreditAlertCurrency } from "../lib/credit-alert-ingest.ts";

test("credit alert currencies are normalized before database checks", () => {
  assert.equal(normalizeCreditAlertCurrency(" sgd "), "SGD");
  assert.equal(normalizeCreditAlertCurrency("usd"), "USD");
  assert.equal(normalizeCreditAlertCurrency("S$"), null);
  assert.equal(normalizeCreditAlertCurrency("SGDollars"), null);
  assert.equal(normalizeCreditAlertCurrency(undefined), null);
});
