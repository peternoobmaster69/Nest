---
title: Module Index
description: Domain and platform module boundaries, ownership surfaces, and dependency direction.
audience: [engineers, maintainers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Module index

## Purpose

Define the cohesive modules used by this knowledge base. Nest is one npm package; these are architectural boundaries, not separately deployed services.

## Scope

| Module | Primary responsibility | Main consumers |
| --- | --- | --- |
| [Web UI](web-ui.md) | Shell, shared controls/dialogs, client cache, route states | All browser routes |
| [Authentication](auth.md) | Provider/passkey sign-in, sessions, recent auth | Pages and all protected APIs |
| [Workspaces](workspaces.md) | Tenant context, roles, collaboration, invitations | Every private domain |
| [Ledger](ledger.md) | Accounts, envelopes, transactions, transfers, posting | Dashboard, budgets, cards, receivables |
| [Budgets](budgets.md) | Templates, monthly drafts, balancing, application | Budget plan UI and ledger |
| [Cards](cards.md) | Card metadata, statement activity, allocation/payment | Cards, reminders, receivables |
| [Receivables](receivables.md) | Expected repayment and settlement | Dashboard, cards, ledger |
| [Investments](investments.md) | Dated valuation snapshots and liquidity | Investments, net worth |
| [Rewards](rewards.md) | Miles, points, expiry, conversions | Rewards UI |
| [AI](ai.md) | Ask Nest, Smart Review, deterministic/entity/provider reads | Assistant and card review |
| [Integrations](integrations.md) | Gmail alerts, Maybank imports, provider credentials | Cards and jobs |
| [Jobs/notifications](jobs-notifications.md) | Durable work, reminders, email/push/in-app | Cron, admin, browser |
| [Admin/public](admin-public.md) | Fail-closed operations view and minimal public projections | Administrators/share viewers |

## Shared dependency direction

- Modules may depend on authentication/workspace guards and API contracts.
- Finance mutation modules depend on ledger posting; ledger must not depend on page controllers.
- Integration workers may call domain services but must not bypass workspace and idempotency checks.
- AI may read domain data but must not expose mutation functions.
- UI depends on HTTP/public module surfaces, not Prisma.

## Related Files

- [Repository structure](../architecture/repository-structure.md)
- [Dependency map](../ai/dependency-map.md)
- [API index](../api/README.md)

## Dependencies

- `app/`, `components/`, and `lib/`.

## Assumptions

- Module ownership is conceptual; repository-wide CODEOWNERS remains authoritative.

## Known Limitations

- Some route handlers and controllers still mix transport, orchestration, and presentation concerns.

## Future Improvements

- Enforce module boundaries with import rules and domain-specific ownership.

## Last Updated

2026-07-28
