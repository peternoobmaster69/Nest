# Nest codebase audit and improvement plan

Last updated: 2026-07-14

## Purpose

This document is the implementation roadmap for improving Nest's security, financial correctness, backend reliability, UI/UX, accessibility, performance, testing, and operations. It is based on a repository-wide review of the current Next.js application, all 71 API route files (113 HTTP handlers), the 948-line Prisma schema and 18 migrations, 52 UI component files, the 15,161-line global stylesheet, background jobs, integrations, scripts, tests, and deployment configuration.

The order is deliberate: contain security and double-posting risks before expanding the product or performing a broad visual redesign.

## Audit confidence and constraints

- Source review, lint, unit/contract tests, a production Next.js build, dependency audit, and Prisma migration-status attempt were performed.
- `npm run lint` and the TypeScript check pass.
- `npx next build` passes on Next.js 16.2.10 and produces 80 routes. The normal `npm run build` wrapper is blocked locally by a Windows lock on the already-generated Prisma engine DLL; no user-owned process was stopped.
- The current test baseline is 38/38 passing, including the focused Phase 0 containment suite and UI contracts.
- `npm audit --omit=dev` reports 0 high/critical and 4 moderate production findings. The residual Next.js/PostCSS and NextAuth/UUID chains are documented in `docs/phase-0-security-containment.md`; npm currently proposes unsupported or regressive major downgrades rather than compatible fixes.
- Live database verification is blocked because the configured Azure SQL database is paused after exhausting its July 2026 free allowance. The attempted connection also reported certificate validation being bypassed, which must be corrected for production.
- No interactive browser was available, so responsive layout, contrast, screen-reader behavior, and complete keyboard navigation have not been visually validated. These are explicit release gates below.

## Executive assessment

Nest has a strong product foundation: strict TypeScript, consistent workspace scoping on most data routes, integer cents for money, Zod validation on many handlers, transactional posting in several high-value flows, a shared responsive shell, focus management, reduced-motion support, pagination for transactions, passkeys, and encrypted card fields.

It is not ready for a security-sensitive production launch without remediation. The most important confirmed issues are:

1. Cron routes fail open without a secret, and a normal authenticated user can trigger a global auto-accounting run.
2. Several posting workflows are race-prone or non-idempotent, so retries/concurrency can create duplicate financial entries. One deletion path updates a credit-card transaction using a credit-card account ID.
3. CVV and full card numbers can be stored and revealed to any workspace member; Gmail OAuth tokens are stored in plaintext.
4. The service worker persists private finance API responses across logout/user changes.
5. Two incompatible authentication/data stacks remain exposed, leaving dead and internally inconsistent login, registration, and Accounts routes.
6. Collaboration roles are not enforced consistently; members can invite users, enable public sharing, and mutate most workspace data.
7. Current dependencies contain known vulnerabilities, security headers/rate limiting are absent, and many APIs return internal exception text.
8. The database cannot be recreated from the checked-in migrations, and most relations rely on Prisma rather than database-enforced foreign keys.

## Priority definitions

| Priority | Meaning | Release rule |
| --- | --- | --- |
| P0 | Exploitable security, privacy, or financial-integrity risk | Block production deployment |
| P1 | High-impact reliability, authorization, data, or compliance gap | Complete before broader rollout |
| P2 | Maintainability, performance, accessibility, and product-quality work | Schedule immediately after P0/P1 |
| P3 | Optimization and refinement | Deliver from measured evidence |

## Confirmed risk register

