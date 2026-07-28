---
title: Refactoring Opportunities
description: Behavior-preserving improvement candidates with benefits, risks, and migration sequences.
audience: [maintainers, technical-leads, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Refactoring opportunities

## Purpose

Turn structural debt into sequenced, testable improvements without mixing refactoring with business-rule changes.

## Scope

High-value controller, AI, route, schema-contract, balance, job, and test refactors.

## Opportunity 1: Decompose Page Controllers

**Why:** Several feature pages coordinate queries, mutations, dialogs, selection, derived totals, and presentation in files over 1,000–3,000 lines.

**Benefits:** Smaller review units, targeted tests, reduced rerender scope, clearer ownership.

**Risks:** Effect ordering, stale closures, optimistic state, and dialog state can change during extraction.

**Migration:**

1. Add interaction characterization tests.
2. Extract pure selectors/formatters.
3. Extract one server-state hook at a time.
4. Extract dialog/view components with typed props.
5. Reduce the exception ceiling after each step.

## Opportunity 2: Split Ask Nest Tools by Domain

**Why:** A single large tool module spans many read domains.

**Benefits:** Explicit authorization and data-shaping boundaries; focused tests; smaller AI context.

**Risks:** Tool names/schema changes can affect prompts and evaluation.

**Migration:** Freeze the registry contract, create domain registries, re-export through the old registry, compare evaluation results, then remove compatibility glue.

## Opportunity 3: Shared Runtime and OpenAPI Schemas

**Why:** Validation and generated API descriptions can drift.

**Benefits:** One parameter definition, richer client generation, less documentation duplication.

**Risks:** Zod-to-OpenAPI conversion may express unions/refinements differently.

**Migration:** Start with one low-risk route family, snapshot generated output, add compatibility tests, and expand only after error responses remain stable.

## Opportunity 4: Explicit Bank Control Balance

**Why:** Manual bank control balance is represented by `Account.startingCents`, a field name that suggests a fixed opening value.

**Benefits:** Prevents accidental double-counting and communicates domain meaning.

**Risks:** Schema migration and legacy callers may reinterpret historical values.

**Migration:** Introduce a named service/value type first, migrate reads/writes behind it, audit callers, then consider a database rename in a separate release.

## Opportunity 5: Normalize Route Guard Mechanics

**Why:** Route files repeat authentication, workspace, error, and request-parsing scaffolding.

**Benefits:** Consistent error envelopes, rate-limit metadata, and audit hooks.

**Risks:** A generic wrapper can hide the specific role or ownership check.

**Migration:** Standardize mechanics only; require each route to declare its role and resource-ownership policy explicitly.

## Opportunity 6: Strengthen Test Layers

**Why:** Contract tests are strong, but browser and provider integration coverage is limited.

**Benefits:** Detects hydration, navigation, cookie, WebAuthn, and callback failures.

**Risks:** Browser/provider tests can be slow and flaky.

**Migration:** Begin with four deterministic flows: login entry, workspace switch, transaction posting retry, and reversal. Stub providers at network boundaries.

## Opportunity 7: Observability Boundary

**Why:** There is no evident shared correlation/redaction interface.

**Benefits:** Faster incident diagnosis without unsafe payload logging.

**Risks:** Instrumentation can leak sensitive values or add request cost.

**Migration:** Define approved fields, add redaction tests, instrument route/job/posting boundaries, then add dashboards and alerts.

## Prioritization

1. Shared schemas/OpenAPI and browser critical-path tests.
2. Ask Nest tool decomposition.
3. Transaction/card/reward page controller decomposition.
4. Control-balance encapsulation.
5. Guard and observability mechanics.

Priority should be revised using incident frequency and change churn, which are **Unknown from source code.**

## Related Files

- [Technical debt](technical-debt.md)
- [Testing strategy](../testing/strategy.md)
- [AI module](../modules/ai.md)
- [UI module](../modules/web-ui.md)
- [ADR-006](../architecture/adr/ADR-006-bank-control-balances.md)

## Dependencies

- Characterization tests, stable external contracts, and incremental review.

## Assumptions

- Refactoring preserves behavior unless a separately reviewed business change says otherwise.

## Known Limitations

- Estimates and team capacity are unknown from source code.

## Future Improvements

- Track each accepted opportunity with an owner, baseline metric, target, and ADR where needed.

## Last Updated

2026-07-28
