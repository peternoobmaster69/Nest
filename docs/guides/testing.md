---
title: Testing Guide
description: Commands, test layers, database gates, and expectations for safe changes.
audience: [engineers, reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Testing guide

## Purpose

Make validation proportional to the risks of a personal-finance application.

## Scope

Unit-like contract tests, source-structure tests, database integration tests, UI budgets, AI evaluation, build checks, and security gates.

## Standard Commands

| Command | Coverage |
| --- | --- |
| `npm test` | All `tests/*.test.mjs` through Node's test runner |
| `npm run test:ui` | UI contract suite |
| `npm run ui:check` | UI architecture and component-size policy |
| `npm run ui:metrics:check` | UI performance budget |
| `npm run lint` | ESLint and Next.js rules |
| `npm run typecheck` | TypeScript without emitting |
| `npm run openapi:check` | Generated OpenAPI drift |
| `npm run check` | UI check, lint, typecheck, OpenAPI, and tests |
| `npm run build` | Production compilation and route generation |
| `npm run audit:public` | Publication policy and high-severity production dependency audit |
| `npm run ai:eval` | Ask Nest evaluation dataset; requires configured AI service |

## Test Selection by Change

| Change | Minimum focused checks |
| --- | --- |
| Auth, workspace, or session | Relevant auth/workspace tests, `phase2-security-contract`, build |
| Posting or balances | Ledger, concurrency, affected workflow tests, DB integrity suite |
| Prisma schema/migration | Database readiness, migration report, SQL Server integration suite |
| API route | Route contract test, OpenAPI check, typecheck |
| UI controller/component | UI contract, UI check, performance check, build |
| Job/cron | Background job and schedule tests; verify idempotency and lease recovery |
| AI tools/prompts | Ask Nest contracts, entity resolution, evaluation where credentials exist |
| CIO domain/API/UI | CIO pure-domain and API contracts, Ask Nest routing/tools, UI contract/accessibility, Prisma migration, build |
| Public share/provider | Purpose-token and provider contract tests |

## Database Integration Tests

The default suite keeps database-dependent tests behind environment gates:

- `RUN_PHASE1_DB_TESTS=true`
- `RUN_PHASE4_DB_TESTS=true`

CI starts SQL Server, bootstraps the retained baseline, seeds it, exercises integrity constraints, and verifies that forward migration deployment is idempotent.

## Test Design Rules

- Test an externally meaningful invariant, not an implementation detail.
- Include cross-workspace denial cases for workspace-owned resources.
- Include retry cases for financial mutations and jobs.
- Include boundary values for integer cents, dates, list caps, and payload sizes.
- Assert both the response and persistent side effects for integration tests.
- Use synthetic data; do not commit personal financial data.
- Keep clocks, provider responses, and random identifiers controlled where practical.

## Coverage Gaps

- No browser-driven end-to-end test framework is configured.
- No numeric code-coverage threshold is configured.
- Most external integrations are validated with source/contract tests rather than live provider sandboxes.
- AI evaluation depends on external configuration and is not part of `npm run check`.
- Disaster recovery and production-scale load tests are not represented.

## Related Files

- [`tests/`](../../tests)
- [CI workflow](../../.github/workflows/ci.yml)
- [Detailed test strategy](../testing/strategy.md)
- [Debugging guide](debugging.md)

## Dependencies

- Node's test runner, `tsx`, Prisma, and SQL Server for gated integration tests.

## Assumptions

- A green source-contract test complements but does not replace runtime integration coverage.

## Known Limitations

- Exact test ownership and historical flake rates are unknown from source code.

## Future Improvements

- Add Playwright coverage for authentication, workspace switching, posting, and reversals.
- Add coverage reporting with thresholds based on risk-critical modules.
- Add reproducible provider emulators or recorded fixtures.

## Last Updated

2026-07-28
