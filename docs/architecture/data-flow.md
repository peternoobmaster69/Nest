---
title: Data Flow
description: Workspace scoping, read paths, mutation paths, provider flows, cache behavior, and data lifecycle.
audience: [engineers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Data flow

## Purpose

Show how identity, workspace scope, finance records, and external data move through Nest.

## Scope

This page focuses on trust and persistence transitions rather than individual endpoint payloads.

## Workspace-scoped read flow

```mermaid
flowchart LR
    URL[/w/{workspaceId}/...] --> Proxy[proxy.ts]
    Proxy -->|X-Workspace-Id| Fetch[page/workspaceFetch]
    Fetch --> Route[API route]
    Route --> Guard[requireWorkspaceAccess]
    Guard --> Member[(WorkspaceMember)]
    Guard --> Query[workspace-scoped query]
    Query --> SQL[(Azure SQL)]
    SQL --> Private[no-store JSON]
    Private --> Cache[workspace-keyed React Query cache]
```

Source: [data-flow.mmd](../diagrams/data-flow.mmd).

The URL is the canonical tab scope. The cookie and `User.activeWorkspaceId` only choose a default for bare/legacy URLs.

## Financial mutation flow

1. UI constructs integer-cent payload and unique `Idempotency-Key`.
2. Route verifies `EDITOR` or `OWNER` membership as required.
3. Request content and referenced rows are validated inside the target workspace.
4. `executePosting` hashes the request and claims `(workspaceId, operation, idempotencyKey)`.
5. One SQL transaction creates/updates domain rows, ledger movements, posting group, and balance deltas.
6. Matching retries replay the completed result; mismatched reuse returns conflict.
7. Destructive transaction operations create reversals instead of erasing journal history.
8. Client invalidates affected workspace query keys.

See [posting-sequence.mmd](../diagrams/posting-sequence.mmd).

## Authentication flow

- OAuth claims must be verified by the provider.
- Passkey authentication creates a one-minute, one-time login handoff ticket.
- Successful login creates a database `LoginSession` after a user-row lock.
- Up to five active sessions are allowed; excess logins become short-lived pending sessions.
- JWT callbacks verify user session version and session status/expiry.
- Sensitive operations can require authentication within the last ten minutes.

See [authentication sequence](../diagrams/auth-sequence.mmd).

## External integration flow

| Flow | Inbound data | Processing | Persisted data | Outbound data |
| --- | --- | --- | --- | --- |
| Gmail alerts | Subject/body and Gmail IDs | Filter, parse, dedupe, card match | Encrypted failed sample or staged normalized alert; OAuth token envelope | OAuth/token and Gmail requests |
| Maybank import | Bounded CSV chunks | Parse, skip rules, duplicate detection | Card transactions and posting records | None |
| Ask Nest | Question, bounded history, current page | Intent, read tools, model response, grounding | Turn, usage, bounded diagnostics, approved memory | Prompt/tool results to Azure OpenAI |
| Azure AI Search | Query derived for workspace knowledge | Hybrid search with user/workspace filter | Provider-owned index; no local document persistence here | Search text/vector request |
| Massive | Ticker/date range | Bounds, durable cache, serialized throttle | Cached normalized history | API key request |
| SerpApi | Public news query only | Privacy gate, quota/account check, cache | Cached public result and durable quota state | API-key query request |
| Notifications | Due statement projection | Dedupe and channel delivery | In-app row and delivery job | Email and Web Push payload |

Private account/card/transaction names and balances must not be sent to public news search.

## Data retention flow

The daily retention cron:

- Archives Ask Nest counts/tokens before deleting raw turns.
- Removes expired OAuth state and WebAuthn challenges.
- Scrubs old failed card-alert bodies.
- Removes old terminal job payloads and eventually job rows.
- Removes old invites, notifications, audit logs, session metadata, caches, and inactive rate-limit rows.
- Processes bounded batches so a run can continue the next day.

Retention windows are configurable in `.env.example`. Memory rows remain until user removal, explicit deletion, expiry, or policy status changes.

## Client caching

- React Query keys include workspace IDs.
- Workspace switches remove old workspace-scoped data before refetch.
- Background refetch failures retain previous data.
- Dashboard and context are `private, no-store`; no shared server cache is used.
- Service worker stores static assets only and purges old private caches.

## Related Files

- [`proxy.ts`](../../proxy.ts)
- [`lib/workspace-client.ts`](../../lib/workspace-client.ts)
- [`lib/query-keys.ts`](../../lib/query-keys.ts)
- [`lib/posting-service.ts`](../../lib/posting-service.ts)
- [`lib/data-retention.ts`](../../lib/data-retention.ts)

## Dependencies

- Workspace membership and role records.
- SQL transactions and unique constraints.
- Browser cookie and fetch behavior.

## Assumptions

- All finance data is private unless projected through a dedicated public token endpoint.

## Known Limitations

- No formal data-flow classification labels are encoded in types.
- Provider-side retention and logging policies are unknown from source code.

## Future Improvements

- Add data-classification annotations to schemas and telemetry.
- Add provider retention requirements to operational contracts.

## Last Updated

2026-07-28