| ID | Priority | Finding and evidence | Impact | Required disposition |
| --- | --- | --- | --- | --- |
| SEC-01 | P0 | The three `app/api/cron/*` routes return authorized when `CRON_SECRET` is absent. | Anyone can trigger Gmail reads, reminder delivery, or global auto-accounting. | Fail closed, validate secrets at boot, use constant-time comparison, and add authorization tests. |
| SEC-02 | P0 | `app/api/credit-transactions/auto-rules/run/route.ts` checks access to one workspace but calls a runner that scans every workspace. | Any authenticated member can run accounting jobs for every tenant. | Pass an authorized workspace ID to manual runs; reserve global execution for the protected scheduler. |
| FIN-01 | P0 | Credit allocation and receivable close check state before entering a non-serializable transaction; posting IDs are not uniquely idempotent. | Concurrent requests/retries can double-post and corrupt balances. | Add atomic state claims, serializable/conditional updates, idempotency keys, and unique database constraints. |
| FIN-02 | P0 | Transaction deletion uses `CreditCardTxnLink.creditCardId` as `CreditCardTransaction.id`. The schema has no source credit-transaction relation. | Linked deletes fail or update the wrong record; allocation state cannot be reliably reversed. | Add an explicit source relation and replace hard deletion with a tested reversal/void workflow. |
| DATA-01 | P0 | Full PAN and encrypted CVV are stored; `GET /api/credit-cards/[id]` reveals both to any workspace member and lacks `no-store`. | Expands breach/PCI scope and exposes highly sensitive authentication data. | Stop storing CVV, purge existing CVVs, retain only last four unless a justified vault design exists, require owner re-auth for any reveal, and return `Cache-Control: no-store`. |
| PRIV-01 | P0 | `public/sw.js` caches `/api/context`, `/api/dashboard/summary`, and `/api/notifications` in persistent Cache Storage and does not purge on logout or identity/workspace change. | A later user on a shared browser can receive a previous user's financial data offline. | Stop caching authenticated API payloads; cache static shell assets only and purge old read caches during activation/logout. |
| DEP-01 | P0 | Current npm audit reports a high-severity Next.js vulnerability set plus three moderate entries. | Known framework, DoS, middleware, cache, and transitive risks remain deployed. | Upgrade Next.js to at least the audited fixed 16.2.10 release, upgrade related packages, re-run build/tests/audit, and document residual findings. |
| AUTH-01 | P1 | Custom HMAC-cookie auth/raw SQL (`/login`, `/register`, `/api/auth/login`, `/api/auth/register`) coexists with NextAuth. It uses a production fallback secret and a different schema/session. | Broken flows, inconsistent identity, extra attack surface, and potential forged sessions if misconfigured. | Migrate any legacy users, choose one Auth.js/NextAuth identity system, remove the legacy routes/pages/SQL pool, and make secrets mandatory. |
| AUTH-02 | P1 | OAuth providers set `allowDangerousEmailAccountLinking: true`; password/passkey endpoints have no distributed rate limit. | Account-linking and credential-enumeration/brute-force risk. | Disable dangerous linking by default, link only verified identities with explicit user confirmation, and rate-limit all public auth/passkey endpoints. |
| AUTHZ-01 | P1 | `requireWorkspaceAccess` treats every member equally. Non-owners can invite/auto-add users, update public-net-worth settings, configure rules/defaults, run jobs, and mutate/delete finance records. | Least privilege is not enforced and workspace data can be exposed or destroyed by any member. | Define OWNER/EDITOR/VIEWER permissions and enforce them centrally in every route/service. |
| AUTHZ-02 | P1 | Invitations auto-accept existing users during invite and pending invites mutate membership during `GET /api/context`. | Users are added without consent; a GET performs security-sensitive writes. | Use one-time hashed invite tokens, explicit accept/decline endpoints, expiry/revocation, owner-only invite management, and no writes in GET handlers. |
| OAUTH-01 | P1 | Gmail OAuth state is unsigned base64 JSON and access/refresh tokens are plaintext in `GmailIntegration`. Google error bodies can flow into API responses/jobs. | Login-CSRF/integration confusion, token theft after DB compromise, and information leakage. | Use a one-time server-side state nonce and PKCE; encrypt tokens with a versioned KMS/Key Vault key; redact provider errors and support token revocation. |
| API-01 | P1 | 51 route files construct internal exception messages and many return them in 500 responses. | Prisma, SQL, provider, and operational details leak to clients. | Add a shared error mapper; log redacted internal details with a request ID and return stable public error codes only. |
| API-02 | P1 | No global mutation origin check, distributed rate limiting, or consistent request/body-size policy exists. CSV/email fields can be effectively unbounded. | DoS, cost amplification, and abuse of expensive imports/syncs/public endpoints. | Add content-type/origin checks, per-route body limits, rate limits, timeouts, and quotas. |
| SEC-03 | P1 | No CSP, HSTS policy, `frame-ancestors`, `nosniff`, referrer policy, or permissions policy is configured. The theme uses an inline script and fonts are third-party. | Weaker XSS/clickjacking/privacy defense in depth. | Move to `next/font`, add a nonce/hash-compatible CSP and security headers, disable the powered-by header, and verify with automated header tests. |
| DATA-02 | P1 | Migrations contain incremental changes but no checked-in baseline for the full schema. `relationMode = "prisma"` leaves most foreign keys unenforced by SQL Server. | New environments are not reproducible and orphan/cross-workspace data can survive application bugs. | Create a reviewed baseline, reconcile migration history, add database FKs/checks/unique constraints, and test clean install plus restore. |
| DATA-03 | P1 | Materialized `BudgetEnvelope.availableCents` is updated by many routes and scripts in addition to the transaction ledger. | Any missed/duplicated delta creates silent balance drift. | Centralize posting/reversal in a ledger service, make transactions the source of truth, and add reconciliation alerts/repair tooling. |
| JOB-01 | P1 | Job exclusion uses a process-local global and a query-then-create record without a unique lease. Manual Gmail sync starts work with `void` after returning 202. | Multiple serverless instances can duplicate work; background work can be terminated after the response. | Use a durable queue/worker or atomic DB lease, idempotent job keys, retry/backoff/dead-letter handling, and persisted progress. |
| PRIV-02 | P1 | Raw email alert bodies, OAuth tokens, push endpoints, job errors, and audit details have no implemented retention/purge schedule. Analytics loads regardless of the displayed consent banner. | Privacy-policy mismatch and unnecessary breach impact. | Define retention, redact raw data, gate optional analytics on consent (or remove the banner if only essential storage is used), and implement export/delete workflows. |
| UI-01 | P2 | Ten client components exceed 500 lines; the largest is 2,664 lines. `globals.css` is 298 KB/15,161 lines with 346 exact duplicate selector names, 144 `!important`s, and 71 media-query blocks. | High regression risk, large client payloads, and slow UI iteration. | Split by feature/state, move styles into explicit layers/modules, consolidate tokens/breakpoints, and enforce budgets. |
| UI-02 | P2 | Only three feature routes have `loading.tsx`; there are no route error boundaries or custom not-found surfaces. API helpers/error shapes are duplicated across feature components. | Inconsistent loading/recovery and avoidable boilerplate. | Add shared route states and one typed API client/query-key factory. |
| A11Y-01 | P2 | Strong foundations exist, but many raw buttons omit `type`, tables lack captions/header scopes, and legacy dialogs depend on a document-wide mutation observer. Live contrast/reader testing is outstanding. | Form submission surprises and incomplete assistive-technology behavior. | Migrate all dialogs/fields/buttons to shared primitives and add axe, keyboard, screen-reader, and contrast gates. |
| OPS-01 | P1 | No CI workflow, integration/e2e suite, structured telemetry, health/readiness endpoint, backup verification, or alerting is present. Existing tests are mostly source-regex contracts. | Regressions and production failures will be detected late. | Add CI, DB-backed tests, browser tests, structured logs/metrics, SLOs, alerts, and restore drills. |
| DOC-01 | P2 | README references a missing `.env.example`, outdated reminder/email configuration, and a stale OpenAPI document that describes bearer JWT auth and only a fraction of routes. | Setup errors and misleading security/API expectations. | Generate an environment contract and OpenAPI spec from code; fail CI when docs drift. |

