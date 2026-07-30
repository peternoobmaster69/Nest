import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ageFromBirthDate } from "../components/cio/dialogs/cio-profile-dialog.tsx";

test("CIO profile calculates age from date of birth at birthday boundaries", () => {
  assert.equal(ageFromBirthDate("1980-07-30", "2026-07-30"), 46);
  assert.equal(ageFromBirthDate("1980-07-31", "2026-07-30"), 45);
  assert.equal(ageFromBirthDate("1980-02-29", "2026-02-28"), 45);
  assert.equal(ageFromBirthDate("1980-02-29", "2026-03-01"), 46);
  assert.equal(ageFromBirthDate("2027-01-01", "2026-07-30"), null);
});

test("CIO profile keeps manual age as a dated fallback and omits it when birth date exists", async () => {
  const source = await readFile(new URL("../components/cio/dialogs/cio-profile-dialog.tsx", import.meta.url), "utf8");

  assert.match(source, /primaryCurrentAge: hasBirthDate \? null : numberOrNull\(form\.primaryCurrentAge\)/);
  assert.match(source, /primaryAgeAsOfDate: hasBirthDate \? null : toIsoDate\(form\.primaryAgeAsOfDate\)/);
  assert.match(source, /value \? \{ primaryCurrentAge: "", primaryAgeAsOfDate: "" \} : \{\}/);
  assert.match(source, /primaryAgeAsOfDate: value \? current\.primaryAgeAsOfDate \|\| today : ""/);
});

test("CIO profile explicitly supports individual calculations and explains both spending inputs", async () => {
  const [source, scopeField] = await Promise.all([
    readFile(new URL("../components/cio/dialogs/cio-profile-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/cio/dialogs/cio-profile-scope-field.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(scopeField, /Who are these calculations for\?/);
  assert.match(scopeField, /Just me — individual plan/);
  assert.match(source, /form\.planningScope === "HOUSEHOLD" \? \(/);
  assert.match(source, /partnerBirthDate: planningScope === "INDIVIDUAL" \? "" : current\.partnerBirthDate/);
  assert.match(source, /partnerBirthDate: form\.planningScope === "HOUSEHOLD" \? toIsoDate\(form\.partnerBirthDate\) : null/);
  assert.match(source, /Target monthly retirement spending \(today's money\)/);
  assert.match(source, /This drives the retirement fund target/);
  assert.match(source, /Enter 0 when emergency-runway and months-of-spending checks do not apply/);
});
