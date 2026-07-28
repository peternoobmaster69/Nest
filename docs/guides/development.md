---
title: Development Guide
description: Local development workflows, configuration boundaries, and change-safety rules.
audience: [engineers, maintainers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Development guide

## Purpose

Describe how to develop Nest safely while preserving workspace isolation, accounting correctness, and generated contracts.

## Scope

Local application work, configuration, database changes, API changes, UI work, and generated artifacts.

## Daily Workflow

```bash
npm run dev
npm test
npm run lint
npm run typecheck
```

`predev` regenerates the Prisma client. Run focused Node tests directly while iterating:

```bash
node --import tsx --test tests/<name>.test.mjs
```

Before handing off a change, run `npm run check` and `npm run build`.

## Configuration

| Group | Required when | Examples |
| --- | --- | --- |
| Database | Any persistent workflow | `DATABASE_URL`, optional split Azure SQL fields |
| Application auth | Authenticated use | `NEXTAUTH_URL`, `NEXTAUTH_SECRET` |
| Passkeys | WebAuthn use | `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_NAME` |
| Gmail | Alert ingestion | Google OAuth pair, encryption key |
| Ask Nest | AI queries | AI endpoint, API key, model |
| Search grounding | Knowledge retrieval | Both feature gates plus Azure Search settings |
| Email/push | Reminder delivery | Azure email and/or VAPID configuration |
| Public providers | Net worth/card due enrichment | Massive and/or SerpApi keys |

See [integrations](../architecture/integrations.md) for failure and ownership boundaries. Never log variable values that contain credentials.

## API Changes

1. Add parsing and validation at the route boundary.
2. Authenticate the user or validate the purpose-scoped public/cron token.
3. Resolve workspace context and the minimum required role.
4. Delegate domain mutation to `lib/`, preferably within a database transaction.
5. Return a sanitized, stable response.
6. Update `lib/openapi.ts`, regenerate `generated/openapi.json`, and add contract tests.
7. Update the relevant API and module documentation.

Run:

```bash
npm run openapi:generate
npm run openapi:check
```

## Database Changes

- Change `prisma/schema.prisma`.
- Create an additive migration with `npm run prisma:migrate`.
- Add constraints or indexes when Prisma cannot express the invariant.
- Test both an empty database bootstrap and forward migration when the baseline is affected.
- Never edit an already-deployed migration to change production history.

See [migration operations](../database/migrations.md).

## Financial Changes

- Use integer cents at storage and service boundaries.
- Make retries idempotent through a stable operation key.
- Use reversal entries instead of deleting posted history.
- Lock or serialize contested balance transitions.
- Verify that every account, envelope, card, or receivable belongs to the active workspace.

See [business rules](../business/business-rules.md) and [ledger module](../modules/ledger.md).

## UI Changes

- Prefer server components until browser state or browser APIs are required.
- Use React Query for shared server state; avoid duplicating it in component-local state.
- Use shared shell, loading, dialog, and primitive components.
- Keep workspace URLs canonical.
- Treat the component-size exception file as a temporary budget, not a target.

Run `npm run ui:check`, `npm run test:ui`, and `npm run ui:metrics:check` for UI platform work.

## Generated and Policy Artifacts

| Artifact | Update command or rule |
| --- | --- |
| `generated/openapi.json` | `npm run openapi:generate` |
| Prisma client | `npm run prisma:generate` |
| App icons | `npm run icons:generate` |
| UI performance baseline | `npm run ui:metrics:baseline`; only after reviewing the regression |
| UI component exceptions | Edit only with an owner, reason, and non-increasing line ceiling |

## Related Files

- [`package.json`](../../package.json)
- [`.env.example`](../../.env.example)
- [`scripts/generate-openapi.mjs`](../../scripts/generate-openapi.mjs)
- [`prisma/schema.prisma`](../../prisma/schema.prisma)
- [Coding conventions for AI](../ai/coding-conventions.md)

## Dependencies

- The local setup described in [onboarding](onboarding.md).

## Assumptions

- Feature changes preserve the existing security model unless an explicit ADR changes it.

## Known Limitations

- There is no repository-wide automatic documentation generator.
- The OpenAPI artifact does not currently describe every request and response schema.

## Future Improvements

- Add route-schema generation from shared Zod contracts.
- Add a local integration test profile with disposable provider stubs.

## Last Updated

2026-07-28