## Delivery roadmap

### Phase 0 — Immediate containment and production gate

Target: 1–3 days. Owner: backend/security. Status: Complete.

- [x] Make every cron endpoint return 503 when its required secret is not configured and 401 on mismatch.
- [x] Scope manual auto-accounting to the caller's authorized workspace and require OWNER/EDITOR permission.
- [x] Temporarily disable card-detail reveal and remove CVV fields from create/update/reveal responses.
- [x] Remove authenticated API paths from the service-worker cache and purge existing `*-read` caches.
- [x] Upgrade Next.js and related locked dependencies, then require an audit result with no high/critical production finding.
- [x] Stop returning raw exception/provider/database messages from public responses on the affected P0 paths.
- [x] Add focused regression tests for unauthenticated cron calls, cross-workspace manual jobs, cache cleanup, and card-detail responses.

Implementation verification (2026-07-14): focused Phase 0 tests, the full test suite, lint, TypeScript, and `npx next build` pass. `npm audit --omit=dev` reports 0 high/critical and 4 moderate findings, documented in `docs/phase-0-security-containment.md`. The CVV purge migration is checked in for the next database deployment; it has not been applied to the currently paused live database. The `npm run build` wrapper remains locally blocked by the known Windows Prisma engine DLL lock, so the established non-destructive `npx next build` verification path was used.

