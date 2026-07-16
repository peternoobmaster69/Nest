import assert from "node:assert/strict";
import test from "node:test";

import {
  getDaysUntilDue,
  REMINDER_LEAD_DAYS,
  shouldSendPaymentReminder,
  shouldShowPaymentReminder,
  startOfUtcDay,
} from "../lib/credit-card-payment-reminder-schedule.ts";

test("sends credit card reminders at 5, 3, and 1 days, due day, and every overdue day", () => {
  assert.equal(REMINDER_LEAD_DAYS, 5);
  assert.equal(shouldSendPaymentReminder(6), false);
  assert.equal(shouldSendPaymentReminder(5), true);
  assert.equal(shouldSendPaymentReminder(4), false);
  assert.equal(shouldSendPaymentReminder(3), true);
  assert.equal(shouldSendPaymentReminder(2), false);
  assert.equal(shouldSendPaymentReminder(1), true);
  assert.equal(shouldSendPaymentReminder(0), true);
  assert.equal(shouldSendPaymentReminder(-1), true);
  assert.equal(shouldSendPaymentReminder(-30), true);
});

test("keeps in-app reminders visible throughout the five-day reminder window", () => {
  assert.equal(shouldShowPaymentReminder(6), false);
  assert.equal(shouldShowPaymentReminder(5), true);
  assert.equal(shouldShowPaymentReminder(4), true);
  assert.equal(shouldShowPaymentReminder(2), true);
  assert.equal(shouldShowPaymentReminder(0), true);
  assert.equal(shouldShowPaymentReminder(-30), true);
});

test("calculates reminder day offsets using UTC calendar days", () => {
  const today = startOfUtcDay(new Date("2026-07-11T23:30:00+08:00"));

  assert.equal(getDaysUntilDue(new Date("2026-07-14T00:00:00.000Z"), today), 3);
  assert.equal(getDaysUntilDue(new Date("2026-07-12T00:00:00.000Z"), today), 1);
  assert.equal(getDaysUntilDue(new Date("2026-07-11T00:00:00.000Z"), today), 0);
  assert.equal(getDaysUntilDue(new Date("2026-07-10T00:00:00.000Z"), today), -1);
});
