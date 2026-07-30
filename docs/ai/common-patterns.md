---
title: AI Common Patterns
description: Reusable implementation patterns and their failure modes.
audience: [ai-assistants, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI common patterns

## Purpose

Help assistants find and extend established implementation shapes instead of creating parallel abstractions.

## Scope

Authorization, posting, jobs, integrations, public tokens, client data, and AI tools.

## Pattern Map

| Pattern | Intent | Inspect |
| --- | --- | --- |
| `requireUser` | Establish authenticated identity | `lib/api-auth.ts` |
| Workspace context guard | Bind identity, workspace, and role | `lib/workspace-context.ts`, `lib/workspace-api.ts` |
| Posting execution | Atomic, idempotent balance effect | `lib/posting-service.ts` |
| Reversal | Preserve history while correcting effect | posting/reversal services |
| SQL job lease | Reliable bounded asynchronous work | `lib/background-jobs.ts` |
| Encrypted integration credential | Store provider token with key version | encryption/Gmail modules |
| Purpose-token hash | Public access without storing raw token | public share modules |
| Provider adapter | Bound timeout/quota/error translation | Massive, SerpApi, Gmail modules |
| React Query hook | Cache/invalidate shared server state | `hooks/` |
| Read-only AI tool | Workspace-scoped evidence projection | `lib/ask-nest-tools.ts` |
| Deterministic planning snapshot | One scoped domain result shared by page/API/AI | `lib/domains/cio/snapshot-service.ts`, `lib/ai/tools/cio-tools.ts` |
| Generated contract check | Detect route/OpenAPI drift | `scripts/generate-openapi.mjs`, generated artifact |

## Pattern Selection Rules

- Reuse a domain service before writing Prisma directly from a route.
- Reuse the posting service before inventing balance arithmetic.
- Use a job when work can exceed an interactive request or needs durable retry.
- Use public purpose tokens only for deliberately restricted unauthenticated views.
- Do not turn a convenience helper into an implicit authorization decision.
- Keep authoritative CIO arithmetic in pure domain engines; the UI and model may only present or explain returned values.

## Related Files

- [Architecture summary](architecture-summary.md)
- [Anti-patterns](anti-patterns.md)
- [Module index](../modules/README.md)

## Dependencies

- Shared helpers and domain modules under `lib/`.

## Assumptions

- Referenced symbols remain canonical; search source before copying signatures.

## Known Limitations

- The exact helper API can change faster than this summary.

## Future Improvements

- Add small source-linked examples for each pattern.

## Last Updated

2026-07-28