Exit criteria:

- All scheduler routes fail closed under missing, invalid, and valid secret tests.
- A manual workspace job cannot touch a second workspace.
- No endpoint persists or returns CVV; existing encrypted CVV data has a documented purge migration.
- Cache Storage contains no authenticated finance API response after upgrade/logout.
- `npm audit --omit=dev`, lint, tests, and production build pass at the agreed vulnerability threshold.

### Phase 1 — Financial ledger correctness and idempotency

Target: 1 week. Owner: backend/data. Status: Complete (2026-07-14).

- [x] Introduce a central posting service for transaction create/update/reversal, transfers, receivable close, credit allocation, card payments, imports, and budget-plan application.
- [x] Add a `PostingGroup`/journal identifier and explicit source relations (including `creditCardTransactionId` and `receivableId`) instead of inferring links.
- [x] Require a client or server idempotency key for every money-changing POST; persist it under a workspace-scoped unique constraint.
- [x] Atomically claim `isAllocated = false` and open receivables before posting; return the prior successful result for retries.
- [x] Replace destructive deletion of posted finance records with void/reversal entries. Preserve immutable history and actor/reason metadata.
- [x] Fix the linked credit-card transaction deletion bug and backfill links where they can be identified safely.
- [x] Put balance changes and journal records in the same serializable transaction or derive balances from the ledger.
- [x] Add reconciliation that compares materialized budget balances with ledger totals and alerts rather than silently repairing.
- [x] Add concurrent-request tests for duplicate payment, allocation, transfer, receivable close, import, and job execution.

Completed evidence (2026-07-14):

- Added and applied `phase_1_posting_ledger_and_idempotency`, including journal/idempotency tables, explicit source links, reversal metadata, indexes, and a conservative credit-link backfill.
- Added central serializable posting, replay, atomic-claim, reversal, and reconciliation services and migrated every listed balance-changing workflow.
- SQL Server concurrency integration passed for payment, allocation, transfer, receivable close, import, and job idempotency; allocation and receivable claims each admitted one of two simultaneous writers.
- Reconciliation returned zero drift for the configured migrated database. Local suite: 48 passed and 1 database test skipped by default; the database concurrency test passed separately. Production build, TypeScript, lint, and Prisma validation passed.

Exit criteria:

- Replaying any mutation with the same idempotency key produces one journal effect.
- Two simultaneous close/allocation requests result in exactly one posting.
- Every balance-changing record is traceable to an actor, source operation, posting group, and reversal if applicable.
- Reconciliation is zero on seeded and migrated fixtures.

### Phase 2 — Authentication, authorization, and collaboration

Target: 1–2 weeks. Owner: backend/product. Status: Not started.

