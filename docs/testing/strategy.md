---
title: Test Strategy and Coverage Map
description: Risk-based map of Nest test suites, gates, gaps, and required scenarios.
audience: [engineers, reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Test strategy and coverage map

## Purpose

Map product risk to executable validation and expose gaps that maintainers should not mistake for coverage.

## Scope

The 38 Node test suites, UI policy checks, SQL Server CI job, build, audits, and AI evaluation.

## Strategy

Nest uses contract-heavy tests. Many suites inspect source structure and exported behavior without starting a browser or complete application server. Database invariants receive a separate SQL Server CI job. This provides fast architecture regression feedback but leaves browser and live-provider behavior less covered.

## Coverage Map

| Domain | Representative suites | Primary risk |
| --- | --- | --- |
| Authentication/admin | `admin-access-contract`, `login-session-audit` | Privilege and session lifecycle |
| Workspace isolation | `workspace-entry-contract`, `workspace-url`, `phase2-security-contract` | Cross-workspace access |
| Ledger/posting | `phase1-ledger-contract`, `phase1-concurrency.integration` | Duplicate or inconsistent balances |
| Database integrity | `database-readiness`, `phase4-database-integrity*` | Invalid persisted state |
| Budget planning | `monthly-budget-plan` | Monthly allocation semantics |
| Cards/receivables | reminder, public dues, close, visibility suites | Due/settlement and visibility rules |
| Investments/providers | entry-order, Massive, SerpApi suites | Ordering and third-party contract drift |
| Nest CIO | CIO domain/API/UI and Ask Nest contracts | Exact rounding, workspace isolation, incomplete data, projection/policy safety |
| Gmail/import | Gmail query/summary, bulk import notes | Bounded ingestion and traceability |
| Jobs | `background-jobs`, `phase5-reliable-jobs` | Lease, retry, deduplication |
| Ask Nest | contracts, evaluation, entity resolution, category suites | Read-only grounding and interpretation |
| Smart Review | `smart-review` | Safe batch classification |
| UI platform | UI contract, phase 7 platform, workspace entry | Shared shell and component policy |
| Architecture/API | phase 6 suites, OpenAPI check | Route/error/structure drift |
| Security | phases 0, 2, and 3 suites; workflows | Exposure and guard regressions |

## Required Scenarios for Critical Mutations

- Happy path with correct workspace and role.
- Missing authentication.
- Valid user in the wrong workspace.
- Insufficient role.
- Invalid identifiers and boundary values.
- Duplicate request with the same operation key.
- Concurrent or stale-state transition where relevant.
- Database/provider failure with no partial financial effect.
- Successful reversal/correction path.
- Audit or posting evidence created as required.

## Fixtures and Mocking

Tests use local JavaScript fixtures and source-level stubs. A centralized fixture factory or mock-server package is not evident. Exact live-provider sandbox strategy is **Unknown from source code.**

## CI Gates

```text
validate: npm ci → npm run check → npm run build → npm run audit:public
sqlserver-baseline: bootstrap → seed → integrity test → deploy migrations
security: gitleaks + dependency review
codeql: JavaScript/TypeScript analysis
```

## Coverage Gaps and Priority

| Priority | Gap | Consequence |
| --- | --- | --- |
| High | No browser E2E | Navigation, WebAuthn, dialogs, and client hydration can regress |
| High | No measured coverage threshold | Untested branches can grow invisibly |
| Medium | Limited live-provider tests | OAuth/provider response drift may appear only in deployment |
| Medium | No load/soak suite | Queue, bulk-query, and AI limits lack scale evidence |
| Medium | AI evaluation not in normal CI | Model/prompt quality can drift independently |
| Low | No documented flake quarantine | Intermittent failures lack a defined handling policy |

## Related Files

- [`tests/`](../../tests)
- [Testing guide](../guides/testing.md)
- [CI workflow](../../.github/workflows/ci.yml)
- [Business traceability](../business/traceability.md)

## Dependencies

- Node test runner, TypeScript loader, Prisma client, SQL Server, and optional external AI configuration.

## Assumptions

- Test file names accurately describe the primary covered contract.

## Known Limitations

- This map describes presence, not a measured line or branch percentage.
- Source-inspection tests can pass while a runtime integration is broken.

## Future Improvements

- Add Playwright, coverage instrumentation, provider contract recordings, and load tests.
- Attach stable business-rule IDs to critical test names.

## Last Updated

2026-07-28
