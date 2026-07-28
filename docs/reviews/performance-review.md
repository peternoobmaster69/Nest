---
title: Performance Review
description: Source-based review of request cost, database behavior, caching, jobs, provider latency, and UI budgets.
audience: [maintainers, performance-engineers, operators]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Performance review

## Purpose

Identify expensive paths and optimization opportunities while avoiding unsupported performance claims.

## Scope

HTTP payloads, Prisma/SQL access, background work, AI/provider calls, caching, client bundles, and concurrency.

## Existing Controls

- List endpoints impose caps, typically 20–500 records depending on domain.
- Gmail sync and retention work use bounded slices/batches.
- Reliable jobs use leases and retry scheduling rather than blocking interactive requests.
- Provider clients apply rate/usage limits where required.
- UI component and performance baselines have automated checks.
- Financial mutations use transactions and targeted serialization where correctness requires it.
- Ask Nest limits question/history size, request rate, tool access, and retention.

## Expensive or Sensitive Paths

| Path | Cost driver | Risk |
| --- | --- | --- |
| Investment writes/history | Large nested collections and price history | Validation memory, transaction duration, SQL writes |
| Transactions/card transactions | Filters, totals, month aggregation | Large workspaces and missing composite indexes |
| Dashboard | Multi-domain summary | Query fan-out and repeated calculations |
| Ask Nest | Model round trips plus tool/database calls | Latency, cost, context growth |
| Smart Review | Up to 250 transaction IDs | Batch reads/classification |
| Gmail sync | Provider pagination, parsing, dedupe, writes | Cron duration and provider quota |
| Public net worth/card dues | Database plus external market/news data | Provider latency and availability |
| Background worker | Polling and lease updates in primary SQL | Contention with interactive workload |
| Large client controllers | JavaScript parsing/hydration and rerender surface | Slow initial interaction on constrained devices |

## Database

- Indexes exist for workspace ownership, common time filters, job readiness, token hashes, and posting identities.
- New queries must be evaluated against their `where`, `orderBy`, and join pattern, not merely model-level indexes.
- Avoid unbounded `findMany`, N+1 resource lookups, and holding transactions open across network calls.
- Posting correctness may require locks; do not weaken serialization without concurrency evidence.

Production query plans, table cardinality, DTU/vCore sizing, and slow-query telemetry are **Unknown from source code.**

## Caching

- Bank logos are cached through a repository script/static assets.
- Azure Search and provider-specific caching/limits exist in selected paths.
- No general shared application cache such as Redis is configured.

Add caching only for data with an explicit freshness and invalidation contract. Never cache one workspace's data under a key that omits the workspace.

## Concurrency and Async Work

- Background jobs have lease and retry state.
- Cron invocations are bounded; repeated invocations must remain safe.
- Financial mutations rely on transactions/idempotency.
- Avoid unbounded `Promise.all` over provider calls or user-controlled arrays.

## Recommendations

| Priority | Recommendation | Required evidence |
| --- | --- | --- |
| High | Instrument endpoint, SQL, provider, and queue latency | Percentiles, error rates, query timing |
| High | Split/lazy-load large UI controllers and validate bundle impact | UI metrics and browser traces |
| Medium | Chunk large investment writes | Transaction and memory benchmarks |
| Medium | Profile dashboard and monthly transaction queries | Query plans at realistic cardinality |
| Medium | Track Ask Nest tokens, tool calls, latency, and cache hit rate | Sanitized cost/latency metrics |
| Low | Consider dedicated queue/cache only after contention is measured | Job backlog and SQL utilization |

## Measured Validation

On 2026-07-28, `npm run ui:metrics:check` after a clean production build reported:

```text
/collaborators/page javascript: 90673 > 63058 gzip bytes
```

The baseline was intentionally not raised. This is an active performance-budget regression until the collaborators route is profiled and reduced or a reviewed architecture change justifies a new baseline.

## Related Files

- [Scalability and reliability](../architecture/scalability.md)
- [Indexes](../database/indexing.md)
- [Technical debt](technical-debt.md)
- [`scripts/report-ui-performance.mjs`](../../scripts/report-ui-performance.mjs)

## Dependencies

- SQL Server query plans, hosting telemetry, provider metrics, and UI performance reports.

## Assumptions

- Current input caps are enforced before expensive processing.

## Known Limitations

- The local bundle measurement above is available, but no production latency, throughput, memory, real-user bundle, or query-plan measurements were available for this review.

## Future Improvements

- Establish service-level indicators and representative load datasets.
- Automate query-plan regression checks for critical aggregates.

## Last Updated

2026-07-28