- [ ] Inventory legacy password users and decide whether password login remains a supported product feature. 
Owner: Not needed anymore. remove legacy password flow
- [ ] If retained, migrate it into the single Auth.js identity model with verified email, password reset, modern hash parameters, session revocation, and rate limits. Otherwise remove it entirely.
- [ ] Delete the custom `nest-session` cookie, raw `Users`/`Accounts`/`Transactions` access, `/login`, `/register`, duplicate registration form, and unused legacy Accounts pages after migration.
- [ ] Require `NEXTAUTH_SECRET`/`AUTH_SECRET`, canonical application origin, WebAuthn RP ID/origin, encryption keys, database TLS settings, and cron secrets during production startup.
- [ ] Replace dangerous automatic email linking with explicit linking from an authenticated account and verified provider claims.
- [ ] Define a permission matrix: OWNER manages workspace/security/integrations/public links; EDITOR posts finance data; VIEWER is read-only.
- [ ] Add central helpers such as `requireWorkspaceRole(workspaceId, minimumRole)` and apply them to all 113 handlers.
- [ ] Replace auto-accept invitations with explicit accept/decline, hashed one-time tokens, expiry, revocation, and email/push notice.
- [ ] Make public-link creation/rotation/revocation owner-only, hide the bearer token from non-owners, and provide a clear audit event.
- [ ] Require recent re-authentication for public sharing, integrations, passkey deletion, collaborator changes, workspace deletion, and any justified card reveal.

Exit criteria:

- One session system and one canonical user table remain.
- A route-permission test matrix proves viewer/editor/owner behavior and cross-workspace denial.
- GET requests do not create workspaces, accept invites, or mutate user/workspace state.
- Sessions, invites, and public links can be revoked and are covered by audit events.

### Phase 3 — Data protection and application security foundation

Target: 1–2 weeks. Owner: security/platform. Status: Not started.

- [ ] Retain only card brand/name/last four/expiry unless a written business requirement justifies more. Never store CVV.
- [ ] If PAN storage remains, use a dedicated vault/tokenization provider or envelope encryption with Azure Key Vault, key versioning, rotation, AAD binding to workspace/record/field, owner-only access, re-authentication, audit, and `no-store`.
- [ ] Encrypt Gmail refresh/access tokens and other long-lived credentials at application level; rotate and revoke them on disconnect.
- [ ] Replace Gmail state with an expiring, one-time, server-stored nonce bound to user/workspace and add PKCE.
- [ ] Add a shared server-only route wrapper for authentication, role checks, Zod parsing, content type, body limit, origin policy, request ID, safe error mapping, and cache policy.
- [ ] Add distributed rate limits for auth, passkey options/verification, public share, Gmail connect/sync, imports, reminders, and all expensive mutations.
- [ ] Configure CSP, HSTS, `frame-ancestors 'none'`, `X-Content-Type-Options`, referrer and permissions policies; use `next/font` and a CSP-safe theme bootstrap.
- [ ] Set `Cache-Control: no-store` for sessions, context, notifications, integrations, secrets, and mutation responses. Add `Vary` where private cache is intentionally retained.
- [ ] Validate production database encryption and reject `trustServerCertificate=true` outside local development.
- [ ] Add automated secret scanning, dependency review, SAST, and security-header tests to CI.

Exit criteria:

- A data-flow/threat-model review covers auth, workspaces, card data, Gmail, web push, public sharing, jobs, and offline behavior.
- Security tests verify IDOR/tenant isolation, role enforcement, CSRF/origin handling, rate limits, OAuth state replay, and safe errors.
- No long-lived integration credential is stored plaintext and no sensitive endpoint is browser/service-worker cached.

### Phase 4 — Database reproducibility and domain integrity

Target: 1–2 weeks. Owner: data/backend. Status: Not started.

