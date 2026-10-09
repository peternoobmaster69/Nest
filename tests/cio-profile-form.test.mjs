import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_FORM, MAX_MONEY_INPUT, ageFromBirthDate, formFromProfile, validateProfileForm } from "../components/cio/dialogs/cio-profile-form.ts";
import { localDateInput, parseCioDateInput } from "../components/cio/cio-date-input.ts";

const today = "2026-10-09";
const validate = (patch) => validateProfileForm({ ...EMPTY_FORM, ...patch }, today);

test("CIO calendar inputs reject malformed dates and handle local dates and birthday boundaries", (t) => {
  for (const value of ["", "not a date", "2026-2-03", "2026-13-01", "2026-00-01", "2026-02-30", "1900-02-29", "10000-01-01"]) {
    assert.equal(parseCioDateInput(value), null, value);
  }
  assert.deepEqual(parseCioDateInput("2000-02-29"), { year: 2000, month: 2, day: 29 });
  assert.equal(localDateInput(new Date(2026, 0, 2, 12)), "2026-01-02");
  for (const [birth, date, expected] of [
    ["1980-10-09", today, 46], ["1980-10-10", today, 45], ["1980-11-01", today, 45], ["1980-09-10", today, 46],
    ["2000-02-29", "2026-02-28", 25], ["2000-02-29", "2026-03-01", 26], ["2027-01-01", today, null],
    ["invalid", today, null], ["1980-01-01", "invalid", null],
  ]) assert.equal(ageFromBirthDate(birth, date), expected);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00Z") });
  assert.equal(ageFromBirthDate("1980-10-09"), 46);
});

