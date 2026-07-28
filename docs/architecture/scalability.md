---
title: Scalability and Reliability
description: Current scaling model, performance boundaries, concurrency controls, bottlenecks, and reliability risks.
audience: [engineers, operators, architects]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Scalability and reliability

## Purpose

Document how Nest behaves across multiple runtime instances and where growth will require design changes.

## Scope

This is an evidence-based review of code and configuration, not a capacity commitment.

## Current scaling model

- Next.js handlers are stateless except for ephemeral in-process AI rate limiting; durable correctness lives in Azure SQL.
- Workspace scoping partitions most finance queries logically.
- Durable jobs, provider throttles, idempotency claims, and caches coordinate through SQL across instances.
- Cursor pagination is available for large transaction, collaborator, reward-history, notification, alert, and admin collections.
- Imports are chunked and use SQL Server-safe query batches.
- Dashboard/context use direct no-store reads with query telemetry rather than shared caching.

## Reliability controls

| Concern | Control |
| --- | --- |
| Azure SQL serverless wake | Detect known transient errors, probe with bounded backoff, retry session lookup |
| Duplicate finance request | Scoped idempotency record plus request hash and stored result |
| Concurrent allocation/settlement | Conditional single-row claims inside SQL transaction |
| Duplicate background scope | Filtered unique active-scope key |
| Worker failure | Lease expiry, checkpoint, exponential retry, dead-letter |
| Duplicate reminder | Daily/provider idempotency key and notification dedupe |
| Provider quota | Durable cache/throttle/quota records |
| Oversized import | Body, row, chunk, and batch limits |
| UI stale tenant data | Workspace-specific React Query keys and cache removal |

## Expected bottlenecks

- `app/api/dashboard/summary/route.ts` and `/api/context` aggregate many domain values per request.
- `lib/ai/ask-nest-tools.ts` contains numerous finance queries; each tool is bounded but a model turn can call multiple tools.
- SQL Server is both primary data store and work queue, increasing contention risk under high job throughput.
- Large React controllers and route bundles increase browser parse/interaction cost.
- Gmail sync deliberately processes bounded slices, so large backlogs trade latency for safety.
- SerpApi and Massive free-plan throttles intentionally serialize/limit traffic.

## Performance contracts

- List reads must have explicit bounds.
- SQL Server batches stay under parameter limits.
- Route JavaScript/CSS may regress no more than 5% against an intentionally reviewed baseline.
- Heavy UI (charts, imports, access management, auto-rule editor) is lazily loaded.
- Bank/account aggregates are not cached until invalidation and tenant isolation are proven.

## Capacity unknowns

The following are **Unknown from source code**:

- Expected users, workspaces, transactions, alerts, and jobs per day.
- Azure SQL SKU, connection limits, auto-pause settings, and storage growth.
- Vercel instance/region/concurrency limits.
- Provider paid/free plan commitments outside configured guards.
- Availability, latency, RPO, and RTO objectives approved by product/operations.

## Scaling triggers

Review architecture when:

- p95 dashboard/context query time grows materially with high-volume workspaces.
- Job queue age exceeds the daily schedule interval.
- SQL lock/timeout/deadlock errors become observable.
- Large controllers exceed UI exception ceilings or route size budgets.
- Provider cache tables or raw finance tables approach index/storage limits.
- A single cents value may exceed SQL `INT`.

## Safe evolution

- Add/verify composite indexes before adding caches.
- Preserve tenant key in every cache key and invalidation path.
- If jobs move to an external queue, retain database idempotency and audit state.
- Prefer background materialization for stable aggregates over cross-user in-memory caches.
- Partition/archival decisions require measured volume and Azure SQL plan evidence.

## Related Files

- [`lib/background-jobs.ts`](../../lib/background-jobs.ts)
- [`lib/api/pagination.ts`](../../lib/api/pagination.ts)
- [`lib/api/batching.ts`](../../lib/api/batching.ts)
- [`lib/observability/query-telemetry.ts`](../../lib/observability/query-telemetry.ts)
- [Performance review](../reviews/performance-review.md)

## Dependencies

- Azure SQL query planner and transaction behavior.
- Vercel runtime execution limits.
- Provider quotas.

## Assumptions

- Correctness takes priority over cache hit rate and maximum throughput.

## Known Limitations

- No checked-in load tests or production telemetry dashboard.
- SQL-backed queue processing shares database capacity with user requests.

## Future Improvements

- Establish volume baselines and SLOs.
- Add representative load tests and query-plan capture.
- Measure queue age, lease recovery, provider latency, and cache hit rate.

## Last Updated

2026-07-28
