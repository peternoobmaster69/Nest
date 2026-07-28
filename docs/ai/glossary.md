---
title: AI Glossary
description: Concise domain-to-code vocabulary for repository search and reasoning.
audience: [ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI glossary

## Purpose

Map business language to code/search concepts with minimal ambiguity.

## Scope

Frequently used terms. Use the business glossary for detailed definitions.

## Terms

| Term | Search/code meaning |
| --- | --- |
| Workspace | Tenant boundary; `Workspace`, `WorkspaceUser`, context helpers |
| Owner/editor/viewer | Ordered workspace authorization roles |
| Member | Legacy/compatibility role normalized to editor |
| Account | Workspace financial container; manual bank control may use `startingCents` |
| Envelope | Virtual budget allocation |
| Posting | Durable balance effect; `PostingGroup`, `PostingEntry` |
| Operation key | Idempotency identity |
| Reversal | New posting negating prior posting |
| Card statement | Card/month/year accounting boundary |
| Receivable close | Settlement that must not exceed outstanding |
| Alert | External evidence, not automatically trusted accounting truth |
| Reliable job | SQL-backed leased/retried task |
| Purpose token | Hashed token for one public projection |
| Recent auth | Fresh proof for sensitive actions |
| Grounded answer | AI response backed by authorized tool evidence |
| Smart Review | Bounded AI-assisted transaction review workflow |

## Related Files

- [Business glossary](../business/glossary.md)
- [Domain summary](business-domain.md)
- [Schema](../database/schema.md)

## Dependencies

- Current model and service names.

## Assumptions

- Exact code casing is shown where relevant.

## Known Limitations

- This intentionally omits rare provider and migration terms.

## Future Improvements

- Add aliases discovered in legacy imports.

## Last Updated

2026-07-28
