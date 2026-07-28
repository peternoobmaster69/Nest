---
title: Investments and Rewards API
description: Endpoint contracts for investment snapshots, loyalty accounts, mileage history, card points, hotel points, and conversions.
audience: [engineers, API-consumers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Investments and rewards API

## Purpose

Document non-cash asset valuation and loyalty tracking endpoints.

## Scope

Reads require VIEWER; writes require EDITOR. Values are scoped to the active/header workspace except investment creation also carries explicit workspace ID.

## Investments

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/investments` | VIEWER | required `workspaceId` | `[{"id":"inv","entries":[...]}]` | Max 500 accounts × 5,000 entries; entries returned ascending |
| `POST /api/investments` | EDITOR | workspace, optional display≤160, institution/product 1–160, inception ISO, nullable divested, optional liquid | Account (201) | No automatic bank posting |
| `PATCH /api/investments/{id}` | EDITOR | Optional account fields | Updated account | Empty display becomes null |
| `DELETE /api/investments/{id}` | EDITOR | None | `{"ok":true}` | Cascades entries |
| `POST /api/investments/{id}/entries` | EDITOR | ISO date, integer invested/current cents | Entry (201) | Cumulative snapshot |
| `PATCH /api/investments/entries/{entryId}` | EDITOR | Optional date/invested/current cents | Updated entry | Parent workspace derived |
| `DELETE /api/investments/entries/{entryId}` | EDITOR | None | `{"ok":true}` | Can change latest displayed valuation |

## Reward aggregate and accounts

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/rewards` | VIEWER | Active workspace | Composite flyer/hotel/card/conversion data and summaries | Excludes expired mileage from active balance logic |
| `POST /api/rewards/frequent-flyer` | EDITOR | program/airline, optional account, current/target miles, warning 1–24, expiry policy, notes | Account (201) | Duplicate program 409 |
| `PATCH /api/rewards/frequent-flyer` | EDITOR | `id` plus optional create fields/active | Updated account | Workspace-scoped |
| `DELETE /api/rewards/frequent-flyer?id=...` | EDITOR | ID query | `{"success":true}` | Cascading/history implications |
| `POST /api/rewards/hotel-rewards` | EDITOR | program/brand, optional account, current/target points, nonnegative cents-per-point, notes | Account with numeric rate (201) | Duplicate program 409 |
| `PATCH /api/rewards/hotel-rewards` | EDITOR | `id` plus optional fields/active | Updated account | Decimal serialized as number |
| `DELETE /api/rewards/hotel-rewards?id=...` | EDITOR | ID query | `{"success":true}` | Workspace-scoped |
| `POST /api/rewards/credit-card` | EDITOR | card, current/nonnegative value points, initial conversion from/to and optional description | Reward (201) | Creates reward and conversion atomically |
| `PATCH /api/rewards/credit-card` | EDITOR | ID and optional current/value points | Updated reward | Updates `lastUpdated` |
| `DELETE /api/rewards/credit-card?id=...` | EDITOR | ID query | `{"success":true}` | One-to-one card reward |
| `POST /api/rewards/conversion` | EDITOR | reward ID, flyer ID, positive from/to, optional description | Conversion with numeric rate (201) | Both records same workspace |
| `PATCH /api/rewards/conversion` | EDITOR | ID, optional positive from/to, nullable description≤500 | Updated conversion | Recomputes rate |
| `DELETE /api/rewards/conversion?id=...` | EDITOR | ID query | `{"success":true}` | Workspace-scoped |

## Frequent-flyer history

| Operation | Auth | Request | Success example | Notes/errors |
| --- | --- | --- | --- | --- |
| `GET /api/rewards/frequent-flyer/history` | VIEWER | `frequentFlyerId`, cursor/list filters | Separate bounded earn/redeem envelopes | Opaque cursors |
| `POST` | EDITOR | `type:"earn"` with flyer/date/positive miles/title/expiry; or `type:"redeem"` with flyer/title/date/positive miles | Created history and updated balance | Redemption auto-allocates earliest expiry/date lots |
| `PATCH` | EDITOR | `type`, flyer, ID, and optional earn/redeem fields | Updated history | Reverses/reapplies balance effects |
| `DELETE` | EDITOR | Query `id`, `type`, `frequentFlyerId` | `{"success":true}` | Restores/removes lot allocations consistently |

## Examples

Investment snapshot:

```http
POST /api/investments/inv_1/entries
Content-Type: application/json

{"date":"2026-07-28T00:00:00.000Z","investedCents":1000000,"currentValueCents":1125000}
```

Mileage redemption:

```http
POST /api/rewards/frequent-flyer/history
Content-Type: application/json

{"type":"redeem","frequentFlyerId":"ff_1","redemptionTitle":"Flight","dateTime":"2026-07-28T00:00:00.000Z","milesToRedeem":25000}
```

Insufficient available miles fails without partial allocation.

## Related Files

- [`app/api/investments/route.ts`](../../app/api/investments/route.ts)
- [`app/api/rewards/frequent-flyer/history/route.ts`](../../app/api/rewards/frequent-flyer/history/route.ts)
- [Investments module](../modules/investments.md)
- [Rewards module](../modules/rewards.md)

## Dependencies

- Workspace auth, Prisma transactions, deterministic entry ordering.

## Assumptions

- Investment entries are cumulative and reward units are integers.

## Known Limitations

- Investment list can return a very large nested payload.
- Reward route schemas are not exported into OpenAPI.

## Future Improvements

- Add cursor/summary endpoints for investment history and unify reward CRUD paths.

## Last Updated

2026-07-28
