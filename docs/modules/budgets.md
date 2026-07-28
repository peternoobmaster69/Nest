---
title: Monthly Budgets Module
description: Budget templates, monthly plans, balancing, confirmation, destination funding, and compatibility transport.
audience: [engineers, finance-domain-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Monthly budgets

## Purpose

Turn reusable expected income/allocation setup into a balanced, immutable monthly funding plan.

## Scope

`BudgetItem`, `BudgetSource`, V2 monthly-plan models, legacy snapshot models, `/api/budgets/plan`, and budget-plan UI.

## Responsibilities

- CRUD active source/item templates.
- Start monthly draft blank or from active setup.
- Validate source owner and item destination.
- Reorder/update/delete draft rows.
- Require non-empty equal aggregate totals.
- Confirm once and apply remaining destination cents atomically.
- Preserve existing API action contract while logic lives in domain services.

## Public APIs and important files

| File | Exported surface | Responsibility |
| --- | --- | --- |
| `lib/domains/ledger/budget-plan/contracts.ts` | action Zod schemas | Transport contract |
| `handlers.ts` | GET/POST/PATCH/DELETE | Thin compatibility orchestration |
| `query-service.ts` | `getBudgetPlan` | Composite template/month read |
| `template-service.ts` | template CRUD/archive | Reusable setup |
| `monthly-draft-service.ts` | start/discard draft | Plan lifecycle |
| `monthly-entry-service.ts` | draft item/source CRUD | Draft editing |
| `confirm-service.ts` | `confirmMonthlyBudget` | Balance and posting |
| `lib/monthly-budget-plan.mjs` | summary/remaining helpers | Deterministic math |

## Internal workflow

POST action union dispatches to template or draft creation. PATCH updates a typed target. DELETE archives template or removes draft entity. Confirmation locks/validates the draft, summarizes sources/items, rejects empty/mismatch, and posts only unapplied destination cents.

## Configuration

Period is explicit year/month. Source owner must be a workspace member; destination must be a workspace envelope.

## Error handling

Domain `BudgetPlanRequestError` carries status/message. Zod errors become validation responses. Confirm conflicts include missing, already confirmed, unbalanced, invalid member/destination, or posting conflict.

## Performance considerations

- Query loads plan, templates, members, and destinations as a bounded workspace configuration set.
- Sort order queries happen inside transactions.
- Do not create an N×M source-item matrix; V2 balances aggregate independent lists.

## Security considerations

- Reads require workspace membership; writes require EDITOR.
- Owner/source/destination IDs are revalidated in the target workspace.
- Confirmation requires idempotent posting.

## Risks

- Editing confirmed plans breaks audit.
- Reapplying full item amounts duplicates envelope funds.
- Treating plan confirmation as real-bank income breaks reconciliation.
- Legacy `MonthlyBudget*` models still exist for migration compatibility.

## Future extension points

- Explicit versioning/amendment workflow for confirmed plans.
- Reporting against actual transactions without mutating plan history.

## Related Files

- [Ledger API](../api/ledger.md)
- [BR-020–BR-025](../business/business-rules.md)
- [`tests/monthly-budget-plan.test.mjs`](../../tests/monthly-budget-plan.test.mjs)

## Dependencies

- Workspace membership, ledger posting, envelope destinations.

## Assumptions

- Aggregate source total must equal aggregate item total.

## Known Limitations

- No partial confirmation or post-confirm edit workflow.

## Future Improvements

- Retire legacy monthly models only after migration/consumer proof.

## Last Updated

2026-07-28
