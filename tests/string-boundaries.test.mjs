import assert from "node:assert/strict";
import test from "node:test";
import { trimCharacters, trimEndCharacters } from "../lib/string-boundaries.mjs";

test("delimiter trimming preserves internal separators and supports empty boundaries", () => {
  assert.equal(trimEndCharacters("https://example.test/path///", "/"), "https://example.test/path");
  assert.equal(trimEndCharacters("already-clean", "/"), "already-clean");
  assert.equal(trimEndCharacters("///", "/"), "");
  assert.equal(trimEndCharacters("", "/"), "");
  assert.equal(trimEndCharacters("text?!.", "!."), "text?");
  assert.equal(trimCharacters("__ALT_FUND__", "_"), "ALT_FUND");
  assert.equal(trimCharacters("--Long-term-plan---", "-"), "Long-term-plan");
  assert.equal(trimCharacters("__-", "_-"), "");
  assert.equal(trimCharacters("", "_-"), "");
  assert.equal(trimCharacters(" a ", ""), " a ");
  assert.equal(trimCharacters("  inside  spaces  ", " "), "inside  spaces");
});

test("long delimiter runs terminate without changing adjacent data", () => {
  const delimiters = "/".repeat(100_000);
  assert.equal(trimEndCharacters(`https://example.test${delimiters}`, "/"), "https://example.test");
  assert.equal(trimCharacters(`${delimiters}payload${delimiters}`, "/"), "payload");
});
