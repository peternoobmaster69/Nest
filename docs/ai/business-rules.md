---
title: AI Business Rules
description: High-signal rule checklist with stable IDs and canonical references.
audience: [ai-assistants, engineers, reviewers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI business rules

## Purpose

Put the rules most likely to be violated during code generation in one checklist.

## Scope

Summary only. The [canonical rule catalog](../business/business-rules.md) contains evidence and consequences.

## Rule Checklist

| ID | Rule |
| --- | --- |
| BR-001 | Every private resource access is workspace-scoped. |
| BR-002 | Enforce the minimum role; owner-only actions require fresh authentication where implemented. |
| BR-003 | Money is integer cents. |
| BR-004 | Balance changes use postings and an auditable group. |
| BR-005 | Retried mutations reuse a stable operation key. |
| BR-006 | Corrections reverse history; they do not erase it. |
| BR-007 | Budget envelopes are allocations, not bank accounts. |
| BR-008 | A receivable cannot be closed beyond its outstanding amount. |
| BR-009 | Card payment/accounting cannot exceed applicable outstanding amounts. |
| BR-010 | Background work is bounded, leased, retryable, and idempotent. |
| BR-011 | Ask Nest tools are read-only and workspace-filtered. |
| BR-012 | Integration credentials are encrypted and never returned. |
| BR-013 | Public shares expose restricted projections using purpose-scoped tokens. |
| BR-014 | Imported/provider data is untrusted and size-limited. |
| BR-015 | Manual bank control balance semantics remain isolated from ordinary posting totals. |
| BR-070 | Nest CIO is read-only decision support with no trading or posting authority. |
| BR-071 | Structured Nest data and deterministic CIO services are authoritative. |
| BR-072 | Planning net worth stays separate from dashboard/public net worth. |
| BR-073 | CIO classifications, policies, and assumptions are explicit and reviewable. |
| BR-074 | Internal reallocations are not new contributions. |
| BR-075 | CIO projections show their data date and assumptions. |
| BR-076 | Unknown, missing, and stale data is surfaced rather than silently excluded. |

## Change Protocol

If a rule changes:

1. Update canonical rules and affected workflow.
2. Update service/route tests.
3. Update API/schema docs.
4. Add an ADR for a durable architectural change.

## Related Files

- [Canonical business rules](../business/business-rules.md)
- [Traceability](../business/traceability.md)
- [Common workflows](common-workflows.md)

## Dependencies

- Domain services, route guards, Prisma constraints, and tests.

## Assumptions

- Rule IDs remain stable across wording improvements.

## Known Limitations

- Rules not discoverable from source are not represented.

## Future Improvements

- Reference rule IDs directly from critical tests and service documentation.

## Last Updated

2026-07-28
