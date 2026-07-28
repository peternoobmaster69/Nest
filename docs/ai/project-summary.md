---
title: AI Project Summary
description: Minimal high-signal context an AI assistant needs before changing Nest.
audience: [ai-assistants, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI project summary

## Purpose

Bootstrap a coding assistant with product intent, technology, invariants, and safe navigation.

## Scope

Repository-wide orientation. Follow links before modifying a domain.

## Snapshot

| Item | Value |
| --- | --- |
| Product | Multi-workspace personal finance web application |
| Runtime | Next.js 16 App Router, React 19, TypeScript |
| Persistence | Prisma 6 with SQL Server/Azure SQL |
| Authentication | NextAuth OAuth plus WebAuthn passkeys |
| Client data | TanStack React Query |
| Validation | Zod and explicit boundary validation |
| AI | Azure-hosted OpenAI-compatible endpoint; optional Azure AI Search |
| Hosting contract | Node application; Vercel cron declarations |

## Non-Negotiable Invariants

- Scope every private resource to the active workspace.
- Roles order as `OWNER > EDITOR > VIEWER`; legacy `MEMBER` behaves as `EDITOR`.
- Store and calculate money in integer cents.
- Use posting groups/entries for balance-changing workflows.
- Make retryable mutations idempotent; correct posted history with reversals.
- Keep Ask Nest read-only and evidence-grounded.
- Never expose secrets, raw public tokens, OAuth tokens, or private financial content.
- Preserve canonical `/w/{workspaceId}` navigation.

## Read Before Editing

1. [Business rules](../business/business-rules.md)
2. [Architecture summary](architecture-summary.md)
3. Relevant [module](../modules/README.md)
4. Relevant [API contract](../api/README.md)
5. [Schema](../database/schema.md) and [tests](../testing/strategy.md)

## Validation

```bash
npm run check
npm run build
```

Also run focused tests and `npm run audit:public` when relevant.

## Related Files

- [`package.json`](../../package.json)
- [Full architecture overview](../architecture/overview.md)
- [Feature map](feature-map.md)

## Dependencies

- Canonical documentation and executable source.

## Assumptions

- The requested change should preserve existing behavior unless stated otherwise.

## Known Limitations

- Team ownership, production topology, and operational SLOs are unknown from source code.

## Future Improvements

- Generate counts and source links automatically in CI.

## Last Updated

2026-07-28
