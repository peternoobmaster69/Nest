---
title: API Conventions and Route Index
description: Authentication, workspace scope, headers, envelopes, errors, limits, examples, and all exported HTTP paths.
audience: [engineers, API-consumers, testers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-30
---

# API conventions and route index

## Purpose

Define cross-route behavior and provide a complete map to detailed endpoint documentation.

## Scope

The Next.js application exports 94 API paths. `generated/openapi.json` is generated from route-handler exports and checked for drift; it is the authoritative machine-readable method inventory. Route source remains authoritative for payload details.

## Base URL and content type

- Application APIs are same-origin under `/api`.
- JSON mutations use `Content-Type: application/json`.
- Shared parser default body cap is 64 KiB; imports declare larger explicit caps.
- Dates are ISO-8601 strings; user-entered calendar dates are normally normalized to UTC.
- Money is integer cents.

## Authentication

Normal APIs accept the HttpOnly NextAuth session cookies:

- `next-auth.session-token`
- `__Secure-next-auth.session-token`

No API bearer token is accepted for user authentication. Exceptions:

- Public token routes are anonymous bearer-link projections.
- Cron routes require `Authorization: Bearer ${CRON_SECRET}`.
- NextAuth/passkey authentication-start routes are anonymous by design.

## Workspace and roles

- Canonical pages carry workspace in `/w/{workspaceId}`.
- Browser API calls add `X-Workspace-Id`.
- Some compatibility routes also accept `workspaceId` in query/body.
- The server always verifies `WorkspaceMember`.

Role notation in detailed tables:

| Value | Meaning |
| --- | --- |
| Session | Any authenticated user |
| VIEWER | Workspace read |
| EDITOR | Workspace finance/config write |
| OWNER+recent | Owner and authentication within default ten minutes |
| Cron | Matching scheduler secret |
| Public token | Exact enabled/revocable token |

## Request headers

| Header | Required when | Purpose |
| --- | --- | --- |
| `Cookie` | Authenticated API | NextAuth session |
| `X-Workspace-Id` | Canonical workspace client requests | Tab-local scope |
| `Origin` / `Sec-Fetch-Site` | Browser mutation | Same-origin defense |
| `Idempotency-Key` | Money-changing operation/import | Replay safety; maximum bounded by posting schema |
| `X-Reversal-Reason` | Transaction reversal, optional | Bounded audit reason |
| `Authorization: Bearer ...` | Cron only | Scheduler authentication |

## Response headers

- `Cache-Control: no-store` for private APIs.
- `Vary: Cookie` or `Vary: Cookie, Origin`.
- `X-Request-Id` on shared secure-wrapper responses.
- `Retry-After` on distributed limits where produced.

## Errors

New/shared routes use:

```json
{
  "error": "Human-readable safe message",
  "code": "STABLE_ERROR_CODE",
  "requestId": "request-correlation-id",
  "issues": []
}
```

Older routes may return `{ "error": "..." }`, a Zod flattened error, and sometimes a safe `message`. Clients must use HTTP status first.

| Status | Meaning |
| ---: | --- |
| 200/201/204 | Success/created/no content |
| 400 | Invalid query/body or domain precondition |
| 401 | Missing/expired session, recent auth required, or bad cron secret |
| 403 | Origin, membership, role, or admin denial |
| 404 | Scoped resource/token not found |
| 409 | Idempotency, stale state, concurrency, or one-time-token conflict |
| 412 | Stale reviewed suggestion/precondition where used |
| 413/415 | Body too large/wrong content type |
| 422 | Semantically invalid request where shared contract uses it |
| 429 | Distributed rate limit |
| 500 | Unexpected sanitized server error |
| 503 | Required configuration/database unavailable |

Rate limits are route-specific. Do not assume one global quota; inspect the handler and [security architecture](../architecture/security.md).

## List conventions

New cursor lists use:

```json
{
  "items": [],
  "pageInfo": {
    "hasMore": false,
    "nextCursor": null,
    "limit": 25
  }
}
```

Some compatibility routes return named collections or arrays. Cursors are opaque; clients must not construct or decode them.

## Generic examples

Authenticated read:

```http
GET /api/transactions?workspaceId=ws_123&limit=50 HTTP/1.1
Cookie: __Secure-next-auth.session-token=...
X-Workspace-Id: ws_123
```

Idempotent mutation:

```http
POST /api/transactions HTTP/1.1
Content-Type: application/json
Cookie: __Secure-next-auth.session-token=...
X-Workspace-Id: ws_123
Idempotency-Key: transaction-create:019...

{"workspaceId":"ws_123","accountId":"acct_1","budgetId":"env_1","subject":"Groceries","amountCents":4200,"direction":"DEBIT","kind":"EXPENSE","date":"2026-07-28T00:00:00.000Z","budgetOperation":"DEDUCT"}
```

All examples use fictitious identifiers and values.

## Complete route index

### Identity and profile

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/auth/{nextauth}` | GET, POST | [Authentication](authentication.md) |
| `/api/auth/accounts` | GET | [Authentication](authentication.md) |
| `/api/auth/session-limit` | GET, POST | [Authentication](authentication.md) |
| `/api/auth/sessions` | GET, DELETE | [Authentication](authentication.md) |
| `/api/passkeys/authenticate/options` | POST | [Authentication](authentication.md) |
| `/api/passkeys/authenticate/verify` | POST | [Authentication](authentication.md) |
| `/api/passkeys/register/options` | POST | [Authentication](authentication.md) |
| `/api/passkeys/register/verify` | POST | [Authentication](authentication.md) |
| `/api/passkeys` | GET, PATCH, DELETE | [Authentication](authentication.md) |
| `/api/profile` | PATCH | [Authentication](authentication.md) |

### Workspaces and collaboration

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/context` | GET, PATCH | [Workspaces](workspaces.md) |
| `/api/workspaces` | GET, POST | [Workspaces](workspaces.md) |
| `/api/workspaces/{id}` | PATCH, DELETE | [Workspaces](workspaces.md) |
| `/api/workspaces/switch` | POST | [Workspaces](workspaces.md) |
| `/api/collaborators` | GET | [Workspaces](workspaces.md) |
| `/api/collaborators/{memberId}` | PATCH, DELETE | [Workspaces](workspaces.md) |
| `/api/collaborators/invite` | POST | [Workspaces](workspaces.md) |
| `/api/collaborators/invites/{inviteId}` | DELETE | [Workspaces](workspaces.md) |
| `/api/invitations/{token}` | GET, POST | [Workspaces](workspaces.md) |

### Ledger and budgets

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/accounts` | GET, POST | [Ledger](ledger.md) |
| `/api/accounts/{id}` | PATCH | [Ledger](ledger.md) |
| `/api/budgets` | GET, POST | [Ledger](ledger.md) |
| `/api/budgets/{id}` | PATCH, DELETE | [Ledger](ledger.md) |
| `/api/budgets/plan` | GET, POST, PATCH, DELETE | [Ledger](ledger.md) |
| `/api/budgets/recalculate` | POST | [Ledger](ledger.md) |
| `/api/budgets/reconciliation` | GET | [Ledger](ledger.md) |
| `/api/transactions` | GET, POST | [Ledger](ledger.md) |
| `/api/transactions/{id}` | PATCH, DELETE | [Ledger](ledger.md) |
| `/api/transactions/bulk-import` | POST | [Ledger](ledger.md) |
| `/api/transactions/months` | GET | [Ledger](ledger.md) |
| `/api/transactions/transfer` | POST | [Ledger](ledger.md) |
| `/api/transaction-groups` | GET, POST | [Ledger](ledger.md) |
| `/api/transaction-groups/{id}` | GET, PATCH, DELETE | [Ledger](ledger.md) |

### Cards and alerts

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/credit-cards` | GET, POST | [Cards](cards.md) |
| `/api/credit-cards/{id}` | GET, PATCH, DELETE | [Cards](cards.md) |
| `/api/credit-transactions` | GET, POST | [Cards](cards.md) |
| `/api/credit-transactions/{id}` | PATCH, DELETE | [Cards](cards.md) |
| `/api/credit-transactions/{id}/accounting` | POST | [Cards](cards.md) |
| `/api/credit-transactions/auto-rules` | GET, PUT | [Cards](cards.md) |
| `/api/credit-transactions/auto-rules/run` | POST | [Cards](cards.md) |
| `/api/credit-transactions/import-maybank` | POST | [Cards](cards.md) |
| `/api/credit-transactions/payment-due` | GET, PATCH | [Cards](cards.md) |
| `/api/credit-transactions/payment-due/reminders` | POST | [Cards](cards.md) |
| `/api/credit-transactions/payments` | POST | [Cards](cards.md) |
| `/api/credit-card-payment-reminders` | POST | [Cards](cards.md) |
| `/api/credit-alerts` | GET, POST | [Cards](cards.md) |

### Receivables

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/receivables` | GET, POST | [Receivables](receivables.md) |
| `/api/receivables/{id}` | PATCH, DELETE | [Receivables](receivables.md) |
| `/api/receivables/{id}/close` | POST | [Receivables](receivables.md) |
| `/api/receivables/budget-summary` | GET | [Receivables](receivables.md) |
| `/api/receivables/source-summary` | GET | [Receivables](receivables.md) |
| `/api/receivables/summary` | GET | [Receivables](receivables.md) |

### Investments and rewards

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/investments` | GET, POST | [Assets and rewards](assets-rewards.md) |
| `/api/investments/{id}` | PATCH, DELETE | [Assets and rewards](assets-rewards.md) |
| `/api/investments/{id}/entries` | POST | [Assets and rewards](assets-rewards.md) |
| `/api/investments/entries/{entryId}` | PATCH, DELETE | [Assets and rewards](assets-rewards.md) |
| `/api/rewards` | GET | [Assets and rewards](assets-rewards.md) |
| `/api/rewards/conversion` | POST, PATCH, DELETE | [Assets and rewards](assets-rewards.md) |
| `/api/rewards/credit-card` | POST, PATCH, DELETE | [Assets and rewards](assets-rewards.md) |
| `/api/rewards/frequent-flyer` | POST, PATCH, DELETE | [Assets and rewards](assets-rewards.md) |
| `/api/rewards/frequent-flyer/history` | GET, POST, PATCH, DELETE | [Assets and rewards](assets-rewards.md) |
| `/api/rewards/hotel-rewards` | POST, PATCH, DELETE | [Assets and rewards](assets-rewards.md) |

### Nest CIO

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/cio/overview` | GET | [CIO](cio.md) |
| `/api/cio/profile` | GET, PATCH | [CIO](cio.md) |
| `/api/cio/policy` | GET, PATCH | [CIO](cio.md) |
| `/api/cio/investments/{investmentId}/profile` | GET, PUT | [CIO](cio.md) |
| `/api/cio/investments/{investmentId}/exposures` | GET, PUT | [CIO](cio.md) |
| `/api/cio/recurring-flows` | GET, POST | [CIO](cio.md) |
| `/api/cio/recurring-flows/{id}` | PATCH, DELETE | [CIO](cio.md) |
| `/api/cio/planning-positions` | GET, POST | [CIO](cio.md) |
| `/api/cio/planning-positions/{id}` | PATCH, DELETE | [CIO](cio.md) |
| `/api/cio/retirement-projection` | POST | [CIO](cio.md) |

### AI

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/ai/ask` | POST | [AI](ai.md) |
| `/api/ai/feedback` | POST | [AI](ai.md) |
| `/api/ai/history` | GET, DELETE | [AI](ai.md) |
| `/api/ai/memory` | GET, PATCH, DELETE | [AI](ai.md) |
| `/api/ai/smart-review` | POST | [AI](ai.md) |

### Gmail, notifications, and push

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/gmail/connect` | POST | [Integrations](integrations.md) |
| `/api/gmail/callback` | GET | [Integrations](integrations.md) |
| `/api/gmail/disconnect` | POST | [Integrations](integrations.md) |
| `/api/gmail/status` | GET | [Integrations](integrations.md) |
| `/api/gmail/sync` | GET, POST | [Integrations](integrations.md) |
| `/api/notifications` | GET, PATCH | [Integrations](integrations.md) |
| `/api/push-subscriptions` | GET, POST, DELETE | [Integrations](integrations.md) |

### Operations and public surfaces

| Path | Methods | Detailed documentation |
| --- | --- | --- |
| `/api/dashboard/summary` | GET | [Operations/public](operations-public.md) |
| `/api/openapi` | GET | [Operations/public](operations-public.md) |
| `/api/public-links/net-worth` | POST, DELETE | [Operations/public](operations-public.md) |
| `/api/public/net-worth/{token}` | GET | [Operations/public](operations-public.md) |
| `/api/public/cards-due/{token}` | GET | [Operations/public](operations-public.md) |
| `/api/cron/ask-nest-retention` | GET | [Operations/public](operations-public.md) |
| `/api/cron/credit-auto-accounting` | GET | [Operations/public](operations-public.md) |
| `/api/cron/credit-card-payment-reminders` | GET | [Operations/public](operations-public.md) |
| `/api/cron/gmail-sync` | GET | [Operations/public](operations-public.md) |

## Related Files

- [`generated/openapi.json`](../../generated/openapi.json)
- [`scripts/generate-openapi.mjs`](../../scripts/generate-openapi.mjs)
- [`lib/api-security.ts`](../../lib/api-security.ts)
- [Module index](../modules/README.md)

## Dependencies

- Next.js route handlers, NextAuth cookies, workspace guards, Zod.

## Assumptions

- APIs are called by the same-origin web application; they are not a public third-party API.

## Known Limitations

- Generated OpenAPI currently inventories methods/security/common responses but does not fully describe every request/response schema.
- Older endpoint error shapes are not uniform.

## Future Improvements

- Export route-level Zod schemas and generate complete OpenAPI request/response components.
- Migrate all routes to the shared secure wrapper and stable envelopes.

## Last Updated

2026-07-30
