---
title: Core Service and Function Contracts
description: Maintainer reference for important exported functions, classes, side effects, failures, and complexity.
audience: [engineers, maintainers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-30
---

# Core service and function contracts

## Purpose

Document high-impact callable surfaces without repeating obvious syntax or unstable implementation details.

## Scope

Authorization, posting, jobs, CIO planning, AI, providers, parsing, navigation, formatting, and exported error classes. Route handlers are documented by endpoint in [API documentation](../api/README.md).

## Contract Reading Rules

- Confirm exact TypeScript types at the linked source before calling.
- Complexity uses `n` for supplied/listed records and excludes provider/database internals.
- Database and provider functions are asynchronous and can fail due to configuration, connectivity, timeouts, or constraint errors.
- Preconditions include authenticated workspace access where the caller is responsible for establishing it.

## Authentication and Workspace Functions

| Function | Purpose and business context | Parameters → return | Side effects/failures | Complexity |
| --- | --- | --- | --- | --- |
| `requireSession()` | Require a signed-in server session | none → session | Throws/redirects according to caller boundary | Time/space O(1), excluding auth store |
| `requireSessionUserId()` | Resolve authenticated user for API work | none → user ID | `ApiAuthError` on missing identity | O(1) |
| `requireRecentAuthentication(maxAgeSeconds?)` | Protect sensitive account/workspace actions | freshness window → authenticated user | Rejects stale/missing proof | O(1) |
| `requireWorkspaceAccess(workspaceId, options?)` | Prove membership and return workspace context | workspace ID/options → access context | Database read; auth/not-found/role failure | O(1) rows |
| `requireWorkspaceRole(workspaceId, minimumRole)` | Enforce ordered workspace role | IDs/role → access context | Authorization failure | O(1) rows |
| `normalizeWorkspaceRole(role)` | Map persisted/legacy role to current vocabulary | string → role | Throws on unsupported role | O(1) |
| `hasMinimumWorkspaceRole(role, minimum)` | Compare role ordering | two roles → boolean | None | O(1) |
| `ensureUserWithDefaultWorkspace(identity)` | Bootstrap user and first workspace after identity establishment | identity → user/workspace context | Transactional creates/updates | O(1) rows |

**Example:**

```ts
const access = await requireWorkspaceRole(workspaceId, "EDITOR");
```

The route must still validate that any referenced account/card/budget belongs to `access.workspace.id`.

## Posting and Financial Functions

| Function | Purpose and pre/postconditions | Parameters → return | Side effects/failures | Complexity |
| --- | --- | --- | --- | --- |
| `getIdempotencyKey(request, fallback?)` | Resolve stable operation identity | HTTP request/fallback → string | None; caller must avoid retry-random fallback | O(1) |
| `executePosting(params)` | Atomically claim an operation and commit a posting group | workspace/operation/transaction callback → typed result | SQL transaction; conflict on incompatible duplicate; no partial commit | O(e), entries |
| `createPostingGroupRecord(...)` | Create auditable group inside an existing transaction | transaction client/metadata → group | Inserts record; constraint failure | O(1) |
| `createLedgerTransaction(...)` | Persist user-visible transaction in posting workflow | transaction client/data → transaction | Inserts record | O(1) |
| `reverseLedgerTransaction(params)` | Negate a prior ledger effect while retaining history | workspace/source/reversal metadata → result | Transactional writes; conflict/ownership failure | O(e) |
| `reconcileWorkspaceBudgets(db, workspaceId)` | Recalculate envelope availability from ledger truth | client/workspace → completion | Reads and updates budgets | O(b+t) |
| `getBudgetAvailableDeltaCents(direction, amount)` | Convert transaction direction to envelope delta | direction/cents → signed cents | Throws or returns rule-specific delta | O(1) |
| `deriveStatementCycle(params)` | Assign card activity to a statement period | transaction date/statement day → year/month | None | O(1) |

**Postcondition:** a successful posted mutation has a durable operation identity and auditable entries. Corrections create new reversal evidence.

## Background Job Functions

| Function | Purpose | Parameters → return | Side effects/failures | Complexity |
| --- | --- | --- | --- | --- |
| `enqueueBackgroundJob(params)` | Create/deduplicate durable work | type/key/payload/schedule → job | SQL insert/update; serialization errors | O(payload) |
| `claimBackgroundJob(params)` | Lease one eligible job | ID/type/lease duration → claim/null | Atomic job state/lease update | O(1) plus indexed lookup |
| `heartbeatBackgroundJob(id, leaseToken, ...)` | Extend a valid lease | claim identity/progress → job | Rejects lost/stale claim | O(1) |
| `continueBackgroundJob(...)` | Persist progress and schedule next slice | claim/progress/time → job | Releases/reschedules claim | O(progress payload) |
| `completeClaimedBackgroundJob(...)` | Mark claimed work successful | claim/result → job | Rejects stale lease | O(result payload) |
| `failClaimedBackgroundJob(id, token, error)` | Record bounded failure and retry/dead-letter state | claim/error → job | Sanitizes error; updates attempt state | O(error summary) |
| `requestBackgroundJobCancellation(id)` | Request cooperative cancellation | job ID → state | Updates job | O(1) |
| `throwIfBackgroundJobCancelled(id, token)` | Stop a worker at safe checkpoints | claim identity → void | Throws cancellation/lost-lease error | O(1) |

Workers must be idempotent because leases, scheduler retries, and process crashes allow repeated execution attempts.

## CIO Planning Functions

| Function | Purpose and business context | Parameters → return | Side effects/failures | Complexity |
| --- | --- | --- | --- | --- |
| `buildCioSnapshot(params)` | Build the authoritative workspace CIO read model from bank controls, latest valuations, explicit planning metadata, policy, and assumptions | authorized workspace/data date/optional temporary projection overrides → `CioSnapshot` | Bounded SQL reads; validation/calculation failure; no writes | O(a+i+e+p+f), loaded accounts, investments, exposures, positions, and flows |
| `runWorkspaceRetirementProjection(params)` | Rebuild the snapshot with validated temporary scenario overrides and return projection/data-quality evidence | workspace plus `CioRetirementProjectionInput` → projection result | Bounded SQL reads; typed 422-style validation failure; no writes | Snapshot cost plus O(3y), three scenarios over at most 100 years |
| `calculateAllocation(sources)` | Allocate every source cent across weighted dimensions with deterministic largest-remainder rounding | valued sources/exposures → exact buckets | Pure; rejects invalid or unsafe numeric input | O(s log s) per dimension in the largest-remainder step |
| `summarizeRecurringFlows(flows, asOfDate)` | Annualize active flows and keep external wealth changes separate from internal reallocations | bounded flows/date → active and retirement-eligible totals | Pure; rejects invalid dates, amounts, or account-reference combinations | O(f) |
| `evaluateCioPolicy(params)` | Compare allocation, liquidity, data quality, concentration, and retirement output with explicit policy constraints | snapshot-derived inputs → ordered review exceptions | Pure; produces no order, transfer, or mutation | O(b+g+a+s), bands, geography limits, accounts, and securities |
| `getCioAskNestTools()` | Return the four bounded read-only CIO tool definitions | none → function-tool definitions | None; no model-visible workspace argument | O(1) |
| `executeCioAskNestTool(name, args, context)` | Validate a CIO tool request and execute it in already-authorized workspace context | tool name/model args/private context → bounded output/evidence or `null` | CIO SQL reads and validation failures; no writes or public-provider calls | Tool-specific snapshot/projection cost |

CIO money uses integer cents and rates/weights use integer basis points. Planning net worth remains separate from dashboard/public net worth; missing valuations and unknown exposure are returned explicitly.
Retirement projections apply contributions at completed year ends. A final partial period prorates return and inflation by its UTC-day fraction in basis points and does not apply a full annual contribution; the echoed assumptions expose that fraction.

## AI and Retrieval Functions

| Function | Purpose | Parameters → return | Side effects/failures | Complexity |
| --- | --- | --- | --- | --- |
| `answerAskNest(input)` | Produce grounded answer over authorized context | question/workspace/user/history → answer/evidence | Model and SQL calls; rate/config/provider errors; persists bounded history/usage | Depends on tools/model |
| `getAskNestTools(includeKnowledgeSearch)` | Return approved read-only tool definitions | gate → definitions | None | O(number of tools) |
| `executeAskNestTool(name, args, context)` | Validate and run one workspace-scoped read tool | tool call/context → serialized result | SQL/provider reads; input errors | Tool-specific |
| `reviewCreditCardTransactions(params)` | Suggest accounting for bounded card activity | workspace/user/IDs → suggestions | Model/SQL reads; no accounting mutation | O(n) plus model |
| `resolveAskNestEntity(...)` | Match normalized user phrase to authorized candidates | phrase/candidates → resolution | None | O(n) |
| `searchAskNestKnowledge(params)` | Retrieve optional approved knowledge evidence | query/filter → results | Azure Search call; disabled/config/provider failure | Provider-specific |
| `getMassiveDailyMarketHistory(params)` | Fetch normalized daily market data | symbol/range → history | HTTP/cache/quota errors | O(days returned) |
| `searchSerpApiNews(query)` | Fetch normalized finance news results | query → results | HTTP/quota/config errors | O(results) |

AI outputs are advisory. Tool execution must remain read-only; the calling route separately establishes workspace authorization.

## Integration and Parsing Functions

| Function | Purpose | Parameters → return | Side effects/failures | Complexity |
| --- | --- | --- | --- | --- |
| `encryptCredential(value, context)` | Seal provider credential with versioned authenticated encryption | secret/context → envelope | Reads key configuration; throws on invalid config | O(secret length) |
| `decryptCredential(envelope, context)` | Open and authenticate credential envelope | envelope/context → secret | Throws on tamper/missing key/context mismatch | O(envelope length) |
| `buildGmailConsentUrl(params)` | Build PKCE OAuth consent URL | state/challenge/origin → URL | None | O(1) |
| `exchangeCodeForTokens(params)` | Exchange OAuth callback code | code/verifier/origin → tokens | Gmail HTTP call; sanitized provider error | Provider-specific |
| `ensureActiveGmailAccessToken(integrationId, origin?)` | Decrypt/refresh a usable Gmail access token | integration ID/origin → token | SQL and provider writes; revocation/config errors | O(1) |
| `queueGmailSyncForIntegration(integration)` | Deduplicate a sync job | integration → job | SQL job write | O(1) |
| `processGmailSyncQueue(params)` | Run bounded leased Gmail slices | optional job/origin/slice limit → summary | Provider/SQL work; continuation/retry | O(messages processed) |
| `parseMaybankCsv(raw)` | Parse and normalize supported statement CSV | text → rows | Throws validation/format errors | Time/space O(input length) |
| `parseCreditAlert(body, subject?)` | Extract candidate card transaction evidence | untrusted text → parsed alert | No persistence; may return partial/unknown fields | O(input length) |

## API, Browser, and Utility Functions

| Function | Purpose | Parameters → return | Side effects/failures | Complexity |
| --- | --- | --- | --- | --- |
| `parseJsonBody(request, schema/options)` | Bound and validate JSON | request/contract → typed body | Consumes body; throws `ApiRequestError` | O(body size) |
| `runSecureApiRoute(request, handler)` | Normalize secure route failures | request/callback → response | Error translation/logging | Handler-specific |
| `parseListQuery(request, defaults?)` | Validate cursor/list cap | request/options → pagination | Throws on invalid cursor/limit | O(cursor length) |
| `apiFetch<T>(input, init?)` | Browser JSON transport with typed errors | fetch inputs → payload | Network; throws `ApiClientError` | O(response size) |
| `workspaceFetch(input, init?)` | Add active workspace context to browser request | fetch inputs → response | Network/cookie/header read | O(response size) |
| `invalidateWorkspaceQueries(client, workspaceId, roots?)` | Invalidate related React Query cache | client/scope → promise | Browser cache mutation | O(matching queries) |
| `buildWorkspacePath(...)` | Construct canonical workspace URL | workspace/path → string | None | O(path length) |
| `formatMoney(cents, currency?)` | Display integer cents in supported currency | cents/code → string | None; presentation only | O(1) |
| `chunkValues(values, size?)` | Bound SQL/provider batches | array/size → chunks | Allocates arrays | Time/space O(n) |

## Exported Error Classes

| Class | Meaning | Lifecycle/state | Consumer response |
| --- | --- | --- | --- |
| `ApiRequestError` | Server request contract failure with HTTP/code metadata | Immutable after construction; per failure | Convert to sanitized API envelope |
| `ApiClientError` | Browser representation of non-success API response | Immutable response status/code/details | Show mapped user message; branch on code when required |
| `ApiAuthError` | Authentication/workspace authorization failure | Immutable per guard failure | Preserve status/concealment behavior |
| `PostingConflictError` | Incompatible idempotency or posting-state conflict | Immutable per operation | Return conflict; do not retry with a new key blindly |
| `BackgroundJobError` | Invalid lease/state/job transition | Immutable per transition | Retry only according to job state |
| `AskNestToolInputError` | Invalid model-supplied tool argument | Immutable per tool call | Return safe tool error/evidence gap |
| `AiConfigurationError` | Required AI config is absent/invalid | Immutable per configuration check | Surface disabled/unavailable behavior |
| `MassiveMarketDataError` / `SerpApiNewsError` / `GmailProviderError` | Typed provider failure | Contains sanitized category/status | Degrade or retry according to code |
| `BudgetPlanRequestError` | Budget plan validation/state conflict | Per request | Map to stable route status |

These classes are composed rather than inherited into domain hierarchies. They hold request-local state and are not shared mutable objects; explicit thread-safety guarantees are **Unknown from source code** and are not normally relevant to Node request-local instances.

## Failure and Complexity Notes

- Big-O does not describe SQL query-plan or remote-provider cost.
- Callers must not expose error messages that may contain internal/provider detail.
- Functions that accept a Prisma transaction client assume the caller owns commit/rollback.
- Functions that take `workspaceId` still require the caller or function to prove membership; inspect the exact implementation.

## Related Files

- [Important file catalog](file-catalog.md)
- [Module index](../modules/README.md)
- [API reference](../api/README.md)
- [Common patterns](../ai/common-patterns.md)

## Dependencies

- Public exports under `lib/`, current TypeScript signatures, Prisma, and provider clients.

## Assumptions

- Only high-impact public functions require narrative contracts here; small pure presentation helpers remain self-describing unless they encode a business rule.

## Known Limitations

- This catalog is not generated and does not enumerate every exported type, constant, React component, route handler, or trivial pure function.
- Exact exception types for provider and database internals can change; inspect source and tests before relying on them.

## Future Improvements

- Generate a symbol index from TypeScript and attach owners, callers, tests, and complexity measurements.
- Move stable schemas into generated API/reference documentation.

## Last Updated

2026-07-30
