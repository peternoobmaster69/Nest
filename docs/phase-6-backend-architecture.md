# Phase 6 backend architecture

Phase 6 keeps existing public URLs and mutation payloads stable while moving reusable behavior out of route files.

## Boundaries

- `lib/domains/workspaces`: collaborator and workspace reads.
- `lib/domains/ledger`: ledger posting and the compatibility adapter for budget-plan actions.
- `lib/domains/cards`: card alerts and statement behavior.
- `lib/domains/receivables`: receivable domain boundary.
- `lib/domains/rewards`: frequent-flyer history.
- `lib/domains/integrations`: bounded, idempotent imports and Gmail integration behavior.
- `lib/domains/jobs`: background job boundary.
- `lib/api`: transport contracts, typed client errors, cursor pagination, and SQL-safe batching.

The existing `/api/budgets/plan` endpoint is now a thin compatibility transport. Its schemas, reads, template actions, monthly-draft actions, monthly-entry actions, and confirmation posting are separate ledger-domain services. The URL and UI workflow remain unchanged.

## API contracts

Authenticated list responses use `ListEnvelope<T>`:

```json
{
  "items": [],
  "pageInfo": {
    "hasMore": false,
    "nextCursor": null,
    "limit": 25
  }
}
```

Composite responses, such as collaborators and reward history, use one envelope per collection. Cursors are opaque, versioned, length-limited values. Invalid cursors and overlong searches are rejected rather than truncated.

Errors produced through the secure route wrapper include `error`, `code`, and `requestId`. The browser client preserves HTTP status, stable code, request ID, validation issues, and `Retry-After` for 401, 403, 409, 422, 429, and 503 handling.

## Imports

JSON imports accept at most 250 rows per request and query duplicates in SQL Server-safe batches of 50. Clients keep one import-run ID and derive a stable idempotency key for each chunk. Ledger rows and balance deltas commit together.

Maybank imports accept at most 500 parsed rows and 512 KiB of CSV per chunk. Card validation, duplicate detection, and `createMany` execute inside the same serializable idempotent posting transaction. Replaying the same key and payload returns the stored result; using a key for different content returns 409.

## OpenAPI and caching

`generated/openapi.json` is generated from exported `app/api/**/route.ts` handlers and checked in CI. It documents both NextAuth session cookie names. `/api-docs` and `/api/openapi` require a session; in production they are absent unless `ENABLE_API_DOCS=true` and are then admin-only.

Dashboard responses are explicitly `private, no-store` while query-group telemetry establishes a baseline. No shared or server cache is introduced before user/workspace correctness and invalidation can be demonstrated.

## Data scripts

Mutation-capable scripts default to dry-run. Live changes require all of:

- an exact workspace;
- `--apply`;
- an environment included by `DATA_SCRIPT_ALLOWED_ENVIRONMENTS`;
- `--confirm=<exact-workspace-id>`.

Every run emits structured audit output. Hard-coded record diagnostic scripts were removed.
