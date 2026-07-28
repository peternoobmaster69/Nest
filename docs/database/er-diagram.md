---
title: Entity Relationship Diagram
description: Domain-level relationship view and guidance for reading the complete Prisma graph.
audience: [engineers, database-operators, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Entity relationship diagram

## Purpose

Show the relationships most relevant to tenant isolation and financial posting.

## Scope

The complete 61-model graph is too dense for one useful diagram. This view intentionally focuses on core domains; [schema.md](schema.md) catalogs every model.

```mermaid
erDiagram
    User ||--o{ WorkspaceMember : joins
    Workspace ||--o{ WorkspaceMember : contains
    Workspace ||--o{ FinancialAccount : owns
    FinancialAccount ||--o{ BudgetEnvelope : divides
    Workspace ||--o{ Transaction : records
    FinancialAccount ||--o{ Transaction : controls
    BudgetEnvelope o|--o{ Transaction : allocates
    PostingGroup o|--o{ Transaction : journals
    Workspace ||--o{ CreditCardAccount : owns
    CreditCardAccount ||--o{ CreditCardTransaction : posts
    CreditCardTransaction o|--o{ Transaction : accountedBy
    Workspace ||--o{ Receivable : tracks
    Receivable o|--o{ Transaction : settledBy
    Workspace ||--o{ MonthlyBudgetPlan : plans
    MonthlyBudgetPlan ||--o{ MonthlyBudgetPlanSource : funds
    MonthlyBudgetPlan ||--o{ MonthlyBudgetPlanItem : allocates
    Workspace ||--o{ InvestmentAccount : owns
    InvestmentAccount ||--o{ InvestmentEntry : snapshots
```

Reusable source: [er.mmd](../diagrams/er.mmd).

## Relationship rules

- Workspace-owned child IDs are never sufficient authorization on their own.
- Account and envelope referenced together must belong to the same workspace and parent relationship.
- Cross-workspace receivable source IDs are intentionally application-validated rather than local composite foreign keys.
- `PostingGroup` is the operation-level parent for related transactions and receivables.
- SQL `NO ACTION` is used where cascade paths would conflict; Prisma/services order cleanup.
- Polymorphic `LegacyRecordLink.targetModel/targetId` cannot have a conventional foreign key.

## Related Files

- [`prisma/schema.prisma`](../../prisma/schema.prisma)
- [Schema catalog](schema.md)
- [Posting ADR](../architecture/adr/ADR-002-posting-ledger.md)

## Dependencies

- Prisma relations and SQL migration constraints.

## Assumptions

- Diagram labels express business roles, not every physical foreign key.

## Known Limitations

- Auth, AI, rewards, notification, cache, and job relations are omitted from the visual for readability.

## Future Improvements

- Generate per-domain ER diagrams from Prisma metadata.

## Last Updated

2026-07-28
