---
title: Architecture Decision Records
description: Index and maintenance policy for decisions that constrain Nest architecture.
audience: [engineers, architects, reviewers, ai-assistants]
status: living
source_of_truth: true
last_updated: 2026-07-28
---

# Architecture decision records

## Purpose

Preserve decisions whose rationale is easy to lose but whose consequences affect safe maintenance.

## Scope

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-001](ADR-001-workspace-scoped-urls.md) | Workspace URL is canonical request scope | Accepted |
| [ADR-002](ADR-002-posting-ledger.md) | Money mutations use journaled idempotent posting | Accepted |
| [ADR-003](ADR-003-session-model.md) | JWT cookie plus database session audit/admission | Accepted |
| [ADR-004](ADR-004-background-jobs.md) | Reliable work uses SQL-backed leased jobs | Accepted |
| [ADR-005](ADR-005-read-only-ai.md) | AI remains read-only and evidence-grounded | Accepted |
| [ADR-006](ADR-006-bank-control-balances.md) | Bank balances are manually maintained control totals | Accepted |

These records reconstruct decisions from code, tests, migrations, and checked-in guides. Options not evidenced by source are marked unknown.

## Related Files

- [Architecture overview](../overview.md)
- [Business rules](../../business/business-rules.md)

## Dependencies

- Repository evidence and future maintainer review.

## Assumptions

- “Accepted” means current code depends on the decision, not that a formal meeting record exists.

## Known Limitations

- Original decision authors and meeting history are unknown from source code.

## Future Improvements

- Add ADRs in the same pull request as future architectural changes.

## Last Updated

2026-07-28
