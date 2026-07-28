---
title: Rewards Module
description: Frequent-flyer miles, expiry lots, redemptions, hotel points, card rewards, and point conversions.
audience: [engineers, domain-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Rewards

## Purpose

Track loyalty balances, expiry, valuation, earning/redemption history, and conversions independently from cash ledger balances.

## Scope

Frequent-flyer, mileage history, hotel rewards, credit-card points, and conversions.

## Responsibilities

- CRUD reward account metadata and current/target values.
- Track mile earn lots with balance/expiry.
- Allocate redemption across mileage lots.
- Maintain account current miles consistently.
- Store hotel cents-per-point valuation.
- Convert card points to miles with decimal rate.
- Provide bounded cursor history.

## Public APIs and important files

| File | Surface |
| --- | --- |
| `lib/domains/rewards/history-service.ts` | bounded frequent-flyer history |
| `app/api/rewards/route.ts` | aggregate read |
| frequent-flyer/history routes | account and earn/redeem CRUD |
| hotel/card/conversion routes | reward CRUD |
| `components/rewards-page.tsx` | page orchestration |
| `components/rewards/rewards-overview.tsx` | extracted overview view |

## Internal workflow

Earn creates/updates a `MileProgram` lot and current account miles. Redeem creates header/details, decrements lot balances, and reduces account miles. Edits/deletes reverse old effects then apply new values within transaction logic.

## Configuration

Per-account expiry warning, never-expire flag, and validity years. No provider integration is configured.

## Error handling

- Invalid/insufficient mileage allocation rejects request.
- Missing/mismatched workspace records reject without partial update.
- Pagination cursor is bounded and validated.

## Performance considerations

- History uses cursor pagination and separate bounded collection envelopes.
- Large lot histories may increase redemption allocation cost.

## Security considerations

- Account numbers and balances are private workspace data.
- All writes require EDITOR.

## Risks

- Updating current total without matching lot history creates drift.
- Floating-point conversion can lose precision; use Prisma Decimal.
- Large page controller increases regression risk.

## Future extension points

- Automated provider import with encrypted credentials and reconciliation.
- Explicit reward-balance reconciliation report.

## Related Files

- [Assets/rewards API](../api/assets-rewards.md)
- [BR-055–BR-056](../business/business-rules.md)
- [Database schema](../database/schema.md)

## Dependencies

- Workspace auth, Prisma transactions, presentation.

## Assumptions

- Points/miles are integer units.

## Known Limitations

- No external loyalty-provider synchronization.

## Future Improvements

- Extract mutation services from route files and split the large controller.

## Last Updated

2026-07-28
