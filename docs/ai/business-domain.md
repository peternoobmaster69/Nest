---
title: AI Business Domain
description: Compact model of Nest finance concepts and their relationships.
audience: [ai-assistants, domain-engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI business domain

## Purpose

Prevent code changes from confusing distinct financial concepts.

## Scope

Workspaces, accounts, budgets, cards, receivables, investments, rewards, and AI assistance.

## Domain Map

| Concept | Meaning | Change hazard |
| --- | --- | --- |
| Workspace | Tenant and collaboration boundary | Cross-workspace access |
| Account | Financial container/control account | Direct balance mutation |
| Transaction | User-visible movement or record | Duplicate retry |
| Posting group/entry | Auditable accounting effect | Unbalanced or deleted history |
| Budget envelope | Virtual allocation of funds | Treating it as a bank account |
| Credit card | Statement/payment schedule | Month/due-date boundary |
| Receivable | Money owed to the workspace/user | Closing more than outstanding |
| Investment asset | Holding and price-history aggregate | Large batch writes |
| Reward program | Points/miles balance and activity | Unit/currency confusion |
| Alert/import source | External evidence producing candidate records | Duplicate ingestion |
| Ask Nest | Read-only assistant over authorized data | Hallucination or data leakage |

## Relationships

- A user accesses data through workspace membership.
- Transactions and workflows affect accounts/envelopes through postings.
- Cards, receivables, investments, and rewards are workspace-owned feature domains.
- Alerts/imports are evidence; accounting changes remain explicit and idempotent.
- AI reads domain projections but does not write them.

## Unknown Business Context

Target customer segment, supported legal jurisdictions, accounting standard, tax treatment, and regulatory obligations are **Unknown from source code.**

## Related Files

- [Business glossary](../business/glossary.md)
- [Business workflows](../business/workflows.md)
- [Database schema](../database/schema.md)

## Dependencies

- Business rules and schema ownership.

## Assumptions

- The application is a personal-finance manager, not a bank ledger of record.

## Known Limitations

- Business rationale is inferred only where code, migrations, or existing guides provide evidence.

## Future Improvements

- Add product-owner-reviewed domain definitions and jurisdictional constraints.

## Last Updated

2026-07-28
