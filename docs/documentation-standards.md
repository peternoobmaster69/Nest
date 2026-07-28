---
title: Documentation Standards
description: Required structure, evidence rules, naming, metadata, and review expectations for Nest documentation.
audience: [engineers, technical-writers, ai-assistants]
status: living
source_of_truth: true
last_updated: 2026-07-28
---

# Documentation standards

## Purpose

Keep documentation consistent, searchable, evidence-based, and maintainable over a long project lifetime.

## Scope

These rules apply to Markdown and Mermaid files under `docs/`.

## Required front matter

```yaml
---
title: Human-readable title
description: One-sentence page intent.
audience: [engineers, ai-assistants]
status: living
source_of_truth: false
last_updated: YYYY-MM-DD
---
```

Use `source_of_truth: true` only for a documentation policy or an explicit decision. Runtime behavior belongs to executable source.

## Required page sections

Every Markdown page includes:

1. `Purpose`
2. `Scope`
3. Topic-specific content
4. `Related Files`
5. `Dependencies`
6. `Assumptions`
7. `Known Limitations`
8. `Future Improvements`
9. `Last Updated`

Short index pages may keep these sections concise.

## Evidence rules

- Derive claims from code, tests, migrations, configuration, or an existing business guide.
- Link the exact source paths that maintainers should inspect.
- Write **“Unknown from source code.”** when ownership, rationale, operational policy, or external behavior cannot be established.
- Label recommendations and inferred risks; do not present them as shipped behavior.
- Use absolute dates for migrations and decisions where the date is known.

## Content rules

- Explain intent, invariants, side effects, failure modes, and change hazards.
- Do not explain syntax or restate every line.
- Keep one topic per file and prefer tables for inventories.
- Keep pages between roughly 50 and 800 lines.
- Use relative Markdown links.
- Put reusable Mermaid sources in `docs/diagrams/*.mmd`.
- Avoid duplicating API and schema definitions; summarize and point to executable sources.

## Naming

| Item | Convention | Example |
| --- | --- | --- |
| Documentation file | lower-case kebab case | `background-jobs.md` |
| ADR | `ADR-NNN-short-name.md` | `ADR-002-posting-ledger.md` |
| Mermaid source | lower-case kebab case | `posting-sequence.mmd` |
| Code symbol | exact source casing in backticks | `executePosting` |
| HTTP route | uppercase method plus literal path | `POST /api/transactions` |
| Database model | Prisma model casing | `PostingGroup` |

## Update triggers

Update the relevant pages when changing:

- An API route, method, request, response, status, or authorization guard.
- A Prisma model, raw SQL constraint, index, migration, or retention window.
- A financial posting or reconciliation rule.
- A scheduled job, integration, environment variable, or deployment prerequisite.
- An authentication, role, public-link, encryption, or rate-limit behavior.
- A release gate, testing contract, source layout, or large refactor boundary.

## Review checklist

- Claims are traceable to source.
- Unknowns are stated as unknowns.
- Security-sensitive examples contain no real secrets or personal data.
- Cross-links resolve.
- Mermaid blocks parse.
- The page avoids duplicating a canonical rule.
- `last_updated` is current.

## Related Files

- [Knowledge base entry point](README.md)
- [Table of contents](SUMMARY.md)
- [Collaboration guide](guides/collaboration.md)

## Dependencies

- Markdown, YAML front matter, and Mermaid-compatible tooling.

## Assumptions

- Reviewers can inspect repository-relative source paths.

## Known Limitations

- No documentation linter is currently declared in `package.json`.

## Future Improvements

- Add link, front-matter, spelling, and Mermaid validation to CI.

## Last Updated

2026-07-28
