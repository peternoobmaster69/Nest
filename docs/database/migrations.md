---
title: Migration History
description: Frozen baseline, forward migrations, historical themes, legacy mapping, and safe change policy.
audience: [engineers, database-operators, reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Migration history

## Purpose

Preserve why the schema evolved and define how future changes are applied without corrupting shared environments.

## Scope

The repository contains a frozen baseline plus 34 historical/forward migration directories. Directory names are not uniformly timestamped; ordering is preserved by Prisma migration records and the baseline manifest.

## Baseline model

- `prisma/baseline/migration.sql` is the complete clean-install schema at the Phase 4 boundary.
- `prisma/baseline/history.json` lists 30 historical migrations represented by that SQL.
- `npm run db:bootstrap` requires an empty database, applies the baseline, marks those migrations applied, then deploys migrations after the boundary.
- Never regenerate the baseline or append future migrations to its history.

## Migration themes

| Migration/theme | Intent and consequence |
| --- | --- |
| `phase_0_purge_credit_card_cvv` | Irreversibly purge CVV columns before removal |
| `phase_1_posting_ledger_and_idempotency` | Add posting journal, replay-safe claims, reversals, source links |
| `phase_2_auth_rbac_collaboration` | Add session version, roles, one-time invitations, audit/public-link security |
| `phase_3_device_integration` | Add passkeys, challenges, push subscriptions |
| `phase_3_security_foundation` | Require PKCE/encrypted Gmail grants; purge legacy PAN/cardholder and plaintext grants |
| `phase_5_reliable_background_jobs` | Add scoped leased jobs, resumable Gmail state, dedupe indexes |
| `backend_performance_jobs_and_indexes` | Add transaction read indexes and job foundation |
| `monthly_budget_plan_v2*` | Introduce aggregate plans, reconcile/backfill, abort on mismatch |
| `fix_budget_monthly_snapshot_and_apply_once` | Snapshot titles/destination and prevent repeated application |
| `add_credit_txn_auto_rules_and_receivable_sources` | Persist ordered rules and cross-workspace source references |
| `cleanup_auto_receivables` | One-time destructive cleanup before consolidated auto-accounting; already historical |
| Ask Nest series | History, memory, token/quality telemetry, daily retention summary |
| Rewards/investment series | Hotel rewards, mileage expiry policy, investment liquidity |
| Provider series | Massive and SerpApi durable caches/throttles |
| `add_in_app_notifications` | Add user/workspace notification dedupe |
| `add_public_net_worth_share` | Add revocable workspace token projection |
| `add_transaction_groups` | Add user-defined envelope groupings |
| `20260721000000_phase_4_database_integrity` | Reconcile drift, add domain checks/scoped references/retention integrity |
| `20260722000000_login_session_audit` | Add session audit records |
| `20260722120000_multi_device_sessions` | Expand to five active device sessions with status/expiry |
| `sync_receivable_close_transaction_content` | Backfill close postings from source title/notes |
| `remove_unique_card_alert_staging_credit_transaction_id` | Allow non-unique alert staging link with lookup index |
| `widen_credit_card_auto_rules` | Allow large ordered-rule JSON |

## Legacy migration

`LegacyRecordLink` maps `(system, sourceTable, sourceId)` to `(targetModel, targetId)` so imports can be rerun safely. Historical mapping includes transactions, accounts, budgets, expenses, cards, receivables, notes, salary/USD values, and KrisFlyer mileage records.

Import invariants:

- Convert decimal money to integer cents.
- Preserve decimal exchange/conversion rates.
- Create reference/master records before dependent rows.
- Create the mapping in the same safe workflow as the target.
- Skip/reconcile an existing mapping; never silently duplicate.

## Creating a new migration

1. Update `prisma/schema.prisma`.
2. Use a separate disposable shadow database locally/staging.
3. Generate a new migration directory; do not rename or edit applied ones.
4. Review SQL for locks, data conversion, cascade paths, nullability, and rollback-on-error.
5. Add preflight/backfill checks for existing data.
6. Test clean bootstrap and upgrade from a representative restoration.
7. Deploy with `npm run prisma:migrate:deploy`.

## Rollback

There are no production down migrations. Use application rollback only when the new schema is backward-compatible; otherwise create and verify a forward-fix migration.

## Related Files

- [`prisma/baseline/history.json`](../../prisma/baseline/history.json)
- [`scripts/bootstrap-database.mjs`](../../scripts/bootstrap-database.mjs)
- [`scripts/dry-run-sql-migration.mjs`](../../scripts/dry-run-sql-migration.mjs)
- [Database operations](operations.md)

## Dependencies

- Prisma migration history table and SQL Server.

## Assumptions

- Historical migrations in the baseline manifest are immutable.

## Known Limitations

- Several historical migration directory names have no sortable timestamp.
- Exact production application dates for non-timestamped migrations are unknown from source code.

## Future Improvements

- Use timestamped names for every new migration.
- Add a generated migration catalog with checksums and schema-impact summary.

## Last Updated

2026-07-28
