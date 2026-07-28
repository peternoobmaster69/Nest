---
title: Gmail, Notifications, and Push API
description: Endpoint contracts for Gmail OAuth/sync, in-app notification state, and browser push subscriptions.
audience: [engineers, API-consumers, operators, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Gmail, notifications, and push API

## Purpose

Document provider entry points and user-visible delivery state.

## Scope

Gmail administration is restricted to OWNER. Connect/disconnect require recent authentication; manual sync requires OWNER.

## Gmail endpoints

| Operation | Auth | Request | Success example | Errors/limits |
| --- | --- | --- | --- | --- |
| `POST /api/gmail/connect` | OWNER+recent | Empty JSON/request | `{"url":"https://accounts.google.com/o/oauth2/v2/auth?..."}` | Same-origin; 5/10 min; stores one-time state/PKCE |
| `GET /api/gmail/callback` | Session+recent OWNER | Google `code`/`state` or `error` query | Redirect to workspace settings with `gmail=connected` | 20/10 min by state; redirects denied/invalid/forbidden/profile unavailable |
| `POST /api/gmail/disconnect` | OWNER+recent | Empty | `{"ok":true}` | 5/10 min; best-effort revoke then local credential clear/audit |
| `GET /api/gmail/status` | OWNER | None | `{"connected":true,"integration":{"id":"...","email":"...",...}}` | Token fields omitted |
| `GET /api/gmail/sync` | OWNER | None | `{"phase":"running","progress":42,...}` | Latest persisted job or idle |
| `POST /api/gmail/sync` | OWNER | Empty | Completed `{"ok":true,"jobId":"...",...}` or 202 queued | 4/5 min; processes at most one bounded slice synchronously |

## Notifications

| Operation | Auth | Request | Success example | Notes |
| --- | --- | --- | --- | --- |
| `GET /api/notifications` | VIEWER | Cursor/limit; default 25, max 50 | `{"notifications":[...],"unreadCount":2}` | Syncs current card-due in-app notices before list |
| `PATCH /api/notifications` | VIEWER | `{"notificationId":"..."}` or `{"markAllRead":true}` | `{"ok":true}` | Exact union, JSON body |
| `GET /api/push-subscriptions` | Session | None | `{"configured":true,"publicKey":"...","subscribed":true}` | Public VAPID key only |
| `POST /api/push-subscriptions` | Session | endpoint URL≤1,000, optional expiry, p256dh/auth≤1,000 | `{"ok":true}` | Endpoint must HTTPS; upsert endpoint to current user |
| `DELETE /api/push-subscriptions` | Session | Optional endpoint; absent deletes all current-user subscriptions | `{"ok":true}` | Idempotent |

## Example: start Gmail connection

```http
POST /api/gmail/connect
Cookie: ...
X-Workspace-Id: ws_123
Origin: https://nest.example
```

```json
{"url":"https://accounts.google.com/o/oauth2/v2/auth?...&code_challenge=...&state=..."}
```

The client navigates to the URL. It must not inspect/persist state, verifier, or tokens.

## Example: save push subscription

```http
POST /api/push-subscriptions
Content-Type: application/json

{"endpoint":"https://push.example/subscription","expirationTime":null,"keys":{"p256dh":"public-key","auth":"auth-secret"}}
```

Push subscription material is sensitive and must not be logged.

## Side effects and failure behavior

- Gmail callback encrypts tokens and audits connection.
- Disconnect clears local tokens even if Google revocation fails.
- Sync creates/deduplicates a durable `GMAIL_SYNC` job.
- Notification GET may create/upsert due reminders.
- Push delivery later removes 404/410 endpoints.

## Related Files

- [`lib/gmail-sync-runner.ts`](../../lib/gmail-sync-runner.ts)
- [`lib/in-app-notifications.ts`](../../lib/in-app-notifications.ts)
- [Integrations module](../modules/integrations.md)
- [Jobs module](../modules/jobs-notifications.md)

## Dependencies

- Google OAuth/Gmail, encryption key, SQL jobs, Web Push/VAPID.

## Assumptions

- Gmail callback origin matches configured redirect/canonical application.

## Known Limitations

- No live provider contract tests.
- Push endpoints are provider-controlled opaque values.

## Future Improvements

- Add explicit sync cancellation endpoint for owners if required.

## Last Updated

2026-07-28
