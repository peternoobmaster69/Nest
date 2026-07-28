---
title: AI Anti-Patterns
description: Code shapes that should not be introduced into Nest.
audience: [ai-assistants, engineers, reviewers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI anti-patterns

## Purpose

Provide explicit rejection criteria for generated or reviewed changes.

## Scope

Security, finance, architecture, UI, providers, testing, and maintenance.

## Do Not Introduce

- Floating-point financial storage or arithmetic.
- Private resource queries without workspace ownership.
- Role checks implemented only in the browser.
- Direct balance changes that bypass posting/audit rules.
- Destructive correction of posted financial history.
- A random idempotency key created separately for each retry.
- Unbounded user-controlled arrays, histories, file bodies, or provider pagination.
- Network requests inside a long database transaction.
- Raw OAuth tokens, session tokens, public tokens, imports, or AI context in logs.
- General-purpose public endpoints protected by obscurity.
- AI tools capable of writes or unrestricted database access.
- Duplicate validation schemas with silently different constraints.
- Route handlers that contain large domain workflows.
- Client components importing Prisma, environment secrets, or server SDKs.
- New large-component exceptions without a documented extraction plan.
- Tests that assert source text alone when runtime behavior can be tested reasonably.
- Editing applied migrations or deleting migration history.
- Documentation that guesses product policy or operational facts.

## Review Heuristic

If a shortcut removes an authorization, idempotency, audit, validation, or evidence boundary, reject it until an explicit architecture decision and migration plan exist.

## Related Files

- [Coding conventions](coding-conventions.md)
- [Security notes](security-notes.md)
- [Refactoring guide](refactoring-guide.md)

## Dependencies

- Business invariants and security architecture.

## Assumptions

- Exceptions require explicit review and documentation.

## Known Limitations

- Not every discouraged style choice is a security defect.

## Future Improvements

- Automate enforceable items with lint and architecture tests.

## Last Updated

2026-07-28
