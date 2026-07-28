---
title: Authentication, Sessions, Passkeys, and Profile API
description: Endpoint-level contracts for identity, active devices, passkeys, linked providers, and profile naming.
audience: [engineers, API-consumers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Authentication, sessions, passkeys, and profile API

## Purpose

Document identity endpoints and the session/passkey security workflow.

## Scope

Common headers, error behavior, and cookies are in [API conventions](README.md). WebAuthn `response` objects follow SimpleWebAuthn browser JSON and are intentionally treated as opaque provider structures here.

## Endpoints

| Operation | Auth | Request | Success example | Important errors/limits |
| --- | --- | --- | --- | --- |
| `GET /api/auth/[...nextauth]` | Anonymous/session | NextAuth path/query | Provider/callback/session response | NextAuth semantics; DB wake retry |
| `POST /api/auth/[...nextauth]` | Anonymous/session | NextAuth form/JSON contract | Sign-in/callback response | 30 requests per distributed window configured by route; 429 |
| `GET /api/auth/accounts` | Session | None | `{"accounts":[{"provider":"google"}]}` | Max 100; token fields omitted |
| `GET /api/auth/session-limit` | Pending JWT | None | `{"sessions":[...],"maxActiveSessions":5}` | 401 no pending login; 409 expired/stale |
| `POST /api/auth/session-limit` | Pending JWT | `sessionIds?: string[]` (max 5) or legacy `sessionId` | `{"approved":true,"revokedSessionIds":["..."]}` | Same-origin; 400 invalid choice; 409 race |
| `GET /api/auth/sessions` | Session | None | `{"sessions":[{"sessionId":"...","current":true}],"maxActiveSessions":5}` | Returns max five active, no-store |
| `DELETE /api/auth/sessions` | Recent session | `{"sessionId":"..."}` | `{"revoked":true,"current":false}` | Same-origin; 404 inactive; audits every membership |
| `POST /api/passkeys/authenticate/options` | Anonymous | Empty body | `{"challengeId":"...","options":{...}}` | 20 per 5 minutes; 429/503 |
| `POST /api/passkeys/authenticate/verify` | Anonymous | `challengeId`, WebAuthn `response` | `{"verified":true,"loginToken":"one-time-ticket"}` | 10 per credential/5 min, 15-min block; 400/401 |
| `POST /api/passkeys/register/options` | Recent session | Empty body | `{"challengeId":"...","options":{...}}` | 10 per user/10 min; excludes existing credentials |
| `POST /api/passkeys/register/verify` | Recent session | `challengeId`, `name` (1–80), WebAuthn `response` | `{"verified":true}` | 10 per user/10 min; one-time challenge |
| `GET /api/passkeys` | Session | None | `{"passkeys":[{"id":"...","name":"Phone",...}]}` | Max 100; no public key returned |
| `PATCH /api/passkeys` | Session | `{"id":"...","name":"Laptop"}` | `{"ok":true,"name":"Laptop"}` | Name normalized, 1–80; 404 wrong owner |
| `DELETE /api/passkeys` | Recent session | `{"id":"..."}` | `{"ok":true}` | Same-user delete; idempotent delete count not exposed |
| `PATCH /api/profile` | Session | `{"name":"Name"}` (1–120) | `{"id":"...","name":"Name","email":"..."}` | 400/401 |

## Authentication sequence

1. Browser receives options/challenge.
2. Authenticator/provider proves identity.
3. Passkey verify updates replay counter and emits a one-minute one-time ticket.
4. Browser sends ticket to the NextAuth `passkey` credentials provider.
5. NextAuth creates ACTIVE or PENDING `LoginSession`.
6. Pending flow replaces selected active sessions and audits action.

See [auth-sequence.mmd](../diagrams/auth-sequence.mmd).

## Example: passkey authentication

```http
POST /api/passkeys/authenticate/verify
Content-Type: application/json

{"challengeId":"challenge_1","response":{"id":"credential-id","rawId":"...","response":{"authenticatorData":"...","clientDataJSON":"...","signature":"..."},"type":"public-key"}}
```

```json
{"verified":true,"loginToken":"temporary-one-time-token"}
```

The token is immediately passed to NextAuth; do not persist or log it.

## Authorization and side effects

- Session revocation writes `WorkspaceAuditLog` for up to 100 memberships.
- Provider link events clear OAuth token columns and audit linked account.
- Registration stores public key/counter/transports/device metadata.
- Authentication consumes challenge and updates counter/last-used state.
- Profile update changes only the authenticated user's name.

## Related Files

- [`lib/auth.ts`](../../lib/auth.ts)
- [`lib/passkeys.ts`](../../lib/passkeys.ts)
- [Authentication module](../modules/auth.md)

## Dependencies

- NextAuth cookies, SimpleWebAuthn, Prisma/Azure SQL.

## Assumptions

- Client uses `@simplewebauthn/browser` to produce response JSON.

## Known Limitations

- NextAuth catch-all request/response details remain library-controlled.
- Passkey delete does not prevent deleting the user's final passkey; other sign-in providers may still exist.

## Future Improvements

- Generate WebAuthn component schemas in OpenAPI.

## Last Updated

2026-07-28
