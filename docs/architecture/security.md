---
title: Security Architecture
description: Assets, trust boundaries, controls, threats, residual risks, and secure-change rules.
audience: [engineers, security-reviewers, operators, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Security architecture

## Purpose

Make security invariants explicit so refactors do not turn convenience paths into authorization or data-exposure defects.

## Scope

Nest processes authenticated identity, workspace finance data, card metadata, Gmail OAuth credentials, public share tokens, notifications, AI prompts/tool output, and background jobs.

## Trust boundaries

- Browser and service worker.
- Next.js/Vercel runtime.
- Azure SQL.
- OAuth providers and Gmail.
- Azure OpenAI and optional Azure AI Search.
- Massive and SerpApi.
- Azure Communication Email and push providers.
- GitHub and CI supply chain.

All browser input and provider responses are untrusted.

## Assets and controls

| Asset/flow | Primary threats | Current controls |
| --- | --- | --- |
| Sessions | takeover, replay, unbounded devices | Signed HttpOnly NextAuth cookie, database session status, five-session admission, expiry/touch, revocation, recent-auth checks |
| Workspace finance | IDOR, tenant crossover, role escalation | Membership lookup, OWNER/EDITOR/VIEWER ordering, workspace-scoped queries, canonical URL header propagation |
| Financial history | replay, double posting, destructive edits | Idempotency keys, request hash, posting groups, SQL transaction, conditional claims, attributed reversals |
| Credit cards | PAN/CVV compromise | Metadata and last four only; legacy sensitive columns purged; reveal disabled |
| Gmail OAuth | CSRF, code replay, token theft | Hashed one-time state, ten-minute expiry, user/workspace binding, S256 PKCE, AES-256-GCM envelopes, revocation |
| Failed alert samples | sensitive email body disclosure | 32,000-character bound, contextual encryption, owner-only diagnostics, short retention |
| Public shares | token leakage, over-broad projection | Random revocable token, minimal fields, distributed limit, audit, no-store |
| Cron/jobs | forged invocation, duplicates, stuck work | Fail-closed constant-time secret, durable lease, idempotency, retry/dead-letter |
| AI | private-data leakage, invented values, unsafe action | Workspace-scoped read tools, bounded prompt/history, structured response, evidence and currency grounding, no mutation tools |
| Public search | private query leakage | Only public market/news terms; finance names and balances prohibited |
| Browser boundary | CSRF, XSS, clickjacking | Same-origin unsafe methods, nonce CSP, HSTS, frame denial, content-type/body limits |
| Service worker | stale cross-user data, offline mutation replay | Static-only cache, no API cache, no mutation queue, purge on logout/upgrade |
| Supply chain | secret/dependency/code vulnerabilities | Gitleaks, dependency review, npm audit, CodeQL, pinned overrides |

## Authentication and session security

- OAuth accounts are accepted only with verified provider claims.
- Unused OAuth provider access/refresh/ID tokens are cleared after linking.
- Passkey challenges and login tickets are one-time and expiring.
- WebAuthn counters are used to detect replayed authenticators.
- Session metadata records device description, bounded IP, and country.
- Forwarding headers are ignored unless proxy trust is explicitly enabled.
- Pending sessions expire after ten minutes; active sessions after 30 days and renew near expiry/after activity.
- Account-wide `sessionVersion` changes invalidate issued JWTs.

## Authorization

Role order:

| Role | Read | Finance/config write | Membership/sensitive owner action |
| --- | --- | --- | --- |
| VIEWER | Yes | No | No |
| EDITOR | Yes | Yes | No |
| OWNER | Yes | Yes | Yes, often with recent authentication |

Legacy `MEMBER` is normalized to `EDITOR` until migration completion.

Never authorize a workspace-owned row by ID alone. Load its `workspaceId`, verify membership/role, then execute a workspace-constrained mutation.

## Input and output controls

- Unsafe APIs require same origin.
- Shared JSON parser requires JSON content type and defaults to 64 KiB.
- Imports declare larger explicit limits and row caps.
- Zod validates structure and length.
- Searches and cursors are bounded.
- Private API responses are no-store and vary by cookie.
- Error responses are sanitized; logs should carry request IDs, not credentials or raw personal data.

## Cryptography and secret rotation

Gmail tokens and OAuth PKCE verifiers use AES-256-GCM:

- Current key: `INTEGRATION_ENCRYPTION_KEY`.
- Key identifier: `INTEGRATION_ENCRYPTION_KEY_VERSION`.
- Old-key map during rotation: `INTEGRATION_ENCRYPTION_PREVIOUS_KEYS`.
- AAD binds envelope to integration/workspace/field or OAuth state record.

Rotation sequence:

1. Move old current key into the previous-key map.
2. Deploy a new current version/key.
3. Reconnect or refresh integrations so envelopes are rewritten.
4. Confirm no envelope needs the old version.
5. Remove the retired key.

The application runtime necessarily decrypts active credentials; runtime compromise remains a residual risk.

## Security response and disclosure

The public reporting process is in `SECURITY.md`. Vulnerabilities are reported privately through GitHub Security Advisories. Current documented response target is acknowledgement within three business days and an initial update within seven.

## Secure-change checklist

- Does every finance row remain workspace-scoped?
- Is the minimum role explicit?
- Does a sensitive owner action require recent auth?
- Does every money mutation use idempotent posting?
- Are request bodies, list sizes, and provider calls bounded?
- Could a log/error/cache expose finance data or credentials?
- Does a new integration have token encryption, OAuth replay defense, revocation, and retention?
- Does a new public surface return only necessary fields and support revocation?
- Are contract and integration tests added?

## Related Files

- [`SECURITY.md`](../../SECURITY.md)
- [`proxy.ts`](../../proxy.ts)
- [`lib/auth.ts`](../../lib/auth.ts)
- [`lib/api-security.ts`](../../lib/api-security.ts)
- [`lib/credential-encryption.ts`](../../lib/credential-encryption.ts)
- [Security review](../reviews/security-review.md)

## Dependencies

- Correct secret management outside Git.
- Azure SQL availability for distributed guards.
- TLS and canonical origin configuration.

## Assumptions

- Production environment access is restricted and audited outside this repository.

## Known Limitations

- CSP permits inline styles because the UI uses React style attributes.
- JWT theft cannot be distinguished from the original browser before revocation/expiry.
- Provider-side revocation can fail; local tokens are still deleted.
- A formal privacy impact assessment and regulatory classification are unknown from source code.

## Future Improvements

- Remove inline styles and tighten `style-src`.
- Add a formal data classification and privacy model.
- Add automated dynamic security tests and incident runbooks.

## Last Updated

2026-07-28
