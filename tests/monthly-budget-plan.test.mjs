import assert from "node:assert/strict";
import test from "node:test";

import {
  getUnappliedMonthlyBudgetItemCents,
  summarizeMonthlyBudgetPlan,
} from "../lib/monthly-budget-plan.mjs";

test("balances independent source and item lists by aggregate total", () => {
  const summary = summarizeMonthlyBudgetPlan(
    [{ amountCents: 6_000 }, { amountCents: 4_000 }],
    [{ amountCents: 2_500 }, { amountCents: 3_500 }, { amountCents: 4_000 }],
  );

  assert.deepEqual(summary, {
    sourceTotalCents: 10_000,
    itemTotalCents: 10_000,
    differenceCents: 0,
    isBalanced: true,
    canConfirm: true,
  });
});

test("rejects a mismatched aggregate even when list counts match", () => {
  const summary = summarizeMonthlyBudgetPlan(
    [{ amountCents: 8_000 }],
    [{ amountCents: 7_500 }],
  );

  assert.equal(summary.differenceCents, 500);
  assert.equal(summary.isBalanced, false);
  assert.equal(summary.canConfirm, false);
});

test("requires both sides even when two empty lists total zero", () => {
  const summary = summarizeMonthlyBudgetPlan([], []);

  assert.equal(summary.isBalanced, true);
  assert.equal(summary.canConfirm, false);
});

test("only applies the remaining monthly item amount", () => {
  assert.equal(getUnappliedMonthlyBudgetItemCents(10_000, 4_000), 6_000);
  assert.equal(getUnappliedMonthlyBudgetItemCents(10_000, 10_000), 0);
  assert.equal(getUnappliedMonthlyBudgetItemCents(10_000, 12_000), 0);
});
