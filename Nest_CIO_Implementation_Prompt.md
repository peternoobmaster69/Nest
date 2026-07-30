# Codex Prompt: Implement Nest CIO — Production-Grade MVP

You are modifying the **Nest** repository. Implement a production-grade **Nest CIO** feature as a new, deterministic, read-only household investment-planning capability integrated with the existing Ask Nest assistant.

Do not merely write a plan. Inspect the actual repository, implement the feature end to end, add tests and documentation, run the relevant validation commands, and report exactly what changed.

## 1. Read the repository before changing code

Read these documents first, then inspect the corresponding source and tests. When documentation conflicts with executable code, the source, migrations, route handlers, and tests are authoritative.

1. `docs/ai/project-summary.md`
2. `docs/ai/architecture-summary.md`
3. `docs/ai/business-rules.md`
4. `docs/ai/coding-conventions.md`
5. `docs/ai/pitfalls.md`
6. `docs/ai/anti-patterns.md`
7. `docs/architecture/overview.md`
8. `docs/architecture/system-design.md`
9. `docs/architecture/repository-structure.md`
10. `docs/architecture/security.md`
11. `docs/architecture/adr/ADR-005-read-only-ai.md`
12. `docs/modules/ai.md`
13. `docs/modules/investments.md`
14. `docs/modules/budgets.md`
15. `docs/modules/web-ui.md`
16. `docs/api/ai.md`
17. `docs/api/assets-rewards.md`
18. `docs/database/schema.md`
19. `docs/reference/service-contracts.md`
20. `docs/testing/strategy.md`

Inspect at minimum:

- `app/w/[workspaceId]/[[...path]]/page.tsx`
- `components/app-shell.tsx` and the actual sidebar/navigation implementation
- `components/investments-page.tsx`
- `lib/query-keys.ts`
- `lib/net-worth.ts`
- `lib/investment-entry-order.ts`
- `lib/workspace-auth.ts`
- `lib/api-security.ts`
- `lib/api/contracts.ts`
- `lib/api/client.ts`
- `lib/ai/ask-nest.ts`
- `lib/ai/ask-nest-tools.ts`
- `lib/ai/ask-nest-types.ts`
- `lib/ai/ask-nest-intent.mjs`
- existing Ask Nest tests and `evals/ask-nest/golden.json`
- `prisma/schema.prisma`
- relevant investment, workspace, API, UI, and migration tests

Do not guess an exact function signature when the source can answer it. Use the phrase **“Unknown from source code.”** in documentation where product intent cannot be proven.

---

## 2. Architectural objective

Nest CIO is not a second chatbot and not a model-only prompt. Build it as:

```text
CIO page / Ask Nest
        |
        v
read-only CIO APIs and Ask Nest tools
        |
        v
lib/domains/cio deterministic services
        |
        +--> existing Nest financial reads
        +--> explicit CIO planning metadata
        +--> projection and policy engines
        |
        v
Prisma / Azure SQL
```

The model may interpret and explain calculated results. It must never calculate authoritative balances by itself and must never receive database credentials, unrestricted SQL, mutation tools, trade-execution tools, or caller-controlled workspace identifiers.

### Non-negotiable existing invariants

- Every private read and write is scoped to the authenticated active workspace.
- Roles remain `OWNER > EDITOR > VIEWER`; legacy `MEMBER` remains compatible with current normalization.
- Store and calculate money as integer cents. Store rates and percentages as integer basis points or another explicit integer scale.
- Preserve the canonical `/w/{workspaceId}` URL and workspace-keyed React Query caches.
- Ask Nest remains read-only and evidence-grounded.
- Do not add AI write tools.
- Do not execute trades, transfers, postings, purchases, sales, options, margin, or leverage.
- Do not change the semantics of the current dashboard/public net-worth projection.
- Do not count an internal reallocation, such as Cash+ to an equity portfolio, as a new household contribution.
- Do not infer an investment product's exposure from its display name and silently treat that inference as authoritative.
- Do not hardcode any real household's financial values into source, migrations, tests, or seed data.

