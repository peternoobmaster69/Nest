---
title: AI Pitfalls
description: Non-obvious Nest behaviors that commonly make otherwise plausible changes incorrect.
audience: [ai-assistants, engineers, reviewers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI pitfalls

## Purpose

Warn code assistants about semantics that are easy to miss during localized edits.

## Scope

Workspace context, money, posting, sessions, jobs, integrations, AI, and UI.

## Pitfalls

| Pitfall | Why it breaks | Safe response |
| --- | --- | --- |
| Querying by resource ID only | IDs do not prove workspace authorization | Include workspace ownership and membership/role |
| Treating cookie workspace as canonical | Cookie is compatibility fallback | Preserve `/w/{workspaceId}` and header context |
| Treating `startingCents` as always immutable | Manual bank mode uses it as control balance | Read [ADR-006](../architecture/adr/ADR-006-bank-control-balances.md) |
| Updating balances outside postings | Loses atomic audit/idempotency | Use posting service |
| Generating a new key on retry | Duplicate financial action | Reuse caller-stable operation identity |
| Deleting a bad posting | Destroys audit trail | Reverse and repost |
| Treating envelopes as cash accounts | Double-counts allocation and cash | Preserve virtual allocation semantics |
| Holding DB transaction across provider call | Increases lock time/failure coupling | Fetch externally before/after a bounded transaction |
| Assuming a cron runs once | Schedulers retry/overlap | Make work leased, bounded, idempotent |
| Logging provider/import/AI payloads | May expose financial or credential data | Log identifiers/counts/categories only |
| Adding an AI mutation tool | Breaks read-only safety decision | Keep AI tools read-only |
| Importing server code into client component | Leaks/builds server dependencies | Add a browser-safe adapter |
| Raising UI line budget | Institutionalizes large controllers | Extract and lower the ceiling |
| Assuming OpenAPI is complete | Body schemas are partial | Inspect route validation and tests |

## Related Files

- [Business rules](business-rules.md)
- [Anti-patterns](anti-patterns.md)
- [Common bugs](common-bugs.md)

## Dependencies

- Current ADRs and domain behavior.

## Assumptions

- The pitfall list is reviewed whenever an architecture boundary changes.

## Known Limitations

- It cannot replace reading affected service and tests.

## Future Improvements

- Link each pitfall to a regression test.

## Last Updated

2026-07-28
