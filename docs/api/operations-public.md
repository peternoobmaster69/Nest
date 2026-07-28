---
title: Dashboard, OpenAPI, Public Links, and Cron API
description: Endpoint contracts for aggregate reads, API spec gating, public projections, and scheduled operations.
audience: [engineers, operators, API-consumers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Dashboard, OpenAPI, public links, and cron API

## Purpose

Document operational and deliberately exceptional access surfaces.

## Scope

Public token routes do not accept normal session identity. Cron routes accept only `CRON_SECRET`, not user sessions.

## Dashboard and API specification

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/dashboard/summary` | VIEWER | Workspace header/fallback | `{"totalBalanceCents":...,"bankDiscrepancies":[...],"budgets":[...],"recentTransactions":[...],"creditCardSummary":{...},"cashFlow":[...]}` | no-store, request ID, query telemetry; 12 months, 8 recent, bounded aggregates |
| `GET /api/openapi` | Session; production admin | None | OpenAPI JSON | Production returns 404 unless enabled and admin; private no-store |

Dashboard no-workspace compatibility returns empty aggregates. Unexpected DB errors return 500 with empty-safe structure and error text; clients should not treat it as a successful zero balance.

## Public-link lifecycle and projections

| Operation | Auth | Request | Success example | Notes/errors/limits |
| --- | --- | --- | --- | --- |
| `POST /api/public-links/net-worth` | OWNER+recent | workspace, optional `rotate` | `{"publicNetWorthEnabled":true,"publicNetWorthToken":"..."}` | Creates/reuses/rotates 32-byte base64url token; audit |
| `DELETE /api/public-links/net-worth` | OWNER+recent | workspace | `{"publicNetWorthEnabled":false,"publicNetWorthToken":null}` | Immediate revocation; audit |
| `GET /api/public/net-worth/{token}` | Public token | Path token≥24 | Aggregate total/liquid currency payload | 60/min/token, 5-min block; no-store; 404 invalid/revoked |
| `GET /api/public/cards-due/{token}` | Public token | Path token≥24 | Minimal selected card-due fields | Same limit; uses same enabled workspace token |

Example:

```http
GET /api/public/net-worth/long-random-token
```

```json
{"currency":"SGD","totalAmount":125000.0,"liquidAmount":45000.0}
```

Exact public amount field names are protected by public contract tests; inspect `lib/net-worth.ts` and generated response before integrating. Public projections never return memberships, account identifiers/names, transactions, or notes.

## Cron endpoints

All requests:

```http
Authorization: Bearer <CRON_SECRET>
```

If secret is not configured, route returns 503; mismatch returns 401.

| Operation | Schedule | Success example | Side effects/errors |
| --- | --- | --- | --- |
| `GET /api/cron/gmail-sync` | 03:00 UTC daily | `{"ok":true,"queued":n,"suppressed":n,"processedSlices":n}` | Queues due integrations and processes bounded slices |
| `GET /api/cron/credit-auto-accounting` | 03:00 UTC daily | `{"ok":true,...runnerCounts}` | Applies ordered rules across due workspace scopes |
| `GET /api/cron/credit-card-payment-reminders` | 01:00 UTC daily | Reminder job result; 200 or 207 partial | Optional `dryRun=1`; max 3/min and 5-min block |
| `GET /api/cron/ask-nest-retention` | 18:00 UTC daily | `{"ok":true,...retentionCounts,"askNest":{...}}` | Archives AI usage, then consolidated bounded cleanup |

Every route calls `ensureDatabaseReady` before work. They declare up to five-minute execution where configured.

## Manual scheduler example

```http
GET /api/cron/credit-card-payment-reminders?dryRun=1
Authorization: Bearer example-secret-not-a-real-value
```

Do not place real cron secrets in shell history, logs, screenshots, or documentation.

## Related Files

- [`vercel.json`](../../vercel.json)
- [`lib/cron-auth.ts`](../../lib/cron-auth.ts)
- [`lib/net-worth.ts`](../../lib/net-worth.ts)
- [Admin/public module](../modules/admin-public.md)

## Dependencies

- Azure SQL, Vercel cron, configured optional delivery/integration providers.

## Assumptions

- Public URL tokens are distributed only by workspace owners.

## Known Limitations

- Public net-worth and cards-due share one workspace token.
- No token expiry or access log exists.

## Future Improvements

- Separate per-purpose tokens with optional expiry and rotation metadata.

## Last Updated

2026-07-28
