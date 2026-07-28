---
title: AI Refactoring Guide
description: Safe sequence and stop conditions for AI-assisted Nest refactoring.
audience: [ai-assistants, engineers, reviewers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI refactoring guide

## Purpose

Keep mechanical improvement separate from unreviewed behavior change.

## Scope

Controllers, services, routes, schemas, tests, and deprecated code.

## Safe Sequence

1. State the behavior and invariant being preserved.
2. Inspect callers, exports, routes, schema, migrations, tests, and documentation.
3. Add characterization coverage for fragile paths.
4. Make one dependency-boundary change at a time.
5. Preserve response, idempotency, transaction, and authorization behavior.
6. Run focused tests after each extraction.
7. Remove old code only after references, dynamic loading, scripts, and generated artifacts are checked.
8. Run the full gate and update documentation/exception budgets.

## Stop Conditions

Stop and request a product/architecture decision when:

- Business behavior is ambiguous.
- A data migration can reinterpret historical money.
- Authorization becomes broader.
- A public/API contract must break.
- AI would gain write capability.
- An applied migration would need rewriting.

## Deletion Checklist

- `rg` finds no static references.
- Dynamic route/import/config/script references are checked.
- The symbol is not a framework entry point.
- Tests do not rely on its contract indirectly.
- Migration/history/audit evidence is not being erased.
- Documentation and generated files are updated.

## Priority Targets

See [refactoring opportunities](../reviews/refactoring-opportunities.md): shared route/OpenAPI schemas, browser tests, Ask Nest tool decomposition, large page controllers, and control-balance encapsulation.

## Related Files

- [Anti-patterns](anti-patterns.md)
- [Technical debt](../reviews/technical-debt.md)
- [Testing strategy](testing-strategy.md)

## Dependencies

- Characterization tests and explicit architecture invariants.

## Assumptions

- Refactors are behavior-preserving unless separately authorized.

## Known Limitations

- Dynamic provider/framework usage may not appear in simple text search.

## Future Improvements

- Add codemods and architecture tests for repeatable extractions.

## Last Updated

2026-07-28
