import assert from "node:assert/strict";
import test from "node:test";

import {
  getDaysUntilDue,
  shouldSendPaymentReminder,
  startOfUtcDay,
} from "../lib/credit-card-payment-reminder-schedule.ts";

test("sends credit card reminders at 3 days, 1 day, due day, and every overdue day", () => {
  assert.equal(shouldSendPaymentReminder(4), false);
  assert.equal(shouldSendPaymentReminder(3), true);
  assert.equal(shouldSendPaymentReminder(2), false);
  assert.equal(shouldSendPaymentReminder(1), true);
  assert.equal(shouldSendPaymentReminder(0), true);
  assert.equal(shouldSendPaymentReminder(-1), true);
  assert.equal(shouldSendPaymentReminder(-30), true);
});

test("calculates reminder day offsets using UTC calendar days", () => {
  const today = startOfUtcDay(new Date("2026-07-11T23:30:00+08:00"));

  assert.equal(getDaysUntilDue(new Date("2026-07-14T00:00:00.000Z"), today), 3);
  assert.equal(getDaysUntilDue(new Date("2026-07-12T00:00:00.000Z"), today), 1);
  assert.equal(getDaysUntilDue(new Date("2026-07-11T00:00:00.000Z"), today), 0);
  assert.equal(getDaysUntilDue(new Date("2026-07-10T00:00:00.000Z"), today), -1);
});