Add a new ADR clarifying that Nest CIO is **read-only financial decision support**, not an autonomous trading agent or regulated-advice implementation.

---

## 3. Scope of this MVP

Implement one complete vertical slice that does the following:

1. Builds a canonical, typed CIO snapshot from the active workspace.
2. Adds explicit user-confirmed classification for investment products.
3. Supports manual planning positions for assets or liabilities not already represented in Nest, without altering existing dashboard net-worth semantics.
4. Supports recurring financial flows and distinguishes external contributions from internal reallocations.
5. Stores an explicit household CIO profile and investment policy.
6. Calculates allocation, liquidity, concentration, data quality, policy exceptions, and retirement projections deterministically.
7. Adds a workspace-scoped CIO dashboard with accessible charts.
8. Adds bounded read-only CIO tools to Ask Nest.
9. Adds tests, OpenAPI updates, migrations, and living documentation.

### Explicitly out of scope for this MVP

- Brokerage order execution or transfer execution.
- AI mutation tools.
- Individual-stock buy/sell/hold recommendations.
- Options, margin, leverage, automated rebalancing, or autonomous actions.
- Monte Carlo simulation.
- Tax optimization.
- Live market/news research inside the CIO calculation path.
- Scraping provider portals.
- Automatic product classification without user confirmation.
- Refactoring every existing Ask Nest tool. Add a clean CIO registry without broad unrelated rewrites.
- A scheduled monthly CIO report. Leave a clean extension point for it.

---

## 4. Domain design

Create a focused domain under `lib/domains/cio/`. Keep route handlers thin and keep reusable financial logic outside UI and route files.

A reasonable structure is:

```text
lib/domains/cio/
  contracts.ts
  repository.ts
  snapshot-service.ts
  allocation-engine.ts
  cashflow-engine.ts
  policy-engine.ts
  retirement-projection.ts
  data-quality.ts
  types.ts
  index.ts
```

Adapt names to existing repository conventions, but preserve the separation of responsibilities.

### 4.1 Canonical CIO snapshot

Implement a server-only function similar in responsibility to:

```ts
buildCioSnapshot({ workspaceId, asOfDate }): Promise<CioSnapshot>
```

The snapshot must be the single authoritative input for the CIO page and Ask Nest CIO tools. It must contain at least:

- `asOfDate`
- workspace base currency
- financial asset totals using current Nest semantics without double counting
- planning balance sheet totals, clearly separated from current Nest dashboard net worth
- liquid, restricted, and locked amounts
- investable and retirement-included amounts
- asset-class allocation
- geographic allocation
- optional single-security allocation where explicitly configured
- latest valuation dates and staleness
- recurring-flow summary
- externally contributed annual amount
- internal reallocation annual amount
- essential monthly expense assumption
- emergency liquidity runway
- policy exceptions
- retirement projection inputs
- completeness percentage and concrete missing-data warnings
- evidence/source references suitable for safe UI links and Ask Nest grounding

Reuse existing canonical services such as `lib/net-worth.ts` and latest-investment-entry ordering where appropriate. Do not independently reimplement existing financial semantics. Do not add `FinancialAccount.startingCents` and budget-envelope balances together if that would double count real and virtual money.

### 4.2 Explicit investment profile

Add an additive one-to-one planning profile for each `InvestmentAccount`. It should support concepts equivalent to:

- liquidity class: immediate, liquid, restricted, locked
- portfolio role: emergency, core, stabilizer, satellite, goal, other
- risk level
- include in retirement projection
- optional lock-until date
- classification status/source, with user-confirmed classification distinguishable from a suggestion
- optional notes

Do not replace or silently reinterpret the existing `InvestmentAccount.liquid` field. Preserve old behavior and use a documented fallback only when no CIO profile exists.

### 4.3 Look-through exposure

Add explicit weighted exposure slices for an investment account. Support independent dimensions:

- asset class
- geography
- optional security/ticker

Store weights as integer basis points. For each configured account and dimension, validate that weights total exactly 10,000 basis points. Use stable unique constraints and bounded strings.

Suggested asset classes:

