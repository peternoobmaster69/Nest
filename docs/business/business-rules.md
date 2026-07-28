---
title: Business Rules
description: Stable financial, workspace, card, receivable, investment, reward, and AI invariants derived from source.
audience: [engineers, product-reviewers, testers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Business rules

## Purpose

Give every important rule a stable identifier that can be traced to routes, services, database models, tests, and documentation.

## Scope

Rules are derived from `guide.md`, source, migrations, and tests. Regulatory requirements are **Unknown from source code.**

## Identity and workspace

| ID | Rule | Why | Primary evidence |
| --- | --- | --- | --- |
| BR-001 | Every private finance operation belongs to an authenticated workspace context. | Prevent cross-household disclosure or mutation. | `lib/workspace-auth.ts` |
| BR-002 | Role order is OWNER > EDITOR > VIEWER; legacy MEMBER behaves as EDITOR. | Preserve historical write access while making new read-only membership explicit. | `lib/workspace-roles.ts` |
| BR-003 | Reads require VIEWER; ordinary finance writes require EDITOR; membership/sensitive settings require OWNER and sometimes recent auth. | Least privilege. | Phase 2 contract tests |
| BR-004 | `/w/{workspaceId}` is the canonical tab-local workspace; cookie/profile are fallback preferences. | Multiple tabs must not switch one another. | workspace entry tests |
| BR-005 | Invitations use expiring, one-time hashed tokens and explicit accept/decline/revocation. | Avoid implicit membership and token recovery from DB. | collaboration routes/migration |
| BR-006 | At most five `ACTIVE` login sessions are admitted; excess sign-ins are short-lived `PENDING`. | Bounded user-visible device access. | `lib/session-policy.ts`, auth routes |

## Money representation and reconciliation

| ID | Rule | Why | Primary evidence |
| --- | --- | --- | --- |
| BR-010 | Money is stored as integer cents; never use floating point for balances/postings. | Exact arithmetic. | Prisma `*Cents`, tests |
| BR-011 | Workspace base currency controls display; Nest does not automatically convert finance views. | Avoid implicit/stale exchange assumptions. | `lib/currency.ts`, `guide.md` |
| BR-012 | `FinancialAccount.startingCents` is the current manually maintained real-bank control total. | Real settlement is distinct from virtual allocation. | `guide.md`, bank consistency |
| BR-013 | A budget envelope is a virtual purpose allocation and may go negative. | Show underfunding rather than hiding it. | `BudgetEnvelope.availableCents` |
| BR-014 | `unallocated = configured bank balance - sum(active linked envelope balances)`. | Detect stale or over/under allocation. | `lib/bank-consistency.ts` |
| BR-015 | A transaction changes envelope balance/cash-flow reporting but does not automatically update the real-bank control total. | Preserve real-versus-virtual separation. | `guide.md` |
| BR-016 | A transfer creates equal debit/credit effects; same-bank transfer only reallocates virtual cash. | Preserve total allocation. | transfer route |
| BR-017 | Every money-changing request is atomic, workspace-scoped, idempotent, and auditable. | Prevent partial/duplicate finance state. | posting service |
| BR-018 | Posted financial history is reversed/voided, not destructively deleted. | Preserve trace and reconciliation. | transaction delete route |
| BR-019 | Normal transaction views hide voided originals and reversal rows; reconciliation includes them. | Keep user lists readable while preserving accounting truth. | visibility contract tests |

## Monthly budget plan

| ID | Rule | Why | Primary evidence |
| --- | --- | --- | --- |
| BR-020 | Templates and a monthly plan are separate. | Reuse setup while allowing month-specific adjustments. | budget-plan domain |
| BR-021 | A plan can start blank or copy active monthly templates. | Support regular and exceptional months. | monthly draft service |
| BR-022 | Confirmation requires at least one source and one item and equal aggregate totals. | A valid plan explains all expected funds. | monthly budget tests |
| BR-023 | Confirmation makes the plan read-only and applies only remaining item cents once. | Avoid duplicate funding. | confirm service, `appliedCents` |
| BR-024 | Items without a destination stay in the plan but do not change an envelope. | Planning can include unallocated categories. | confirm service |
| BR-025 | Plan confirmation allocates virtual money; user updates bank control when income arrives. | Avoid creating fictional cash. | `guide.md` |

## Cards and payables

| ID | Rule | Why | Primary evidence |
| --- | --- | --- | --- |
| BR-030 | A card transaction increases/decreases a statement payable without changing bank control balance. | Liability precedes bank settlement. | card models/guide |
| BR-031 | Statement month/year and due date drive outstanding totals and reminders. | Align activity to payable obligation. | statement cycle/reminder code |
| BR-032 | Payment is an offsetting negative card transaction and cannot exceed outstanding statement amount. | Reduce the selected payable without overpayment. | payment route |
| BR-033 | Personal card accounting debits a source envelope and can credit a settlement destination. | Reserve payment cash while preserving allocation total. | accounting route |
| BR-034 | Reimbursable card accounting creates a receivable; payable remains visible. | Show liability and expected recovery simultaneously. | auto-accounting/route |
| BR-035 | “Mark accounted” without posting is allowed only for already-handled activity. | Compatibility escape hatch with acknowledged visibility risk. | UI/guide |
| BR-036 | Reminder schedule is 5, 3, and 1 days before due, due day, and every overdue day while outstanding. | Escalating payment awareness. | reminder schedule tests |
| BR-037 | Card storage contains metadata and last four only; no PAN/CVV/cardholder fields. | Data minimization. | schema/security migrations |

## Receivables

| ID | Rule | Why | Primary evidence |
| --- | --- | --- | --- |
| BR-040 | OPEN and PARTIAL receivables remain outstanding assets but are not bank cash. | Separate expected recovery from settled money. | receivable summaries |
| BR-041 | Close claims one receivable, marks it paid, credits default destination, and may debit a distinct source. | Represent actual settlement atomically. | close route/posting |
| BR-042 | Manual status `PAID` is not equivalent to Close because it may not create ledger cash movement. | Avoid silent missing postings. | `guide.md` |
| BR-043 | Current Close settles the full recorded amount; partial receipt must be edited/split first. | Ensure posting equals real receipt. | close implementation/guide |
| BR-044 | Cross-workspace source account and envelope are permitted only after source membership and parent validation. | Support shared reimbursements without cross-tenant corruption. | receivable routes/tests |
| BR-045 | Workspace receivable default account/envelope must be active and belong together. | Settlement destination must be valid and reconcilable. | context/settings routes |

## Investments, savings, and rewards

| ID | Rule | Why | Primary evidence |
| --- | --- | --- | --- |
| BR-050 | Investment entries are cumulative dated snapshots of invested and current value. | Model valuation rather than transaction history. | investment models |
| BR-051 | Latest investment entry sorts by date, then creation time, then ID. | Deterministic same-day valuation. | investment order tests |
| BR-052 | Investment entries do not move bank/envelope balances automatically. | Contributions/withdrawals require explicit cash-side recording. | `guide.md` |
| BR-053 | Liquid net-worth value includes savings plus latest values of investments marked liquid. | Distinguish accessible from total value. | net-worth service |
| BR-054 | Dashboard/public net worth is savings envelopes plus latest investments, not a full balance sheet. | Avoid false claims and double-counting. | `guide.md`, net-worth service |
| BR-055 | Mileage earn/redemption updates account and lot balances consistently. | Keep current total and expiry lots aligned. | rewards history route |
| BR-056 | Conversion rates use decimal precision; points/miles are integer units. | Avoid precision loss. | Prisma schema |

## AI, integrations, and operations

| ID | Rule | Why | Primary evidence |
| --- | --- | --- | --- |
| BR-060 | Ask Nest finance tools are read-only, bounded, user/workspace-scoped, and evidence-producing. | AI cannot alter money or cross tenant boundaries. | Ask Nest contracts |
| BR-061 | Structured SQL data is authoritative for totals; optional search is for notes/documents only. | Prevent retrieval text from becoming finance truth. | knowledge search gate |
| BR-062 | User memory must be explicit, reviewable, safe, scoped, and never a financial source. | Preserve user control and prevent stale facts driving totals. | memory code/tests |
| BR-063 | Smart Review suggestions are read-only until an existing accounting route validates fresh fingerprint/action. | Prevent stale model output from mutating data. | Smart Review tests |
| BR-064 | Public news search receives public market terms only, never private finance identifiers/values. | Prevent provider leakage. | SerpApi contracts |
| BR-065 | Gmail full bodies are fetched only for supported alert subjects; failed samples are bounded, encrypted, owner-only, and short-lived. | Minimize mailbox exposure. | Gmail/alert code |
| BR-066 | Long/provider work runs as durable leased jobs with bounded retries and dead-letter state. | Survive serverless termination and overlap. | background job contracts |
| BR-067 | Cron routes fail closed without a matching secret. | Prevent forged scheduler work. | cron guard tests |
| BR-068 | Service worker caches static assets only and never queues finance mutations. | Avoid cross-user/offline replay. | service-worker contract |

## Related Files

- [`guide.md`](../../guide.md)
- [Business workflows](workflows.md)
- [Traceability matrix](traceability.md)
- [Database schema](../database/schema.md)

## Dependencies

- Current route/service implementation and tests.

## Assumptions

- Rules without external product requirement IDs are still current because code and tests enforce them.

## Known Limitations

- Tax, consumer-finance, privacy, accounting, and jurisdictional requirements are unknown from source code.
- Some product escape hatches, such as mark-accounted without posting, require user judgment.

## Future Improvements

- Attach external product/regulatory requirement IDs.
- Add rule IDs to test names and financial service comments.

## Last Updated

2026-07-28
