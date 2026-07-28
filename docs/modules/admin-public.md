---
title: Administration and Public Sharing Module
description: Fail-closed administrator overview, API docs gating, public token projections, and operational safety.
audience: [engineers, operators, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Administration and public sharing

## Purpose

Expose necessary operational insight and deliberately minimal public projections without weakening normal workspace privacy.

## Scope

`/admin`, admin overview/records/jobs, `/api/openapi`, `/api-docs`, public net-worth/card-due endpoints, and share-link lifecycle.

## Responsibilities

- Permit one configured administrator email, case-insensitively.
- Fail closed when `ADMIN` is missing.
- Report users/workspaces, DB storage, job health, Ask Nest tokens/cost/quality, and secret presence without secret values.
- Gate API docs in production behind explicit enablement and admin access.
- Generate/revoke random workspace public token.
- Return minimal aggregate public data with rate limits and no-store.
- Audit share creation/revocation.

## Public APIs and important files

| File | Surface |
| --- | --- |
| `lib/admin-auth.ts` | `isAdminEmail`, `requireAdminPage` |
| `lib/admin-overview.ts` | `getAdminOverview` |
| `app/admin/page.tsx` | server-protected operations UI |
| `app/api/openapi/route.ts` | authenticated/admin generated spec |
| `lib/net-worth.ts` | minimal net-worth projection |
| `lib/public-card-dues.ts` | minimal selected-card statement projection |
| public-link/public routes | create/revoke/read |

## Internal workflow

Admin: server session → normalized configured-email match → bounded aggregate reads → sanitized UI.

Public share: authenticated OWNER creates token → token index lookup on public GET → verify enabled/token → minimal projection → no-store/rate-limited response → OWNER revokes and token becomes unusable.

## Configuration

- `ADMIN`.
- `ENABLE_API_DOCS`.
- Optional token pricing variables for estimated Ask Nest cost.

## Error handling

- Missing/wrong admin behaves unavailable/forbidden.
- Storage metadata failure does not fail entire overview.
- Public invalid/revoked token returns not found/unauthorized response without workspace enumeration.
- Cost estimate is omitted when rates are absent.

## Performance considerations

- Admin collections paginate after ten in UI and backend reads are bounded where implemented.
- Public projections aggregate only necessary data.
- Token lookup is indexed.

## Security considerations

- Admin is independent of workspace role and checked server-side.
- Never expose env values—only configured presence.
- Public tokens are bearer credentials; do not log/referrer-leak them.
- Public payloads omit account names, transaction detail, membership, and private notes.

## Risks

- Email-only admin policy is simple and creates a single configuration dependency.
- Public URLs can be shared/copied until revoked.
- Cost estimates are not Azure billing truth.

## Future extension points

- Multi-admin role with audited assignment.
- Token rotation/expiry and view audit if product requires it.

## Related Files

- [Operations/public API](../api/operations-public.md)
- [`tests/admin-access-contract.test.mjs`](../../tests/admin-access-contract.test.mjs)
- [`tests/public-net-worth-contract.test.mjs`](../../tests/public-net-worth-contract.test.mjs)

## Dependencies

- Authentication, workspace ownership, SQL aggregates.

## Assumptions

- One configured admin email is acceptable current policy.

## Known Limitations

- No admin RBAC, token expiry, or public-link access log is documented.

## Future Improvements

- Replace single-email administration with explicit audited roles if multi-operator support is needed.

## Last Updated

2026-07-28
