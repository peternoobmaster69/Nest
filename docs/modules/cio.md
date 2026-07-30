---
title: Nest CIO Module
description: Deterministic household allocation, liquidity, policy, data-quality, and retirement planning.
audience: [engineers, finance-domain-reviewers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-30
---

# Nest CIO

## Purpose

Provide a workspace-scoped planning balance sheet and investment-policy view without changing recorded balances, dashboard/public net worth, or granting trading authority.

## Responsibilities

- Build one canonical typed snapshot from bank control balances, latest investment valuations, and CIO-only planning metadata.
- Allocate exact cents through user-confirmed asset-class, geography, and optional security weights.
- Keep manual planning assets/liabilities separate from existing Nest net-worth semantics.
- Annualize external contributions, internal reallocations, and withdrawals without double counting.
- Calculate liquidity runway, completeness, staleness, concentration, policy exceptions, and bear/base/bull retirement projections deterministically.
- Supply the CIO page and bounded Ask Nest read tools.

## Important contracts

`buildCioSnapshot({ workspaceId, asOfDate })` is the authoritative composite read. Pure engines under `lib/domains/cio/` use integer cents, integer basis points, stable tie-breaking, and bounded horizons. Exposure replacement validates each configured dimension totals exactly 10,000 bps.

The legacy `InvestmentAccount.isLiquid` field is unchanged. When no CIO profile exists, the snapshot uses the documented legacy liquidity fallback and reports incomplete classification. Opinionated allocation bands and constraints remain nullable until a user confirms them.

The profile records whether the plan is `INDIVIDUAL` or `HOUSEHOLD`. An individual plan has no partner birth date; its included assets, positions, flows, and spending inputs are expected to represent that individual. The retirement timeline uses the primary person's age in both modes. Target retirement spending sets the projected retirement fund target. Essential monthly spending is separate and is used only for emergency-runway and liquidity-policy checks. An explicit zero is configured and disables those months-of-spending calculations; `null` means the assumption is missing.

## Projection mechanics

Contributions are applied at completed year ends. Fixed-point `BigInt` arithmetic rounds at explicit steps; the horizon is capped at 100 years. When a target date falls between anniversaries, the final return and inflation rates are prorated by the exact UTC-day fraction in basis points, and no full annual contribution is added for that partial period. Real values deflate nominal values by the configured inflation rate. Results echo the data date, final-period fraction, and every assumption. Missing or invalid target/rate inputs produce a precise `NOT_READY` response rather than fabricated defaults.

## Security and privacy

Reads require VIEWER and configuration writes require EDITOR in the active workspace. Referenced investments and accounts are revalidated in that workspace. CIO writes are planning metadata, not financial postings. No CIO tool can mutate state or execute a trade.

## Known limitations

- Monte Carlo simulation, taxes, live research, automatic classification, trade execution, and scheduled reports are deferred.
- Household mode does not calculate a separate partner retirement timeline or automatically assign workspace assets and flows to a person.
- Historical investment valuations can be selected by data date, but Nest has no historical bank-control series. A bank control updated after a requested historical date is excluded and reported as critical rather than backfilled.
- The appropriate stale-valuation interval and completeness weighting are product mechanics, not household policy; the MVP exposes its chosen values. Their long-term product governance is **Unknown from source code.**

## Related files

- [CIO API](../api/cio.md)
- [ADR-007](../architecture/adr/ADR-007-read-only-cio-decision-support.md)
- [Investments](investments.md)
