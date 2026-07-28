---
title: "ADR-002: Posting Journal and Idempotency"
description: Decision to execute money mutations through atomic posting groups and replay-safe idempotency records.
audience: [engineers, architects, reviewers, ai-assistants]
status: accepted
source_of_truth: true
last_updated: 2026-07-28
---

# ADR-002: Posting journal and idempotency

## Purpose

Protect the central financial mutation invariant.

## Scope

Transactions, transfers, card accounting/payment, receivable close, imports, and monthly budget application.

## Context

Network retries, double-clicks, concurrent workers, and cross-domain operations can otherwise create duplicate ledger rows or partially update balances.

## Problem

A business action may create several transactions and change multiple envelope balances, but it must commit once and remain auditable.

## Constraints

- SQL Server is the durable coordinator.
- Existing HTTP clients can retry.
- Financial history should not be erased.

## Options considered

- Direct model writes: rejected for money-changing workflows.
- In-memory dedupe: rejected as multi-instance unsafe.
- SQL-scoped journal/idempotency transaction: implemented.

## Decision

All money-changing actions use `executePosting` or an equivalent posting helper with workspace, operation, actor, source, request hash, and idempotency key. Matching retries replay stored results; mismatched key reuse conflicts. Deletion of posted transactions creates attributed reversal rows.

## Consequences

- Ledger effects, balance deltas, and source claims commit together.
- Operators can trace rows to a business operation.
- Clients must generate stable unique idempotency keys.
- Migration and reconciliation must retain journal history.

## Risks

- A route that directly changes `availableCents` can bypass guarantees.
- Using a random fallback on server retry can create duplicates.
- Reusing a key for different content returns 409 by design.

## Alternatives

External event sourcing or a dedicated ledger service are not present. Whether they were considered is **Unknown from source code.**

## Future Improvements

- Centralize remaining legacy mutation wrappers.
- Add an operator-facing posting trace view.

## Related Files

- [`lib/posting-service.ts`](../../../lib/posting-service.ts)
- [`prisma/migrations/phase_1_posting_ledger_and_idempotency/migration.sql`](../../../prisma/migrations/phase_1_posting_ledger_and_idempotency/migration.sql)
- [`tests/phase1-ledger-contract.test.mjs`](../../../tests/phase1-ledger-contract.test.mjs)

## Dependencies

- SQL transactions, uniqueness, and conditional claims.

## Assumptions

- Integer-cent arithmetic fits current SQL `INT` limits.

## Known Limitations

- Nest is not a complete double-entry accounting system.

## Last Updated

2026-07-28
