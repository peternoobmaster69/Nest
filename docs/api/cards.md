---
title: Credit Cards, Card Transactions, Alerts, and Reminders API
description: Endpoint contracts for card metadata, statement activity, accounting, imports, rules, due dates, payments, and reminders.
audience: [engineers, API-consumers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Credit cards, card transactions, alerts, and reminders API

## Purpose

Document the payable workflow from card configuration through transaction accounting and statement payment.

## Scope

No endpoint accepts or returns PAN/CVV. Shared request conventions are in [API README](README.md).

## Card accounts

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/credit-cards` | VIEWER | required `workspaceId` | `[{"id":"card","last4Digit":"1234","maskedNumber":"•••• •••• •••• 1234",...}]` | Active only; max 500 |
| `POST /api/credit-cards` | EDITOR | workspace, cardName≤120, optional bank/theme, exactly 4 digits, optional expiry, statement/due days 1–31, notes≤500 | Masked card (201) | Strict JSON, ≤16 KiB |
| `GET /api/credit-cards/{id}` | VIEWER | None | Always `410 {"error":"Card detail reveal is disabled"}` after scope validation | Security compatibility endpoint |
| `PATCH /api/credit-cards/{id}` | EDITOR | Optional create fields plus active flag; nullable optional fields | Updated masked card | Strict JSON, ≤16 KiB |
| `DELETE /api/credit-cards/{id}` | EDITOR | None | `{"ok":true}` | May fail with dependent rows |

## Card transactions and accounting

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/credit-transactions` | VIEWER | Header workspace; optional card/year/month/page/limit≤500/cursor | `{"transactions":[...],"cardCounts":[...],"total":1,"summary":{"totalAmountCents":4200,"unaccountedAmountCents":4200,...}}` | Default 250; validates 2020–2100 |
| `POST /api/credit-transactions` | EDITOR | card, transaction ISO date, optional due date, statement month/year, signed cents, subject≤500 | Transaction (201) | Derives due date when omitted |
| `PATCH /api/credit-transactions/{id}` | EDITOR | Optional card/date/due/statement/cents/subject/accounted | Updated transaction | Card must be same workspace; installment flags reset |
| `DELETE /api/credit-transactions/{id}` | EDITOR | None | `{"success":true}` | Physical delete; do not use for journaled bank transaction |
| `POST /api/credit-transactions/{id}/accounting` | EDITOR | `DEDUCT` or `RECEIVABLE` discriminated body; optional Smart Review proof | Posting result with `postingGroupId`,`replayed` | Money/idempotent; one-row claim; stale suggestion 409 |

`DEDUCT` requires `accountId` and `budgetId`; optional destination account/envelope must be supplied together. `RECEIVABLE` requires date, title≤120, positive cents, optional remarks≤500/notes/source. Smart Review fingerprint is 64 hex characters and must be paired with generation time.

## Rules, imports, due dates, and payments

| Operation | Auth | Request | Success example | Notes/errors/limits |
| --- | --- | --- | --- | --- |
| `GET /api/credit-transactions/auto-rules` | VIEWER | `workspaceId` | `{"workspaceId":"ws","rules":[...]}` | Ordered first-match rules |
| `PUT /api/credit-transactions/auto-rules` | OWNER | workspace and ≤100 rules | Saved normalized rules | Validates same/cross-workspace targets |
| `POST /api/credit-transactions/auto-rules/run` | EDITOR | Workspace/filter options defined by handler | Queue/run summary | Manual run scoped to active workspace |
| `POST /api/credit-transactions/import-maybank` | EDITOR | card/import run/chunk and CSV≤512 KiB, ≤500 rows | Import result (201; replay 200) | JSON body≤600 KiB; 6/10 min; idempotent |
| `GET /api/credit-transactions/payment-due` | VIEWER | required year 2020–2100; optional card | `{"months":[{"statementMonth":7,"paymentDueDate":"..."}]}` | Only outstanding statements |
| `PATCH /api/credit-transactions/payment-due` | EDITOR | optional card, month/year, nullable ISO due date | `{"ok":true,"updatedCount":4}` | Updates all matching statement rows |
| `POST /api/credit-transactions/payments` | EDITOR | card, month/year, positive cents | `{"ok":true,"paidAmountCents":4200,"outstandingAmountCents":0,...}` | Cannot exceed current outstanding; needs default destination; idempotent |
| `POST /api/credit-transactions/payment-due/reminders` | EDITOR/session route policy | Manual reminder request | Delivery/job summary | Uses same reliable reminder path |
| `POST /api/credit-card-payment-reminders` | Session/workspace policy | Manual reminder trigger/dry-run fields in handler | Reminder result | Intended interactive wrapper; cron is canonical scheduler |

## Alert staging

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/credit-alerts` | VIEWER | Cursor/list query | Bounded alert envelope | Parsed status and owner-safe diagnostics |
| `POST /api/credit-alerts` | EDITOR | `rawBody` min 20, optional `rawSubject`≤255 | Ingest result | Untrusted parser input; dedupe and encrypted failure sample |

## Example: account a purchase

```http
POST /api/credit-transactions/cctx_1/accounting
Content-Type: application/json
Idempotency-Key: credit-account:cctx_1:019...

{"action":"DEDUCT","accountId":"bank_1","budgetId":"groceries","destinationAccountId":"bank_1","destinationBudgetId":"settlement"}
```

```json
{
  "transaction": {"id":"ledger_debit"},
  "destinationTransactionId":"ledger_credit",
  "postingGroupId":"posting_1",
  "replayed":false
}
```

## Example: pay a statement

```http
POST /api/credit-transactions/payments
Content-Type: application/json
Idempotency-Key: card-payment:card_1:2026-07:019...

{"cardId":"card_1","statementMonth":7,"statementYear":2026,"amountCents":4200}
```

The response includes a negative card payment and linked bank-ledger debit.

## Related Files

- [`app/api/credit-transactions/[id]/accounting/route.ts`](../../app/api/credit-transactions/[id]/accounting/route.ts)
- [`lib/credit-card-payment-reminders.ts`](../../lib/credit-card-payment-reminders.ts)
- [Cards module](../modules/cards.md)

## Dependencies

- Workspace auth, ledger posting, receivables, jobs, optional Gmail/AI.

## Assumptions

- Card transaction cents may be signed; positive purchases and negative payments determine statement outstanding.

## Known Limitations

- Some card CRUD and due-date mutations are not routed through central posting because they do not directly change envelope money.
- Exact manual reminder wrapper payload is intentionally left to route source; unknown from inspected public UI contract.

## Future Improvements

- Export all request schemas and unify errors.
- Add a statement-level resource and reconciliation endpoint.

## Last Updated

2026-07-28
