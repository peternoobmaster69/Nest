---
title: Business Glossary
description: Canonical meanings of finance and collaboration terms used by Nest.
audience: [engineers, product-reviewers, support, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Business glossary

## Purpose

Prevent ordinary finance terms from being interpreted differently than the product implementation.

## Scope

| Term | Nest meaning | Important distinction |
| --- | --- | --- |
| Bank account | Real cash control record at an institution | Balance is manually configured, not transaction-derived |
| Sub-account / envelope | Virtual purpose allocation under one bank account | Not a real bank account |
| Available | Current envelope allocation (`availableCents`) | May be negative |
| Allocated | Sum of active envelope available balances | Does not necessarily equal real bank cash |
| Unallocated | Bank control minus linked envelopes | A reconciliation signal |
| Target | Envelope goal/reference | Not an enforced spending limit |
| Transaction | Ledger movement affecting cash-flow and usually an envelope | Does not auto-update bank control |
| Credit / debit | Add to / subtract from an envelope | Card purchase sign semantics differ at payable layer |
| Transfer | Paired debit and credit between envelopes | Same-bank transfer is virtual reallocation |
| Posting group | Auditable business operation containing related ledger effects | Not a user-facing transaction group |
| Transaction group | User-created grouping inside one envelope | Deleting it does not delete transactions |
| Idempotency key | Client operation identity used for replay safety | Reuse with different body conflicts |
| Credit-card payable | Outstanding statement activity owed to issuer | Not yet a bank withdrawal |
| Accounted card transaction | Card transaction whose funding/recovery path was handled or explicitly acknowledged | Payable remains until payment |
| Card settlement | Envelope used to reserve/pay statement cash | Recommended as receivable default destination |
| Receivable | Expected repayment from another person/workspace | Not bank cash before settlement |
| Close receivable | Full settlement posting and PAID state | Not the same as manually changing status |
| Budget setup | Reusable source/item templates | Separate from a month |
| Monthly plan | Source and item rows for one month | Must balance and confirm once |
| Source | Expected funding in a monthly plan | May have a workspace-member owner |
| Budget item | Planned use of funds | May fund an envelope |
| Investment entry | Dated cumulative invested/current snapshot | Not an investment cash transaction |
| Liquid investment | Latest value counts toward public liquid amount | Liquidity is explicit metadata |
| Savings | Envelope with shield icon or recognized fallback naming | Still cash inside a parent bank account |
| Net worth | Nest's savings-plus-investments focused measure | Not a full balance sheet |
| Workspace | Tenant containing finance configuration and records | User may belong to several |
| OWNER / EDITOR / VIEWER | Ordered workspace roles | OWNER controls membership/sensitive actions |
| Ask Nest | Read-only grounded workspace finance assistant | Not an autonomous agent/adviser |
| Smart Review | Read-only card-accounting suggestion workflow | Existing route performs approved write |
| Background job | SQL-backed leased unit of long/provider work | Not an in-process promise |
| Public link | Revocable bearer-token projection | Anyone with token may view minimal response |

## Related Files

- [`guide.md`](../../guide.md)
- [Business rules](business-rules.md)
- [Global glossary](../glossary.md)

## Dependencies

- Current UI wording and model semantics.

## Assumptions

- “Account” without qualification is ambiguous; documentation should say bank account, provider account, investment account, or reward account.

## Known Limitations

- User-visible copy may use “sub-account” while the schema uses `BudgetEnvelope`/`budget`.

## Future Improvements

- Add glossary checks to UX copy review.

## Last Updated

2026-07-28
