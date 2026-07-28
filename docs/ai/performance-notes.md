---
title: AI Performance Notes
description: Performance guardrails for generated queries, routes, jobs, AI calls, and UI changes.
audience: [ai-assistants, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI performance notes

## Purpose

Prevent changes that are correct on small fixtures but unsafe at realistic scale.

## Scope

Database access, payloads, concurrency, background jobs, provider calls, AI, and browser bundles.

## Guardrails

- Keep `findMany` bounded and indexed by workspace plus filter/order columns.
- Select only fields required by the response or calculation.
- Avoid per-row database/provider calls; batch deliberately.
- Bound arrays, text, histories, uploads, pagination, and worker slices before processing.
- Keep network I/O outside database transactions.
- Do not remove locks/idempotency to improve speed without concurrency proof.
- Use SQL jobs for durable retry, but monitor database contention and backlog.
- Apply provider timeouts, quota caps, and degraded responses.
- Cap AI history/tool results and measure token/cost/latency.
- Lazy-load optional heavy UI; split oversized controllers and verify performance budgets.
- Include workspace in every cache key and define invalidation/freshness.

## Review Hotspots

- Dashboard aggregation.
- Transaction and card month lists/totals.
- Investment history batch writes.
- Ask Nest tool fan-out.
- Gmail pagination and parsing.
- Public routes that combine SQL with market/news providers.

## Related Files

- [Performance review](../reviews/performance-review.md)
- [Database indexes](../database/indexing.md)
- [Scalability](../architecture/scalability.md)

## Dependencies

- Query plans, UI metric reports, provider limits, and production telemetry.

## Assumptions

- Correctness and authorization take priority over speculative optimization.

## Known Limitations

- Production latency and cardinality are unknown from source code.

## Future Improvements

- Add performance budgets for critical APIs and database queries.

## Last Updated

2026-07-28
