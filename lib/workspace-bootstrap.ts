import { prisma } from "@/lib/prisma";

type UserIdentity = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export async function ensureUserWithDefaultWorkspace(user: UserIdentity) {
  const storedUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { activeWorkspaceId: true },
  });

  const activeMembership = storedUser?.activeWorkspaceId
    ? await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: storedUser.activeWorkspaceId,
            userId: user.id,
          },
        },
        include: {
          workspace: {
            select: { id: true, name: true },
          },
        },
      })
    : null;

  if (activeMembership) {
    return activeMembership.workspace;
  }

  const existingMembership = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: {
      workspace: {
        select: { id: true, name: true },
      },
    },
  });

  if (existingMembership?.workspaceId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { activeWorkspaceId: existingMembership.workspaceId },
    });
    return existingMembership.workspace;
  }

  const workspaceName = user.name?.trim() ? `${user.name.trim()}'s Workspace` : "My Workspace";

  const workspace = await prisma.workspace.create({
    data: {
      name: workspaceName,
      baseCurrency: "SGD",
      isShared: false,
    },
    select: { id: true, name: true },
  });

  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER",
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { activeWorkspaceId: workspace.id },
  });

  await prisma.workspaceAuditLog.create({
    data: {
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "WORKSPACE_CREATED",
      details: `Default workspace "${workspace.name}" created automatically.`,
    },
  });

  return workspace;
}