- [ ] Create and review a complete baseline migration for a clean SQL Server database without rewriting migration history already applied to production.
- [ ] Add a documented deploy migration command (`migrate deploy`, not `migrate dev`) and a shadow/staging verification workflow.
- [ ] Reconcile schema drift and remove runtime `Unknown argument/field` fallbacks for `themeKey`, `bankName`, `displayName`, and `isLiquid`.
- [ ] Add database foreign keys where SQL Server cascade-path constraints permit; document and test any relations that must remain application-managed.
- [ ] Replace free-form roles/statuses/kinds/directions/job phases with Prisma enums or database check constraints.
- [ ] Add workspace-consistency constraints/validation for account, budget, group, card, receivable, reward, and integration relations.
- [ ] Add unique constraints for public tokens, job leases/idempotency keys, ingestion references where appropriate, and source posting links.
- [ ] Review `Int` range, `Float` conversion rates, date-only/time-zone semantics, and currency rules; use `Decimal` where precision demands it.
- [ ] Add retention/purge migrations for WebAuthn challenges, background jobs, raw alert bodies, expired invites, old notifications, and audit/error payloads.
- [ ] Establish encrypted backups, point-in-time recovery, and a quarterly restore drill with recorded recovery time/data loss.

Exit criteria:

- CI can provision an empty SQL Server database, apply every migration, seed it, run tests, and destroy it.
- Migration status is clean in staging and a rollback/forward-fix runbook exists.
- Database constraints reject representative orphan, cross-workspace, duplicate-idempotency, and invalid-state writes.

### Phase 5 — Reliable background jobs and integrations

Target: 1 week. Owner: backend/platform. Status: Not started.

- [ ] Remove unused in-process `setInterval` schedulers; Vercel/serverless instances are not durable schedulers.
- [ ] Replace query-then-create job exclusion with an atomic lease or a durable queue supporting uniqueness, visibility timeouts, retry/backoff, and dead-letter state.
- [ ] Never start un-awaited work after returning an API response. Queue Gmail sync and process it in a durable worker/cron invocation.
- [ ] Scope every job by workspace/integration, propagate idempotency keys, and use atomic checkpoints for resumable imports/sync.
- [ ] Cap Gmail pages/messages per run, record history cursors, redact raw content, and distinguish retryable from permanent provider errors.
- [ ] Add delivery deduplication and rate limits for email/push reminders; report partial failure without leaking recipient/provider details.
- [ ] Consolidate the three reminder entry points and align README, Vercel cron configuration, and environment names.
- [ ] Add job dashboards/metrics for queue age, duration, success, retry, duplicate suppression, and dead letters.

Exit criteria:

- Killing a worker mid-run and retrying does not duplicate a financial posting, email, notification, or Gmail staging row.
- Only one active lease exists per unique job scope across multiple processes.
- Operators can retry or cancel a job safely and identify its workspace, actor, progress, and sanitized failure.

### Phase 6 — Backend API and architecture improvement

Target: 2–3 weeks, incremental. Owner: backend. Status: Not started.

- [ ] Organize server code by domain (`workspaces`, `ledger`, `cards`, `receivables`, `rewards`, `integrations`, `jobs`) with route handlers limited to transport concerns.
- [ ] Extract shared request schemas, response DTOs, error codes, query keys, cache policies, and role requirements.
- [ ] Generate OpenAPI from the actual handlers/schemas, describe cookie/session auth correctly, and protect or remove Swagger in production as appropriate.
- [ ] Standardize list envelopes and cursor pagination. Add bounded pagination to reward history, alerts, collaborators/audit, notifications, and any unbounded collection.
- [ ] Add strict search lengths, import limits, and SQL Server-safe batching; the current 1,000-row duplicate OR query can exceed practical parameter/query limits.
- [ ] Make Maybank/JSON imports atomic per chunk, resumable, and idempotent instead of partial row-by-row commits.
- [ ] Replace duplicated component-local `fetchJson` helpers with one typed client that handles 401/403/409/422/429/503 consistently.
- [ ] Split the 786-line multi-action budget-plan handler into action-specific services/routes without changing the public workflow.
- [ ] Remove ad hoc production-data scripts or add explicit environment allowlists, dry-run defaults, confirmation, audit output, and tests. Delete hard-coded record IDs.
- [ ] Profile dashboard/context/database queries with real telemetry before adding caches. Cache only non-sensitive, user-correct data with explicit invalidation.

