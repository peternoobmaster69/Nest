# Phase 3 threat model and deployment notes

Last reviewed: 2026-07-21

## Scope and trust boundaries

Nest handles authenticated sessions, tenant-scoped finance data, card metadata, Google OAuth credentials, web-push subscriptions, public share links, scheduled/background jobs, and an offline-capable browser shell. The browser, Vercel/Next.js runtime, Azure SQL, Google OAuth/Gmail, push providers, and CI are separate trust boundaries. All browser input and provider responses are untrusted.

## Assets and controls

| Asset or flow | Primary threats | Controls |
| --- | --- | --- |
| Authentication and passkeys | account takeover, replay, enumeration | NextAuth sessions, one active server-tracked session ID per user, explicit confirmation before session replacement, verified provider claims, unused provider API tokens cleared on link, one-time WebAuthn challenges, replay counters, recent-auth gates, distributed limits |
| Workspaces and finance records | IDOR, cross-tenant writes, role escalation | membership lookup on every scoped request, OWNER/EDITOR/VIEWER ordering, source-contract tests, audit records |
| Credit cards | PAN/CVV compromise | only name/bank, last four, and expiry retained; legacy PAN/cardholder columns purged and dropped; card reveal disabled |
| Gmail OAuth | CSRF, code interception/replay, token theft | hashed expiring one-time state bound to user/workspace, S256 PKCE, AES-256-GCM token envelopes with record/workspace/field AAD and key versions, recent owner auth, revocation and deletion on disconnect |
| Web push | endpoint disclosure, notification abuse | authenticated subscription ownership, restricted notification types, no finance payload cache |
| Public sharing | bearer-token leakage, tenant crossover | random revocable tokens, minimal projections, distributed limits, audit events, no-store responses |
| Jobs and reminders | forged invocation, duplicate work, resource abuse | fail-closed constant-time cron secret, leases/idempotency, distributed limits, safe errors |
| Offline/service worker | stale or cross-user sensitive data | static-only cache, no API caching, purge on logout/upgrade, mutation queue disabled |
| HTTP/application boundary | CSRF, XSS, clickjacking, oversized input, error leakage | same-origin policy for unsafe API calls, CSP nonce, HSTS, frame denial, content-type/body limits, Zod validation, request IDs, safe errors, no-store API policy |
| Database and delivery | interception, secret/dependency compromise | SQL encryption required with certificate trust disabled, Gitleaks, dependency review, npm audit, CodeQL |

## Credential rotation

`INTEGRATION_ENCRYPTION_KEY` is the current 32-byte base64 key and `INTEGRATION_ENCRYPTION_KEY_VERSION` identifies it. During rotation, move the old version/key into the JSON object in `INTEGRATION_ENCRYPTION_PREVIOUS_KEYS`, deploy the new current key, and reconnect or naturally refresh Gmail integrations so envelopes are rewritten. Remove an old key only after no envelopes reference its version. `CARD_ENCRYPTION_KEY` is accepted only as a temporary deployment-compatible fallback and should be removed after the new variable is configured.

The Phase 3 migration intentionally deactivates existing Gmail integrations and clears legacy plaintext grants. Users must reconnect once. It also permanently removes legacy full-card/cardholder columns.

## Residual risk and operational checks

- A compromised application runtime can access credentials while actively using them; restrict production environment access and rotate Google grants after any runtime compromise.
- A copied JWT cookie remains indistinguishable from the original device until logout, account-wide revocation, expiry, or a confirmed new sign-in rotates the active session ID. Single-session enforcement limits concurrent independently issued sessions; it does not provide device attestation.
- CSP permits inline styles because the current UI uses React style attributes. Scripts remain nonce-restricted. Remove inline style usage before tightening `style-src` further.
- Google revocation is best effort. Local credentials are cleared even if Google is temporarily unavailable; users can also revoke Nest in Google Account settings.
- Distributed limits depend on Azure SQL. The database-wake path retries auto-resume; prolonged database unavailability fails closed for protected operations.

Before production deployment, set the integration encryption variables, verify the canonical HTTPS/WebAuthn values, run `npm run prisma:migrate:deploy`, reconnect Gmail, and confirm CSP/security headers on both an HTML response and an API response.
