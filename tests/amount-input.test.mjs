import assert from "node:assert/strict";
import test from "node:test";
import { parseNonNegativeCents } from "../lib/amount-input.ts";

test("money input preserves zero and decimal amounts while rejecting unsafe or unfinished values", () => {
  for (const [input, cents] of [["0", 0], [" 0.00 ", 0], ["12.34", 1234], [".5", 50], ["123.456", 12346]]) assert.equal(parseNonNegativeCents(input), cents);
  for (const input of ["", " ", "not a number", "1+2", "Infinity", "-Infinity", "-0.001", "-1", "1e100"]) assert.equal(parseNonNegativeCents(input), null);
});
