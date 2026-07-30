---
title: Nest CIO API
description: Workspace-scoped read and planning-metadata endpoints for Nest CIO.
audience: [engineers, API-consumers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-30
---

# Nest CIO API

## Contract

All routes use the active workspace from the authenticated session. The optional `X-Workspace-Id` header selects a tab-local workspace, and the server always revalidates membership and the documented role; request bodies never accept `workspaceId`. Reads require VIEWER. Planning-metadata writes require EDITOR and the shared same-origin check. Body-bearing writes additionally require JSON content type and bounded Zod contracts. Referenced-resource ownership is revalidated. Private responses are `no-store` and include the shared sanitized error envelope.

| Path | Methods | Access and success | Purpose |
| --- | --- | --- | --- |
| `/api/cio/overview` | GET | VIEWER; 200 | Canonical deterministic snapshot, warnings, policy status, and projection |
| `/api/cio/profile` | GET, PATCH | VIEWER/EDITOR; 200 | Individual or household planning scope and assumptions; changes are workspace-audited |
| `/api/cio/policy` | GET, PATCH | VIEWER/EDITOR; 200 | Confirmed constraints, normalized asset bands, and geography limits |
| `/api/cio/investments/{investmentId}/profile` | GET, PUT | VIEWER/EDITOR; 200 | Explicit investment liquidity/role/risk/classification profile |
| `/api/cio/investments/{investmentId}/exposures` | GET, PUT | VIEWER/EDITOR; 200 | Full weighted exposure replacement; each dimension must total 10,000 bps |
| `/api/cio/recurring-flows` | GET, POST | VIEWER/EDITOR; 200/201 | List/create external contribution, internal reallocation, or withdrawal flows |
| `/api/cio/recurring-flows/{id}` | PATCH, DELETE | EDITOR; 200 | Update/delete one workspace flow |
| `/api/cio/planning-positions` | GET, POST | VIEWER/EDITOR; 200/201 | List/create planning-only assets and liabilities |
| `/api/cio/planning-positions/{id}` | PATCH, DELETE | EDITOR; 200 | Update/delete one planning position |
| `/api/cio/retirement-projection` | POST | VIEWER; 200 | Run a bounded read-only projection with optional validated scenario overrides |

GET and DELETE operations have no request body. The retirement projection uses POST for a bounded scenario input but is read-only, so it does not use the mutation-only origin check. Amounts are integer cents and rates/weights are integer basis points. Dates are ISO values as required by each schema. Array, text, and horizon caps are defined in `lib/domains/cio/contracts.ts` and reflected in the generated OpenAPI schemas.

Profile `planningScope` accepts `INDIVIDUAL` or `HOUSEHOLD`. Individual scope cannot include `partnerBirthDate`. Both retirement and essential spending accept zero; a zero essential-spending baseline makes emergency runway not applicable rather than missing.

## Safety behavior

Missing valuations remain missing, unconfigured exposure is allocated to `UNKNOWN`, and invalid exposure totals are rejected. Internal reallocations never enter the external-contribution total. Manual planning positions never alter dashboard/public net worth or underlying balances. For historical data dates, current bank controls updated after that date are excluded with a critical warning because Nest has no historical bank-balance series.

## Related files

- [`app/api/cio/`](../../app/api/cio/)
- [`lib/domains/cio/contracts.ts`](../../lib/domains/cio/contracts.ts)
- [CIO module](../modules/cio.md)

## Last Updated

2026-07-30
