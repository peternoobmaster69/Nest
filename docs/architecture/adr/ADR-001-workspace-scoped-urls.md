---
title: "ADR-001: Workspace-Scoped URLs"
description: Decision to make /w/{workspaceId} the canonical active-workspace context.
audience: [engineers, architects, ai-assistants]
status: accepted
source_of_truth: true
last_updated: 2026-07-28
---

# ADR-001: Workspace-scoped URLs

## Purpose

Record why the workspace in the URL is authoritative.

## Scope

Authenticated application navigation and workspace-scoped API requests.

## Context

Users may belong to multiple workspaces and keep different workspaces open in different browser tabs. A global cookie-only active workspace makes tabs interfere and increases the chance of stale cross-workspace UI.

## Problem

Every page, query, and mutation needs an explicit tenant scope that remains stable per tab and is still verified server-side.

## Constraints

- URLs must be shareable within an authenticated session.
- Legacy/bare routes must continue to work.
- Client-supplied scope cannot be trusted without membership verification.

## Options considered

- Cookie or user-profile active workspace only: rejected by current implementation because it is global across tabs.
- Workspace ID only in request bodies/query strings: rejected because navigation and client cache context become implicit.
- Canonical workspace path with header propagation: implemented.

Other options considered are **Unknown from source code.**

## Decision

Use `/w/{workspaceId}/...` as canonical application scope. `proxy.ts` and `workspaceFetch` propagate it as `X-Workspace-Id`; server guards verify membership and role. Cookie/profile values only choose a default for bare or legacy entry.

## Consequences

- Tabs can remain in different workspaces.
- React Query keys can include an explicit workspace.
- URL migrations and redirects must preserve path/query state.
- Route handlers must never trust the header without `requireWorkspaceAccess`.

## Risks

- Missing propagation can fall back to a different last-used workspace.
- Unscoped cache keys can display stale data.
- Hand-built links can lose the workspace segment.

## Alternatives

Cookie-only and implicit server-session workspace remain compatibility fallbacks, not primary scope.

## Future Improvements

- Make workspace context mandatory in typed server helpers for all finance reads.

## Related Files

- [`proxy.ts`](../../../proxy.ts)
- [`lib/workspace-entry.ts`](../../../lib/workspace-entry.ts)
- [`lib/workspace-client.ts`](../../../lib/workspace-client.ts)
- [`tests/workspace-entry-contract.test.mjs`](../../../tests/workspace-entry-contract.test.mjs)

## Dependencies

- Workspace membership and URL routing.

## Assumptions

- Workspace IDs are opaque and safe as encoded path segments.

## Known Limitations

- Some legacy endpoints still accept `workspaceId` in payload/query for compatibility.

## Last Updated

2026-07-28
