---
title: Cards and Card Transactions Module
description: Card metadata, statements, imports, alerts, accounting, payments, rules, reminders, and Smart Review handoff.
audience: [engineers, finance-domain-reviewers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Cards and card transactions

## Purpose

Make card liabilities and their funding/recovery path visible from purchase through statement payment.

## Scope

Card accounts, card transactions, Maybank imports, Gmail alerts, accounting actions, auto rules, statement due dates, payments, and reminder preparation.

## Responsibilities

- Store non-sensitive card metadata and statement calendar.
- Record/import/dedupe card transactions.
- Derive statement cycle and outstanding amount.
- Allocate purchase as envelope deduction or receivable.
- Run ordered first-match auto-accounting rules.
- Accept fresh Smart Review suggestions through the normal accounting route.
- Record statement payment without overpaying.
- Schedule/deliver reminders while outstanding.

## Public APIs and important functions

| File | Symbol/surface | Responsibility |
| --- | --- | --- |
| `lib/credit-card-statement-cycle.ts` | `deriveStatementCycle` | Calendar-safe statement/due period |
| `lib/credit-txn-auto-rules.ts` | parse/stringify/match/find | Ordered bounded JSON rules |
| `lib/credit-txn-auto-account-runner.ts` | `runCreditTxnAutoAccounting` | Apply first matching rule |
| `lib/credit-card-payment-reminder-schedule.ts` | reminder-day helpers | UTC calendar schedule |
| `lib/credit-card-payment-reminders.ts` | enqueue/process reminder job | Outstanding obligations and delivery |
| `lib/credit-alert-parser.ts` | `parseCreditAlert` | Supported bank-email normalization |
| `lib/credit-alert-ingest.ts` | `ingestCreditAlert` | Dedupe/stage/create |
| `lib/domains/cards/alert-service.ts` | `listCardAlerts` | Bounded diagnostics |
| Card/credit-transaction APIs | CRUD/accounting/payment/rules/import | HTTP surface |

## Internal workflow

Card transaction → statement assignment → unaccounted state → one accounting action:

- `DEDUCT`: claim transaction; debit source envelope; optional destination credit.
- `RECEIVABLE`: claim transaction; create receivable and posting relationship.
- explicit mark: set allocated without ledger effect.

Payment loads current selected-statement outstanding, rejects excessive amount, debits default settlement envelope, and adds offsetting negative card transaction in one posting.

## Configuration

- Workspace receivable default account/envelope.
- Ordered `creditCardAutoRules` JSON (maximum 100).
- Reminder currency/cap and email/push credentials.
- Gmail slice counts.

## Error handling

- Missing card/default/source/destination: 400/404.
- Wrong workspace/role: 403.
- Concurrent already-accounted or stale Smart Review suggestion: 409/412-style workflow error.
- Payment above outstanding: validation failure.
- Provider delivery failures are sanitized and retried by job policy.

## Performance considerations

- Card transaction reads use workspace/card/statement/date indexes.
- Imports are bounded and dedupe in SQL-safe batches.
- Auto-accounting is backgrounded for workspace scope.
- Reminder delivery has a per-run cap.

## Security considerations

- Never add PAN/CVV/cardholder persistence or logs.
- Alert bodies can contain personal data; successful bodies are discarded, failed bodies encrypted/retained briefly.
- Smart Review is read-only until route revalidation.
- Money operations require EDITOR and idempotency.

## Risks

- Incorrect statement calendar changes reminder/payable totals.
- Mark-accounted escape hatch can hide an unfunded purchase.
- A broad auto rule can misclassify; first-match order matters.
- Default settlement envelope can become negative if reimbursement arrives late.

## Future extension points

- Additional bounded import formats/parsers.
- Rule simulation/dry-run metrics before enablement.
- Partial/reconciled statement lifecycle if product requires it.

## Related Files

- [Cards API](../api/cards.md)
- [BR-030–BR-037](../business/business-rules.md)
- [Integrations module](integrations.md)

## Dependencies

- Ledger, receivables, jobs/notifications, Gmail, AI suggestions.

## Assumptions

- Statement activity sign and calendar data are correct at entry/import.

## Known Limitations

- No issuer/bank statement reconciliation feed.
- Supported alert/CSV formats are limited.

## Future Improvements

- Add sanitized parser fixtures and statement reconciliation reports.

## Last Updated

2026-07-28
