---
title: "ADR-007: Read-Only CIO Decision Support"
description: Decision to make Nest CIO deterministic household planning support without trading or autonomous authority.
audience: [engineers, product-reviewers, security-reviewers, ai-assistants]
status: accepted
source_of_truth: true
last_updated: 2026-07-30
---

# ADR-007: Read-only CIO decision support

## Context

Households need allocation, liquidity, policy, and retirement views across recorded investments and explicit planning-only data. Model-generated arithmetic, inferred product classifications, and trade execution would weaken Nest's existing data and authorization boundaries.

## Decision

Nest CIO is read-only financial decision support. A deterministic service in `lib/domains/cio/` builds the authoritative workspace snapshot and projections from structured Nest records plus explicit user-confirmed planning metadata. The CIO page and Ask Nest consume that service; neither calculates authoritative balances independently.

CIO configuration writes assumptions and classifications only. It never posts money, changes an account balance, executes an order or transfer, or exposes a mutation tool to the model. Ask Nest may explain deterministic output and policy trade-offs, but cannot issue security-specific buy, sell, or hold instructions.

Planning net worth remains separate from BR-054 dashboard/public net worth. Internal reallocations are displayed but excluded from new household contributions. Unknown and stale data remain visible.

## Consequences

- Every CIO read is scoped to the active authenticated workspace; writes require EDITOR.
- Money and rates remain integer cents and basis points.
- Investment exposures are explicit weighted classifications, never name-derived facts.
- Assumptions, data dates, completeness warnings, and rounding rules are returned with results.
- A future scheduled report can reuse the snapshot, but scheduling is not part of this decision.

## Rejected alternatives

- Autonomous trading or rebalancing: outside Nest's authority and safety model.
- Model-only calculations: not deterministic or auditable enough for financial totals.
- Reusing planning positions in public/dashboard net worth: would change established BR-054 semantics.
- Automatic product-name classification: would present inference as confirmed household data.

## Known limitations

Nest CIO is not a regulated-advice implementation. Regulatory classification, suitability obligations, and jurisdiction-specific product policy are **Unknown from source code.**

## Related files

- [`lib/domains/cio/`](../../../lib/domains/cio/)
- [`lib/ai/tools/cio-tools.ts`](../../../lib/ai/tools/cio-tools.ts)
- [ADR-005](ADR-005-read-only-ai.md)
- [CIO module](../../modules/cio.md)

