---
title: Receivables Module
description: Expected repayments, source references, summaries, status management, and atomic close settlement.
audience: [engineers, finance-domain-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Receivables

## Purpose

Track money expected from another party and convert it into traceable cash allocation when settlement actually arrives.

## Scope

Receivable CRUD, outstanding summaries, budget/source summaries, cross-workspace sources, card-created receivables, and Close posting.

## Responsibilities

- Create/edit/delete expected repayment records.
- Preserve title, notes, dates, family/user metadata, statement month, and optional destination/source.
- Sum OPEN/PARTIAL amounts.
- Show amount reserved against a source envelope.
- Close one receivable exactly once.
- Credit default destination and optionally debit a distinct source.
- Link settlement transactions to source receivable and posting group.

## Public APIs and important files

| File | Surface | Purpose |
| --- | --- | --- |
| `lib/domains/receivables/summary-service.ts` | `getReceivableSummary`, `getReceivableSourceSummary` | Aggregate outstanding values |
| `app/api/receivables/route.ts` | GET/POST | List/create |
| `app/api/receivables/[id]/route.ts` | PATCH/DELETE | Edit/delete |
| `app/api/receivables/[id]/close/route.ts` | POST | Full settlement posting |
| summary routes | GET | Workspace/budget/source views |
| `components/receivables-page.tsx` | page controller | UI workflows |

## Internal workflow

Close: load receivable → verify EDITOR → validate defaults and optional source workspace/account/envelope → conditional claim → one posting credits destination and optionally debits source → mark `PAID` → return linked result.

## Configuration

`Workspace.receivableDefaultAccountId` and `receivableDefaultBudgetId` must be an active parent/child pair.

## Error handling

- Missing defaults or invalid relationship blocks Close.
- Already-paid/concurrently claimed receivable conflicts.
- Cross-workspace source without membership is forbidden.
- Manual status edits do not simulate missing settlement rows.

## Performance considerations

- Status and source indexes support summaries.
- Summary queries aggregate rather than loading unbounded detail.

## Security considerations

- Cross-workspace source is validated independently from destination workspace.
- Notes can contain personal context.
- Close is money-changing and idempotent.

## Risks

- Setting `PAID` manually can omit cash postings.
- Current Close settles full amount, so partial receipt requires deliberate edit/split.
- Source aliases must not be forced into destination workspace foreign keys.

## Future extension points

- Explicit partial-payment child records.
- Settlement history and remaining-balance calculation.

## Related Files

- [Receivables API](../api/receivables.md)
- [BR-040–BR-045](../business/business-rules.md)
- [`tests/receivable-close-contract.test.mjs`](../../tests/receivable-close-contract.test.mjs)

## Dependencies

- Workspaces, ledger posting, account/envelope defaults.

## Assumptions

- One current Close represents full recorded amount.

## Known Limitations

- Status enum is stored as string and partially enforced by migrations.

## Future Improvements

- Introduce explicit payment model if partial settlement becomes common.

## Last Updated

2026-07-28
