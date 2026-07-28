---
title: Workspaces and Collaboration Module
description: Tenant scope, roles, canonical navigation, context, setup, invitations, members, audit, and workspace settings.
audience: [engineers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Workspaces and collaboration

## Purpose

Isolate financial data by tenant while supporting invited household/team collaboration.

## Scope

Workspace CRUD/context/switch, membership roles, collaborators, invitations, audit, canonical URLs, and onboarding setup.

## Responsibilities

- Create a default workspace for a new user.
- Resolve canonical URL and tab-local active context.
- Verify membership and minimum role.
- Manage workspace name/shared state/currency/defaults/sidebar/rules/public settings.
- Invite, accept/decline, update, remove, and revoke collaborators.
- Audit security-sensitive changes.
- Report setup progress from actual bank/envelope/card state.

## Public APIs and important files

| File | Important surface |
| --- | --- |
| `lib/workspace-auth.ts` | `requireWorkspaceAccess`, role/recent-auth guards |
| `lib/workspace-roles.ts` | role normalization and comparison |
| `lib/workspace-entry.ts` | canonical path construction/parsing |
| `lib/workspace-client.ts` | workspace header propagation |
| `lib/workspace-bootstrap.ts` | default workspace creation |
| `lib/workspace-setup.ts` | required/recommended setup step calculation |
| `lib/domains/workspaces/collaborator-service.ts` | bounded collaborator lists |
| `lib/workspace-invite-email.ts` | escaped invitation email |
| `app/api/context/route.ts` | composite application context and owner settings |

## Internal workflow

URL/header/body candidate → session user → `WorkspaceMember` lookup → normalized role → scoped service/query. An ID from the client never replaces membership verification.

Invitation lifecycle: owner creates hashed token → recipient receives raw token → authenticated inspect → explicit accept/decline → membership/audit → optional revocation before response.

## Configuration

- Active-workspace cookie is HttpOnly preference/fallback.
- `ADMIN` is independent of workspace OWNER role.
- Base currency supports SGD/USD/EUR/GBP/AUD/JPY display values.

## Error handling

- 401 without session.
- 403 for missing/underprivileged membership.
- 404 when no workspace or referenced member/invite is available.
- Conflicts for ownership/self-removal/last-owner constraints where route code enforces them.

## Performance considerations

- Context is a broad aggregate and emits query-group telemetry.
- Collaborator/invite lists are cursor-bounded.
- Workspace changes remove prior workspace client caches.

## Security considerations

- OWNER-only member/default/public-link changes.
- Recent authentication for sensitive actions.
- Raw invite token never stored.
- Email content is escaped.
- Audit details must not expose token/secret values.

## Risks

- Using cookie/profile scope for a `/w/` request breaks tab isolation.
- Deleting a workspace has broad cascading impact and requires careful owner/recent-auth checks.
- Cross-workspace receivable source is an explicit exception, not permission to make general cross-tenant joins.

## Future extension points

- Per-domain permissions would extend role checks but must retain simple minimum-role semantics or introduce an explicit capability model.

## Related Files

- [Workspace API](../api/workspaces.md)
- [ADR-001](../architecture/adr/ADR-001-workspace-scoped-urls.md)
- [BR-001–BR-006](../business/business-rules.md)

## Dependencies

- Authentication, Prisma, email delivery.

## Assumptions

- One user can own/join many workspaces.

## Known Limitations

- Domain-specific role customization is not implemented.
- Workspace deletion recovery depends on database backup.

## Future Improvements

- Add last-owner invariant at database/service level if not already universal.

## Last Updated

2026-07-28