Exit criteria:

- Route handlers are thin, domain services are unit/integration tested, and response contracts are generated/checked.
- No unbounded request or collection endpoint remains.
- OpenAPI and environment documentation are CI-verified and match production behavior.

### Phase 7 — UI platform refactor

Target: 2–4 weeks, route by route. Owner: frontend/design. Status: Not started.

- [ ] Preserve the shipped mobile-shell contract below while migrating legacy UI to shared primitives.
- [ ] Remove or fully migrate the dead legacy Accounts experience. Choose one canonical place for bank-account management and eliminate duplicate navigation/data shapes.
- [ ] Split each mega component into a page controller plus focused feature components/hooks; first targets are Transactions, Rewards, Dashboard, Credit Transactions, and Settings.
- [ ] Divide `globals.css` into ordered token/base/component/feature/utility layers or CSS modules. Consolidate breakpoints (phone/tablet/desktop/coarse landscape), remove duplicate selectors, and reduce `!important` usage.
- [ ] Establish one design-token source for spacing, type, color, elevation, focus, motion, touch targets, and responsive layout; enforce it with lint/style checks.
- [ ] Migrate every modal family to `Dialog`, every field to accessible form primitives, and every action to `Button`. Remove the global mutation-observer modal compatibility layer when complete.
- [ ] Add route-level `loading.tsx`, `error.tsx`, and not-found states with consistent retry/support actions. Keep prior data visible during non-destructive refetches.
- [ ] Add a typed query-key/invalidation factory and make mutation success, stale state, conflict, offline, and permission errors predictable.
- [ ] Lazy-load charts, import tools, rule editors, and heavy modal workflows. Measure route JS/CSS, LCP, INP, CLS, and memory before/after each extraction.
- [ ] Replace external Google font links with `next/font`; reserve dimensions for dynamic content and remove avoidable layout shifts.

Suggested UI engineering budgets:

- No feature component above 400 lines without a documented exception.
- Reduce global CSS by at least 40% while keeping visual snapshots stable.
- No new raw color/spacing/z-index values outside tokens.
- Route-specific client JavaScript and interaction latency may not regress beyond an agreed 5% budget.

### Phase 8 — Product UX, accessibility, and privacy controls

Target: 2–3 weeks, parallel with Phase 7. Owner: product/design/frontend. Status: Not started.

- [ ] Run task-based UX tests for first workspace, first account/sub-account, first transaction, transfer, receivable close, card payment, Gmail connection, collaboration, and public sharing.
- [ ] Make money-changing confirmations show source, destination, amount, date, resulting balance, and whether an immutable reversal is available.
- [ ] Add visible workspace/role context to destructive or cross-workspace workflows; explain why a control is unavailable to viewers.
- [ ] Add concurrent-edit conflict UI using version/`updatedAt` preconditions instead of silent last-write-wins behavior.
- [ ] Put share-link rotation/revocation, Gmail data scope/last sync/revoke, passkeys, notification devices, offline storage, data export, and account deletion in a clear Privacy & Security area.
- [ ] Replace the current accept-only cookie overlay: either gate optional analytics behind granular accept/reject controls or remove consent UI when only essential storage is used.
- [ ] Make filters/sort/month selections URL-addressable where sharing/deep links matter; use session storage only for ephemeral presentation state.
- [ ] Add table captions/scope, error summaries, `aria-invalid`/descriptions, explicit raw-button types, non-color status cues, and consistent live-region behavior.
- [ ] Test keyboard-only navigation, focus order/return, zoom/reflow at 200–400%, reduced motion, high contrast, VoiceOver, NVDA, and TalkBack.
- [ ] Complete visual/responsive passes at 360, 390, 430, 768, 1024, 1280, and phone landscape sizes in light/dark themes.

Exit criteria:

