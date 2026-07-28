---
title: Receivables API
description: Endpoint contracts for receivable records, summaries, source reservation, and full close settlement.
audience: [engineers, API-consumers, testers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Receivables API

## Purpose

Document expected-repayment records and the distinction between status edits and cash settlement.

## Scope

All writes require EDITOR. A source account/envelope may belong to another workspace where the user is also EDITOR.

## Endpoints

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/receivables` | VIEWER | required `workspaceId` | `[{"id":"r","status":"OPEN","sourceWorkspaceId":"...",...}]` | Max 100; resolves source display aliases |
| `POST /api/receivables` | EDITOR destination and source | workspace, positive cents, `receivableDate` or legacy `date`, optional title≤120, transaction date, remarks≤500, notes, source account/envelope, from user, status | Receivable (201) | Source bank/envelope active and parent-matched |
| `PATCH /api/receivables/{id}` | EDITOR destination and source | Optional title, positive cents, dates, remarks/notes, OPEN/PARTIAL/PAID/VOID, family flags, nullable source account/envelope | Updated receivable | Manual PAID does not post cash |
| `DELETE /api/receivables/{id}` | EDITOR | None | `{"ok":true}` | Intended for unposted/domain deletion; dependencies may block |
| `POST /api/receivables/{id}/close` | EDITOR destination and source | Optional `{"closeDate":"ISO"}` | `{"receivable":{...},"incomeTransactionId":"...","sourceTransactionId":"...","postingGroupId":"...","replayed":false}` | Full amount; requires valid defaults; idempotent/409 |
| `GET /api/receivables/summary` | VIEWER | Active workspace | `{"totalCents":...,"count":...}` | OPEN/PARTIAL aggregate |
| `GET /api/receivables/budget-summary` | VIEWER | Budget/workspace query supported by handler | Per-envelope outstanding aggregate | Bounded aggregate |
| `GET /api/receivables/source-summary` | VIEWER | required source `budgetId` query | Source outstanding aggregate | Used for reserved amount |

## Close workflow

1. Load receivable and verify destination workspace EDITOR.
2. Resolve active workspace default bank account and envelope.
3. Resolve optional source bank/envelope and verify source workspace EDITOR.
4. Claim receivable only if still closable.
5. Credit destination by full `amountCents`.
6. If source differs, debit source in its workspace; cross-workspace source gets a separate posting group.
7. Set `PAID` and `transactionDate`.
8. Store/replay result using idempotency key.

## Example

```http
POST /api/receivables/recv_1/close
Content-Type: application/json
Idempotency-Key: receivable-close:recv_1:019...

{"closeDate":"2026-07-28T00:00:00.000Z"}
```

```json
{
  "receivable":{"id":"recv_1","status":"PAID","amountCents":8000},
  "incomeTransactionId":"tx_income",
  "sourceTransactionId":"tx_source",
  "sourcePostingGroupId":"source_posting",
  "postingGroupId":"destination_posting",
  "replayed":false
}
```

## Status and error behavior

- 400: invalid source/default, missing date, invalid status/body.
- 403: missing EDITOR in destination or cross-workspace source.
- 404: receivable not found.
- 409: already claimed/paid or idempotency mismatch.
- 500: sanitized unexpected DB failure.

## Related Files

- [`app/api/receivables/[id]/close/route.ts`](../../app/api/receivables/[id]/close/route.ts)
- [Receivables module](../modules/receivables.md)
- [BR-040–BR-045](../business/business-rules.md)

## Dependencies

- Workspace defaults, ledger posting, source/destination membership.

## Assumptions

- Close always settles full current amount.

## Known Limitations

- There is no payment-history or partial-settlement child endpoint.

## Future Improvements

- Add explicit partial payment resource and remaining balance.

## Last Updated

2026-07-28
