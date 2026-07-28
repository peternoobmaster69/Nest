---
title: AI Architecture Summary
description: Compact map of Nest runtime boundaries and dependency direction.
audience: [ai-assistants, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI architecture summary

## Purpose

Provide a low-token architecture model for change planning and code review.

## Scope

Runtime layers, state ownership, and architectural boundaries.

## Layer Map

```text
app pages/layouts
  → components + hooks
  → app/api route handlers
  → lib authentication / workspace guards / domain services
  → Prisma client
  → SQL Server or Azure SQL

domain services → background jobs → cron handlers
domain services → typed provider clients → external APIs
Ask Nest → read-only tool registry → workspace-filtered domain reads
```

## State Ownership

| State | Owner |
| --- | --- |
| Durable business data | SQL through Prisma/domain services |
| Auth application state | Signed NextAuth JWT |
| Login audit/revocation | SQL session records |
| Shared browser server state | React Query |
| Temporary interaction state | React component/hook state |
| Reliable asynchronous state | `BackgroundJob` SQL records |

## Boundary Rules

- Route handlers authenticate, validate, resolve workspace, and delegate.
- Business invariants belong in `lib/`, not UI controllers.
- Provider code must not become an authorization boundary.
- Network calls should not occur inside long financial database transactions.
- Generated OpenAPI describes public route shape but is incomplete for full bodies.

## Key Decisions

- [Workspace URL context](../architecture/adr/ADR-001-workspace-scoped-urls.md)
- [Posting ledger](../architecture/adr/ADR-002-posting-ledger.md)
- [Session model](../architecture/adr/ADR-003-session-model.md)
- [Reliable SQL jobs](../architecture/adr/ADR-004-background-jobs.md)
- [Read-only AI](../architecture/adr/ADR-005-read-only-ai.md)
- [Bank control balance](../architecture/adr/ADR-006-bank-control-balances.md)

## Related Files

- [System design](../architecture/system-design.md)
- [Dependency map](dependency-map.md)
- [System diagram](../diagrams/system.mmd)

## Dependencies

- Next.js, React, Prisma, SQL Server, and configured external providers.

## Assumptions

- Server-only modules stay out of client bundles.

## Known Limitations

- Physical production network and failover topology are unknown from source code.

## Future Improvements

- Add automated import-boundary enforcement.

## Last Updated

2026-07-28
