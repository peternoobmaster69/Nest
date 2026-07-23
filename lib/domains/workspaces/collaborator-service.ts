import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api-security";
import { decodeCursor, MAX_CURSOR_LENGTH, toListEnvelope } from "@/lib/api/pagination";
import type { WorkspaceRole } from "@/lib/workspace-roles";

const CollaboratorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  memberCursor: z.string().trim().min(1).max(MAX_CURSOR_LENGTH).optional(),
  inviteCursor: z.string().trim().min(1).max(MAX_CURSOR_LENGTH).optional(),
  auditCursor: z.string().trim().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

function parseCursor(value: string | undefined, name: string) {
  if (!value) return null;
  try {
    const cursor = decodeCursor(value);
    const date = new Date(cursor.sortValue);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid cursor");
    return { ...cursor, date };
  } catch {
    throw new ApiRequestError(400, `Invalid ${name} cursor`);
  }
}

export async function getCollaborators(
  workspaceId: string,
  role: WorkspaceRole,
  request: Request,
) {
  const params = new URL(request.url).searchParams;
  const query = CollaboratorQuerySchema.parse({
    limit: params.get("limit") || undefined,
    memberCursor: params.get("memberCursor") || undefined,
    inviteCursor: params.get("inviteCursor") || undefined,
    auditCursor: params.get("auditCursor") || undefined,
  });
  const memberCursor = parseCursor(query.memberCursor, "member");
  const inviteCursor = parseCursor(query.inviteCursor, "invite");
  const auditCursor = parseCursor(query.auditCursor, "audit");
  const isOwner = role === "OWNER";

  const [workspace, members, invites, auditLogs] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, isShared: true },
    }),
    prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        ...(memberCursor ? {
          OR: [
            { createdAt: { gt: memberCursor.date } },
            { createdAt: memberCursor.date, id: { gt: memberCursor.id } },
          ],
        } : {}),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
    }),
    isOwner ? prisma.workspaceInvite.findMany({
      where: {
        workspaceId,
        status: "PENDING",
        ...(inviteCursor ? {
          OR: [
            { createdAt: { lt: inviteCursor.date } },
            { createdAt: inviteCursor.date, id: { lt: inviteCursor.id } },
          ],
        } : {}),
      },
      include: { invitedBy: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }) : Promise.resolve([]),
    isOwner ? prisma.workspaceAuditLog.findMany({
      where: {
        workspaceId,
        ...(auditCursor ? {
          OR: [
            { createdAt: { lt: auditCursor.date } },
            { createdAt: auditCursor.date, id: { lt: auditCursor.id } },
          ],
        } : {}),
      },
      include: { actorUser: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }) : Promise.resolve([]),
  ]);

  return {
    workspace,
    members: toListEnvelope(members, query.limit, (row) => ({ id: row.id, sortValue: row.createdAt.toISOString() })),
    invites: toListEnvelope(invites, query.limit, (row) => ({ id: row.id, sortValue: row.createdAt.toISOString() })),
    auditLogs: toListEnvelope(auditLogs, query.limit, (row) => ({ id: row.id, sortValue: row.createdAt.toISOString() })),
    role,
  };
}

