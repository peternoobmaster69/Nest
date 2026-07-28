---
title: Documentation Table of Contents
description: Canonical navigation for the Nest engineering knowledge base.
audience: [engineers, operators, reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Documentation table of contents

## Purpose

Provide deterministic navigation to every maintained knowledge-base topic.

## Scope

### Start here

- [Knowledge base entry point](README.md)
- [Documentation standards](documentation-standards.md)
- [Glossary](glossary.md)
- [FAQ](faq.md)

### Architecture

- [Overview](architecture/overview.md)
- [System design](architecture/system-design.md)
- [Repository structure](architecture/repository-structure.md)
- [Data flow](architecture/data-flow.md)
- [Security](architecture/security.md)
- [Deployment](architecture/deployment.md)
- [Scalability and reliability](architecture/scalability.md)
- [Integrations](architecture/integrations.md)
- [ADR index](architecture/adr/README.md)
  - [ADR-001: Workspace-scoped URLs](architecture/adr/ADR-001-workspace-scoped-urls.md)
  - [ADR-002: Posting journal and idempotency](architecture/adr/ADR-002-posting-ledger.md)
  - [ADR-003: JWT sessions with database session audit](architecture/adr/ADR-003-session-model.md)
  - [ADR-004: SQL-backed reliable jobs](architecture/adr/ADR-004-background-jobs.md)
  - [ADR-005: Read-only grounded AI](architecture/adr/ADR-005-read-only-ai.md)
  - [ADR-006: Manual bank control balances](architecture/adr/ADR-006-bank-control-balances.md)

### Business and domain

- [Business rules](business/business-rules.md)
- [Workflows](business/workflows.md)
- [Traceability matrix](business/traceability.md)
- [Business glossary](business/glossary.md)

### Modules

- [Module index](modules/README.md)
- [Application shell and UI platform](modules/web-ui.md)
- [Authentication and sessions](modules/auth.md)
- [Workspaces and collaboration](modules/workspaces.md)
- [Accounts and ledger](modules/ledger.md)
- [Monthly budgets](modules/budgets.md)
- [Cards and card transactions](modules/cards.md)
- [Receivables](modules/receivables.md)
- [Investments](modules/investments.md)
- [Rewards](modules/rewards.md)
- [Ask Nest and Smart Review](modules/ai.md)
- [Gmail and imports](modules/integrations.md)
- [Background jobs and notifications](modules/jobs-notifications.md)
- [Administration and public sharing](modules/admin-public.md)

### API

- [API conventions and complete route index](api/README.md)
- [Authentication, sessions, and passkeys](api/authentication.md)
- [Workspaces, context, and collaborators](api/workspaces.md)
- [Accounts, transactions, groups, and budgets](api/ledger.md)
- [Cards, card transactions, and alerts](api/cards.md)
- [Receivables](api/receivables.md)
- [Investments and rewards](api/assets-rewards.md)
- [Ask Nest and Smart Review](api/ai.md)
- [Gmail, notifications, and push](api/integrations.md)
- [Dashboard, administration, public links, and cron](api/operations-public.md)

### Database

- [Schema and model catalog](database/schema.md)
- [Entity relationship diagram](database/er-diagram.md)
- [Indexes and constraints](database/indexing.md)
- [Migration history](database/migrations.md)
- [Database operations](database/operations.md)

### Engineering guides

- [Onboarding](guides/onboarding.md)
- [Development](guides/development.md)
- [Testing](guides/testing.md)
- [Debugging](guides/debugging.md)
- [Deployment](guides/deployment.md)
- [Git, review, and release](guides/collaboration.md)
- [Troubleshooting](troubleshooting/common-issues.md)
- [Test strategy and coverage map](testing/strategy.md)

### Reviews and maintenance

- [Technical debt](reviews/technical-debt.md)
- [Security review](reviews/security-review.md)
- [Performance review](reviews/performance-review.md)
- [Refactoring opportunities](reviews/refactoring-opportunities.md)

### Reference catalogs

- [Important file catalog](reference/file-catalog.md)
- [Core service and function contracts](reference/service-contracts.md)
- [Runtime configuration](reference/configuration.md)
- [Package dependency catalog](reference/dependency-catalog.md)

### AI assistant knowledge base

- [Project summary](ai/project-summary.md)
- [Architecture summary](ai/architecture-summary.md)
- [Business domain](ai/business-domain.md)
- [Business rules](ai/business-rules.md)
- [Coding conventions](ai/coding-conventions.md)
- [Common patterns](ai/common-patterns.md)
- [Common workflows](ai/common-workflows.md)
- [Feature map](ai/feature-map.md)
- [Dependency map](ai/dependency-map.md)
- [Pitfalls](ai/pitfalls.md)
- [Anti-patterns](ai/anti-patterns.md)
- [Performance notes](ai/performance-notes.md)
- [Security notes](ai/security-notes.md)
- [Testing strategy](ai/testing-strategy.md)
- [Common bugs](ai/common-bugs.md)
- [FAQ](ai/faq.md)
- [Glossary](ai/glossary.md)
- [Refactoring guide](ai/refactoring-guide.md)

### Diagram sources

- [System context](diagrams/system.mmd)
- [Runtime containers](diagrams/runtime-containers.mmd)
- [Data flow](diagrams/data-flow.mmd)
- [Database domains](diagrams/er.mmd)
- [Authentication sequence](diagrams/auth-sequence.mmd)
- [Financial posting sequence](diagrams/posting-sequence.mmd)
- [Gmail job sequence](diagrams/gmail-job-sequence.mmd)
- [Traceability](diagrams/traceability.mmd)

## Related Files

- [Knowledge base entry point](README.md)
- [Repository structure](architecture/repository-structure.md)

## Dependencies

- All linked documentation files.

## Assumptions

- `SUMMARY.md` is updated whenever a maintained page is added, moved, or removed.

## Known Limitations

- Generated artifacts such as `generated/openapi.json` are linked from their explanatory pages but are not duplicated here.

## Future Improvements

- Add an automated check ensuring every Markdown page appears in this index.

## Last Updated

2026-07-28
