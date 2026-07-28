---
title: Package Dependency Catalog
description: Purpose, boundary, and upgrade risk for every direct npm package.
audience: [engineers, maintainers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Package dependency catalog

## Purpose

Explain why each direct package exists and what to verify when modifying or upgrading it.

## Scope

Direct `dependencies`, `devDependencies`, and security overrides from `package.json`. Transitive packages are owned through the lockfile and audits.

## Runtime Dependencies

| Package | Purpose | Upgrade/change risk |
| --- | --- | --- |
| `next` | App Router, server rendering, route handlers, build | Routing, caching, proxy, server/client boundaries |
| `react`, `react-dom` | Component and hydration runtime | Concurrent rendering, effects, hydration |
| `next-auth` | OAuth/session framework | Cookie/JWT/callback/account-linking behavior |
| `@auth/prisma-adapter` | NextAuth persistence mapping | Auth schema compatibility |
| `@simplewebauthn/browser` | Browser passkey ceremony | Browser credential shapes |
| `@simplewebauthn/server` | Server passkey verification | Origin/RP/counter validation |
| `@prisma/client` | Typed database access | Generated API/query behavior |
| `prisma` | Schema client generation/migrations | SQL Server DDL/migration workflow |
| `@tanstack/react-query` | Browser server-state cache | Query-key invalidation and hydration |
| `zod` | Runtime request/config validation | Coercion/refinement/error shape |
| `openai` | Ask Nest model client | Request/stream/tool-call contract |
| `@azure/search-documents` | Azure AI Search client | Query/result/auth contract |
| `@azure/identity` | Managed identity for Azure Search | Credential chain/deployment identity |
| `@azure/core-auth` | Azure credential types/support | Compatibility with Azure clients |
| `@azure/communication-email` | Reminder/invite email delivery | Provider request/status behavior |
| `web-push` | VAPID push delivery | Subscription and encryption behavior |
| `swagger-ui-react` | Interactive API documentation | Client bundle and production exposure |
| `lucide-react` | UI icons | Bundle/import pattern |
| `@vercel/analytics` | Hosting analytics | Privacy and client instrumentation |
| `@vercel/speed-insights` | Web performance telemetry | Privacy and client instrumentation |

## Development Dependencies

| Package | Purpose | Upgrade/change risk |
| --- | --- | --- |
| `typescript` | Type system and compiler | New strictness/inference errors |
| `tsx` | TypeScript execution for scripts/tests | Node loader behavior |
| `eslint` | Static analysis engine | Rule/config compatibility |
| `eslint-config-next` | Next/React lint policy | Framework-specific rule changes |
| `tailwindcss` | Utility CSS engine | Class scanning/theme output |
| `@tailwindcss/postcss` | Tailwind v4 PostCSS integration | CSS build pipeline |
| `sharp` | Image/icon generation/optimization | Native binary and output differences |
| `@types/node` | Node typings | Runtime/type version mismatch |
| `@types/react`, `@types/react-dom` | React typings | JSX/component API type drift |
| `@types/web-push` | Push library typings | Type/runtime mismatch |

## Overrides

| Package | Pinned version | Intent |
| --- | --- | --- |
| `js-yaml` | `4.3.0` | Security/compatibility override; exact originating advisory is unknown from source code |
| `postcss` | `8.5.20` | Security/compatibility override; exact originating advisory is unknown from source code |

## Upgrade Protocol

1. Read the upstream migration/security notes.
2. Update lockfile through npm; do not hand-edit it.
3. Run focused contracts for the package boundary.
4. Run `npm run check`, `npm run build`, and `npm run audit:public`.
5. For auth/database/framework upgrades, test deployed-origin and SQL Server behavior.
6. Update documentation when configuration or behavior changes.

## Current Audit Status

On 2026-07-28, the public-readiness repository scan passed, but `npm audit --omit=dev --audit-level=high` reported 7 production advisories:

- Critical: transitive `@auth/core` through `@auth/prisma-adapter`.
- High: `brace-expansion`, `immutable`, `next`, and `sharp`.

See the [security review](../reviews/security-review.md) for advisory themes and response priority. The dependency tree needs a reviewed upgrade; the repository should not be described as audit-clean.

## External Systems Without Direct Dedicated Package

- Gmail uses HTTP/provider helpers plus OAuth configuration.
- Massive and SerpApi use HTTP clients.
- Vercel cron is configured in `vercel.json`.
- Azure SQL is reached through Prisma's SQL Server provider.

## Related Files

- [`package.json`](../../package.json)
- [`package-lock.json`](../../package-lock.json)
- [Integrations](../architecture/integrations.md)
- [Security review](../reviews/security-review.md)

## Dependencies

- npm registry metadata, lockfile, and automated vulnerability scans.

## Assumptions

- `package.json` contains every intentionally direct runtime/build dependency.

## Known Limitations

- Transitive dependencies are not exhaustively cataloged; the current high/critical audit status is summarized above.
- Package choice rationale is unknown where no ADR or source boundary establishes it.

## Future Improvements

- Generate package/version/license/security metadata in CI.
- Record ADRs for high-impact authentication, database, and AI client changes.

## Last Updated

2026-07-28
