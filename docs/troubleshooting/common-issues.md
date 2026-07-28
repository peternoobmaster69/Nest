---
title: Common Troubleshooting Issues
description: Symptom-to-diagnosis map for local, deployed, database, and integration failures.
audience: [engineers, operators, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Common troubleshooting issues

## Purpose

Provide fast, safe first responses to failures that can be inferred from the repository.

## Scope

Setup, database, authentication, workspace context, OpenAPI, UI policy, jobs, Gmail, Ask Nest, and notification delivery.

## Issue Matrix

| Symptom | Checks | Corrective direction |
| --- | --- | --- |
| Prisma client import/build failure | Node version, install state, generated client | Run `npm ci` then `npm run prisma:generate` |
| Database connection failure | URL structure, SQL encryption, server reachability | Correct `.env`; retain encrypted transport |
| Migration drift | `db:migration:report`, migration table, schema history | Resolve history deliberately; do not edit applied migrations |
| Login callback redirects incorrectly | `NEXTAUTH_URL`, OAuth callback registration | Align all origins with the deployed canonical URL |
| Passkey works locally but not deployed | RP ID and origin | Use exact HTTPS origin and registrable RP domain |
| `401` from authenticated route | session cookie and expiry | Reauthenticate; inspect session configuration |
| `403` in a workspace | membership and required role | Select an authorized workspace or request the needed role |
| Wrong workspace data appears absent | `/w/{id}` and `X-Workspace-Id` | Use the canonical URL/header for the intended workspace |
| OpenAPI check fails | source route/registry changed | Run `npm run openapi:generate` and review the diff |
| UI check reports a large component | exception ceiling exceeded | Extract a cohesive view/hook; do not raise the ceiling casually |
| UI metrics check fails | bundle/baseline regression | Inspect report; reduce regression or explicitly review baseline change |
| Background job retries repeatedly | last error, attempts, lease, provider health | Fix root cause; confirm retry remains idempotent |
| Gmail reconnect required | encrypted refresh token and provider grant | Reauthorize through the owner-only recent-auth flow |
| Ask Nest returns unavailable | required AI variables and upstream access | Configure the workload or surface the intended disabled state |
| Azure Search not used | both enable/evaluation gates | Both must be `true`, with valid search configuration |
| Email reminder not sent | Azure email config, recipient, job delivery record | Configure sender/connection and inspect delivery state |
| Push subscription rejected | HTTPS endpoint and VAPID pair | Use a valid HTTPS subscription and matching keys |

## Do Not

- Disable authorization to make a failing test pass.
- set `trustServerCertificate=true` in production to bypass certificate errors.
- delete ledger or posting rows to repair a balance.
- reset migration history on an existing production database.
- print integration secrets or entire financial payloads.
- repeatedly invoke a mutation without the same idempotency identity.

## Escalation Evidence

Capture sanitized:

- Commit and environment name.
- Route and HTTP status.
- Request, workspace, operation, and job identifiers.
- Timestamp and provider response category.
- Relevant schema/migration version.
- Minimal reproduction and focused test result.

Escalation contacts and response-time targets are **Unknown from source code.**

## Related Files

- [Debugging guide](../guides/debugging.md)
- [Database operations](../database/operations.md)
- [Security review](../reviews/security-review.md)
- [Common bugs for AI](../ai/common-bugs.md)

## Dependencies

- Access to sanitized logs, configuration presence, and database/job status.

## Assumptions

- The reader begins with read-only diagnostics.

## Known Limitations

- Provider dashboards and hosting-specific procedures are outside this repository.

## Future Improvements

- Add incident-specific runbooks with alert thresholds and escalation ownership.

## Last Updated

2026-07-28
