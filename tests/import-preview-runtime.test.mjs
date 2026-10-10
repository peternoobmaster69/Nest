import assert from "node:assert/strict";
import test from "node:test";
import { previewImport } from "../lib/domains/integrations/import-preview.ts";

const transaction = { Direction: "CREDIT", Subject: "Income", Date: "2026-10-01", AmountCents: 1200 };

test("import previews distinguish empty input, empty arrays, and invalid JSON", () => {
  for (const input of ["", " \n\t"]) assert.equal(previewImport(input), null);
  assert.deepEqual(previewImport("[]"), { valid: 0, invalid: 0, totalAmountCents: 0, errors: [], transactions: [] });
  assert.deepEqual(previewImport("["), {
    valid: 0, invalid: 0, totalAmountCents: 0, errors: ["Invalid JSON: check the syntax and try again."], transactions: [],
  });
});

test("import previews support both wrapper spellings, arrays, and individual transactions", () => {
  for (const value of [transaction, [transaction], { Transactions: [transaction] }, { transactions: [transaction] }]) {
    assert.deepEqual(previewImport(JSON.stringify(value)), {
      valid: 1, invalid: 0, totalAmountCents: 1200, errors: [], transactions: [transaction],
    });
  }
  const both = previewImport(JSON.stringify({ Transactions: [transaction], transactions: [{ ...transaction, AmountCents: 2 }] }));
  assert.equal(both.totalAmountCents, 1200);
});

test("a declared transaction wrapper must be an array even if another field contains valid rows", () => {
  for (const value of [null, {}, 0, false, "rows"]) {
    for (const key of ["Transactions", "transactions"]) {
      const preview = previewImport(JSON.stringify({ [key]: value }));
      assert.deepEqual(preview.errors, ["Expected Transactions to be an array"]);
      assert.equal(preview.valid, 0);
      assert.equal(preview.invalid, 0);
    }
  }
  assert.deepEqual(previewImport(JSON.stringify({ Transactions: null, transactions: [transaction] })).transactions, []);
});

test("invalid rows include their item number and schema field without contributing to the total", () => {
  const preview = previewImport(JSON.stringify([
    null,
    { ...transaction, AmountCents: -1, Subject: "" },
    { ...transaction, Direction: "OTHER" },
    transaction,
  ]));
  assert.equal(preview.valid, 1);
  assert.equal(preview.invalid, 3);
  assert.equal(preview.totalAmountCents, 1200);
  assert.match(preview.errors[0], /^Item 1: transaction:/);
  assert.match(preview.errors[1], /^Item 2: Subject:.*AmountCents:/);
  assert.match(preview.errors[2], /^Item 3: Direction:/);
  assert.deepEqual(preview.transactions, [transaction]);
  for (const value of [null, false, 0, "text"]) {
    assert.equal(previewImport(JSON.stringify(value)).invalid, 1);
  }
});

test("normalization retains long notes and repeated migration rows without deduplicating them", () => {
  const notes = "n".repeat(3000);
  const value = { ...transaction, Subject: " Income ", Notes: ` ${notes} `, AccountName: null, Details: null, ignored: "metadata" };
  const preview = previewImport(JSON.stringify([value, value]));
  assert.equal(preview.valid, 2);
  assert.equal(preview.totalAmountCents, 2400);
  assert.deepEqual(preview.transactions, [
    { ...transaction, Notes: notes, AccountName: undefined, Details: undefined },
    { ...transaction, Notes: notes, AccountName: undefined, Details: undefined },
  ]);
});
