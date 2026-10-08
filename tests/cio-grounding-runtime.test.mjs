import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureCioDataDate, findUnsupportedCioValue, findUnsupportedCurrencyValue,
  isReferentialFinancialFollowUp, userSuppliedCurrencyGrounding,
} from "../lib/ai/cio-grounding.ts";

const generated = (answer, highlights = []) => ({ answer, highlights });

test("currency grounding preserves signs, precision, currency, whitespace, and values in highlights", () => {
  for (const currency of ["SGD", "USD", "EUR", "GBP", "AUD", "JPY"]) {
    const supported = [`${currency} 1,234.50`, `-${currency} 25.50`];
    assert.equal(findUnsupportedCurrencyValue(generated(`${currency} 1234.5`), supported), null);
    assert.equal(findUnsupportedCurrencyValue(generated(`${currency} -25.50`), supported), null);
    assert.equal(findUnsupportedCurrencyValue(generated(`-${currency} -25.50`), supported), null);
    assert.equal(findUnsupportedCurrencyValue(generated(`${currency} -26`), supported), null);
    assert.equal(findUnsupportedCurrencyValue(generated(`${currency} -25`), supported), `${currency} -25`);
    assert.equal(findUnsupportedCurrencyValue(generated(`${currency} 1234.51`), supported), `${currency} 1234.51`);
  }
  assert.equal(findUnsupportedCurrencyValue(generated("A qualitative answer", [{ label: "USD\t12.50", value: "EUR 5" }]), ["USD 12.50"]), "EUR 5");
  assert.equal(findUnsupportedCurrencyValue(generated("USD\t12.50"), ["EUR 12.50"]), "USD\t12.50");
  assert.equal(findUnsupportedCurrencyValue(generated("USD pending; EUR 5"), []), "EUR 5");
});

test("malformed amounts and embedded currency identifiers cannot ground a shorter valid amount", () => {
  for (const source of ["SGD 1,23", "SGD 1.234", "SGD 1.23.4", "SGD 1.23,", "key_SGD 1.23", "XSGD 1.23"]) {
    assert.equal(findUnsupportedCurrencyValue(generated("SGD 1.23"), [source]), "SGD 1.23", source);
  }
  assert.equal(findUnsupportedCurrencyValue(generated("SGD 2"), ["SGD 1.50", "USD 2"]), null);
  assert.equal(findUnsupportedCurrencyValue(generated("SGD 2"), ["USD 1.50"]), "SGD 2");
});

test("financial checks use successful sources, allowed context, and all rendered highlights", () => {
  assert.equal(findUnsupportedCioValue(generated("SGD 100 in 2030 at 25%"), [{ ok: false, domain: "CIO" }]), null);
  const sources = [{ ok: true, domain: "CIO", value: "-1,234.50%", asOfDate: "2026-10-08" }];
  assert.equal(findUnsupportedCioValue(generated("The value is -1234.5%"), sources), null);
  assert.equal(findUnsupportedCioValue(generated("The value is -12.25  %"), sources), "-12.25  %");
  assert.equal(findUnsupportedCioValue(generated("Qualitative answer", [{ label: "Model in 2030", value: "25%" }]), sources), "2030");
  assert.equal(findUnsupportedCioValue(generated("Qualitative answer", [{ label: "Allocation", value: "25%" }]), sources), "25%");
  assert.equal(findUnsupportedCioValue(generated("Model in 2030 at 25%"), sources, ["Use 2030 and 25%"]), null);
  assert.equal(findUnsupportedCioValue(generated("No numerical claims"), [{ ok: true, domain: "PUBLIC_FINANCIAL_RESEARCH" }]), null);
});

test("periodic inputs recognize labelled monthly and annual amounts without truncating invalid numbers", () => {
  assert.deepEqual(userSuppliedCurrencyGrounding([
    "100 a month, 200 per year, 300 each month, 400/year",
    "monthly spending of 1,000.50, annual budget is 2,000, yearly income at 3000",
    "monthly contribution = 45, annual amount 60, yearly target 70, monthly expenses 80, annual expense 90",
    "100 a month; monthly spending of 1,000.50",
  ], "SGD"), [
    "SGD 100", "SGD 200", "SGD 300", "SGD 400", "SGD 1,000.50", "SGD 2,000", "SGD 3000",
    "SGD 45", "SGD 60", "SGD 70", "SGD 80", "SGD 90",
  ]);
  assert.deepEqual(userSuppliedCurrencyGrounding([
    "monthly spending unknown; 120 without a period", "1,23 per month", "1.234 a year", "1,,23 per month",
    "monthly budget 1.234", "monthly income 1.23.4",
  ], "EUR"), []);
  assert.deepEqual(userSuppliedCurrencyGrounding(["Monthly budget 125"], "EUR"), ["EUR 125"]);
});

test("data dates stay complete when answers need word-boundary truncation or contain no whitespace", () => {
  const outputs = [{ ok: true, domain: "CIO", asOfDate: "2026-10-08" }];
  const suffix = "Data date: 2026-10-08.";
  const maximum = suffix.length + 1 + 8;
  assert.equal(ensureCioDataDate("Explain something very long", outputs, maximum), `Explain ${suffix}`);
  assert.equal(ensureCioDataDate("x".repeat(100), outputs, maximum), `xxxxxxxx ${suffix}`);
  assert.equal(ensureCioDataDate("", outputs), suffix);
  assert.equal(ensureCioDataDate("A short answer.   ", outputs), `A short answer. ${suffix}`);
  assert.equal(ensureCioDataDate("Already as of 2026-10-08.", outputs), "Already as of 2026-10-08.");
  assert.equal(ensureCioDataDate("Short", outputs, suffix.length), suffix);
  assert.equal(ensureCioDataDate("Answer", [
    ...outputs, ...outputs, { ok: true, domain: "CIO", asOfDate: "2026-10-07" },
    { ok: true, domain: "CIO", asOfDate: 20261008 }, { ok: true, domain: "CIO", asOfDate: "invalid" },
    { ok: false, domain: "CIO", asOfDate: "2026-10-06" },
  ]), "Answer Data dates: 2026-10-08, 2026-10-07.");
  assert.equal(ensureCioDataDate("Answer", [{ ok: true, domain: "PUBLIC_FINANCIAL_RESEARCH", asOfDate: "2026-10-08" }]), "Answer");
});

test("referential requests distinguish preceding figures from ordinary date or topic queries", () => {
  for (const value of ["Apply that", "This scenario", "Use the previous plan", "Explain the same result"]) {
    assert.equal(isReferentialFinancialFollowUp(value), true, value);
  }
  assert.equal(isReferentialFinancialFollowUp("Show spending this month"), false);
});

test("long numeric and whitespace runs without units do not make financial grounding backtrack", { timeout: 5_000 }, () => {
  const digits = "1".repeat(30_000);
  const spaces = " ".repeat(30_000);
  const sources = [{ domain: "CIO", ok: true, text: "Financial evidence without numbers" }];
  assert.equal(findUnsupportedCioValue(generated(`${digits} words ${spaces} words`), sources), null);
  assert.deepEqual(userSuppliedCurrencyGrounding([`${digits} words`, `monthly income${spaces}unknown`], "SGD"), []);
  const dated = ensureCioDataDate(`Known words${spaces}ending`, [{ ...sources[0], asOfDate: "2026-10-08" }], 20_000);
  assert.equal(dated, "Known words Data date: 2026-10-08.");
});
