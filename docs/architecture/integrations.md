---
title: External Integrations
description: Provider purpose, configuration, data exposure, failure behavior, and maintenance constraints.
audience: [engineers, operators, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# External integrations

## Purpose

Catalog systems outside Nest and the controls required to change or operate them safely.

## Scope

This page covers provider boundaries. Feature workflows are documented in [integration modules](../modules/integrations.md) and [AI module](../modules/ai.md).

## Provider catalog

| Provider | Purpose | Configuration | Data sent | Durable controls |
| --- | --- | --- | --- | --- |
| Google/Apple/Facebook | OAuth sign-in | Provider client ID/secret pairs | Standard authentication claims | Verified claims; unused API tokens cleared |
| Gmail | Supported card-alert ingestion | Google client credentials, redirect URI, encryption key | OAuth code/token requests; bounded mailbox queries | One-time PKCE state, encrypted tokens, job checkpoints |
| Azure OpenAI | Ask Nest and model-assisted Smart Review | endpoint, API key, deployment | Bounded question/history, read-tool results, instructions | Server-only key, structured output, grounding, rate limits, evaluation |
| Azure AI Search | Optional workspace knowledge | endpoint/index/semantic config; managed identity or query key; two gates | User/workspace-filtered hybrid query | Both enable/eval gates required; fields and filter contract |
| Massive | Adjusted daily US market history | API base/key | Ticker and date range only | One-hour SQL cache, cross-instance throttle |
| SerpApi | Recent public Google News | API base/key/monthly limit | Public news terms only | One-hour cache, Account API quota check, durable monthly reserve |
| Azure Communication Email | Workspace invitations and card reminders | connection string and sender | Recipient and bounded message content | Job idempotency and sanitized failures |
| Web Push | Card-due and invitation notifications | VAPID keys/subject | Subscription endpoint and notification payload | Per-user subscriptions, stale endpoint deletion |
| Vercel | Next.js hosting, cron, analytics, speed insights | project/environment outside repo | Runtime traffic and configured telemetry | Security headers and cron secret |
| Azure SQL | Primary persistence and distributed coordination | `DATABASE_URL` or split variables | All durable app state | TLS validation, migrations, constraints, retention |

## Gmail constraints

- OAuth state expires in ten minutes and can be consumed once.
- Access/refresh tokens use contextual AES-256-GCM envelopes.
- Sync first tries Gmail history; an expired cursor falls back to a bounded alert query.
- Metadata is fetched before full body to avoid loading irrelevant messages.
- Only supported subject patterns are ingested.
- Each slice checkpoints counts and page token; more work stays queued.
- Disconnect attempts provider revocation, then clears local credentials even if provider revocation fails.

## AI and search constraints

- Azure OpenAI must support the v1 Responses API, function calling, and structured outputs.
- Finance tools are read-only and bound to authenticated user/workspace context.
- Azure AI Search is not used for balance/total truth.
- Search index must expose retrievable source fields, filterable `workspaceId`/`userId`, a vector field, and named semantic configuration.
- News results are untrusted third-party reporting and must retain attribution.
- Neither market nor news tools may turn into personalized buy/sell/hold advice.

## Notification constraints

- Email configuration is optional; in-app rows are the durable user-visible baseline.
- Web Push silently treats missing configuration as disabled.
- 404/410 push subscriptions are removed.
- Reminder delivery is capped per run.
- Provider errors stored in jobs are sanitized.

## Configuration handling

All credentials are server-only except `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Never introduce `NEXT_PUBLIC_` variables for provider API keys, OAuth secrets, encryption keys, or database credentials.

## Related Files

- [`.env.example`](../../.env.example)
- [`lib/gmail.ts`](../../lib/gmail.ts)
- [`lib/ai/config.ts`](../../lib/ai/config.ts)
- [`lib/ai/knowledge-search.ts`](../../lib/ai/knowledge-search.ts)
- [`lib/web-push.ts`](../../lib/web-push.ts)

## Dependencies

- Provider availability, credentials, quotas, and API contracts.
- SQL storage for durable state and coordination.

## Assumptions

- Optional integration failure must not corrupt or block manual finance workflows.

## Known Limitations

- Provider account ownership, paid tiers, data residency, and contractual retention are unknown from source code.
- Only specific Gmail card-alert subjects and Maybank CSV format are supported.

## Future Improvements

- Add provider contract tests against recorded sanitized fixtures.
- Add integration-specific operational dashboards and credential-rotation evidence.
- Document provider data-processing agreements outside source when available.

## Last Updated

2026-07-28
