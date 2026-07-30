---
title: AI Feature Map
description: Feature-to-route, module, storage, and test navigation for code assistants.
audience: [ai-assistants, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI feature map

## Purpose

Minimize repository search time and expose downstream dependencies before edits.

## Scope

Primary product features and their canonical documentation.

## Map

| Feature | Module | API | Main storage/tests |
| --- | --- | --- | --- |
| Auth/passkeys/sessions | [auth](../modules/auth.md) | [authentication](../api/authentication.md) | User/Auth*/LoginSession; auth/security tests |
| Workspaces/collaboration | [workspaces](../modules/workspaces.md) | [workspaces](../api/workspaces.md) | Workspace/WorkspaceUser/Invite; workspace tests |
| Accounts/transactions | [ledger](../modules/ledger.md) | [ledger](../api/ledger.md) | Account/Transaction/Posting*; ledger tests |
| Budgets | [budgets](../modules/budgets.md) | [ledger](../api/ledger.md) | Budget/MonthlyBudgetPlan |
| Cards | [cards](../modules/cards.md) | [cards](../api/cards.md) | CreditCard/CreditCardTransaction/*Due |
| Receivables | [receivables](../modules/receivables.md) | [receivables](../api/receivables.md) | Receivable/ReceivableClose |
| Investments | [investments](../modules/investments.md) | [assets/rewards](../api/assets-rewards.md) | Investment*/MarketDataCache |
| Nest CIO | [CIO](../modules/cio.md) | [CIO](../api/cio.md) | Cio* planning models; CIO domain/API/UI/AI tests |
| Rewards | [rewards](../modules/rewards.md) | [assets/rewards](../api/assets-rewards.md) | Reward*/Kf* |
| Ask Nest/Smart Review | [AI](../modules/ai.md) | [AI](../api/ai.md) | AskNest*/smart-review tests |
| Gmail/imports | [integrations](../modules/integrations.md) | [integrations](../api/integrations.md) | Gmail*/CreditCardAlert |
| Jobs/notifications | [jobs](../modules/jobs-notifications.md) | [integration/cron](../api/integrations.md) | BackgroundJob/Notification/Push* |
| Admin/public sharing | [admin/public](../modules/admin-public.md) | [operations/public](../api/operations-public.md) | Audit/public token models |
| UI shell | [web UI](../modules/web-ui.md) | n/a | components/hooks; UI tests/budgets |

## Related Files

- [Dependency map](dependency-map.md)
- [Database schema](../database/schema.md)
- [Test strategy](../testing/strategy.md)

## Dependencies

- Module, API, schema, and test documentation.

## Assumptions

- “Main storage” is a navigation hint, not an exhaustive model list.

## Known Limitations

- Source files can participate in multiple features.

## Future Improvements

- Generate this table from explicit module metadata.

## Last Updated

2026-07-28