- CASH
- FIXED_INCOME
- EQUITY
- REIT
- COMMODITY
- PROPERTY
- ALTERNATIVE
- UNKNOWN

Suggested geography keys:

- SINGAPORE
- UNITED_STATES
- CHINA
- DEVELOPED_EX_US
- EMERGING_EX_CHINA
- GLOBAL
- UNKNOWN

These are planning classifications, not accounting entries. Missing classifications must appear under `UNKNOWN` and reduce the completeness score; they must never disappear from totals.

When allocating account cents across weighted slices, use deterministic rounding so the sum of allocated cents exactly equals the account's current value. Add tests for rounding and remainder assignment.

### 4.4 Manual planning positions

Add a workspace-owned planning position for an asset or liability not already represented by an existing Nest investment/account. This enables optional entry of items such as a home, mortgage, CPF-like retirement balance, or other external planning position.

At minimum support:

- ASSET or LIABILITY
- category
- label
- current value in integer cents
- as-of date
- liquidity class
- include in investable allocation
- include in retirement projection
- optional notes

These positions must be displayed as **planning balance-sheet items** and must not alter the existing dashboard/public net-worth service unless a separate future decision explicitly changes BR-054.

### 4.5 Recurring flows

Add workspace-owned recurring planning flows with:

- type: `EXTERNAL_CONTRIBUTION`, `INTERNAL_REALLOCATION`, or `EXTERNAL_WITHDRAWAL`
- optional source account/investment reference
- optional destination investment reference
- amount in integer cents
- cadence: weekly, monthly, quarterly, annual
- active date range
- include in retirement projection
- user label and notes

The annual contribution engine must:

- count only external contributions as new wealth;
- exclude internal reallocations from new contributions;
- subtract planned external withdrawals when configured;
- return a source breakdown instead of only one number;
- prevent obvious double counting when a flow is linked to an existing planning item.

### 4.6 Household CIO profile and policy

Add an explicit workspace-owned profile and policy. Use existing serialized-JSON conventions only if SQL Server/Prisma schema support makes normalized rows impractical; validate all serialized structures through Zod on read and write.

The profile should support:

- primary birth date or current age source
- optional partner birth date
- target retirement age or date
- target monthly retirement spending in today's money
- essential monthly household spending
- minimum immediate bank cash
- inflation rate in basis points
- bear/base/bull nominal return assumptions in basis points
- sustainable withdrawal rate in basis points
- optional annual external-contribution override, with the derived value and override source both visible

The investment policy should support:

- asset-class min/target/max bands
- minimum liquidity reserve in cents and/or months
- maximum account/product concentration
- maximum single-security concentration where security exposures exist
- optional geographic concentration limits
- maximum satellite allocation
- boolean rules for options, margin, leverage, and additional ILP-style top-ups

Do not invent default allocation targets and present them as the user's policy. Provide safe initial defaults only for non-opinionated mechanics, and require user confirmation for allocation bands and investment constraints.

Audit policy/profile changes using the repository's established workspace audit pattern where appropriate.

---

## 5. Deterministic calculation engines

Implement pure, well-tested functions for:

- latest current value selection
- investable/retirement/liquidity totals
- asset-class and geography allocation
- concentration analysis
- annualized recurring flows
- liquidity runway
- policy-band comparison
- setup completeness and staleness
- retirement future-value projections

### Retirement projection requirements

Implement deterministic bear/base/bull yearly projections from the current date to target retirement age/date.

Inputs must include:

- current retirement-included assets
- annual external contribution
- optional contribution growth rate if configured
- bear/base/bull nominal returns
- inflation
- target retirement date/age
- target spending in today's money
- sustainable withdrawal rate

Outputs must include:

- yearly nominal points for all three scenarios
- yearly real-value points in today's purchasing power
- estimated nominal and real fund at retirement
- estimated sustainable monthly retirement income
- target-fund gap or surplus
- the assumptions used, explicitly echoed back

Persisted money remains integer cents. Use deterministic rounding and explicit rate scales. Do not use unbounded floating-point money arithmetic. Do not add Monte Carlo in this change.

### Policy engine requirements

