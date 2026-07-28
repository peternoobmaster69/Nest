---
title: Debugging Guide
description: A safe diagnostic workflow for common Nest application and integration failures.
audience: [engineers, operators, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Debugging guide

## Purpose

Reduce time to diagnosis without exposing secrets, financial records, or cross-workspace data.

## Scope

Local and deployed failures involving configuration, authentication, workspace resolution, database access, jobs, integrations, and builds.

## Diagnostic Order

1. Reproduce with the smallest non-sensitive input.
2. Identify the request path, active workspace, user role, and operation/idempotency key.
3. Distinguish validation (`400`), authentication (`401`), authorization (`403`), absence (`404`), conflict (`409`), throttling (`429`), and dependency failure (`5xx`).
4. Check environment presence without printing secret values.
5. Inspect database state and audit/job records with read-only queries.
6. Run the narrowest relevant test, then the full validation gate.

## Common Signals

| Symptom | Inspect | Common cause |
| --- | --- | --- |
| Redirect loop or no session | `NEXTAUTH_URL`, cookies, provider callback | Canonical origin/cookie mismatch |
| Passkey verification fails | RP ID, origin, challenge expiry/use | WebAuthn origin mismatch or replayed challenge |
| Workspace request denied | URL ID, header, membership, role | Stale workspace selection or insufficient role |
| Duplicate financial action | operation key and posting group | Caller reused or omitted stable retry identity |
| Balance disagreement | posting entries, reversals, control account | Bypassed posting service or misunderstood `startingCents` |
| Job remains pending | `BackgroundJob` lease, attempts, next run | Worker not invoked, lease recovery, provider failure |
| Gmail sync stalls | connection status, cursor, job summary | Expired/revoked OAuth token or bounded slice incomplete |
| Ask Nest unavailable | AI config, rate limit, provider status | Missing model config or upstream failure |
| Build fails after route change | generated OpenAPI, server/client boundary | Contract drift or client import of server-only code |

## Safe Logging

- Log stable request, workspace, job, and operation identifiers when available.
- Redact session tokens, OAuth credentials, passkey material, public share tokens, authorization headers, email bodies, imported statements, and AI prompts containing financial context.
- Do not copy production records into issue trackers.
- Prefer aggregate counts and state transitions over payload dumps.

The production log aggregation platform and retention policy are **Unknown from source code.**

## Database Diagnostics

Use the scripts in [database operations](../database/operations.md):

```bash
npm run db:migration:report
npm run db:phase4:preflight
npm run db:phase4:domain-report
```

Review a dry-run SQL migration before applying it:

```bash
npm run db:migration:dry-run -- <migration-file>
```

Never mutate production rows merely to test a theory. Use an approved backup or sanitized reproduction.

## Related Files

- [`lib/production-config.ts`](../../lib/production-config.ts)
- [`lib/api-security.ts`](../../lib/api-security.ts)
- [`lib/background-jobs.ts`](../../lib/background-jobs.ts)
- [Troubleshooting](../troubleshooting/common-issues.md)
- [Security architecture](../architecture/security.md)

## Dependencies

- Application logs, database access, test commands, and environment configuration.

## Assumptions

- Operators can access the relevant deployment logs and a least-privilege database connection.

## Known Limitations

- Source code does not identify a centralized tracing, metrics, or alerting product.
- Production runbooks and escalation contacts are unknown from source code.

## Future Improvements

- Add correlation IDs across HTTP, posting, background job, and provider calls.
- Define redaction-enforced structured logging and production runbooks.

## Last Updated

2026-07-28