- WCAG 2.2 AA automated checks pass and the manual assistive-technology checklist has no critical issue.
- Every feature has designed loading, empty, partial, error, permission, offline, conflict, and success states.
- Sensitive/share/integration actions are understandable, reversible where possible, and require the correct role/re-authentication.

### Phase 9 — Testing, CI/CD, observability, and operations

Target: start in Phase 0 and mature continuously. Owner: platform/whole team. Status: Not started.

- [ ] Add GitHub Actions for install (`npm ci`), Prisma generate/validate, lint, type-check, unit, integration, e2e, build, dependency audit, secret scan, and migration validation.
- [ ] Stop using regex-only source assertions as the primary behavior proof. Keep useful contract guards but add component interaction, HTTP, database, and browser coverage.
- [ ] Build a SQL Server integration suite with isolated workspaces and tests for tenant isolation, permissions, constraints, transactions, rollbacks, concurrency, and idempotency.
- [ ] Add Playwright journeys for sign-in/passkey fallback, workspace switching, core finance flows, mobile navigation, offline behavior, and logout/cache isolation.
- [ ] Add axe and visual regression tests for critical routes in both themes and supported viewports.
- [ ] Add structured server logs with request/job/workspace correlation IDs and strict redaction for tokens, card data, email bodies, cookies, and SQL parameters.
- [ ] Add error tracking and metrics for API latency/error rate, DB pool/queries, auth failures/rate limits, reconciliation drift, cron/job health, Gmail, email, push, and web vitals.
- [ ] Define SLOs and alerts for sign-in, core reads/mutations, job freshness, duplicate-post prevention, and data reconciliation.
- [ ] Add `/api/health/live` and protected readiness/dependency diagnostics that expose no secrets.
- [ ] Document deploy, rollback/forward-fix, key rotation, token compromise, data restore, job recovery, and security-incident runbooks.

Minimum release gates:

- CI is mandatory and branch-protected.
- No high/critical production dependency finding without a time-bounded, approved exception.
- Clean migration + seed + integration suite succeeds.
- P0/P1 security, tenant-isolation, concurrency, and logout-cache tests pass.
- Production build, accessibility smoke, critical e2e, and rollback rehearsal pass.
- Monitoring and on-call alerts are active before rollout.

## Recommended execution sequence

| Order | Work package | Dependency | Indicative effort |
| --- | --- | --- | --- |
| 1 | Phase 0 containment | None | 1–3 days |
| 2 | Phase 1 ledger/idempotency | Phase 0 | 1 week |
| 3 | Phase 2 auth/RBAC | Phase 0; coordinate data migration | 1–2 weeks |
| 4 | Phase 3 security/data protection | Phases 0–2 | 1–2 weeks |
| 5 | Phase 4 schema/migrations | Phase 1 design | 1–2 weeks |
| 6 | Phase 5 durable jobs | Phase 1 idempotency + Phase 4 constraints | 1 week |
| 7 | Phase 6 backend architecture | Start after route/security contracts stabilize | 2–3 weeks |
| 8 | Phases 7–8 UI/UX | Can start component groundwork after Phase 0; integrate roles/conflicts after Phases 1–2 | 3–6 weeks |
| Continuous | Phase 9 quality/operations | Begin with Phase 0 | Ongoing |

## First implementation slice

Use this as the first pull-request series; keep each change deployable and independently testable.

1. `security/cron-fail-closed`: central cron authorization, required env validation, tests.
2. `security/auto-run-scope`: workspace-scoped manual runner and owner/editor permission tests.
3. `security/offline-cache`: static-only service worker, cache purge, logout isolation test.
4. `security/card-data`: remove CVV API/storage, no-store, purge migration, reveal decision record.
5. `dependencies/next-upgrade`: Next.js/package upgrade, audit/build/e2e smoke.
6. `ledger/idempotent-close-allocation`: atomic claims, idempotency model, concurrency tests.
7. `ledger/link-and-reversal`: explicit source links, fix deletion defect, reversal workflow.
8. `auth/single-stack-rfc`: legacy user inventory and migration/removal implementation decision.
