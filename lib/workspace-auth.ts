import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";

export class ApiAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireSessionUserId() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    throw new ApiAuthError(401, "Unauthorized");
  }
  return userId;
}

export async function requireWorkspaceAccess(requestedWorkspaceId?: string | null) {
  const userId = await requireSessionUserId();

  if (requestedWorkspaceId) {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: requestedWorkspaceId,
          userId,
        },
      },
      select: { workspaceId: true },
    });

    if (!member) {
      throw new ApiAuthError(403, "Forbidden");
    }

    return { userId, workspaceId: requestedWorkspaceId };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeWorkspaceId: true },
  });

  if (user?.activeWorkspaceId) {
    const activeMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: user.activeWorkspaceId,
          userId,
        },
      },
      select: { workspaceId: true },
    });
    if (activeMembership) {
      return { userId, workspaceId: activeMembership.workspaceId };
    }
  }

  const firstMembership = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });

  if (!firstMembership) {
    throw new ApiAuthError(404, "No workspace found");
  }

  return { userId, workspaceId: firstMembership.workspaceId };
}
