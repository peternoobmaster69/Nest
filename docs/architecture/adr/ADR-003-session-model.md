---
title: "ADR-003: JWT Sessions with Database Audit"
description: Decision to combine stateless NextAuth cookies with server-tracked session admission and revocation.
audience: [engineers, security-reviewers, ai-assistants]
status: accepted
source_of_truth: true
last_updated: 2026-07-28
---

# ADR-003: JWT sessions with database audit

## Purpose

Explain why both JWT cookies and `LoginSession` records exist.

## Scope

OAuth/passkey sign-in, session limits, renewal, revocation, and device visibility.

## Context

JWT sessions are convenient for NextAuth, but pure stateless tokens cannot enforce a device/session limit, display active sessions, or revoke one token before expiry.

## Problem

Nest needs bounded concurrent sessions, user-visible device metadata, explicit revocation, and recent-authentication timestamps.

## Constraints

- NextAuth v4 uses JWT strategy.
- Authentication depends on Azure SQL availability for user/session verification.
- Multiple instances must agree on session state.

## Options considered

- Pure JWT: insufficient revocation/admission.
- Database session only: not implemented.
- JWT plus authoritative session audit/admission row: implemented.

## Decision

Issue a signed JWT that carries user/session identifiers and session version. On JWT refresh, verify the corresponding `LoginSession` row and user version. Allow five active sessions; issue excess logins as short-lived pending sessions until the user selects sessions to retain.

## Consequences

- Session state is revocable and inspectable.
- DB outage affects authenticated requests.
- Session metadata has a retention policy.
- Sign-out updates server state.

## Risks

- A stolen cookie is usable until row/version revocation or expiry.
- Trusting forwarding headers could store forged device-location metadata.

## Alternatives

Hardware device attestation and token binding are not implemented.

## Future Improvements

- Add risk-based sign-in notifications and account-wide session reset UI if product requirements call for them.

## Related Files

- [`lib/auth.ts`](../../../lib/auth.ts)
- [`lib/session-policy.ts`](../../../lib/session-policy.ts)
- [`tests/login-session-audit.test.mjs`](../../../tests/login-session-audit.test.mjs)

## Dependencies

- NextAuth and `LoginSession`.

## Assumptions

- Five active sessions is the current product policy.

## Known Limitations

- Device names are inferred from user agent and are not verified hardware identity.

## Last Updated

2026-07-28
