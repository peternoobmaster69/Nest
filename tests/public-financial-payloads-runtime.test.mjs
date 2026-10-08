import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { getWorkspaceCardsDuePayload } = require("../lib/public-card-dues.ts");
const { getWorkspaceNetWorthPayload } = require("../lib/net-worth.ts");
const now = new Date("2026-10-08T18:30:00Z");
const dueDate = (day) => new Date(`2026-10-${String(day).padStart(2, "0")}T00:00:00Z`);

test("public card dues aggregate statements by card and year, include the due window boundaries, and show active cards only", async () => {
  const balances = [];
  const dueDates = [];
  function statement(creditCardId, statementMonth, amountCents, due, statementYear = 2026) {
    const key = { creditCardId, statementMonth, statementYear };
    balances.push({ ...key, _sum: { amountCents } });
    if (due !== undefined) dueDates.push({ ...key, _min: { paymentDueDate: due } });
  }
  statement("daily", 8, 500, dueDate(15));
  statement("daily", 9, 300, dueDate(13));
  statement("daily", 10, 200, dueDate(17));
  statement("daily", 10, 9_999, dueDate(7), 2025);
  statement("earlier", 9, 12_345, dueDate(10));
  statement("today", 9, 100, dueDate(8));
  statement("last-day", 9, 200, dueDate(22));
  statement("future", 9, 300, dueDate(23));
  statement("paid", 9, 0, dueDate(12));
  statement("credit", 9, -10, dueDate(12));
  statement("null-amount", 9, null, dueDate(12));
  statement("no-date", 9, 500);
  statement("null-date", 9, 500, null);
  statement("inactive", 9, 500, dueDate(12));
  const calls = [];
  const db = {
    creditCardTransaction: { async groupBy(args) { calls.push(args); return args._min ? dueDates : balances; } },
    creditCardAccount: { async findMany(args) {
      calls.push(args);
      return ["daily", "earlier", "today", "last-day"].map((id, index) => ({ id, bankName: `Bank ${index}`, last4Digit: `123${index}` }));
    } },
  };
  const payload = await getWorkspaceCardsDuePayload(db, "household", now);
  assert.deepEqual(payload.cards, [
    { bank: "Bank 2", last4: "1232", amount: "1.00", dueDate: dueDate(8) },
    { bank: "Bank 1", last4: "1231", amount: "123.45", dueDate: dueDate(10) },
    { bank: "Bank 0", last4: "1230", amount: "10.00", dueDate: dueDate(13) },
    { bank: "Bank 3", last4: "1233", amount: "2.00", dueDate: dueDate(22) },
  ]);
  assert.deepEqual(calls[0].where, { workspaceId: "household" });
  assert.deepEqual(calls[1].where, { workspaceId: "household", amountCents: { gt: 0 }, paymentDueDate: { not: null } });
  assert.deepEqual(calls[2].where, { workspaceId: "household", id: { in: ["daily", "earlier", "today", "last-day", "inactive"] }, isActive: true });
  assert.equal(calls[2].take, 500);
});

test("empty card dues do not load card details and the default clock uses the current UTC day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const db = { creditCardTransaction: { async groupBy() { return []; } }, creditCardAccount: { async findMany() { assert.fail("No statements require card details"); } } };
  assert.deepEqual(await getWorkspaceCardsDuePayload(db, "household"), { cards: [] });
});

test("public net worth separates liquid and total assets and reads only the workspace's latest valuations", async () => {
  const calls = [];
  const db = {
    workspace: { async findUnique(args) { calls.push(args); return { baseCurrency: "USD" }; } },
    budgetEnvelope: { async findMany(args) { calls.push(args); return [{ availableCents: 10_000 }, { availableCents: 250 }]; } },
    investmentAccount: { async findMany(args) {
      calls.push(args);
      return [
        { isLiquid: true, entries: [{ currentValueCents: 2_000 }] },
        { isLiquid: false, entries: [{ currentValueCents: 5_000 }] },
        { isLiquid: true, entries: [] }, { isLiquid: false, entries: [] },
      ];
    } },
  };
  assert.deepEqual(await getWorkspaceNetWorthPayload(db, "household"), { amount: "172.50", liquidAmt: "122.50", base: "Savings", currency: "USD" });
  assert.deepEqual(calls[0].where, { id: "household" });
  assert.deepEqual(calls[1].where, { workspaceId: "household", isActive: true, isSavings: true });
  assert.deepEqual(calls[2].where, { workspaceId: "household" });
  assert.deepEqual(calls[2].select.entries.orderBy, [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
  assert.equal(calls[2].select.entries.take, 1);
});

test("empty net worth returns zero amounts and a usable default currency", async () => {
  for (const workspace of [null, { baseCurrency: "" }]) {
    const db = {
      workspace: { async findUnique() { return workspace; } },
      budgetEnvelope: { async findMany() { return []; } },
      investmentAccount: { async findMany() { return []; } },
    };
    assert.deepEqual(await getWorkspaceNetWorthPayload(db, "household"), { amount: "0.00", liquidAmt: "0.00", base: "Savings", currency: "SGD" });
  }
});
