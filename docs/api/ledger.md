---
title: Accounts, Transactions, Groups, and Budgets API
description: Endpoint contracts for bank controls, envelopes, ledger movement, imports, reconciliation, and monthly plans.
audience: [engineers, API-consumers, testers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Accounts, transactions, groups, and budgets API

## Purpose

Document the finance HTTP surface whose changes have the greatest reconciliation and idempotency impact.

## Scope

All money request values are integer cents. Money-changing calls require a unique `Idempotency-Key` even where legacy handlers do not reject a missing header. See [posting ADR](../architecture/adr/ADR-002-posting-ledger.md).

## Accounts and envelopes

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/accounts` | VIEWER | `workspaceId`; missing returns `[]` for compatibility | `[{"id":"a","currentBalanceCents":500000,"linkedBudgetTotalCents":450000,"discrepancyCents":50000}]` | Bank kind only; max 500 |
| `POST /api/accounts` | EDITOR | optional workspace, name ≤120, bankName ≤120, nonnegative `startingCents`, description ≤500 | `{"workspaceId":"ws","account":{...}}` (201) | Creates Bank account type if absent |
| `PATCH /api/accounts/{id}` | EDITOR | optional name/bank/description/nonnegative control/active | Updated account | Loads row then verifies its workspace |
| `GET /api/budgets` | VIEWER | required `workspaceId` | `[{"id":"b","availableCents":...,"monthlyOutgoingCents":...,"receivableReservedCents":...}]` | Active only; max 500 |
| `POST /api/budgets` | EDITOR | workspace, active bank account, name ≤80, icon ≤8, nonnegative target | Envelope (201) | Parent account relationship validated |
| `PATCH /api/budgets/{id}` | EDITOR | optional name/icon/target/available/active | Updated envelope | Direct `availableCents` compatibility exists; avoid for ledger workflow |
| `DELETE /api/budgets/{id}` | EDITOR | None | `{"ok":true}` | Can fail on dependent relations |
| `POST /api/budgets/recalculate` | EDITOR | workspace and optional budget/account | Recalculated result | Distributed limit; explicit repair operation |
| `GET /api/budgets/reconciliation` | VIEWER | `workspaceId` | `{"rows":[...],"drifted":[...]}` | Reports drift; does not repair |

## Transactions

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/transactions` | VIEWER | required workspace; optional page/limit≤100/cursor/account/budget/group/transaction/from/to/month/months≤24/search≤100/paginated | Compatibility array or `{"transactions":[...],"total":1,"hasMore":false,"summary":{"incomeCents":0,"expenseCents":4200}}` | Hides void/reversal; max 100 |
| `POST /api/transactions` | EDITOR | workspace/account/envelope, subject≤120, positive cents, DEBIT/CREDIT, kind, ISO date, optional detail≤500/notes/group, DEDUCT/ADD | Posting result/transaction (201/200) | Account/envelope/group scoped; idempotent |
| `PATCH /api/transactions/{id}` | EDITOR | optional subject, positive cents, date, details/notes, group/budget-related fields supported by schema | Updated legacy transaction | Only unposted legacy rows; posted rows remain immutable |
| `GET /api/transactions/{id}/lineage` | VIEWER | Active visible transaction ID | Chronological immutable versions, correction metadata, and compensating reversals | Follows correction posting source links; bounded to 50 versions |
| `POST /api/transactions/{id}/corrections` | EDITOR | at least one corrected field; optional reason≤500; `Idempotency-Key` | Original, reversal, and replacement IDs | Atomically voids the original, posts its reversal and replacement, and applies the net envelope delta; linked workflows return 409 |
| `DELETE /api/transactions/{id}` | EDITOR | Optional `X-Reversal-Reason` | Reversal result | Creates opposite row and void metadata |
| `POST /api/transactions/transfer` | EDITOR | workspace, distinct source/destination envelope, title, positive cents | Paired posting | Validates both destinations and key |
| `POST /api/transactions/bulk-import` | EDITOR | workspace/account/envelope/kind, import-run/chunk metadata, ≤250 normalized rows, optional recalc | `{"created":n,"duplicates":n,...}` | ≤1 MiB; distributed limit; SQL batches 50 |
| `GET /api/transactions/months` | VIEWER | required workspace; optional account/budget | `{"months":[{"key":"2026-07",...}]}` | Raw SQL, bounded identifiers |

Create kinds: `EXPENSE`, `INCOME`, `TRANSFER`, `CREDIT_CARD_PAYMENT`, `RECEIVABLE_PAYMENT`, `ADJUSTMENT`.

## Transaction groups

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/transaction-groups` | VIEWER | workspace, budget | `{"items":[...],"pageInfo":{...}}` or route composite | Validates budget scope |
| `POST /api/transaction-groups` | EDITOR | workspace, budget, name≤80, optional icon≤8, transaction IDs | Group (201) | IDs deduplicated and scoped |
| `GET /api/transaction-groups/{id}` | VIEWER | optional search≤100 | `{"group":{...},"members":[...],"available":[...]}` | Member/available sets bounded |
| `PATCH /api/transaction-groups/{id}` | EDITOR | optional name/icon, add/remove transaction ID arrays | Updated group | Transaction parent envelope/workspace checked |
| `DELETE /api/transaction-groups/{id}` | EDITOR | None | `{"ok":true}` | Unlinks transactions before delete |

## Monthly budget plan

`/api/budgets/plan` uses action unions from `lib/domains/ledger/budget-plan/contracts.ts`.

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET` | VIEWER | workspace, optional year/month | `{"setup":{"sources":[...],"items":[...]},"monthlyPlan":{...}}` | Composite domain query |
| `POST` | EDITOR | One action: `createTemplateItem`, `createTemplateSource`, `startBlank`, `startFromSetup`, `createMonthlyItem`, `createMonthlySource`, `discardMonthlyDraft`, or `confirmMonthly` with action-specific IDs/period/fields | Created plan/item/source or confirmed result | Confirmation non-empty/balanced/idempotent |
| `PATCH` | EDITOR | One update action for template/monthly item/source | Updated entity | Confirmed plan rows reject edit |
| `DELETE` | EDITOR | Query: workspace, target/type ID/action per contract | `{"ok":true}` | Templates archive; draft rows delete |

Representative confirmation:

```http
POST /api/budgets/plan
Content-Type: application/json
Idempotency-Key: budget-confirm:ws_123:2026-07

{"action":"confirmMonthly","workspaceId":"ws_123","year":2026,"month":7,"applyToSubAccounts":true}
```

The exact confirmation field names are authoritative in `contracts.ts`; callers should use the application client rather than constructing actions ad hoc.

## Request and response examples

Transfer:

```http
POST /api/transactions/transfer
Content-Type: application/json
Idempotency-Key: transfer:019...

{"workspaceId":"ws_123","sourceBudgetId":"env_food","destinationBudgetId":"env_travel","title":"Reallocate","amountCents":10000}
```

```json
{"ok":true,"replayed":false,"transactions":[{"direction":"DEBIT","amountCents":10000},{"direction":"CREDIT","amountCents":10000}]}
```

Exact response wrapper can vary by operation; clients should consume the current typed UI contract.

## Related Files

- [`app/api/transactions/route.ts`](../../app/api/transactions/route.ts)
- [`lib/posting-service.ts`](../../lib/posting-service.ts)
- [Ledger module](../modules/ledger.md)
- [Budget module](../modules/budgets.md)

## Dependencies

- Workspace role, Prisma transactions, posting/idempotency.

## Assumptions

- Clients preserve opaque cursors and generate idempotency keys.

## Known Limitations

- Compatibility routes do not share one response shape.
- Envelope PATCH exposes direct availability update for existing UI; new money flows should use posting.

## Future Improvements

- Export schemas and generated examples for every budget-plan action.
- Deprecate offset and direct-balance compatibility paths.

## Last Updated

2026-07-28
