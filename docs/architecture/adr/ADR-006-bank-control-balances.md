---
title: "ADR-006: Manual Bank Control Balances"
description: Decision to separate real-bank control balances from virtual envelope transaction balances.
audience: [engineers, product-reviewers, ai-assistants]
status: accepted
source_of_truth: true
last_updated: 2026-07-28
---

# ADR-006: Manual bank control balances

## Purpose

Record the product accounting model behind `FinancialAccount.startingCents`.

## Scope

Bank accounts, envelope allocations, transactions, card settlement, reconciliation, and dashboard totals.

## Context

Nest does not consume a complete bank feed. Users need to reserve or allocate money before the real bank posts a movement, especially for card purchases.

## Problem

Automatically changing bank control balances on every virtual transaction would conflate intention/allocation with real bank settlement.

## Constraints

- Some bank values are manually maintained.
- `BudgetEnvelope.availableCents` represents purpose allocation.
- A card purchase is a liability before it is a bank withdrawal.

## Options considered

- Automatically derive bank balance from all transactions: not implemented and incompatible with current guide.
- Keep real-bank control total separate from virtual envelope balances: implemented.

## Decision

Treat `FinancialAccount.startingCents` as the current manually configured bank control balance. Transactions change envelope balances and cash-flow reporting; users update the bank control value when real cash posts.

## Consequences

- `bank control - linked envelopes = unallocated`.
- Discrepancies are visible operating signals.
- Card settlement can reserve money without reducing real cash early.
- The field name `startingCents` understates its current product meaning.

## Risks

- Users may assume transaction entry changes bank cash.
- Stale manual balances make reconciliation misleading.
- Refactors may “fix” the field by deriving it and break the model.

## Alternatives

Adding connected bank feeds could create a separate source of truth, but product and provider requirements are unknown from source code.

## Future Improvements

- Rename the field through a backward-compatible migration and UI change.
- Add explicit “last reconciled” timestamp if the product requires it.

## Related Files

- [`guide.md`](../../../guide.md)
- [`lib/bank-consistency.ts`](../../../lib/bank-consistency.ts)
- [`app/api/accounts/route.ts`](../../../app/api/accounts/route.ts)

## Dependencies

- User-maintained bank balances and envelope transactions.

## Assumptions

- Users understand and periodically reconcile real and virtual balances.

## Known Limitations

- There is no automatic bank synchronization in source.

## Last Updated

2026-07-28
