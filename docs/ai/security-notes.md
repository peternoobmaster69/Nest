---
title: AI Security Notes
description: Security constraints an AI assistant must preserve in every Nest change.
audience: [ai-assistants, security-reviewers, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI security notes

## Purpose

Keep security checks explicit during implementation, review, and debugging.

## Scope

Identity, workspace authorization, sensitive actions, tokens, secrets, untrusted input, and privacy.

## Mandatory Checks

1. Authenticate before private data access.
2. Resolve the active workspace and confirm membership.
3. Enforce the minimum role and resource ownership.
4. Require recent authentication for sensitive account/workspace actions where the established flow does.
5. Apply same-origin protection to sensitive browser mutations.
6. Validate type, range, size, and count before expensive work.
7. Store integration credentials encrypted with versioned keys.
8. Store public tokens as hashes and restrict them to one purpose.
9. Authenticate cron invocations with `CRON_SECRET`.
10. Redact secrets, tokens, financial content, email bodies, imports, and AI context from logs.

## Trust External Content As Hostile

- Gmail messages and attachments/derived alerts.
- CSV/JSON imports.
- Massive and SerpApi responses.
- Browser push subscriptions.
- AI prompts, retrieved documents, and model output.
- Forwarded proxy/country headers unless a trusted proxy overwrites them.

## Response Guidance

- Do not reveal whether a resource exists across a workspace boundary.
- Do not return provider credentials or internal error stacks.
- Keep public projections minimal.
- Rate-limit authentication, AI, imports, provider calls, and public tokens.

## Related Files

- [Security architecture](../architecture/security.md)
- [Security review](../reviews/security-review.md)
- [Authentication API](../api/authentication.md)

## Dependencies

- Auth/session libraries, workspace guards, encryption, rate limiting, and deployment secrets.

## Assumptions

- Production configuration uses HTTPS and secure SQL defaults.

## Known Limitations

- Live network, secret-store, logging, and header configuration are unknown from source code.

## Future Improvements

- Add a machine-enforced data classification and logging-redaction policy.

## Last Updated

2026-07-28
