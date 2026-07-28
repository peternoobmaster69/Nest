---
title: Frequently Asked Questions
description: Cross-domain answers to common maintainer and contributor questions.
audience: [engineers, operators, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Frequently asked questions

## Purpose

Answer common project questions and link to authoritative detail.

## Scope

Architecture, data, authentication, financial mutations, tests, deployment, AI, and documentation.

## Questions

### Where should I start?

Use [onboarding](guides/onboarding.md), then read the [business rules](business/business-rules.md) before changing a financial workflow.

### What is the canonical application URL?

Authenticated application workspaces use `/w/{workspaceId}`. The `X-Workspace-Id` header is the API context; cookie fallback exists for compatibility. See [ADR-001](architecture/adr/ADR-001-workspace-scoped-urls.md).

### How is money represented?

As integer cents. Do not introduce floating-point persistence or arithmetic for financial amounts.

### Can I update an account balance directly?

Balance-affecting workflows should use the posting service and stable operation keys. Manual bank control balances are a documented exception with special semantics. See [ledger](modules/ledger.md).

### How are mistakes corrected?

Reverse the original posting and create the corrected operation. Do not delete audit history.

### Is Ask Nest allowed to modify data?

No. Its tool surface is read-only and workspace-scoped. See [ADR-005](architecture/adr/ADR-005-read-only-ai.md).

### Are public endpoints unauthenticated?

Some are, but they require purpose-specific random tokens whose hashes are stored. They expose restricted projections and apply throttling.

### What command should pass before a pull request?

Run `npm run check`, `npm run build`, and `npm run audit:public`.

### Where is the complete API list?

See the [API route index](api/README.md) and generated [`openapi.json`](../generated/openapi.json).

### How do I change the database?

Follow [migration history and procedure](database/migrations.md). Never rewrite an applied migration.

### Is production topology documented?

Only the repository-backed deployment contract is known. Account, region, network, backup, rollback, and SLO details are unknown from source code.

### How should documentation be updated?

Follow [documentation standards](documentation-standards.md), update focused pages and cross-links, and state unknowns rather than guessing.

## Related Files

- [Documentation table of contents](SUMMARY.md)
- [AI FAQ](ai/faq.md)

## Dependencies

- Canonical pages linked in each answer.

## Assumptions

- Runtime source and tests override stale explanatory text.

## Known Limitations

- Team process questions not represented in the repository remain unknown.

## Future Improvements

- Add questions that recur in reviews and incidents.

## Last Updated

2026-07-28
