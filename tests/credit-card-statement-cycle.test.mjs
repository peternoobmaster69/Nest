import assert from "node:assert/strict";
import test from "node:test";
import { deriveStatementCycle } from "../lib/credit-card-statement-cycle.ts";

for (const [transaction, statementDay, paymentDueDay, month, year, due] of [
  ["2026-10-14T08:00:00Z", 15, 25, 10, 2026, "2026-10-25"],
  ["2026-10-15T23:59:59Z", 15, 25, 10, 2026, "2026-10-25"],
  ["2026-10-16T00:00:00Z", 15, 25, 11, 2026, "2026-11-25"],
  ["2026-12-31T12:00:00Z", 15, 25, 1, 2027, "2027-01-25"],
  ["2026-12-15T12:00:00Z", 15, 10, 12, 2026, "2027-01-10"],
  ["2026-10-15T12:00:00Z", 15, 15, 10, 2026, "2026-11-15"],
  ["2026-02-28T12:00:00Z", 31, 30, 2, 2026, "2026-03-30"],
  ["2028-02-29T12:00:00Z", 31, 30, 2, 2028, "2028-03-30"],
  ["2026-01-31T12:00:00Z", 31, 30, 1, 2026, "2026-02-28"],
  ["2028-01-31T12:00:00Z", 31, 30, 1, 2028, "2028-02-29"],
  ["2026-04-20T12:00:00Z", 20, 31, 4, 2026, "2026-04-30"],
  ["2026-11-01T00:15:00+08:00", 31, 15, 10, 2026, "2026-11-15"],
]) {
  test(`statement dates use UTC closing boundaries and clamp month lengths (${transaction}, ${statementDay}/${paymentDueDay})`, () => {
    const transactionDate = new Date(transaction);
    const result = deriveStatementCycle({ transactionDate, statementDay, paymentDueDay });
    assert.deepEqual(result, { statementMonth: month, statementYear: year, paymentDueDate: new Date(`${due}T00:00:00.000Z`) });
    assert.equal(transactionDate.toISOString(), new Date(transaction).toISOString());
  });
}
