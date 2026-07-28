---
title: Developer Onboarding
description: A source-backed path from a clean checkout to a working understanding of Nest.
audience: [new-engineers, maintainers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Developer onboarding

## Purpose

Help a new contributor establish a safe local environment and learn the system in an order that minimizes financial-data and authorization mistakes.

## Scope

This guide covers repository orientation, local setup, first validation, and a recommended reading path. Production deployment is covered separately.

## Before You Start

- Install the Node.js version declared in `.nvmrc` (currently Node 22).
- Obtain a SQL Server or Azure SQL database appropriate for development.
- Obtain only the optional integration credentials needed for your work.
- Never use production financial records, OAuth tokens, passkeys, or secrets in a local environment.

Access provisioning, team ownership, and the expected onboarding completion time are **Unknown from source code.**

## Local Setup

```bash
nvm use
npm ci
cp .env.example .env
npm run prisma:generate
npm run dev
```

Configure `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and the WebAuthn relying-party values before testing authenticated flows. Optional integrations remain disabled when their required variables are empty.

For a new disposable database:

```bash
npm run db:bootstrap
npm run prisma:seed
```

`db:bootstrap` is intended for an empty database. Read [database operations](../database/operations.md) before using it against an existing database.

## First Validation

```bash
npm run check
npm run build
```

The complete pull-request gate also includes:

```bash
npm run audit:public
```

The public-readiness audit includes a production dependency audit and may require network access.

## Recommended Reading Order

1. [Project overview](../architecture/overview.md)
2. [Business glossary](../business/glossary.md)
3. [Business rules](../business/business-rules.md)
4. [System design](../architecture/system-design.md)
5. [Repository structure](../architecture/repository-structure.md)
6. [Security architecture](../architecture/security.md)
7. The [module](../modules/README.md) you will change
8. The corresponding [API](../api/README.md), [schema](../database/schema.md), and [tests](../testing/strategy.md)

## First Change Checklist

- Enter the application through `/w/{workspaceId}` and preserve the selected workspace.
- Reuse `requireUser`, `requireWorkspaceContext`, and role checks; do not implement a parallel authorization path.
- Represent money as integer cents.
- Use the posting service for balance-affecting workflows.
- Add or update tests before changing an established contract.
- Update the relevant knowledge-base pages and `last_updated`.

## Related Files

- [`package.json`](../../package.json)
- [`.env.example`](../../.env.example)
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
- [Development guide](development.md)
- [Testing guide](testing.md)

## Dependencies

- Node.js 22 or newer, npm, SQL Server/Azure SQL, and Git.

## Assumptions

- The developer has permission to create or use a non-production database.
- The local application runs at `http://localhost:3000` unless `.env` says otherwise.

## Known Limitations

- No containerized one-command local environment is present.
- Test OAuth, email, market-data, and AI credentials are not supplied by the repository.
- Team-specific access and support procedures are unknown from source code.

## Future Improvements

- Add a disposable local SQL Server compose profile.
- Add a setup verification script that reports missing required variables without printing secrets.

## Last Updated

2026-07-28
