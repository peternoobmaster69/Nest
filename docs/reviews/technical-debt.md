---
title: Technical Debt Report
description: Evidence-based inventory and prioritization of maintainability, test, architecture, and operational debt.
audience: [maintainers, technical-leads, product-engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Technical debt report

## Purpose

Make known structural risks visible and sequence improvements without disguising recommendations as current behavior.

## Scope

Source size, coupling, API contracts, testing, data design, operations, and documentation. Priorities reflect impact and likelihood inferred from source.

## Critical

| Debt | Evidence | Risk | Recommended direction |
| --- | --- | --- | --- |
| Production dependency audit has a critical Auth.js finding | `npm run audit:public` on 2026-07-28 reported vulnerable transitive `@auth/core` through `@auth/prisma-adapter` | Malformed bearer handling, email normalization, and provider-cookie binding advisories affect an authentication boundary; application exploitability is not established by the audit alone | Review the advisories against used flows, upgrade adapter/core to a fixed compatible version, and run all auth/session/passkey/OAuth tests |

## High

| Debt | Evidence | Risk | Recommended direction |
| --- | --- | --- | --- |
| Very large page controllers | Transactions ~3,000 lines; credit transactions ~2,700; rewards ~2,200; settings ~1,600 | Changes have broad state/effect coupling and high regression cost | Extract domain hooks, query adapters, and focused view models incrementally |
| Oversized AI tool surface | `lib/ask-nest-tools.ts` is ~2,800 lines | Authorization/query changes are difficult to review and test locally | Split by read domain behind one registry |
| Incomplete OpenAPI schemas | Generated contract inventories methods/security/common responses but not all bodies | Clients and reviewers cannot rely on the artifact for full validation behavior | Derive OpenAPI from shared Zod schemas |
| No browser E2E | No browser runner/configuration in repository | Critical navigation/auth/client workflows lack realistic coverage | Add a narrow Playwright critical-path suite |
| Collaborators bundle exceeds its checked baseline | 2026-07-28 build measured 90,673 gzip bytes against a 63,058-byte ceiling | Slower download/parse and a failing optional performance gate | Profile imports, restore lazy boundaries, then re-run the budget check |
| Production audit has six high-severity findings | Audit reported affected `brace-expansion`, `immutable`, Next.js, and `sharp` packages | Potential denial of service, proxy/server-action/cache/SSRF/disclosure, and image-processing risks; reachability varies | Upgrade in reviewed groups, verify proxy/server actions/images/API docs, then rerun audit/build/security tests |

## Medium

| Debt | Evidence | Risk | Recommended direction |
| --- | --- | --- | --- |
| Route orchestration varies | Similar auth/workspace/error work is repeated across route files | Error envelopes or safeguards may drift | Expand shared route wrappers without hiding domain policy |
| Broad investment write payload | Batch accepts large position/history collections | Memory, validation, and transaction duration can spike | Introduce bounded chunking or explicit import job |
| SQL queue shares primary database | `BackgroundJob` and app records use one SQL store | Worker load can contend with user requests | Add metrics first; isolate only if measured |
| Legacy compatibility models/scripts remain | Legacy/import/reconciliation artifacts are retained | Domain language and ownership stay harder to understand | Define retirement criteria and archival migration |
| Bank balance semantics are non-obvious | Manual bank control value lives in `startingCents` | New code may double-count or mutate the wrong field | Encapsulate behind a named balance service/type |
| Missing observability contract | No structured tracing/metrics platform is evident | Cross-request and job diagnosis is slower | Add correlation, redaction, and service-level metrics |

## Low

| Debt | Evidence | Risk | Recommended direction |
| --- | --- | --- | --- |
| Component exception registry | Several controllers have temporary line ceilings | Exceptions can become permanent | Require ceilings to stay flat or decrease |
| No automated docs validation | `package.json` has no documentation check | Links and metadata can drift | Add the validation used for this knowledge base to CI |
| No release/version policy | No changelog or release automation | Operational history is harder to reconstruct | Record release and compatibility policy |

## Duplicated Logic

Likely repetition exists in route parsing, workspace resolution, and common response shaping. Exact semantic duplication requires targeted code review before consolidation; similarly shaped code may encode different permissions.

## Missing Abstractions

- Shared request schemas that feed both runtime parsing and OpenAPI.
- Smaller domain-specific Ask Nest tool registries.
- Explicit bank control-balance value object/service.
- Browser-test application fixtures.
- Structured telemetry interface with redaction.

## Migration Principles

- Add characterization tests before moving logic.
- Preserve route response shape and operation keys.
- Extract one domain boundary at a time.
- Do not combine financial behavior changes with mechanical movement.
- Keep old and new implementations comparable until confidence is established.

## Related Files

- [Refactoring opportunities](refactoring-opportunities.md)
- [Performance review](performance-review.md)
- [Testing strategy](../testing/strategy.md)
- [UI module](../modules/web-ui.md)
- [AI module](../modules/ai.md)

## Dependencies

- Current source measurements, test coverage, and architecture rules.

## Assumptions

- File size is a maintainability signal, not proof that behavior is incorrect.

## Known Limitations

- No production incident, latency, coverage, or ownership data was available.
- Dependency audit severity confirms affected installed versions, not whether every advisory is reachable in this application.

## Future Improvements

- Re-score quarterly using incident data, churn, coverage, and measured latency.
- Assign an owner and target milestone to accepted items.

## Last Updated

2026-07-28
