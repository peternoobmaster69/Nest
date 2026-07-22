import { getActiveWorkspaceCookie } from "@/lib/active-workspace";
import { WORKSPACE_ID_HEADER } from "@/lib/workspace-request";
import { prisma } from "@/lib/prisma";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { headers } from "next/headers";
import {
  hasMinimumWorkspaceRole,
  normalizeWorkspaceRole,
  type WorkspaceRole,
} from "@/lib/workspace-roles";

export { normalizeWorkspaceRole, WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/workspace-roles";

function assertMinimumRole(role: WorkspaceRole, minimumRole: WorkspaceRole) {
  if (!hasMinimumWorkspaceRole(role, minimumRole)) {
    throw new ApiAuthError(403, "Forbidden");
  }
}

export class ApiAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireSessionUserId() {
  const session = await getDatabaseReadyServerSession();
  const userId = session?.user?.id;
  if (!userId) {
    throw new ApiAuthError(401, "Unauthorized");
  }
  return userId;
}

export async function requireRecentAuthentication(maxAgeSeconds = 10 * 60) {
  const session = await getDatabaseReadyServerSession();
  const userId = session?.user?.id;
  const authenticatedAt = session?.user?.authenticatedAt;
  if (!userId) throw new ApiAuthError(401, "Unauthorized");
  if (!authenticatedAt || Date.now() - authenticatedAt * 1000 > maxAgeSeconds * 1000) {
    throw new ApiAuthError(401, "Recent authentication required");
  }
  return userId;
}

export async function requireWorkspaceAccess(
  requestedWorkspaceId?: string | null,
  minimumRole: WorkspaceRole = "VIEWER",
) {
  const userId = await requireSessionUserId();
  const requestWorkspaceId = (await headers()).get(WORKSPACE_ID_HEADER)?.trim() || null;
  const effectiveWorkspaceId = requestedWorkspaceId || requestWorkspaceId;

  if (effectiveWorkspaceId) {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: effectiveWorkspaceId,
          userId,
        },
      },
      select: { workspaceId: true, role: true },
    });

    if (!member) {
      throw new ApiAuthError(403, "Forbidden");
    }

    const role = normalizeWorkspaceRole(member.role);
    assertMinimumRole(role, minimumRole);
    return {
      userId,
      workspaceId: effectiveWorkspaceId,
      role,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, activeWorkspaceId: true },
  });

  if (!user) {
    throw new ApiAuthError(401, "Unauthorized");
  }

  if (user.activeWorkspaceId) {
    const activeMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: user.activeWorkspaceId,
          userId,
        },
      },
      select: { workspaceId: true, role: true },
    });
    if (activeMembership) {
      const role = normalizeWorkspaceRole(activeMembership.role);
      assertMinimumRole(role, minimumRole);
      return {
        userId,
        workspaceId: activeMembership.workspaceId,
        role,
      };
    }
  }

  const cookieWorkspaceId = await getActiveWorkspaceCookie();
  if (cookieWorkspaceId) {
    const cookieMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: cookieWorkspaceId,
          userId,
        },
      },
      select: { workspaceId: true, role: true },
    });
    if (cookieMembership) {
      const role = normalizeWorkspaceRole(cookieMembership.role);
      assertMinimumRole(role, minimumRole);
      return {
        userId,
        workspaceId: cookieMembership.workspaceId,
        role,
      };
    }
  }

  const firstMembership = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true, role: true },
  });

  if (!firstMembership) {
    throw new ApiAuthError(404, "No workspace found");
  }

  const role = normalizeWorkspaceRole(firstMembership.role);
  assertMinimumRole(role, minimumRole);
  return {
    userId,
    workspaceId: firstMembership.workspaceId,
    role,
  };
}

export async function requireWorkspaceRole(
  requestedWorkspaceId: string | null | undefined,
  minimumRole: WorkspaceRole,
) {
  return requireWorkspaceAccess(requestedWorkspaceId, minimumRole);
}

export async function requireSensitiveWorkspaceAction(workspaceId: string) {
  const access = await requireWorkspaceRole(workspaceId, "OWNER");
  const recentUserId = await requireRecentAuthentication();
  if (access.userId !== recentUserId) throw new ApiAuthError(401, "Unauthorized");
  return access;
}
