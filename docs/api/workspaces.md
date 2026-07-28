---
title: Workspaces, Context, Collaborators, and Invitations API
description: Endpoint contracts for tenant discovery, settings, switching, members, and one-time invitations.
audience: [engineers, API-consumers, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Workspaces, context, collaborators, and invitations API

## Purpose

Document the tenant boundary and collaboration lifecycle.

## Scope

See [API conventions](README.md) for cookie, header, origin, and error rules.

## Endpoints

| Operation | Auth | Request | Success example | Side effects/errors |
| --- | --- | --- | --- | --- |
| `GET /api/context` | Session/VIEWER | Header-selected workspace optional | `{"user":{...},"workspaces":[...],"workspace":{...},"setup":{...}}` | No bootstrap/auto-accept; no-store, query telemetry |
| `PATCH /api/context` | Session; OWNER for defaults | Body: optional `activeWorkspaceId`; or `workspaceId`, `baseCurrency`, nullable default account/envelope | `{"workspaceId":"ws","baseCurrency":"SGD","defaultAccountId":"a","defaultBudgetId":"b"}` | Validates default parent/child; sets preference cookie |
| `GET /api/workspaces` | Session | None | `{"workspaces":[{"id":"ws","role":"OWNER",...}]}` | Membership-derived list |
| `POST /api/workspaces` | Session | `{"name":"Household"}` (1–120) | `{"workspace":{...}}` (201) | Creates workspace and OWNER membership |
| `PATCH /api/workspaces/{id}` | OWNER+recent | Optional `name`, `isShared`, sidebar settings | `{"id":"ws","name":"..."}` | Audited settings change |
| `DELETE /api/workspaces/{id}` | OWNER+recent | No body | `{"ok":true}` | Broad cascade; cannot rely on recovery without backup |
| `POST /api/workspaces/switch` | VIEWER | `{"workspaceId":"ws"}` | `{"workspaceId":"ws","ok":true}` | Verifies only; canonical tab navigation remains primary |
| `GET /api/collaborators` | VIEWER | `workspaceId`; cursor/limit/search/status as supported by service | `{"members":{"items":[...],"pageInfo":{...}},"invites":{...}}` | Bounded member/invite collections |
| `PATCH /api/collaborators/{memberId}` | OWNER+recent | `{"role":"EDITOR"}` or VIEWER | `{"id":"member","role":"EDITOR"}` | Cannot change OWNER/self here; audit |
| `DELETE /api/collaborators/{memberId}` | OWNER+recent | None | `{"ok":true}` | Cannot remove OWNER/self; audit |
| `POST /api/collaborators/invite` | OWNER+recent | `workspaceId`, email, optional EDITOR/VIEWER role | `{"ok":true,"invite":{...},"inviteUrl":"...","emailSent":true}` (201) | Shared workspace only; 7-day token; email/push; audit |
| `DELETE /api/collaborators/invites/{inviteId}` | OWNER+recent | None | `{"ok":true}` | Revokes pending invite and clears token; audit |
| `GET /api/invitations/{token}` | Verified-email session | Token path | `{"workspace":{"name":"..."}, "role":"VIEWER","status":"PENDING",...}` | Exact invited email; 404 hides mismatch |
| `POST /api/invitations/{token}` | Verified-email recent session | `{"action":"accept"}` or `decline` | `{"ok":true,"accepted":true,"workspaceId":"ws"}` | Atomic one-time claim; 409 expired/used; audit |

## Context body details

Supported workspace settings visible in `UpdateContextSchema`:

- `activeWorkspaceId`: last-used fallback.
- `workspaceId`: workspace to configure.
- `baseCurrency`: SGD, USD, EUR, GBP, AUD, or JPY.
- `receivableDefaultAccountId`: active bank account or null.
- `receivableDefaultBudgetId`: active envelope under that account or null.

When the default account changes without an explicit envelope, the envelope is cleared.

## Example: create invitation

```http
POST /api/collaborators/invite
Content-Type: application/json
Cookie: ...
X-Workspace-Id: ws_123

{"workspaceId":"ws_123","email":"collaborator@example.test","role":"VIEWER"}
```

```json
{
  "ok": true,
  "invite": {
    "id": "invite_1",
    "invitedEmail": "collaborator@example.test",
    "role": "VIEWER",
    "status": "PENDING",
    "expiresAt": "2026-08-04T00:00:00.000Z"
  },
  "inviteUrl": "https://example.test/invitations/one-time-token",
  "emailSent": false
}
```

The raw token appears only in the delivery URL; the database stores SHA-256 hash.

## Security and workflow rules

- Workspace must be `isShared=true` before invitation.
- Invited email is trimmed/lowercased and must match a verified signed-in account.
- Existing member and active duplicate invite are rejected.
- OWNER role is not assignable by invitation/member update endpoints.
- All membership changes are audited.

## Related Files

- [`app/api/context/route.ts`](../../app/api/context/route.ts)
- [`lib/domains/workspaces/collaborator-service.ts`](../../lib/domains/workspaces/collaborator-service.ts)
- [Workspace module](../modules/workspaces.md)

## Dependencies

- Session/recent auth, workspace membership, optional email/push.

## Assumptions

- Invitation URLs are treated as temporary bearer secrets.

## Known Limitations

- Exact workspace deletion safeguards should be re-read in the route before changing deletion UX.
- Email delivery failure does not roll back the invite.

## Future Improvements

- Generate complete context response schema in OpenAPI.

## Last Updated

2026-07-28
