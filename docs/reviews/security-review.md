---
title: Security Review
description: Source-based assessment of trust boundaries, implemented controls, residual risks, and validation priorities.
audience: [security-reviewers, maintainers, operators]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Security review

## Purpose

Summarize implemented defenses and highlight risks requiring operational or test evidence.

## Scope

Authentication, authorization, secrets, sensitive data, input handling, logging, public links, providers, database transport, dependencies, and CI. This is not a penetration test.

## Control Summary

| Area | Implemented evidence |
| --- | --- |
| Authentication | NextAuth sessions, OAuth providers, passkey challenge/verification, recent-auth checks |
| Authorization | Workspace membership and role guards; admin allowlist; purpose-specific public tokens |
| Session control | JWT application session plus database session/audit records and revocation controls |
| CSRF/origin | Same-origin enforcement on sensitive session mutations; OAuth/WebAuthn origin configuration |
| Secrets | Environment variables; encrypted Gmail integration tokens with key versioning |
| Data transport | SQL encryption defaults; production certificate trust disabled |
| Input validation | Zod/manual validation, payload/list caps, integer/date constraints |
| Abuse controls | Endpoint-specific in-process/distributed rate limits and cron bearer secret |
| Public access | Random token presented raw but stored as a hash; limited response shapes |
| Supply chain | Lockfile, Dependabot, dependency review, npm audit, CodeQL, Gitleaks |
| Financial integrity | Idempotent postings, reversals, transactions, workspace ownership checks |

## Findings and Recommendations

### Critical dependency finding

`npm run audit:public` on 2026-07-28 passed the 622-file public-readiness scan but failed the production dependency audit with 7 advisories:

| Severity | Installed dependency path | Advisory themes |
| --- | --- | --- |
| Critical | `@auth/prisma-adapter` → `@auth/core` | Malformed bearer handling, email normalization, OAuth state/nonce/PKCE cookie binding |
| High | Swagger/APIDOM → `brace-expansion` | Denial of service through unbounded expansion |
| High | `swagger-ui-react` → `immutable` | Trie overflow and hash-collision denial of service |
| High | `next` | Proxy/server-action/cache/SSRF/image/internal-function disclosure advisories |
| High | `sharp` | Inherited libvips vulnerabilities |

The audit proves that affected versions are installed; it does not prove each path is reachable or exploitable in Nest. Treat the Auth.js upgrade as critical because authentication is enabled, then review and upgrade the high-severity packages in compatibility-tested groups. Do not use an unreviewed `npm audit fix --force` on this application.

### High priority validation

1. **Operational secret and key lifecycle is not documented.** Rotation frequency, custody, break-glass access, and retired encryption-key removal are unknown from source code. Define and rehearse rotation for `NEXTAUTH_SECRET`, cron, OAuth, VAPID, AI, public-provider, and integration encryption keys.
2. **No browser E2E security suite is present.** Add cross-workspace, stale-session, CSRF, passkey-origin, and OAuth callback tests in a real browser.
3. **Production logging/redaction controls are unknown.** Introduce structured logging that rejects secrets, raw financial imports, email bodies, public tokens, and sensitive AI prompts.

### Medium priority validation

1. **Distributed rate-limit coverage varies by endpoint.** Confirm all internet-facing sensitive routes use a production-effective store; in-process limits alone do not coordinate across instances.
2. **Public link revocation/expiry policy is incomplete.** Token purpose and hashes are implemented, but required expiry and lifecycle policy varies or is unknown. Establish defaults and user-visible revocation.
3. **External content enters Gmail, imports, news, and AI flows.** Continue strict size/type validation, escaping, and separation of instructions from retrieved content. Add adversarial prompt-injection/provider-payload cases.
4. **Authorization duplication can drift.** Consolidate common guard mechanics while keeping explicit role requirements at each route.

### Low priority hardening

- Document content-security-policy and other response header expectations; exact deployed headers are unknown from source code.
- Add automated secret-value redaction tests.
- Define data-classification and retention ownership beyond configurable retention windows.

## Threat Boundaries

```text
Browser → Next.js route → authentication/workspace guard → domain service → SQL
                                      ↘ provider client → external system
Public token → purpose verifier → restricted projection
Scheduler → CRON_SECRET verifier → bounded job worker
AI prompt → read-only tool registry → workspace-filtered data
```

The most consequential failure modes are cross-workspace access, leaked reusable credentials, duplicate/malformed financial posting, and untrusted external content affecting privileged behavior.

## Injection and File Handling

- Prisma parameterization is the normal database access mechanism; raw SQL migrations and queries require separate review.
- Import routes set explicit payload/row limits. Verify content parsing treats formula-like CSV cells as data and never evaluates them.
- No general user file-storage subsystem is evident.
- React escaping protects normal rendering, but any raw HTML or URL handoff must be reviewed individually.

## Sensitive Data

Financial transactions, balances, receivables, card metadata, email alert content, investment positions, AI history, OAuth credentials, passkeys, and session records are sensitive. Formal data classification, regulatory obligations, residency, and breach notification rules are **Unknown from source code.**

## Verification Checklist

- Run `npm run check`, `npm run build`, and `npm run audit:public`.
- Require a clean high-severity production dependency audit before release, or document a time-bounded, owner-approved reachability exception.
- Review CodeQL, dependency review, and Gitleaks status.
- Test cross-workspace access for every new resource route.
- Confirm sanitized logs for failure paths.
- Confirm old integration ciphertext remains decryptable during key rotation.
- Test public-token revocation and cron rejection.

## Related Files

- [Security architecture](../architecture/security.md)
- [`SECURITY.md`](../../SECURITY.md)
- [Business rules](../business/business-rules.md)
- [Testing strategy](../testing/strategy.md)

## Dependencies

- Authentication libraries, SQL Server, deployment secret store, GitHub security workflows, and external providers.

## Assumptions

- Deployment preserves the secure environment defaults in `.env.example`.

## Known Limitations

- This review did not inspect live infrastructure, network controls, secret stores, or logs.
- The npm audit output was reviewed, but advisory reachability and patched-version compatibility were not established.
- No penetration test evidence is present.

## Future Improvements

- Create a formal threat model, data classification, key-rotation runbook, and recurring security test plan.

## Last Updated

2026-07-28
