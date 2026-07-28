---
title: Deployment Guide
description: Build, migration, configuration, and verification requirements for deploying Nest.
audience: [release-engineers, operators, maintainers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Deployment guide

## Purpose

Describe the verified deployment contract and the checks needed to avoid authentication, schema, or scheduled-work failures.

## Scope

Application build, environment requirements, Azure SQL migration, Vercel cron configuration, and post-deployment verification.

## Supported Shape

The repository is prepared as a Next.js Node application with Vercel cron declarations and SQL Server/Azure SQL persistence. The actual production hosting account, region, network topology, rollback automation, and service-level objective are **Unknown from source code.**

## Pre-Deployment Gate

```bash
npm ci
npm run check
npm run build
npm run audit:public
```

Review migration state before deploying:

```bash
npm run db:migration:report
npm run db:phase4:preflight
```

## Production Configuration

- Use canonical HTTPS `NEXTAUTH_URL` and matching `WEBAUTHN_ORIGIN`.
- Set `WEBAUTHN_RP_ID` to the production relying-party domain.
- Supply strong `NEXTAUTH_SECRET`, `CRON_SECRET`, and `INTEGRATION_ENCRYPTION_KEY`.
- Keep SQL encryption enabled and `trustServerCertificate=false`.
- Enable API docs only when intended; production access is admin-gated.
- Configure only the OAuth, email, push, AI, search, and public-provider integrations in use.
- Do not trust forwarded headers unless the application is behind a controlled proxy that overwrites them.

See [security architecture](../architecture/security.md) for the complete trust model.

## Deployment Sequence

1. Back up the database according to the hosting platform's approved procedure.
2. Apply forward migrations with `npm run prisma:migrate:deploy`.
3. Deploy the application artifact built from the same commit.
4. Verify database connectivity and the health of authenticated landing flows.
5. Verify one non-mutating request in a workspace.
6. Verify configured cron requests authenticate with `CRON_SECRET`.
7. Verify enabled integration callbacks use the deployed canonical URL.
8. Monitor error rates, job backlog, login failures, and provider failures.

The exact backup/restore commands and deployment trigger are **Unknown from source code.**

## Scheduled Work

| Route | Schedule (UTC, Vercel cron) |
| --- | --- |
| `/api/cron/credit-card-payment-reminders` | `0 1 * * *` |
| `/api/cron/gmail-sync` | `0 3 * * *` |
| `/api/cron/credit-auto-accounting` | `0 3 * * *` |
| `/api/cron/ask-nest-retention` | `0 18 * * *` |

Schedules come from `vercel.json`. Any other host must reproduce these invocations and bearer-secret handling.

## Rollback

- Application code can be rolled back only if the older version remains compatible with applied forward migrations.
- Do not reverse financial history to undo an application deployment.
- A database rollback procedure is **Unknown from source code**; create and rehearse one before relying on rollback.

## Related Files

- [`vercel.json`](../../vercel.json)
- [`next.config.ts`](../../next.config.ts)
- [`.env.example`](../../.env.example)
- [Architecture deployment reference](../architecture/deployment.md)
- [Database operations](../database/operations.md)

## Dependencies

- Node 22, SQL Server/Azure SQL, deployment platform secrets, and any enabled external providers.

## Assumptions

- Migration deployment is run once per release under controlled credentials.

## Known Limitations

- No infrastructure-as-code, staging topology, automated rollback, or disaster-recovery runbook is present.
- Vercel cron frequency may be constrained by the selected hosting plan.

## Future Improvements

- Add infrastructure-as-code and environment promotion.
- Add post-deployment smoke tests, migration compatibility checks, and a rehearsed restore runbook.

## Last Updated

2026-07-28
