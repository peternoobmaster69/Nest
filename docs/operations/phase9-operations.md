---
title: Production Operations and Observability
description: Release gates, SLOs, alerts, dashboards, and incident runbooks for Nest.
audience: [engineers, operators, security]
status: living
source_of_truth: true
last_updated: 2026-07-31
---

# Production operations and observability

## Release gates

The `CI` workflow is the executable release gate. Require `validate`, `browser`,
`sqlserver-baseline`, `CodeQL / analyze`, `Security / secret-scan`, and
`Security / dependency-review` in the GitHub `main` branch protection rule.
Repository administrators must enable that rule because source control cannot
enforce its own branch settings.

A release is blocked by a failed build, Prisma validation, migration bootstrap,
seed, integration/concurrency test, critical browser journey, axe smoke, visual
snapshot, secret scan, or high/critical production audit. An exception requires
an owner, compensating control, expiry date, and security approval.

## Telemetry contract

Server telemetry is one JSON object per line. Every event has `timestamp`,
`level`, `event`, `service`, and `environment`. Request events add `requestId`,
route, method, status, duration and, after authorization, `workspaceId`. Job
events add job ID/type, workspace, attempt, retry and deduplication state.
Database query groups carry domain, operation, duration and row count.

The logger recursively redacts credentials, authorization/cookies, email
bodies, provider endpoints, SQL/parameters, card data and likely secrets.
Emails are replaced with a fixed redaction marker. Do not log raw
request bodies, Prisma queries, OAuth responses or exception stacks in
production. Configure the hosting log drain as the error-tracking and metrics
exporter; `ERROR_TRACKING_DSN` is reserved for a provider adapter and must be
stored only in deployment secrets.

Performance telemetry from consented browsers is supplied by Vercel Speed
Insights. Product analytics and performance collection remain independently
consented.

## Health probes

- `GET /api/health/live` is public, performs no dependency work, returns
  `Cache-Control: no-store`, and is the process liveness probe.
- `GET /api/health/ready` requires `Authorization: Bearer
  $HEALTHCHECK_SECRET`. Unauthorized requests return 404. It probes SQL Server
  and reports only latency, expired leases, dead-letter count and oldest queue
  age. Any failed dependency or expired worker lease returns 503.

Never expose record identifiers, connection strings, hostnames, query text,
tokens or exception messages from a probe.

## Service-level objectives

| User journey / invariant | SLI | Rolling 28-day objective | Page threshold |
| --- | --- | --- | --- |
| Sign-in and session validation | successful attempts / valid attempts | 99.9% | <99.5% for 15 min |
| Core authenticated reads | non-5xx responses and p95 latency | 99.9%; p95 <750 ms | 5xx >1% or p95 >1.5 s for 10 min |
| Money mutations | committed or safely replayed / valid requests | 99.95%; p95 <1.5 s | errors >0.5% for 10 min |
| Duplicate-post prevention | duplicate ledger effects | exactly 0 | any occurrence |
| Reconciliation | workspaces with unexplained drift | exactly 0 | any non-zero drift |
| Scheduled jobs | successful before freshness deadline | 99.5% | two missed runs or oldest age >15 min |
| Gmail sync | successful non-permanent attempts | 99%; p95 age <30 min | errors >5% or age >60 min |
| Email/push | accepted or classified permanent / attempts | 99% | retryable failures >5% for 30 min |
| Browser experience | p75 LCP / INP / CLS | ≤2.5 s / ≤200 ms / ≤0.1 | two consecutive bad 15-min windows |

## Dashboards and alerts

Build the primary dashboard from `api.request`, `database.query_group`,
`job.*`, auth/rate-limit, reconciliation, Gmail/delivery, and Web Vitals
signals. Split API latency and errors by route template, never raw URL. Split
jobs by type/status and show queue age, duration, retry, dead letter and
duplicate suppression. Alert destinations must have a primary and backup
on-call receiver and a quarterly delivery test.

- Page immediately: readiness unavailable, duplicate posting, reconciliation
  drift, leaked-secret detection, sustained authentication failure, or a
  critical dependency finding.
- Page during support hours: SLO fast-burn, dead letter, missed cron, DB pool
  saturation, Gmail freshness, or delivery backlog.
- Ticket: slow-burn budget consumption, isolated permanent provider failure,
  elevated rate limits, or Web Vital regression.

## Deploy and forward-fix

1. Confirm all required checks and change approval.
2. Verify deployment secrets, encryption-key versions and database TLS.
3. Back up and verify PITR state before a data migration.
4. Run `npm run prisma:migrate:deploy` exactly once from the deployment job.
5. Deploy the application artifact built by CI; do not rebuild in production.
6. Probe liveness/readiness, then smoke sign-in, context, a read and a
   replay-safe test mutation in a designated workspace.
7. Watch errors, p95 latency, jobs and reconciliation for 30 minutes.

Application rollback is allowed only while schema compatibility is preserved.
Database migrations are never rolled down in production. For incompatible
schema/data defects, stop the rollout, disable the affected workflow, restore
service with a backward-compatible application if safe, and ship a reviewed
forward-fix migration.

## Key rotation and token compromise

For integration encryption, add the current key to
`INTEGRATION_ENCRYPTION_PREVIOUS_KEYS`, deploy a new version/current key,
re-encrypt stored envelopes in bounded audited batches, verify no old version
remains, then remove the retired key in a later deploy. Rotate
`NEXTAUTH_SECRET`, cron, health, VAPID and provider secrets independently.

For suspected OAuth/session/token compromise: revoke at the provider first,
disable the integration or bump user session versions, rotate affected
credentials, purge queued payloads/caches, inspect audit and redacted telemetry,
notify affected owners, and reconnect only after containment. Never paste a
suspected token into tickets or chat.

## Restore

Follow `docs/database/backup-restore-runbook.md`. Restore to an isolated server,
verify migration state and constraints, run reconciliation and tenant-isolation
checks, rotate secrets exposed in the recovered interval, and obtain incident
commander approval before traffic cutover. Record RPO/RTO and discrepancies.

## Job recovery

Use persisted job IDs and scopes. Inspect sanitized failure code, attempts,
checkpoint and lease expiry. Cancel only through the durable cancellation
operation. Retry dead letters through the retry operation so idempotency and
scope locks remain active. Never edit status/lease fields manually. After
recovery verify queue age, duplicate suppression and ledger reconciliation.

## Security incident

1. Declare severity and incident commander; preserve a UTC timeline.
2. Contain access without destroying logs or evidence.
3. Rotate/revoke the narrowest affected credentials and block abusive sources.
4. Determine affected users, workspaces, data classes and time range.
5. Restore from a known-good state or deploy a reviewed fix.
6. Validate tenant isolation, reconciliation, jobs and notification delivery.
7. Complete legal/user notification decisions and a blameless review.

Do not include private financial data or live secrets in the incident channel.
