# Database operations runbook

This runbook is the operational contract for Nest's SQL Server/Azure SQL schema. Production migrations are forward-only and are applied with `migrate deploy`; `migrate dev`, `db push`, and edits to an already-applied migration are prohibited in production.

## Reproducible database setup

The original database was created before a complete migration baseline existed. Phase 4 preserves every historical migration unchanged and adds a frozen baseline:

- `prisma/baseline/migration.sql` is the complete clean-install schema at the Phase 4 boundary.
- `prisma/baseline/history.json` is the immutable list of historical migrations represented by that baseline.
- `npm run db:bootstrap` requires an empty database, applies the baseline, records only that frozen history, and then runs every forward migration after the boundary.

Do not regenerate the baseline or append future migrations to `history.json`. New schema changes always get a new directory under `prisma/migrations` and are deployed normally. CI runs the bootstrap against an ephemeral SQL Server container, seeds it, exercises representative constraints, reruns `migrate deploy`, and lets the service container be destroyed with the job.

## Deployment procedure

1. Confirm an Azure SQL automated backup is available and record the current UTC time and application commit.
2. Restore production to a temporary staging database at a recent point in time.
3. Set staging `DATABASE_URL` and `SHADOW_DATABASE_URL` to separate, disposable databases. Run `npm run db:phase4:preflight`, `npm run db:migration:dry-run -- prisma/migrations/<name>/migration.sql`, `npm run prisma:migrate:deploy`, `node scripts/run-prisma.mjs migrate status`, `npm run prisma:seed` only when the target is disposable, and the database integration tests. The dry-run command executes an explicitly transactional migration with its single `COMMIT` replaced by `ROLLBACK`.
4. Review Phase 4 preflight failures. Invalid domain rows, duplicate external references, or cross-workspace references must be corrected with an explicit data migration; do not disable constraints or edit an applied migration.
5. Deploy the application version that is compatible with both the pre- and post-migration schema.
6. Against production, run:

   ```powershell
   npm run prisma:migrate:deploy
   node scripts/run-prisma.mjs migrate status
   ```

7. Smoke-test sign-in, workspace selection, one read-only finance page, Gmail status, the admin job view, and the retention endpoint. Record the migration name, start/end time, and operator.

`SHADOW_DATABASE_URL` is for local/staging migration authoring only. It must never point at production or at the same database as `DATABASE_URL` when running `migrate dev`.

## Rollback and forward-fix

Prisma migrations have no automatic down migration in production. If the application is unhealthy but the schema is backward compatible, roll the application deployment back and keep the migrated schema. If data/schema correction is required:

1. stop the affected writer or feature;
2. preserve logs and the failed migration output;
3. restore production to a new database only for destructive/data-loss incidents;
4. otherwise create a new forward-fix migration, verify it on a point-in-time staging restore, deploy it, and re-enable the writer;
5. never change a migration checksum after it has reached any shared environment.

## Integrity ownership

SQL Server `NO ACTION` composite foreign keys enforce workspace consistency for financial accounts, budgets, transaction groups, cards, card transactions, receivables, rewards, Gmail integrations, and workspace defaults. `NO ACTION` avoids SQL Server multiple-cascade-path failures; Prisma's `relationMode = "prisma"` remains responsible for ordered cascades. Posting groups retain the bounded Phase 1 identifier format, so single-column foreign keys enforce existence while child and parent update triggers enforce workspace equality without widening the idempotency index.

These relations intentionally remain application-managed:

| Relation | Reason and guard |
| --- | --- |
| `User.activeWorkspaceId` | A user can lose membership; workspace auth resolves membership and repairs the selected workspace. |
| `BackgroundJob.workspaceId/userId` | Historical jobs must survive membership/user removal for sanitized operational evidence. Job enqueue validates scope. |
| Receivable source workspace/account/budget | A receivable can intentionally refer to another authorized workspace; routes validate the source account and budget together. |
| `CreditCardTxnLink` card/ledger workspace | The link has no workspace column; posting services validate both sources and unique source-posting indexes prevent replay. |
| Legacy target model/id links | Polymorphic target columns cannot use a relational foreign key; import/reconciliation scripts validate them. |

## Numeric, currency, and time rules

- Ledger and balance amounts remain signed SQL `INT` cents: exact arithmetic with an accepted per-value range of -2,147,483,648 through 2,147,483,647 cents (about ±21.47 million currency units). A product requirement above that limit requires a dedicated `BIGINT`/`DECIMAL(19,2)` migration and explicit JSON serialization.
- Reward conversion rates use `DECIMAL(19,8)`, not floating point.
- Currency codes are exactly three uppercase ASCII characters. Money is never added across currencies without an explicit persisted conversion rate.
- Timestamps are stored as UTC instants. User-entered calendar dates are normalized to midnight UTC at the API boundary; recurring month/year concepts remain explicit integer columns to avoid locale shifts.

## Retention

The existing `/api/cron/ask-nest-retention` schedule now runs consolidated bounded retention. It removes expired OAuth/WebAuthn records, scrubs old raw card-alert content, removes old terminal job payloads and records, expired/responded invites, old notifications, audit logs, expired provider caches, and inactive rate-limit rows. Ask Nest usage is summarized before raw turns are removed. Retention windows are documented in `.env.example`; each policy performs at most 20 bounded batches per invocation and continues on the next daily run.

## Azure SQL backup and restore

Azure SQL Database automated backups support point-in-time restore, and TDE encrypts database files, logs, and backups at rest. For this service, configure:

- TDE enabled and verified after every database move;
- 28-day short-term point-in-time retention;
- geo-redundant backup storage unless data-residency rules require another choice;
- an operational target of RPO ≤ 15 minutes for an in-region data error and RTO ≤ 4 hours, measured rather than assumed;
- quarterly restore drills to a new, isolated database.

Azure Portal path: logical SQL server → **Backups** → **Retention policies** → configure PITR; database → **Compute & storage** → backup storage redundancy. The equivalent retention command is:

```powershell
az sql db str-policy set --resource-group <group> --server <server> --name <database> --retention-days 28 --diffbackup-hours 12
```

For a drill, choose a UTC restore point shortly before the drill, restore to a new name, run `migrate status`, perform sign-in/read checks with isolated application credentials, compare representative row counts and the latest financial posting timestamp, record results, then remove the isolated database through the normal Azure change process.

```powershell
az sql db restore --resource-group <group> --server <server> --name <database> --dest-name <database>-restore-YYYYMMDD --time "YYYY-MM-DDTHH:MM:SSZ"
```

Record each drill here or in the operations system:

| Drill UTC | Restore point UTC | Completed UTC | Measured RPO | Measured RTO | Integrity checks | Operator | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _pending first quarterly drill_ | | | | | | | |

References: [Azure SQL automated backup behavior](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview?view=azuresql), [change PITR and backup redundancy settings](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-change-settings?view=azuresql), [point-in-time restore](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups?view=azuresql), and [Azure encryption at rest](https://learn.microsoft.com/en-us/azure/security/fundamentals/encryption-atrest).
