---
title: AI Coding Conventions
description: Deterministic implementation conventions for AI-generated Nest changes.
audience: [ai-assistants, engineers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# AI coding conventions

## Purpose

Constrain generated changes to established repository patterns.

## Scope

TypeScript, naming, routes, services, database, UI, errors, tests, and docs.

## Conventions

- Use strict TypeScript; avoid `any` unless the boundary is proven and documented.
- Use kebab-case files, PascalCase components/types/models, camelCase functions/values.
- Keep `route.ts` thin: parse → authenticate → authorize → delegate → sanitize.
- Put reusable business logic and provider clients in `lib/`.
- Validate external input before database/provider work.
- Pass workspace identity explicitly; never infer authorization from a resource ID alone.
- Use integer-cent names such as `amountCents`.
- Use Prisma transactions for atomic multi-row changes.
- Use stable operation keys for retryable mutations.
- Use React Query for shared server state and local state for transient UI only.
- Keep server-only modules out of `"use client"` dependency graphs.
- Reuse UI primitives and lower component exception ceilings after extraction.
- Add intent comments only for non-obvious invariants or trade-offs.
- Update OpenAPI, tests, docs, and migrations in the same change.

## Error Guidance

- `400`: invalid input/context.
- `401`: no valid authentication.
- `403`: authenticated but not authorized.
- `404`: absent or deliberately concealed resource.
- `409`: state/idempotency conflict.
- `429`: throttled.
- `5xx`: unexpected or dependency failure; do not leak internal details.

Follow existing route-family behavior when the current contract differs.

## Related Files

- [Development guide](../guides/development.md)
- [Common patterns](common-patterns.md)
- [Security notes](security-notes.md)

## Dependencies

- ESLint, TypeScript, Next.js, Prisma, Zod, and repository tests.

## Assumptions

- Existing local patterns are preferred unless they conflict with documented invariants.

## Known Limitations

- Automated formatting beyond ESLint is not configured.

## Future Improvements

- Add import-boundary and route-schema lint rules.

## Last Updated

2026-07-28
