---
title: Accounts and Ledger Module
description: Real-bank controls, envelopes, transactions, transfers, grouping, posting, idempotency, reversals, and reconciliation.
audience: [engineers, finance-domain-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Accounts and ledger

## Purpose

Maintain exact, explainable virtual cash allocation and cash-flow history while separating it from manually reconciled bank controls.

## Scope

Accounts, envelopes/budgets, transactions, transfers, transaction groups, posting groups, idempotency records, balance deltas, and reconciliation.

## Responsibilities

- Store current real-bank control values.
- Divide cash into envelope purposes.
- Record credit/debit/transfer ledger movements.
- Apply envelope deltas atomically.
- Group user transactions without changing their ownership.
- Prevent replay and concurrent double effects.
- Reverse posted rows instead of deleting history.
- Report drift without silently repairing it.

## Public APIs and important functions

| File | Symbol | Contract |
| --- | --- | --- |
| `lib/posting-service.ts` | `executePosting` | Atomic idempotent operation; replay or conflict |
|  | `createLedgerTransaction` | Create a transaction tied to a posting |
|  | `reverseLedgerTransaction` | Attributed reversal/void |
|  | `claimCreditCardTransaction`, `claimReceivable` | Conditional one-row concurrency claim |
|  | `reconcileWorkspaceBudgets` | Compare stored versus ledger-derived envelope balance |
| `lib/budget-ledger.ts` | delta and recalculate helpers | Direction-aware envelope arithmetic |
| `lib/bank-consistency.ts` | `getBankConsistency` | Control-versus-allocation calculation |
| `lib/api/pagination.ts` | cursor helpers | Bounded stable lists |
| `lib/api/batching.ts` | `chunkValues` | SQL Server-safe `IN` batches |

## Internal workflow

Source request → workspace EDITOR → referenced account/envelope checks → idempotency claim → `PostingGroup` → transaction rows and envelope deltas → result storage → client invalidation.

Source: [posting sequence](../diagrams/posting-sequence.mmd).

## Function contracts

### `executePosting`

- **Parameters:** workspace, operation, key, actor/source metadata, request value, transactional callback.
- **Returns:** callback result plus replay state/posting ID.
- **Side effects:** creates/updates `IdempotencyRecord` and `PostingGroup`; commits callback writes.
- **Preconditions:** key is stable and request is serializable; caller verified workspace.
- **Postconditions:** effects commit once or no effect commits.
- **Failures:** mismatched replay, unique race, callback/DB failure.
- **Complexity:** dominated by callback queries; fixed idempotency overhead.

### `reverseLedgerTransaction`

- **Parameters:** transaction ID, actor, reason, idempotency key.
- **Returns:** reversal posting result.
- **Side effects:** creates opposite row and marks original voided.
- **Edge cases:** already-voided/missing/cross-workspace transaction.
- **Postcondition:** historical original remains.

## Configuration

No ledger-specific environment variables. Base currency and receivable default destination are workspace configuration.

## Error handling

- Validation and missing references: 400/404.
- Underprivileged: 403.
- Idempotency/request/concurrency conflict: 409.
- Database unavailable: controlled 503 at shared boundaries.

## Performance considerations

- Transaction lists support cursor and legacy page modes with filters.
- Composite indexes lead with workspace/date/budget/account/direction.
- Large imports use row/chunk/body caps and batched duplicate checks.
- Reconciliation is diagnostic and can be expensive; do not run it on every request.

## Security considerations

- IDs must be validated within workspace and parent relationships.
- Notes are potentially sensitive and `NVARCHAR(MAX)`.
- Idempotency result JSON must not store secrets.
- Audit/reversal reasons are bounded.

## Risks

- Direct `availableCents` update outside ledger service.
- Deriving bank balance from transactions.
- Physically deleting posted rows.
- Omitting idempotency on browser mutation.

## Future extension points

- Dedicated posting trace UI.
- BigInt/Decimal migration if cents limits become insufficient.
- Domain-specific read services for reporting.

## Related Files

- [Ledger API](../api/ledger.md)
- [ADR-002](../architecture/adr/ADR-002-posting-ledger.md)
- [BR-010–BR-019](../business/business-rules.md)

## Dependencies

- Workspace auth, Prisma/SQL Server, React Query invalidation.

## Assumptions

- Nest remains an allocation/visibility ledger rather than formal double entry.

## Known Limitations

- Real-bank balances are manual.
- Some legacy transaction fields/models remain.

## Future Improvements

- Encapsulate all envelope writes behind a single domain surface.

## Last Updated

2026-07-28
