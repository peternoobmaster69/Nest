---
title: AI Assistant FAQ
description: Short deterministic answers for common code-assistant decisions.
audience: [ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI assistant FAQ

## Purpose

Answer high-frequency implementation questions with minimal context.

## Scope

Code navigation, authorization, finance, data, validation, and documentation.

## Questions

### Can I query a model by ID after `requireUser`?

Not safely. Also prove workspace ownership and the required role.

### Can I store dollars as a number?

Persist and calculate integer cents. Convert only at presentation/boundaries.

### Can a route write `Account.startingCents`?

Only when following the documented manual bank control-balance workflow. Otherwise use postings.

### Can I delete a transaction to undo it?

Use an auditable reversal/correction path.

### Should a provider call happen inside a Prisma transaction?

Generally no; it lengthens locks and couples atomic state to network failure.

### Can I add an Ask Nest write tool?

No under the current architecture decision.

### Is `generated/openapi.json` the whole contract?

No. Inspect route validators and tests for full body constraints.

### Should I raise a UI component line exception?

Prefer extraction. If temporarily unavoidable, document owner/reason and never raise it casually.

### What is the default validation gate?

`npm run check && npm run build`.

### What if product rationale is missing?

Write “Unknown from source code.” Do not invent it.

## Related Files

- [Project summary](project-summary.md)
- [Pitfalls](pitfalls.md)
- [Full FAQ](../faq.md)

## Dependencies

- Canonical pages linked above.

## Assumptions

- Questions concern the current architecture.

## Known Limitations

- Exact route signatures still require source inspection.

## Future Improvements

- Add reviewed answers for recurring assistant mistakes.

## Last Updated

2026-07-28