Return structured exceptions with stable codes, severity, actual value, policy threshold, evidence, and suggested review action. Include at least:

- `DATA_INCOMPLETE`
- `STALE_VALUATION`
- `LIQUIDITY_BELOW_FLOOR`
- `ASSET_CLASS_OUTSIDE_BAND`
- `ACCOUNT_CONCENTRATION`
- `SECURITY_CONCENTRATION`
- `GEOGRAPHY_CONCENTRATION`
- `SATELLITE_ALLOCATION_EXCEEDED`
- `RETIREMENT_TARGET_GAP`

Prioritize data-quality and liquidity exceptions before optimization recommendations.

---

## 6. API design

Add a documented `/api/cio` route family. Follow existing route, Zod, security, no-store, error-envelope, workspace, and OpenAPI conventions.

At minimum provide functionality equivalent to:

- `GET /api/cio/overview`
- `GET/PATCH /api/cio/profile`
- `GET/PATCH /api/cio/policy`
- `GET/PUT /api/cio/investments/{investmentId}/profile`
- `GET/PUT /api/cio/investments/{investmentId}/exposures`
- CRUD for recurring flows
- CRUD for manual planning positions
- `POST /api/cio/retirement-projection`

You may combine closely related settings routes if an existing repository pattern supports it, but do not create one unbounded generic action endpoint.

Authorization:

- All reads require authenticated `VIEWER` access to the active workspace.
- Configuration writes require at least `EDITOR` and must verify every referenced account/position belongs to the active workspace.
- The client must not be able to override workspace identity in a CIO request body.
- Private responses are `Cache-Control: no-store` and scoped by cookie/workspace.

No CIO metadata write is a financial posting. Do not use the posting service for planning metadata. Conversely, do not mutate balances from CIO routes.

Bound all arrays, labels, notes, exposure slices, and projection horizons.

Update `lib/openapi.ts`, regenerate `generated/openapi.json`, and document the route family in `docs/api/cio.md` and the API index.

---

## 7. CIO user interface

Add a canonical workspace route at `/w/{workspaceId}/cio` through the current catch-all workspace dispatcher and navigation system.

Use the existing shared UI architecture:

- `PageFrame`
- `PageHeader`
- shared `Button`, controls, dialogs, form fields, query states, route states, and data-view primitives
- React Query with workspace-scoped query keys
- `workspaceFetch`/`apiFetch`
- current design tokens and responsive patterns

Suggested component split:

```text
components/cio-page.tsx                 # thin controller only
components/cio/cio-overview.tsx
components/cio/cio-health-summary.tsx
components/cio/cio-allocation-card.tsx
components/cio/cio-liquidity-card.tsx
components/cio/cio-policy-exceptions.tsx
components/cio/cio-retirement-card.tsx
components/cio/cio-setup-dialog.tsx
components/cio/cio-investment-profile-dialog.tsx
components/cio/charts/allocation-chart.tsx
components/cio/charts/retirement-projection-chart.tsx
hooks/use-cio-overview.ts
```

Do not create another 1,000–3,000 line page controller and do not raise a UI component exception without a documented reason and extraction plan.

### CIO page content

Show:

1. Data-completeness and valuation-freshness status.
2. Planning net worth, financial assets, investable assets, retirement-included assets, and liabilities as separate metrics.
3. Asset-class allocation and configured target bands.
4. Geographic exposure and concentration exceptions.
5. Liquid/restricted/locked breakdown and emergency runway.
6. Recurring external contributions versus internal reallocations.
7. Bear/base/bull retirement projection with nominal/real toggle.
8. Structured policy exceptions, ordered by severity.
9. Setup actions for unclassified investments, missing assumptions, and stale data.
10. An **Ask CIO** action that opens or invokes Ask Nest with `/cio` page context.

Do not call the language model automatically on page load. The deterministic overview must render without an AI call.

### Charts

Reuse existing visualization components if suitable. The direct dependency catalog does not establish a charting library, so do not add a heavy chart dependency without a clear need and review. Prefer lazy-loaded, accessible SVG/CSS charts with:

- keyboard/readable labels;
- an underlying table or textual equivalent;
- no hidden reliance on color alone;
- stable layout geometry;
- responsive behavior at compact mobile widths.

---

## 8. Ask Nest integration

Do not place CIO calculation logic inside `lib/ai/` and do not make the model query Prisma directly.

Add a small CIO tool registry, for example:

```text
lib/ai/tools/cio-tools.ts
```

Register it behind the existing stable Ask Nest tool registry without renaming or breaking existing tools. This should be the first domain-decomposed tool registry, not a broad rewrite of every current tool.

Add bounded read-only tools equivalent to:

- `get_cio_overview`
- `get_cio_policy_status`
- `run_cio_retirement_projection`
- `compare_cio_contribution_scenarios`

Tool requirements:

- No `workspaceId` argument exposed to the model.
- Use the already-authorized context supplied by Ask Nest.
- Validate all model arguments with Zod.
- Return bounded structured data, evidence links, `asOfDate`, assumptions, and completeness warnings.
- Never return mutation handles, secrets, raw database rows, or unnecessary identifiers.
- Never silently omit unknown/unclassified values.
- Never send private household names, balances, account labels, or transaction terms to public news/search providers.

Update deterministic intent/planning hints so questions about retirement, asset allocation, liquidity, emergency runway, policy exceptions, recurring contributions, and CIO status route to the CIO tools.

Update the Ask Nest system behavior so CIO answers clearly separate:

- facts from Nest data;
- deterministic calculations;
- user-configured assumptions;
- policy-based recommendation or review action;
- missing data and uncertainty.

A grounded CIO answer must include the data date and must not present a model-created number as authoritative.

Do not implement security-specific buy/sell/hold calls. For questions such as “Should I divest Income+?”, answer in policy terms: current fixed-income allocation, target band, liquidity need, retirement impact, and relevant trade-offs. Do not execute or create an order.

---

## 9. Data quality and safety behavior

The feature must degrade honestly.

- If an investment has no latest entry, report it as missing; do not assume zero without labeling it.
- If an investment is unclassified, include its value under `UNKNOWN`.
- If exposure weights do not total 10,000 bps, reject the write.
- If a valuation is stale, show the age and warning.
- If essential monthly expenses are not configured, do not fabricate emergency months.
- If retirement age or assumptions are missing, disable the projection with a precise setup action.
- If an annual contribution override is used, show the derived amount and the override side by side.
- If an internal reallocation is configured, show it separately and exclude it from new-wealth projections.
- If planning positions duplicate an existing investment, surface a warning rather than trying to infer which record is correct.

All logs and telemetry must contain identifiers, counts, categories, duration, and status only—not private balances, full labels, model prompts, or tool payloads.

---

## 10. Database and migration requirements

- Make additive changes to `prisma/schema.prisma`.
- Create a new forward migration; never edit an applied migration.
- Add workspace and dominant-query indexes.
- Add unique constraints for one-to-one investment profiles and exposure dimension/key pairs.
- Add SQL checks where the repository uses them and Prisma cannot express important state bounds.
- Enforce cross-row exposure-total validation in the domain service transaction.
- Keep deletes and cascades deliberate. Deleting an investment account may cascade its CIO profile/exposures; confirm that behavior against existing investment deletion semantics and test it.
- Update the empty-database baseline only through the repository's supported process if required.

Use synthetic test data only.

---

## 11. Tests and evaluation

Add focused tests before or alongside implementation.

### Pure-domain tests

Cover:

- exact allocation of cents across exposure basis points;
- deterministic remainder handling;
- unknown exposure inclusion;
- liquid/restricted/locked totals;
- internal reallocation excluded from contribution total;
- external contribution annualization for every cadence;
- planning assets and liabilities kept separate from existing net-worth semantics;
- emergency-runway calculation and missing-expense behavior;
- policy band and concentration exceptions;
- retirement projection at zero return, known return, no contribution, extra contribution, and invalid horizon;
- nominal versus real values;
- target gap/surplus and withdrawal-income calculation.

### Route/security tests

Cover:

- unauthenticated access;
- wrong workspace;
- VIEWER read access;
- VIEWER write denial;
- EDITOR valid write;
- referenced investment from another workspace;
- invalid exposure sums;
- oversized arrays/notes;
- private no-store behavior;
- stable sanitized errors.

### Ask Nest tests

Cover:

- tool registry remains read-only;
- CIO tools do not accept a workspace override;
- correct workspace scoping;
- evidence and `asOfDate` returned;
- missing/unknown data is visible;
- retirement values originate from the deterministic service;
- no mutation or order-execution tool is introduced.

Add synthetic golden evaluation cases such as:

- “What is my true asset allocation?”
- “How much of my portfolio is liquid?”
- “Am I on track to retire at 60?”
- “What happens if I invest an extra $10,000 per year?”
- “Is my emergency fund below policy?”
- “Which investments are stale or unclassified?”
- “Should I reduce my fixed-income allocation?”

### UI tests

Cover:

- canonical CIO workspace routing;
- workspace-scoped query keys;
- initial/loading/error/empty/incomplete states;
- setup dialog validation;
- chart textual fallback/accessibility;
- no new unreviewed component-size exception.

Run at minimum:

```bash
npm run check
npm run build
npm run openapi:check
npm run test:ui
npm run ui:check
npm run ui:metrics:check
```

Run focused CIO/Ask Nest tests throughout. Run `npm run ai:eval` if the required AI configuration is available; otherwise state explicitly that it was not run and why. Run SQL Server integration gates if the environment supports them.

Do not update a performance baseline merely to hide a regression.

---

## 12. Documentation requirements

Create or update:

- `docs/architecture/adr/ADR-007-read-only-cio-decision-support.md`
- `docs/modules/cio.md`
- `docs/api/cio.md`
- `docs/architecture/overview.md`
- `docs/architecture/system-design.md`
- `docs/architecture/repository-structure.md`
- `docs/business/business-rules.md`
- `docs/business/traceability.md`
- `docs/database/schema.md`
- `docs/ai/feature-map.md`
- `docs/ai/business-rules.md`
- `docs/ai/common-patterns.md`
- `docs/ai/pitfalls.md`
- `docs/reference/file-catalog.md`
- `docs/reference/service-contracts.md`
- `docs/SUMMARY.md`
- relevant API index and testing documentation

Add stable business-rule IDs for at least:

- CIO remains read-only decision support.
- Existing structured Nest data is authoritative for calculations.
- Planning net worth is separate from the existing dashboard/public projection.
- Classifications and assumptions are explicit and reviewable.
- Internal reallocations are not new contributions.
- Projection assumptions and data dates are always shown.
- Unknown/stale data is surfaced rather than silently excluded.

---

## 13. Completion criteria

The work is complete only when all of the following are true:

- `/w/{workspaceId}/cio` renders a useful deterministic overview without calling AI.
- A user can configure household assumptions, policy, investment profiles/exposures, recurring flows, and manual planning positions.
- The snapshot does not double count real cash, virtual envelopes, internal reallocations, or planning positions.
- The retirement chart is generated by tested application code.
- Ask Nest can answer CIO questions through bounded read-only tools and evidence.
- Existing Ask Nest tools and existing investment/net-worth behavior remain compatible.
- No trading, posting, or mutation authority has been given to the model.
- New APIs are workspace-scoped, documented, bounded, no-store, and covered by role/isolation tests.
- Additive migration and Prisma schema are valid.
- OpenAPI is regenerated and clean.
- `npm run check` and `npm run build` pass.
- Documentation is updated in the same change.

---

## 14. Final handoff format

After implementation, provide:

1. Architecture summary.
2. Files added and materially changed.
3. Database migration summary.
4. API endpoints added.
5. Ask Nest tools added.
6. Calculation assumptions and rounding rules.
7. Security and privacy controls preserved.
8. Tests and commands run, with pass/fail status.
9. Any tests not run and the exact reason.
10. Manual verification steps.
11. Remaining risks and deliberately deferred Phase 2 work.

Do not claim completion if a required route, migration, test, or build remains broken.
