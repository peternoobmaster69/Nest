/** @typedef {{ amountCents: number }} AmountRow */

/**
 * @param {readonly AmountRow[]} sources
 * @param {readonly AmountRow[]} items
 */
export function summarizeMonthlyBudgetPlan(sources, items) {
  const sourceTotalCents = sources.reduce((total, source) => total + source.amountCents, 0);
  const itemTotalCents = items.reduce((total, item) => total + item.amountCents, 0);
  const differenceCents = sourceTotalCents - itemTotalCents;

  return {
    sourceTotalCents,
    itemTotalCents,
    differenceCents,
    isBalanced: differenceCents === 0,
    canConfirm: sources.length > 0 && items.length > 0 && differenceCents === 0,
  };
}

/**
 * @param {number} amountCents
 * @param {number} appliedCents
 */
export function getUnappliedMonthlyBudgetItemCents(amountCents, appliedCents) {
  return Math.max(0, amountCents - appliedCents);
}
