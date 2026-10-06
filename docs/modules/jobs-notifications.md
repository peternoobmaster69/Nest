---
title: Background Jobs and Notifications Module
description: Durable job lifecycle, leases, retries, checkpoints, cancellation, reminders, and delivery channels.
audience: [engineers, operators, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-10-05
---

# Background jobs and notifications

## Purpose

Run long, scheduled, or provider-facing work reliably across serverless instances and notify users without duplicate delivery.

## Scope

`BackgroundJob`, queue helpers, Gmail/card/reminder workers, in-app notifications, push, email, cron authorization, admin retry/cancel, and retention.

## Responsibilities

- Enqueue with active-scope and optional idempotency dedupe.
- Claim with expiring lease token.
- Heartbeat progress/checkpoint.
- Continue, complete, fail/retry, cancel, or dead-letter.
- Recover abandoned leases.
- Store only sanitized failure information.
- Create/read/mark notifications with stable dedupe.
- Deliver capped reminder email/push.

## Public APIs and important functions

| File | Surface | Purpose |
| --- | --- | --- |
| `lib/background-jobs.ts` | enqueue/claim/heartbeat/continue/complete/fail/cancel/retry/find/map | Full job lifecycle |
| `lib/credit-card-payment-reminders.ts` | reminder queue/worker | Due statement email preparation |
| `lib/credit-card-statement-balances.ts` | `getOutstandingCreditCardStatements` | Shared net statement balances for reminders and dashboard |
| `lib/in-app-notifications.ts` | sync/list/mark/process push | Durable user notification |
| `lib/web-push.ts` | config/send | Push provider client |
| `lib/cron-auth.ts` | `authorizeCronRequest` | Fail-closed scheduler auth |
| `lib/data-retention.ts` | `runDataRetention` | Bounded cleanup |
| `lib/domains/jobs/index.ts` | deliberate job boundary exports | Route/operator consumers |

## Job lifecycle

`PENDING` → `RUNNING` → `COMPLETED`, or retry back to `PENDING`; exhausted retry becomes `DEAD_LETTER`. Cancellation can be requested while work runs. Lease token must match every mutation.

Retry delay is bounded exponential backoff. Exact status/check constraints are SQL-migration-backed.

## Function contracts

### `claimBackgroundJob`

- **Parameters:** optional job/type and lease duration.
- **Returns:** claimed job plus unique lease token or null.
- **Side effects:** recovers expired jobs and atomically marks one running.
- **Postcondition:** one live worker owns the lease.

### `failClaimedBackgroundJob`

- **Parameters:** job ID, lease token, unknown error.
- **Side effects:** sanitizes error; schedules retry or dead-letters.
- **Failure:** stale lease does not own completion.
- **Complexity:** fixed number of SQL operations.

## Credit-card reminder balances

Email, push, in-app notifications, and the dashboard use the same statement
balance query. For each workspace, card, statement month, and year, it sums every
signed transaction amount, including refunds and partial payments with missing
or later due dates. A statement with a zero or negative net balance is excluded.

The scheduled due date comes from positive purchase rows only. Payment and refund
dates cannot make the remaining balance due earlier. The reminder window is
applied after the full statement is netted. Delivery retries refresh in-app
notifications before rebuilding push payloads, removing reminders for statements
that have since been settled. Existing in-app reminders are also removed on the
next notification read or scheduled sync.

Credits only offset their own card and statement period; this query does not move
credits between statements or change recorded transactions.

## Configuration

Gmail slice caps, reminder delivery cap, retention windows, email/push keys, and `CRON_SECRET`.

## Error handling

- Lease loss/cancel are controlled worker outcomes.
- Provider errors are converted to bounded code/message.
- Stale push endpoints are removed on 404/410.
- Missing optional provider config leaves that channel disabled.

## Performance considerations

- Queue query indexes status/availability/lease.
- Each invocation/slice is bounded.
- Notification and delivery dedupe reduce provider work.
- SQL queue competes with user traffic.

## Security considerations

- Cron secret comparison is fail-closed and constant-time.
- Job payload/result/error must not contain provider secrets/raw sensitive data.
- Admin operations are fail-closed and scoped.
- Push subscriptions are user-owned sensitive endpoints.

## Risks

- Queue backlog can outgrow daily cadence.
- A worker that ignores heartbeat/lease contract can duplicate provider activity.
- Overly broad retention can erase operational evidence; overly long payload retention increases exposure.

## Future extension points

- Continuous workers/external queue while retaining SQL idempotency and audit.
- Per-job SLO and queue-age alerts.

## Related Files

- [Operations/public API](../api/operations-public.md)
- [ADR-004](../architecture/adr/ADR-004-background-jobs.md)
- [`tests/phase5-reliable-jobs.test.mjs`](../../tests/phase5-reliable-jobs.test.mjs)

## Dependencies

- Azure SQL, Vercel cron, optional email/push providers.

## Assumptions

- Current bounded scheduled capacity is sufficient.

## Known Limitations

- No external queue, continuous worker, or defined queue-age SLO.

## Future Improvements

- Add operational metrics and alerting.

## Last Updated

2026-10-05
