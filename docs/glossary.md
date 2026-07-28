---
title: Project Glossary
description: Entry point for shared technical and business terminology used across Nest.
audience: [all-contributors, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Project glossary

## Purpose

Provide one discoverable entry point for terminology and direct readers to the canonical domain definitions.

## Scope

Business, accounting, security, integration, and architecture terms used in code and documentation.

## Canonical Glossaries

- [Business glossary](business/glossary.md): account, envelope, budget, posting, card statement, receivable, reward program, and workspace terms.
- [AI quick glossary](ai/glossary.md): concise code-search names and invariants for coding assistants.

## Technical Terms

| Term | Meaning in Nest |
| --- | --- |
| App Router | Next.js file-system routing under `app/` |
| Operation key | Stable identity used to make a mutation safe to retry |
| Posting group | Auditable unit containing balanced posting entries |
| Recent authentication | A fresh authentication proof required for sensitive account/workspace actions |
| Purpose token | Random public credential restricted to a single sharing workflow and stored as a hash |
| Lease | Time-bounded claim allowing one worker to process a background job |
| Control balance | Manual bank-account balance stored in `Account.startingCents` under the current model |
| Grounding | Restricting an AI answer to authorized data and evidence returned by read-only tools |

## Related Files

- [Business rules](business/business-rules.md)
- [Architecture overview](architecture/overview.md)

## Dependencies

- The canonical glossaries linked above.

## Assumptions

- Code symbols retain exact casing in module and API documentation.

## Known Limitations

- Regulatory and finance-team terminology ownership is unknown from source code.

## Future Improvements

- Add newly introduced terms in the same change that introduces the domain concept.

## Last Updated

2026-07-28
