---
title: Important File Catalog
description: Maintenance-oriented catalog of source-of-behavior files and their change hazards.
audience: [engineers, maintainers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Important file catalog

## Purpose

Identify the files whose behavior or contracts have broad product impact and explain when they should be changed.

## Scope

Important root, route, platform, domain, database, operational, generated, and policy files. The [API index](../api/README.md) catalogs individual route paths.

## Runtime and Request Boundaries

| File | Responsibility | Modify when | Primary risk |
| --- | --- | --- | --- |
| `app/layout.tsx` | Root document and application providers | Global metadata/provider composition changes | Hydration or all-route regression |
| `app/w/[workspaceId]/[[...path]]/page.tsx` | Canonical workspace dispatcher | Workspace feature navigation changes | Wrong workspace/feature mapping |
| `proxy.ts` | Request headers, workspace path context, origin/CSP/security policy | Request-boundary policy changes | Authorization/header/security regression |
| `instrumentation.ts` | Startup production configuration validation | Production prerequisites change | Insecure or unavailable deployment |
| `next.config.ts` | Framework redirects/images/build settings | Global Next.js behavior changes | Route and asset behavior |
| `vercel.json` | Scheduled HTTP invocations | Cron schedule/route changes | Missed or duplicated background work |

## Authentication and Workspace

| File | Responsibility | Key exports/contracts | Risk |
| --- | --- | --- | --- |
| `lib/auth.ts` | NextAuth providers/callbacks/session creation | `authOptions`, `handler` | Account linking/session privilege |
| `lib/passkeys.ts` | WebAuthn challenge and login tickets | challenge claim/remember, ticket consume | Replay/origin failures |
| `lib/workspace-auth.ts` | Session, recent auth, workspace role checks | `requireWorkspaceAccess`, `requireWorkspaceRole` | Cross-workspace access |
| `lib/workspace-entry.ts` | Canonical workspace paths | path parse/build helpers | Wrong tab/workspace navigation |
| `lib/workspace-roles.ts` | Role normalization/order | `normalizeWorkspaceRole`, `hasMinimumWorkspaceRole` | Privilege inversion |
| `lib/session-policy.ts` | Session age, renewal, count | constants and expiry helpers | Unexpected session lifetime |

## Financial Core

| File | Responsibility | Key exports/contracts | Risk |
| --- | --- | --- | --- |
| `lib/posting-service.ts` | Atomic posting, ledger record, reversal, reconciliation | `executePosting`, `createLedgerTransaction`, `reverseLedgerTransaction` | Duplicate/inconsistent balances |
| `lib/budget-ledger.ts` | Budget availability deltas | calculate/apply/recalculate helpers | Envelope drift |
| `lib/bank-consistency.ts` | Account/ledger consistency projection | `getBankConsistency` | Misleading reconciliation |
| `lib/credit-card-statement-cycle.ts` | Statement month derivation | `deriveStatementCycle` | Wrong card period |
| `lib/credit-card-payment-reminders.ts` | Reminder preparation/delivery | delivery worker, scheduled runner | Duplicate/missed reminders |
| `lib/credit-txn-auto-account-runner.ts` | Rule-driven card accounting | `runCreditTxnAutoAccounting` | Incorrect automated posting |
| `lib/domains/ledger/budget-plan/` | Budget plan schemas and services | handlers, draft/template/confirm services | Draft/confirmed state corruption |
| `lib/domains/receivables/` | Receivable projections | summary functions | Over/under settlement |

## Integrations, Jobs, and AI

| File | Responsibility | Key exports/contracts | Risk |
| --- | --- | --- | --- |
| `lib/background-jobs.ts` | Durable job lifecycle | enqueue/claim/heartbeat/continue/complete/fail | Duplicate or lost work |
| `lib/gmail.ts` | Gmail OAuth/token/provider client | consent, exchange, credential, list/fetch | Credential leak/provider drift |
| `lib/gmail-sync-runner.ts` | Bounded Gmail ingestion | queue/process/scheduled sync | Duplicate alerts/backlog |
| `lib/credential-encryption.ts` | Versioned AES-GCM envelopes | encrypt/decrypt/context | Irrecoverable credentials |
| `lib/maybank-csv.ts` | Statement parsing | parse/normalize/skip | Bad imported transaction data |
| `lib/ai/ask-nest.ts` | Model orchestration and response shaping | `answerAskNest` | Privacy/hallucination/cost |
| `lib/ai/ask-nest-tools.ts` | Read-only data tools | tool registry and executor | Data leakage/oversized coupling |
| `lib/ai/smart-review.ts` | Card transaction suggestions | fingerprint/freshness/review | Stale/unsafe suggestions |
| `lib/ai/knowledge-search.ts` | Optional Azure Search retrieval | gate/search | Ungrounded external content |
| `lib/ai/massive-market-data.ts` | Market history provider | configured check/history | Provider/quote correctness |
| `lib/ai/serpapi-news.ts` | News search provider | configured check/search | Quota/untrusted content |

## Transport and Browser Platform

| File | Responsibility | Risk |
| --- | --- | --- |
| `lib/api-security.ts` | Same-origin, JSON limits, secure route runner | Inconsistent boundary defense |
| `lib/api/contracts.ts` | Shared error/list/cache contracts | Client contract drift |
| `lib/api/client.ts` | Browser fetch/error conversion | Error handling and cookie behavior |
| `lib/api/pagination.ts` | Cursor/limit parsing and list envelopes | Unbounded reads |
| `lib/query-keys.ts` | React Query ownership/invalidation | Cross-workspace stale cache |
| `components/app-shell.tsx` | Shared responsive shell | All feature navigation |
| `components/*-page.tsx` | Feature page controllers | Large state/effect coupling |
| `components/ui/` | Shared interaction primitives | Accessibility/behavior regression |
| `public/sw.js` | Service-worker runtime entry | Caching private/stale content |

## Persistence, Generation, and Policy

| File | Responsibility | Maintenance note |
| --- | --- | --- |
| `prisma/schema.prisma` | Current data model | Pair with additive migration and docs |
| `prisma/migrations/` | Forward history | Never rewrite an applied migration |
| `prisma/baseline/` | Empty-database bootstrap | Keep manifest and schema compatible |
| `scripts/generate-openapi.mjs` | API registry/generator | Update with route contract |
| `generated/openapi.json` | Generated contract artifact | Never hand-edit |
| `scripts/run-prisma.mjs` | Safe Prisma command configuration | Preserve SQL URL handling |
| `scripts/bootstrap-database.mjs` | Empty database setup | Do not run casually on existing data |
| `docs/ui-component-exceptions.json` | Temporary component-size ceilings | Ceilings should stay flat or decrease |
| `docs/ui-performance-budget.json` | Built UI gzip baseline | Update only after reviewed measurement |

## Related Files

- [Repository structure](../architecture/repository-structure.md)
- [Service contracts](service-contracts.md)
- [Module index](../modules/README.md)

## Dependencies

- Current repository layout and public exports.

## Assumptions

- “Important” means a file with broad contracts, sensitive behavior, or operational significance.

## Known Limitations

- This is not an exhaustive list of every page, component, migration, or test file.
- Git history/churn and incident frequency were not available to refine importance.

## Future Improvements

- Generate owner, churn, callers, and test links for each catalog entry.

## Last Updated

2026-07-28
