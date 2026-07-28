---
title: Deployment Architecture
description: Production topology, configuration gates, schedules, migration order, rollback, and operational unknowns.
audience: [operators, engineers, security-reviewers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Deployment architecture

## Purpose

Describe the deployment implied by checked-in configuration and the ordering constraints that protect production data.

## Scope

The repository documents a Next.js deployment with Azure SQL and Vercel cron. Cloud resource creation is outside the repository.

## Topology

```text
Browser
  → HTTPS application origin
  → Vercel-hosted Next.js instances
  → Azure SQL over encrypted, certificate-verified connection
  → optional provider APIs
```

Vercel schedules authenticated GET routes; Azure SQL stores both application and work-queue state. Multi-region, private networking, firewall, DNS, and scaling configuration are **Unknown from source code.**

## Production startup gates

`instrumentation.ts` calls `assertProductionConfig`. Production refuses to start unless:

- `NEXTAUTH_SECRET` or `AUTH_SECRET` is at least 32 characters.
- `NEXTAUTH_URL` is a canonical HTTPS origin.
- `WEBAUTHN_ORIGIN` is the same canonical HTTPS origin.
- `WEBAUTHN_RP_ID` equals the origin hostname.
- A valid 32-byte base64 integration encryption key is configured.
- `CRON_SECRET` is at least 32 characters.
- SQL encryption is enabled and `trustServerCertificate=false`.
- `ADMIN` is present when production API docs are enabled.

## Scheduled routes

Schedules in `vercel.json` are UTC:

| UTC schedule | Route | Responsibility |
| --- | --- | --- |
| `0 3 * * *` | `/api/cron/gmail-sync` | Queue/process due Gmail syncs |
| `0 3 * * *` | `/api/cron/credit-auto-accounting` | Run scoped auto-accounting jobs |
| `0 1 * * *` | `/api/cron/credit-card-payment-reminders` | Prepare/deliver due reminders |
| `0 18 * * *` | `/api/cron/ask-nest-retention` | Retention at 02:00 Singapore time |

Every cron route fails closed unless `Authorization: Bearer ${CRON_SECRET}` matches by the constant-time guard.

## Deployment order

1. Review application, environment, and migration changes.
2. Verify a recent backup and restore path outside the repository.
3. Test the migration on an isolated staging restoration.
4. Run database preflight and dry-run tools where applicable.
5. Apply forward migrations with `npm run prisma:migrate:deploy`.
6. Deploy code compatible with the migrated schema.
7. Smoke-test authentication, workspace reads, a finance workflow, Gmail status, admin jobs, and the retention route.
8. Monitor sanitized application/job failures.

Never use `prisma migrate dev` or `prisma db push` against shared/production data.

## Build and CI

The CI validation job runs:

- `npm ci`
- `npm run check`
- `npm run build`
- `npm run audit:public`

A separate SQL Server 2022 job bootstraps an empty database from the frozen baseline, seeds it, executes database-integrity integration tests, and verifies `migrate deploy` is idempotent.

Security workflows add CodeQL, Gitleaks full-history scanning, and high-severity dependency review.

## Rollback

Database migrations are forward-only:

- If schema remains backward-compatible, roll back application code but retain successful migrations.
- For a data/schema defect, stop affected writers and create a new forward-fix migration.
- Restore to a new database only for destructive/data-loss incidents.
- Never edit a migration that has reached a shared environment.
- Retain successful posting and idempotency history through application rollback.

## Secrets and environment

Secrets belong in deployment environment storage, never in Git or `NEXT_PUBLIC_*` variables. The complete configuration inventory is in [integrations](integrations.md) and [deployment guide](../guides/deployment.md).

## Related Files

- [`vercel.json`](../../vercel.json)
- [`instrumentation.ts`](../../instrumentation.ts)
- [`lib/production-config.ts`](../../lib/production-config.ts)
- [Database operations](../database/operations.md)
- [Deployment guide](../guides/deployment.md)

## Dependencies

- Vercel or an equivalent Next.js host capable of calling the cron routes.
- Azure SQL / SQL Server.
- GitHub Actions for documented CI.

## Assumptions

- Vercel is the intended production host because it is the only checked-in scheduler target.

## Known Limitations

- Infrastructure-as-code, environment promotion, observability backend, backup configuration, and incident ownership are unknown from source code.
- No health endpoint is documented.

## Future Improvements

- Add infrastructure-as-code and environment diagrams.
- Add automated smoke tests, deployment provenance, and rollback playbooks.
- Define SLOs, alert thresholds, and incident contacts.

## Last Updated

2026-07-28
