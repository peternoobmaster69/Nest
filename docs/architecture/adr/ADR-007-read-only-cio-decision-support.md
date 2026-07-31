---
title: "ADR-007: Read-Only CIO Decision Support"
description: Decision to make Nest CIO deterministic household planning support without trading or autonomous authority.
audience: [engineers, product-reviewers, security-reviewers, ai-assistants]
status: accepted
source_of_truth: true
last_updated: 2026-07-31
---

# ADR-007: Read-only CIO decision support

## Context

Households need allocation, liquidity, policy, and retirement views across recorded investments and explicit planning-only data. Model-generated arithmetic, inferred product classifications, and trade execution would weaken Nest's existing data and authorization boundaries.

## Decision

Nest CIO is read-only financial decision support. A deterministic service in `lib/domains/cio/` builds the authoritative workspace snapshot and projections from structured Nest records plus explicit user-confirmed planning metadata. The CIO page and Ask Nest consume that service; neither calculates authoritative balances independently.

CIO writes are limited to assumptions, classifications, confirmed policy, and immutable report snapshots. They never post money, change an account balance, execute an order or transfer, or expose a mutation tool to the model. Ask Nest may explain and sequence recommendations produced by the strategy engine and discuss qualitative trade-offs. It cannot invent numerical targets or issue security-specific buy, sell, or hold instructions; values supplied in the question remain labelled user assumptions rather than Nest calculations.

Household strategy recommendations are read-only outputs. They may prioritize liquidity, contribution levels, allocation bands, future contribution direction, concentration controls, and retirement timing. They favor contribution-led changes and require user confirmation. Tax, legal, lending, insurance-product, mortgage-product, and individual-security recommendations remain outside this boundary.

Planning net worth remains separate from BR-054 dashboard/public net worth. Its cash component is the sum of active sub-accounts explicitly marked `isSavings`; spending sub-accounts are excluded, while bank controls remain available to liquidity checks. Internal reallocations are displayed but excluded from new household contributions. Unknown and stale data remain visible.

## Consequences

- Every CIO read is scoped to the active authenticated workspace; writes require EDITOR.
- Money and rates remain integer cents and basis points.
- Investment exposures are explicit weighted classifications, never name-derived facts.
- Assumptions, data dates, completeness warnings, and rounding rules are returned with results.
- Generated strategy reports store a versioned, immutable structured snapshot; the PDF is rendered from that snapshot rather than recalculating current values.
- Report generation requires EDITOR, while viewing and downloading require VIEWER.
- Scheduled report generation remains deferred.

## Rejected alternatives

- Autonomous trading or rebalancing: outside Nest's authority and safety model.
- Model-only calculations: not deterministic or auditable enough for financial totals.
- Reusing planning positions in public/dashboard net worth: would change established BR-054 semantics.
- Automatic product-name classification: would present inference as confirmed household data.
- Free-form model recommendations: would bypass policy, data-quality, and grounding controls.

## Known limitations

Nest CIO is not a regulated-advice implementation. Regulatory classification, suitability obligations, and jurisdiction-specific product policy are **Unknown from source code.**

## Related files

- [`lib/domains/cio/`](../../../lib/domains/cio/)
- [`lib/ai/tools/cio-tools.ts`](../../../lib/ai/tools/cio-tools.ts)
- [ADR-005](ADR-005-read-only-ai.md)
- [CIO module](../../modules/cio.md)
