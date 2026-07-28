---
title: Investments Module
description: Investment account metadata, dated cumulative snapshots, deterministic latest value, liquidity, and net-worth consumption.
audience: [engineers, finance-domain-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Investments

## Purpose

Track invested capital and current value without pretending valuations are bank ledger movements.

## Scope

Investment account CRUD, entry CRUD, ordering, gain/return/liquid totals, dashboard and public net-worth consumption.

## Responsibilities

- Store institution/product/lifecycle/liquidity metadata.
- Add/edit/delete dated cumulative snapshots.
- Select latest entry deterministically.
- Calculate invested/current/gain/return.
- Include only liquid latest values in liquid projections.

## Public APIs and important files

| File | Surface |
| --- | --- |
| `lib/investment-entry-order.ts` | comparator and latest-entry helper |
| `app/api/investments/route.ts` | list/create account |
| `app/api/investments/[id]/route.ts` | update/delete account |
| entry routes | create/update/delete snapshot |
| `components/investments-page.tsx` | client orchestration/dialogs |
| `lib/net-worth.ts` | consumes latest values |

## Internal workflow

Account holds metadata; entries hold cumulative amounts. Latest sorts by snapshot date, then creation timestamp, then ID. Client mutations update visible query cache and then invalidate/reconcile with the server.

## Configuration

No environment configuration. Workspace base currency controls presentation; no automatic FX conversion exists.

## Error handling

- Invalid dates/amounts or account mismatch: validation/not found.
- Underprivileged write: 403.
- Account deletion cascades entries.

## Performance considerations

- Entries indexed by account/date.
- Current values can be derived by loading ordered entries; high snapshot volume may require top-per-account SQL optimization.

## Security considerations

- Institution/product and values are private workspace data.
- Public projections return aggregate values, not account details.

## Risks

- Editing/delete latest snapshot changes historical displayed totals.
- Contribution/withdrawal without matching bank/envelope action causes reconciliation gaps.
- Stale latest value overstates portfolio.

## Future extension points

- Asset classes/currencies and explicit FX rates.
- Immutable valuation history or audit trail.

## Related Files

- [Assets/rewards API](../api/assets-rewards.md)
- [BR-050–BR-054](../business/business-rules.md)
- [`tests/investment-entry-order.test.mjs`](../../tests/investment-entry-order.test.mjs)

## Dependencies

- Workspace auth, Prisma, net-worth aggregation.

## Assumptions

- Each entry is cumulative rather than a delta.

## Known Limitations

- No market integration automatically values owned investments.
- No transaction-level cost basis.

## Future Improvements

- Add explicit valuation source/timestamp semantics if automatic pricing is introduced.

## Last Updated

2026-07-28
