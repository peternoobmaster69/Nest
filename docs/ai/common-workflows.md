---
title: AI Common Workflows
description: Compact change and runtime workflows for frequent Nest tasks.
audience: [ai-assistants, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI common workflows

## Purpose

Provide deterministic sequences for common implementation and runtime operations.

## Scope

API features, financial mutations, database changes, UI changes, jobs, and incident diagnosis.

## Add an Authenticated API

```text
schema/input cap → require user → resolve workspace → require role
→ call domain service → sanitize response → OpenAPI → tests → docs
```

## Add a Financial Mutation

```text
validate cents/ownership → derive stable operation key
→ transactional posting service → balanced entries → audit response
→ retry/concurrency/reversal tests
```

## Add a Background Task

```text
enqueue deterministic job identity → claim lease → bounded work
→ record result → retry with backoff or dead-letter → expose metrics
```

## Add a Database Field

```text
schema → additive migration → backfill/constraint plan
→ empty bootstrap + forward deploy test → service/API/docs update
```

## Refactor a Large UI Page

```text
characterization test → extract pure calculation → extract hook/view
→ run UI and bundle checks → lower exception ceiling
```

## Diagnose a Production-Like Failure

```text
status category → request/workspace/operation ID → configuration presence
→ read-only DB/job state → provider category → focused test → full gate
```

## Related Files

- [Business workflows](../business/workflows.md)
- [Development](../guides/development.md)
- [Refactoring guide](refactoring-guide.md)

## Dependencies

- Established helpers, tests, and documentation update rules.

## Assumptions

- Each workflow is adapted to the affected route/module contract.

## Known Limitations

- Provider-specific operational steps are summarized elsewhere.

## Future Improvements

- Add automated scaffolds for route/schema/test documentation sets.

## Last Updated

2026-07-28
