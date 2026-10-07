import assert from "node:assert/strict";
import test from "node:test";
import { calculateExpiryDateInputValue, formatNumber, hotelPointValueCents, isExpiredAtToday, todayDateInputValue, toDateInputValue } from "../components/rewards/format.ts";
import { getInitials } from "../lib/user-display.ts";

test("reward validity ends on the final day of the earned month, including leap years", () => {
  assert.equal(calculateExpiryDateInputValue("2024-02-29", 1), "2025-02-28");
  assert.equal(calculateExpiryDateInputValue("2023-02-02", 1), "2024-02-29");
  assert.equal(calculateExpiryDateInputValue("2026-12-05", 3), "2029-12-31");
  assert.equal(calculateExpiryDateInputValue("bad-date", 3), "");
});

test("rewards stay valid throughout their expiry day", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-07T12:00:00Z") });
  assert.equal(isExpiredAtToday("2026-10-06T12:00:00Z"), true);
  assert.equal(isExpiredAtToday("2026-10-07T12:00:00Z"), false);
  assert.equal(isExpiredAtToday("2026-10-08T12:00:00Z"), false);
  assert.equal(isExpiredAtToday(null), false);
  assert.equal(isExpiredAtToday("bad-date"), false);
  assert.equal(todayDateInputValue(), "2026-10-07");
  assert.equal(toDateInputValue("2026-10-07T12:00:00Z"), "2026-10-07");
});

test("reward values retain fractional point valuations while settling to whole cents", () => {
  assert.equal(hotelPointValueCents(12345, 0.625), 7716);
  assert.equal(hotelPointValueCents(0, 0.625), 0);
  assert.equal(formatNumber(1234567), "1,234,567");
});

test("avatar initials handle whitespace, single names, and Unicode characters", () => {
  for (const [name, initials] of [["Nest Owner", "NO"], [" Peter ", "P"], ["  Peter\tFamily\nExtra  ", "PF"], ["", ""], [" \t ", ""], ["😀 Person", "😀P"]]) {
    assert.equal(getInitials(name), initials);
  }
});