test("profile timing validation preserves optional dates and enforces paired ages and mutually exclusive retirement targets", () => {
  assert.deepEqual(validate({}), {});
  assert.deepEqual(validate({ primaryBirthDate: "1980-01-01", primaryCurrentAge: "invalid", primaryAgeAsOfDate: "invalid" }), {});
  for (const [patch, field, expected] of [
    [{ primaryBirthDate: "bad" }, "primaryBirthDate", /Enter a valid date of birth/],
    [{ primaryBirthDate: "2027-01-01" }, "primaryBirthDate", /cannot be in the future/],
    [{ planningScope: "HOUSEHOLD", partnerBirthDate: "bad" }, "partnerBirthDate", /valid partner's date of birth/],
    [{ partnerBirthDate: "2027-01-01" }, "partnerBirthDate", /cannot be in the future/],
    [{ primaryCurrentAge: "25" }, "primaryAgeAsOfDate", /Choose the date when this age was accurate/],
    [{ primaryAgeAsOfDate: today }, "primaryCurrentAge", /Enter the age that was accurate/],
    [{ primaryCurrentAge: "25", primaryAgeAsOfDate: "2027-01-01" }, "primaryAgeAsOfDate", /cannot be in the future/],
    [{ primaryCurrentAge: "25", primaryAgeAsOfDate: "not a date" }, "primaryAgeAsOfDate", /Enter a valid age date/],
    [{ primaryCurrentAge: "1.5", primaryAgeAsOfDate: today }, "primaryCurrentAge", /whole number/],
    [{ primaryCurrentAge: "121", primaryAgeAsOfDate: today }, "primaryCurrentAge", /between 0 and 120/],
    [{ primaryCurrentAge: "-1", primaryAgeAsOfDate: today }, "primaryCurrentAge", /between 0 and 120/],
    [{ primaryCurrentAge: "Infinity", primaryAgeAsOfDate: today }, "primaryCurrentAge", /as a number/],
    [{ targetRetirementAge: "17" }, "targetRetirementAge", /between 18 and 120/],
    [{ targetRetirementAge: "121" }, "targetRetirementAge", /between 18 and 120/],
    [{ targetRetirementAge: "65.5" }, "targetRetirementAge", /whole number/],
    [{ targetRetirementAge: "65", targetRetirementDate: "2040-01-01" }, "targetRetirementDate", /not both/],
    [{ targetRetirementDate: "2026-02-30" }, "targetRetirementDate", /Enter a valid retirement date/],
  ]) assert.match(validate(patch)[field], expected, JSON.stringify(patch));
  assert.deepEqual(validate({ primaryCurrentAge: "0", primaryAgeAsOfDate: today, targetRetirementAge: "18" }), {});
  assert.deepEqual(validate({ primaryCurrentAge: "120", primaryAgeAsOfDate: today, targetRetirementAge: "120" }), {});
  assert.deepEqual(validate({ planningScope: "HOUSEHOLD", partnerBirthDate: "1980-01-01", targetRetirementDate: "2040-01-01" }), {});
});

test("profile money and percentage rules accept their bounds and reject nonfinite and out-of-range values", () => {
  const limits = [
    ...["retirementSpending", "essentialSpending", "minimumCash", "contributionOverride"].map((field) => [field, 0, MAX_MONEY_INPUT]),
    ["inflation", -99.99, 1000], ["contributionGrowth", -100, 1000], ["bearReturn", -100, 1000],
    ["baseReturn", -100, 1000], ["bullReturn", -100, 1000], ["withdrawalRate", 0.01, 100],
  ];
  for (const [field, min, max] of limits) {
    for (const value of [String(min), String(max), " "]) assert.equal(validate({ [field]: value })[field], undefined, `${field}: ${value}`);
    for (const value of [String(min - 0.01), String(max + 0.01)]) assert.match(validate({ [field]: value })[field], /must be between/);
    for (const value of ["NaN", "Infinity", "USD 1"]) assert.match(validate({ [field]: value })[field], /as a number/);
  }
  assert.deepEqual(validate({ bearReturn: "-10", baseReturn: "5", bullReturn: "10" }), {});
  assert.deepEqual(validate({ bearReturn: "5", baseReturn: "5", bullReturn: "5" }), {});
  const inverted = validate({ bearReturn: "6", baseReturn: "5", bullReturn: "4" });
  assert.match(inverted.bearReturn, /less than or equal to base/);
  assert.match(inverted.bullReturn, /greater than or equal to base/);
});

test("profile hydration preserves zeros, uses birth dates as authoritative and supports legacy scope defaults", () => {
  const empty = {
    planningScope: "INDIVIDUAL", primaryBirthDate: null, primaryCurrentAge: null, primaryAgeAsOfDate: null, partnerBirthDate: null,
    targetRetirementAge: null, targetRetirementDate: null, targetMonthlyRetirementSpendingCents: null, essentialMonthlySpendingCents: null,
    minimumImmediateBankCashCents: null, inflationRateBps: null, bearReturnBps: null, baseReturnBps: null, bullReturnBps: null,
    sustainableWithdrawalRateBps: null, annualExternalContributionOverrideCents: null, contributionGrowthRateBps: null,
  };
  assert.deepEqual(formFromProfile(empty), EMPTY_FORM);
  const loaded = formFromProfile({ ...empty, primaryCurrentAge: 40, primaryAgeAsOfDate: "2026-10-09T00:00:00Z", targetRetirementAge: 65,
    targetMonthlyRetirementSpendingCents: 500025, essentialMonthlySpendingCents: 0, minimumImmediateBankCashCents: 3000000,
    inflationRateBps: 250, bearReturnBps: -100, baseReturnBps: 500, bullReturnBps: 700, sustainableWithdrawalRateBps: 400,
    annualExternalContributionOverrideCents: 1200000, contributionGrowthRateBps: 300,
  });
  assert.equal(loaded.primaryCurrentAge, "40");
  assert.equal(loaded.primaryAgeAsOfDate, today);
  assert.equal(loaded.targetRetirementAge, "65");
  assert.equal(loaded.retirementSpending, "5000.25");
  assert.equal(loaded.essentialSpending, "0");
  assert.equal(loaded.minimumCash, "30000");
  assert.equal(loaded.inflation, "2.5");
  assert.equal(loaded.bearReturn, "-1");
  assert.equal(loaded.baseReturn, "5");
  assert.equal(loaded.bullReturn, "7");
  assert.equal(loaded.withdrawalRate, "4");
  assert.equal(loaded.contributionOverride, "12000");
  assert.equal(loaded.contributionGrowth, "3");
  const birth = formFromProfile({ ...empty, primaryBirthDate: "1980-01-01", primaryCurrentAge: 50, primaryAgeAsOfDate: today });
  assert.equal(birth.primaryBirthDate, "1980-01-01");
  assert.equal(birth.primaryCurrentAge, "");
  assert.equal(birth.primaryAgeAsOfDate, "");
  assert.equal(formFromProfile({ ...empty, planningScope: undefined }).planningScope, "INDIVIDUAL");
  assert.equal(formFromProfile({ ...empty, planningScope: undefined, partnerBirthDate: "1980-01-01" }).planningScope, "HOUSEHOLD");
});
