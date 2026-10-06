---
title: Package Dependency Catalog
description: Purpose, boundary, and upgrade risk for every direct npm package.
audience: [engineers, maintainers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-10-07
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
| `htmlparser2` | Plain-text extraction from Gmail alerts and financial-source HTML | Hidden elements, malformed HTML, entity decoding, and financial amounts |
| `@react-pdf/renderer` | CIO strategy report PDFs | Server rendering, fonts, and layout |
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
| `@playwright/test` | Browser, mobile, and visual regression tests | Browser revisions and platform-specific snapshots |
| `@axe-core/playwright` | Browser accessibility checks | Rule changes and accessible interactions |
| `c8` | V8 coverage with all production sources included | Source maps and exact line/branch/function counts |

## Overrides

| Package | Pinned version | Intent |
| --- | --- | --- |
| `js-yaml` | `4.3.2` | Patched YAML parser |
| `postcss` | `8.5.23` | Patched CSS parser |
| `source-map-js` | `1.2.2` | Patched source-map implementation |
| `@prisma/config` → `deepmerge-ts` | `8.0.0` | Patched configuration merge dependency |
| `@next/eslint-plugin-next` → `fast-glob` | Alias to `tinyglobby@0.2.15` | Removes vulnerable `braces`; verifies Next's directory-glob behavior |
| `remarkable` → `argparse` | `2.0.1` | Removes vulnerable `sprintf-js`; retains Markdown CLI compatibility |
| `@simplewebauthn/server`, `sharp` | Same as direct dependency | Keep all consumers on the reviewed direct version |

`argparse` 2.0.1 has a bug in its deprecated `ArgumentParser({ version })` option, which Remarkable still uses: `--version` prints nothing. The postinstall script `scripts/patch-argparse-compatibility.mjs` corrects that single argument. It verifies SHA-256 hashes before and after the change, is idempotent, and refuses changed dependency code. Runtime tests cover stdin, file input, version output, rejected options, and patch integrity. Remove the patch when Remarkable adopts argparse's current API.

SonarScanner is installed independently of npm. CI uses the official Linux CLI archive pinned to version 8.1.0.6389 and verifies its SHA-256 checksum. This replaces `@sonar/scan`, whose dependency tree included vulnerable `node-forge`. Local scans require `sonar-scanner` on `PATH` or `SONAR_SCANNER_PATH` pointing to the official executable.

## Upgrade Protocol

1. Read the upstream migration/security notes.
2. Update lockfile through npm; do not hand-edit it.
3. Run focused contracts for the package boundary.
4. Run `npm run check`, `npm run build`, and `npm run audit:public`.
5. For auth/database/framework upgrades, test deployed-origin and SQL Server behavior.
6. Update documentation when configuration or behavior changes.

## Current Audit Status

On 2026-10-07, a clean install and `npm audit --audit-level=low` reported zero vulnerabilities, including development dependencies. The public-readiness audit and production-only audit also passed. These results concern the installed dependency tree; they do not establish that application security checks or the strict coverage gate pass.

The [security review](../reviews/security-review.md) retains the older findings and advisory themes as historical evidence.

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

- Transitive dependencies are not exhaustively cataloged; their current audit status is summarized above.
- Package choice rationale is unknown where no ADR or source boundary establishes it.

## Future Improvements

- Generate package/version/license/security metadata in CI.
- Record ADRs for high-impact authentication, database, and AI client changes.

## Last Updated

2026-10-07
