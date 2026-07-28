---
title: Database Indexes and Constraints
description: Query-driven indexes, uniqueness, integrity enforcement, transaction behavior, and change guidance.
audience: [engineers, database-operators, performance-reviewers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Database indexes and constraints

## Purpose

Explain why important indexes and constraints exist and what can break when they are changed.

## Scope

This page summarizes Prisma declarations and SQL-only integrity introduced by migrations.

## Index design themes

| Theme | Examples | Protected workflow |
| --- | --- | --- |
| Tenant first | `Transaction(workspaceId, date)`, `CreditCardTransaction(workspaceId, ...)` | Workspace reads and IDOR-resistant lookup |
| Stable pagination | Transaction date/created/id composite | Cursor and chronological lists |
| Status queues | `BackgroundJob(status, availableAt)`, workspace/status alerts | Claiming due work and operational views |
| Due dates | Card transaction workspace/paymentDueDate | Reminders and payable queries |
| Idempotency | Posting/idempotency unique workspace+operation+key | Retry-safe money changes |
| Dedupe | Notification user+key, provider message/transaction keys | At-most-once user-visible effects |
| Expiry cleanup | Provider caches and security records by expiry/update | Bounded daily retention |

## Critical uniqueness

- One membership per workspace/user.
- One monthly plan per workspace/year/month.
- One active card name/program name per workspace where declared.
- One card reward per card.
- One posting/idempotency key per workspace/operation.
- One notification per user/dedupe key.
- One provider identity per provider/provider account.
- One legacy source link per system/table/source ID.
- Filtered SQL uniqueness for active background scope and delivery idempotency.

Do not replace durable uniqueness with preflight `findFirst`; concurrent requests can pass the same check.

## SQL-only integrity

Phase 4 and Phase 5 migrations add behavior not fully visible in Prisma:

- Allowed state values and domain checks.
- Currency/date/month/range validation.
- Composite workspace reference enforcement.
- Triggers that ensure child/parent workspace equality.
- Filtered unique indexes for active jobs.
- Posting/source uniqueness for concurrency claims.

Inspect the latest migration SQL before changing a relation or status field.

## Transactions and isolation

- Posting and imports use Prisma transactions, sometimes serializable behavior and explicit SQL locks.
- Session admission locks the user row with `UPDLOCK, HOLDLOCK`.
- Conditional update counts claim card transactions and receivables once.
- Job leases compare lease token/state so stale workers cannot commit completion.
- `XACT_ABORT` and explicit transaction wrappers are used in major SQL migrations.

## Performance risks

- Redundant indexes increase write cost for high-volume transaction/job tables.
- Removing a workspace-leading index can create cross-tenant scans.
- JSON/MAX columns cannot be efficient query predicates without extraction.
- Offset pagination on large collections is less stable/costly than the shared cursor contract.
- SQL Server has parameter limits; use `chunkValues` for large `IN` queries.

## Index-change process

1. Identify exact route/service query shape.
2. Capture representative SQL plan and row volume.
3. Check overlap with existing indexes and unique constraints.
4. Add a forward migration; never edit applied SQL.
5. Validate on production-like volume and integration tests.
6. Monitor query time and write impact.

## Partitioning

No table partitioning is defined. A future decision requires measured row growth, retention boundaries, Azure SQL tier behavior, and migration/restore tests.

## Related Files

- [`prisma/schema.prisma`](../../prisma/schema.prisma)
- [`prisma/migrations/backend_performance_jobs_and_indexes/migration.sql`](../../prisma/migrations/backend_performance_jobs_and_indexes/migration.sql)
- [`prisma/migrations/20260721000000_phase_4_database_integrity/migration.sql`](../../prisma/migrations/20260721000000_phase_4_database_integrity/migration.sql)
- [Performance review](../reviews/performance-review.md)

## Dependencies

- SQL Server index, transaction, and trigger semantics.

## Assumptions

- Dominant access paths remain workspace-scoped.

## Known Limitations

- No checked-in production query plans or index usage statistics.
- Prisma schema does not express filtered indexes or all triggers/checks.

## Future Improvements

- Add a repeatable query-plan capture script and index inventory report.
- Review MAX-length identifiers and JSON configuration fields.

## Last Updated

2026-07-28
