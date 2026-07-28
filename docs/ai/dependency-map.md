---
title: AI Dependency Map
description: Internal and external dependency directions relevant to safe code changes.
audience: [ai-assistants, architects, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI dependency map

## Purpose

Show what a change can affect and where dependencies must not flow.

## Scope

Source layers, packages, services, storage, and provider boundaries.

## Internal Direction

| From | May depend on | Avoid |
| --- | --- | --- |
| `app/` pages | components, hooks, server services | embedding domain mutation logic |
| `components/` | UI primitives, hooks, shared types | Prisma, secrets, server-only clients |
| `hooks/` | browser API clients/query keys | database/provider SDKs |
| `app/api/` | auth/workspace/domain services | direct duplicated financial rules |
| `lib/` services | Prisma, other focused services, providers | React/browser modules |
| jobs/cron | job service and domain worker | unbounded work in one invocation |
| AI tools | authorized read services | mutation services |

## External Packages by Role

| Role | Package/system |
| --- | --- |
| Web runtime | Next.js, React |
| Persistence | Prisma, SQL Server/Azure SQL |
| Auth | NextAuth, SimpleWebAuthn |
| Client cache | TanStack React Query |
| Validation | Zod |
| AI/search | OpenAI SDK, Azure AI Search |
| Email/push | Azure Communication Email, Web Push |
| Market/news | Massive, SerpApi |
| Hosting telemetry | Vercel Analytics and Speed Insights |

## Change Blast Radius

- Auth/workspace helper: nearly every private route.
- Posting/schema: balances, budgets, cards, receivables, tests, migrations.
- OpenAPI registry: generated artifact and API docs.
- Background jobs: cron routes, provider retries, database load.
- Shared UI shell/query keys: most browser workflows.
- AI registry: prompt behavior, evaluation, privacy boundary.

## Related Files

- [Architecture summary](architecture-summary.md)
- [Integrations](../architecture/integrations.md)
- [Repository structure](../architecture/repository-structure.md)

## Dependencies

- `package.json`, import graph, and module boundaries.

## Assumptions

- Dependency direction is conceptual; no complete automated boundary checker exists.

## Known Limitations

- This is not a file-level generated graph.

## Future Improvements

- Generate import graphs and enforce forbidden client/server edges.

## Last Updated

2026-07-28
