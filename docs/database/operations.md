---
title: Database Operations
description: Setup, migration, validation, backup assumptions, recovery, retention, and safe data-script procedures.
audience: [database-operators, engineers, incident-responders]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Database operations

## Purpose

Provide the safe operational contract for SQL Server/Azure SQL.

## Scope

Local setup, clean bootstrap, shared-environment migration, data scripts, retention, and recovery.

## Connection configuration

Prefer a full `DATABASE_URL`:

```env
DATABASE_URL="sqlserver://server:1433;database=nest;user=app;password=***;encrypt=true;trustServerCertificate=false"
```

Split `AZURE_SQL_*` values are a supported fallback. `SHADOW_DATABASE_URL` must point to a separate disposable database and is only for migration authoring.

Production validates encryption and rejects trusted self-signed server certificates.

## Clean database

```bash
npm ci
npm run prisma:generate
npm run db:bootstrap
npm run prisma:seed
```

Bootstrap fails if any user table exists. It applies the frozen baseline and forward migrations.

## Existing database

```bash
npm run db:phase4:preflight
npm run db:migration:report
npm run prisma:migrate:deploy
node scripts/run-prisma.mjs migrate status
```

Never use `migrate dev` or `db push` in shared/production environments.

## Migration rehearsal

1. Restore production to an isolated staging database at a recent point.
2. Configure separate staging database and shadow URLs.
3. Run preflight/domain reports.
4. For an explicitly transactional SQL migration:

   ```bash
   npm run db:migration:dry-run -- prisma/migrations/<name>/migration.sql
   ```

5. Apply migrations and execute DB integration tests.
6. Compare representative counts and posting/reconciliation results.

The dry-run tool only accepts a `migration.sql` beneath `prisma/migrations` with exactly one explicit transaction pair; it replaces `COMMIT` with `ROLLBACK`.

## Data-script safety

Mutation-capable scripts must:

- Default to dry-run.
- Require an exact workspace.
- Require `--apply`.
- Require an allowed environment.
- Require `--confirm=<exact-workspace-id>`.
- Emit structured audit output.

Do not run historical one-time migration SQL as an ad hoc cleanup tool.

## Retention

The daily consolidated retention job performs bounded batches. Defaults from `.env.example` include:

| Data | Default days |
| --- | ---: |
| Ask Nest raw history | 90 |
| Terminal job payload | 14 |
| Terminal job row | 90 |
| Failed card-alert body | 7 |
| Completed/expired invitation | 30 |
| Read notification | 90 |
| Notification | 365 |
| Audit log | 730 |
| Login-session metadata | 90 |

Ask Nest usage is aggregated before raw turn deletion.

## Backup and restore

The repository does not configure Azure SQL backups. A prior runbook recommended 28-day point-in-time retention, geo-redundant storage where allowed, quarterly restore drills, RPO ≤15 minutes, and RTO ≤4 hours. These are recommendations, not confirmed infrastructure state.

Before production migration:

- Confirm a recent recoverable backup.
- Record commit, migration, and UTC start time.
- Test restoration to a new database.
- Verify TDE and connection TLS outside this repository.

## Incident recovery

- Stop affected writers, not the entire database, when possible.
- Preserve request IDs, job IDs, posting IDs, and migration output.
- Do not delete successful posting/idempotency history.
- Prefer a forward-fix migration.
- Restore to a new database for destructive/data-loss incidents; do not overwrite the only copy.
- Reconcile workspace budgets and representative statements before reopening writes.

## Related Files

- [`scripts/bootstrap-database.mjs`](../../scripts/bootstrap-database.mjs)
- [`scripts/data-script-safety.mjs`](../../scripts/data-script-safety.mjs)
- [`lib/data-retention.ts`](../../lib/data-retention.ts)
- [Migration history](migrations.md)
- [Troubleshooting](../troubleshooting/common-issues.md)

## Dependencies

- SQL Server/Azure SQL administration and backup features.
- Credentials with least privilege for the requested operation.

## Assumptions

- Operators have an external change/incident record system.

## Known Limitations

- Actual backup retention, redundancy, drills, and measured RPO/RTO are unknown from source code.
- No partitioning or archival database is configured.

## Future Improvements

- Check in Azure infrastructure-as-code and a restore-drill log.
- Add automated post-migration reconciliation and health probes.

## Last Updated

2026-07-28
