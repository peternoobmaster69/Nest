---
title: "ADR-004: SQL-Backed Reliable Jobs"
description: Decision to represent long/provider work as leased, resumable, idempotent rows in Azure SQL.
audience: [engineers, operators, architects, ai-assistants]
status: accepted
source_of_truth: true
last_updated: 2026-07-28
---

# ADR-004: SQL-backed reliable jobs

## Purpose

Preserve the reliability contract for scheduled and user-triggered long-running work.

## Scope

Gmail sync, card auto-accounting, reminder preparation/delivery, and operator retry/cancel.

## Context

Serverless handlers can time out, retry, overlap, or terminate after sending a response. Provider work can exceed one request.

## Problem

Work must remain visible, bounded, resumable, and safe across multiple instances.

## Constraints

- Azure SQL already provides durable state.
- Cron invocations are periodic, not continuous workers.
- Provider rate limits and partial failure must be respected.

## Options considered

- Fire-and-forget promise after response: rejected by tests and runtime model.
- In-memory queue: not durable or multi-instance safe.
- SQL-backed leased rows: implemented.
- External queue: not present; operational choice unknown.

## Decision

Persist `BackgroundJob` rows with active-scope and idempotency hashes, status, availability, lease token/expiry, attempts, checkpoint, sanitized result/error, cancellation, and dead-letter state. Workers claim bounded slices and heartbeat or checkpoint before continuing.

## Consequences

- Jobs survive process termination.
- SQL capacity serves both application and queue.
- Operators can inspect/retry/cancel without provider secrets.
- Cleanup must retain useful terminal evidence while deleting payloads.

## Risks

- Long SQL outages delay both user and job processing.
- Incorrect heartbeat/lease checks can allow stale workers.
- Backlog can grow between cron invocations.

## Alternatives

Moving execution to a managed queue is possible only if idempotency, audit, and scoped ownership remain durable.

## Future Improvements

- Add queue-age alerts and a dedicated worker topology when volume requires it.

## Related Files

- [`lib/background-jobs.ts`](../../../lib/background-jobs.ts)
- [`prisma/migrations/phase_5_reliable_background_jobs/migration.sql`](../../../prisma/migrations/phase_5_reliable_background_jobs/migration.sql)
- [`tests/phase5-reliable-jobs.test.mjs`](../../../tests/phase5-reliable-jobs.test.mjs)

## Dependencies

- Azure SQL uniqueness and transaction behavior.

## Assumptions

- Current workload fits scheduled bounded processing.

## Known Limitations

- No continuous worker or checked-in backlog dashboard exists.

## Last Updated

2026-07-28
