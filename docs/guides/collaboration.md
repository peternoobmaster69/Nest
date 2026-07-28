---
title: Git, Review, and Release Guide
description: Repository collaboration, review, ownership, and release conventions.
audience: [contributors, reviewers, maintainers]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Git, review, and release guide

## Purpose

Keep changes focused, auditable, and safe to integrate.

## Scope

Branches, commits, pull requests, code review, documentation review, and release evidence.

## Git Workflow

- Create a focused branch from the current integration branch.
- Keep commits coherent and avoid mixing unrelated formatting or cleanup.
- Do not rewrite another contributor's uncommitted work.
- Include migrations and generated OpenAPI changes with the source change that requires them.
- Use a draft pull request while behavior or migration design is still changing.

The required branch naming convention and merge strategy are **Unknown from source code.**

## Pull Request Content

The repository template asks for:

- What changed and why.
- User and business impact.
- Validation performed.
- Security/privacy impact.
- Database migration and rollback considerations.
- Screenshots for relevant UI changes without personal data.

## Review Checklist

### Correctness

- The change handles edge cases and failure paths.
- Business rules are preserved or intentionally revised.
- Tests prove meaningful behavior.

### Security

- Workspace scope and minimum role are enforced.
- Tokens, secrets, and sensitive payloads are not logged or returned.
- Input limits and same-origin protections remain intact.
- Public routes use purpose-scoped hashed tokens.

### Financial integrity

- Money uses integer cents.
- Balance changes go through posting primitives.
- Retries are idempotent.
- Corrections use reversals and remain auditable.

### Operations

- Migrations are forward-safe.
- Background work is retry-safe and bounded.
- New environment variables are documented in `.env.example`.
- Provider timeouts, quotas, and degraded behavior are understood.

### Maintainability

- Names communicate domain intent.
- Large controller growth is avoided.
- Documentation and OpenAPI are updated.
- New decisions are captured in an ADR when they change a long-lived boundary.

## Coding Standards

- TypeScript strictness is defined by `tsconfig.json`.
- ESLint is the automated style gate.
- File names use kebab case; React components and types use PascalCase; functions and values use camelCase.
- Prisma models use singular PascalCase.
- API routes follow Next.js App Router `route.ts` conventions.
- Domain helpers belong in `lib/`; route handlers should orchestrate, not own complex business logic.

## Ownership

`.github/CODEOWNERS` defines the enforceable path ownership present in the repository. Informal component and domain owners beyond that file are **Unknown from source code.**

## Release Process

CI runs validation, build, public-readiness audit, SQL Server baseline checks, secret scanning, dependency review, and CodeQL. Versioning, changelog, approval stages, and release cadence are **Unknown from source code.**

## Related Files

- [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
- [Pull request template](../../.github/pull_request_template.md)
- [CI workflow](../../.github/workflows/ci.yml)
- [Code owners](../../.github/CODEOWNERS)
- [Documentation standards](../documentation-standards.md)

## Dependencies

- GitHub Actions and repository branch-protection settings.

## Assumptions

- Pull requests are the normal integration path.

## Known Limitations

- Branch protection and required-review settings are not encoded in this repository.
- No changelog or semantic-release configuration exists.

## Future Improvements

- Record the merge, versioning, rollback, and release-approval policies.
- Add documentation validation to CI.

## Last Updated

2026-07-28
