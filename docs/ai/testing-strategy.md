---
title: AI Testing Strategy
description: Minimum validation an AI assistant should select for each class of Nest change.
audience: [ai-assistants, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI testing strategy

## Purpose

Turn change scope into an explicit validation plan.

## Scope

Focused tests, repository gates, database integration, UI checks, and acknowledged gaps.

## Minimum Matrix

| Change | Add/run |
| --- | --- |
| Route/validation | Route contract, invalid/boundary cases, OpenAPI check |
| Workspace/role | unauthenticated, wrong workspace, insufficient role, valid role |
| Financial mutation | retry, concurrency, failure atomicity, reversal, integer boundary |
| Schema/migration | readiness, empty bootstrap, forward deploy, integrity constraint |
| Background job | duplicate enqueue, lease expiry, retry, dead-letter/bounded slice |
| Provider | timeout/error mapping, quota, malformed response, disabled config |
| AI | tool authorization, read-only contract, evidence, prompt/evaluation regression |
| UI | interaction/contract, UI architecture, performance budget, production build |
| Public route | invalid/expired/revoked token, minimal projection, throttle |

## Handoff Gate

```bash
npm run check
npm run build
```

Run `npm run audit:public` for release/security/dependency-sensitive work.

## Test Quality

- Prefer observable behavior over source-string assertions.
- Use synthetic, deterministic fixtures.
- Never weaken a security/integrity assertion merely to fit a new implementation.
- Explain any skipped database/provider/evaluation suite.

## Related Files

- [Detailed test strategy](../testing/strategy.md)
- [Testing guide](../guides/testing.md)
- [`tests/`](../../tests)

## Dependencies

- Node test runner, SQL Server gates, and optional provider configuration.

## Assumptions

- The assistant has identified all affected domains before selecting tests.

## Known Limitations

- CI runs Playwright browser checks and enforces an 80% minimum for lines, statements, functions, and branches. See the [strict quality policy](../operations/strict-quality-gate.md).

## Future Improvements

- Add generated change-to-test ownership metadata.

## Last Updated

2026-07-28
