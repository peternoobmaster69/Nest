---
title: Authentication and Sessions Module
description: OAuth/passkey identity, session admission, JWT validation, revocation, recent authentication, and provider linking.
audience: [backend-engineers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Authentication and sessions

## Purpose

Establish user identity and maintain bounded, revocable, auditable sessions without exposing provider credentials.

## Scope

NextAuth routes/configuration, OAuth providers, passkeys, `LoginSession`, session-limit UI/API, recent-auth checks, and request metadata.

## Responsibilities

- Conditionally enable Google, Apple, and Facebook providers.
- Authenticate passkeys through one-time handoff tickets.
- Require verified OAuth claims.
- Ensure first-time user/default workspace.
- Admit at most five active sessions.
- Track/revoke sessions and renew bounded expiry.
- Record trustworthy device/IP/country metadata.
- Clear unused provider API grants after linking.

## Public APIs and important files

| File | Exported symbols | Purpose |
| --- | --- | --- |
| `lib/auth.ts` | `authOptions`, `handler` | NextAuth callbacks/events/provider config |
| `lib/server-session.ts` | `getDatabaseReadyServerSession` | Session lookup with DB wake retry |
| `lib/require-session.ts` | `requireSession` | Protected server-page redirect |
| `lib/workspace-auth.ts` | session/workspace/recent guards, `ApiAuthError` | API authorization boundary |
| `lib/passkeys.ts` | config, challenge/ticket helpers | One-time WebAuthn lifecycle |
| `lib/session-policy.ts` | max age/renewal/session-count constants | Admission/expiry policy |
| `lib/auth-request-metadata.ts` | trusted metadata helpers | Request-scoped session audit context |
| `app/api/auth/**` | HTTP handlers | NextAuth, linked accounts, session selection/revocation |
| `app/api/passkeys/**` | HTTP handlers | Registration/authentication/manage credentials |

## Lifecycle

See [auth sequence](../diagrams/auth-sequence.mmd).

JWT state includes user ID, session ID, authentication time, user session version, revoked flag, and pending-session requirement. On callback, DB state is rechecked. Missing, revoked, expired, mismatched, or version-invalid sessions do not expose a user.

## Configuration

- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`/`AUTH_SECRET`.
- Optional OAuth provider pairs.
- `WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`.
- `TRUST_PROXY_HEADERS` and optional `TRUSTED_COUNTRY_HEADER`.

## Error handling

- Invalid credentials/ticket returns authentication failure without user enumeration.
- DB serverless wake is retried; persistent unavailability fails.
- Rate-limited NextAuth posts return 429.
- Pending session must be resolved before normal user session is exposed.

## Performance considerations

- JWT callback reads both user and session in parallel.
- Session touch writes are throttled to 15-minute intervals unless near renewal.

## Security considerations

- OAuth claims must be verified.
- Passkey challenges and tickets are one-time.
- Sensitive operations use ten-minute recent-auth default.
- Proxy headers are untrusted unless explicitly configured.
- Never log tokens, cookies, passkey challenge payloads, or provider profiles.

## Known failure scenarios

- Misaligned WebAuthn origin/RP ID blocks passkeys.
- Database unavailability blocks session validation.
- User reaches five sessions and must choose which to keep.
- Unconfigured provider is absent rather than partially usable.

## Future extension points

- New providers must meet verified-claim and token-clearing rules.
- Risk-based step-up can build on recent authentication and session audit.

## Related Files

- [Authentication API](../api/authentication.md)
- [ADR-003](../architecture/adr/ADR-003-session-model.md)
- [`tests/phase2-security-contract.test.mjs`](../../tests/phase2-security-contract.test.mjs)

## Dependencies

- NextAuth, SimpleWebAuthn, Prisma/Azure SQL.

## Assumptions

- Email claim verification is adequate for current social identity linking.

## Known Limitations

- Device identity is descriptive, not attested.
- JWT theft remains usable until revocation/expiry.

## Future Improvements

- Add sign-in alerts and recovery policy when product requirements are known.

## Last Updated

2026-07-28
