---
title: Business-to-Code Traceability
description: Mapping from requirements and rules through API, services, database, tests, and documentation.
audience: [engineers, reviewers, auditors, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-30
---

# Business-to-code traceability

## Purpose

Make change impact discoverable across product intent, code, persistence, and validation.

## Scope

The repository has no external requirement IDs, so this matrix uses stable business-rule IDs.

## Traceability matrix

| Requirement | Rules | API | Service | Models | Tests | Module docs |
| --- | --- | --- | --- | --- | --- | --- |
| Isolate household finances | BR-001–005 | context, workspaces, collaborators | workspace auth/collaborator service | Workspace, Member, Invite, Audit | phase2 security, workspace entry | [Workspaces](../modules/workspaces.md) |
| Track real versus allocated cash | BR-010–019 | accounts, transactions, groups | posting, budget ledger, bank consistency | FinancialAccount, BudgetEnvelope, Transaction, PostingGroup | phase1 ledger, transaction visibility | [Ledger](../modules/ledger.md) |
| Plan and fund a month | BR-020–025 | budgets/plan | budget-plan services | BudgetItem/Source, MonthlyBudgetPlan* | monthly budget, phase1 ledger | [Budgets](../modules/budgets.md) |
| Track and settle card payables | BR-030–037 | cards, credit-transactions, reminders | statement cycle, accounting runner, reminders | CreditCardAccount/Transaction, Link | card reminder, phase0, phase1 | [Cards](../modules/cards.md) |
| Track expected repayments | BR-040–045 | receivables | receivable summary/close posting | Receivable, Transaction, PostingGroup | receivable close, phase1 | [Receivables](../modules/receivables.md) |
| Value investments and liquid assets | BR-050–054 | investments, public net worth | investment ordering, net worth | InvestmentAccount/Entry | investment order, public net worth | [Investments](../modules/investments.md) |
| Track rewards | BR-055–056 | rewards | reward history service | Flyer/Hotel/Card rewards, mileage/conversion | architecture/API contracts | [Rewards](../modules/rewards.md) |
| Provide safe finance AI | BR-060–064 | ai routes | Ask Nest, Smart Review, provider clients | AskNestTurn/Memory/Usage, caches | Ask Nest/smart review/provider contracts | [AI](../modules/ai.md) |
| Import card activity reliably | BR-065–067 | Gmail, credit alerts/import, cron | Gmail runner, alert ingest, jobs | GmailIntegration, AlertStaging, BackgroundJob | Gmail/phase3/phase5 | [Integrations](../modules/integrations.md) |
| Notify users without duplicates | BR-036, BR-066 | reminders, notifications, push | reminder and notification services | BackgroundJob, Notification, PushSubscription | reminder/phase5 | [Jobs and notifications](../modules/jobs-notifications.md) |
| Support safe offline shell | BR-068 | manifest/offline assets | service worker cache purge | None | phase0/phase3 contracts | [Web UI](../modules/web-ui.md) |
| Provide household CIO decision support | BR-070 through BR-076 | cio routes, ai/ask | CIO snapshot/allocation/cashflow/policy/projection services | Cio* profile, policy, exposure, flow, position models | CIO domain/API/UI/Ask Nest tests | [CIO](../modules/cio.md) |

## Change impact method

For a changed rule:

1. Update [business rules](business-rules.md).
2. Inspect each API/service/model/test in the row.
3. Add a migration if persisted meaning changes.
4. Update the module and API documents.
5. Add or revise an ADR if the architectural choice changes.
6. Run all listed tests plus the standard release gate.

## Related Files

- [Business rules](business-rules.md)
- [Feature map](../ai/feature-map.md)
- [Traceability diagram](../diagrams/traceability.mmd)

## Dependencies

- Stable business-rule identifiers.

## Assumptions

- Code and tests are the only available requirement evidence.

## Known Limitations

- Product owner, ticket, risk-control, and regulatory IDs are unknown from source code.

## Future Improvements

- Add external requirement and incident IDs when available.
- Automate rule-to-test reference checks.

## Last Updated

2026-07-30
