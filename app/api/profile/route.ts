import { prisma } from "@/lib/prisma";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { normalizeWorkspaceRole } from "@/lib/workspace-roles";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(120),
});

const DeleteProfileSchema = z.object({
  confirmation: z.literal("DELETE MY ACCOUNT"),
}).strict();

export async function PATCH(request: Request) {
  const session = await getDatabaseReadyServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = UpdateProfileSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name.trim() },
    select: { id: true, name: true, email: true },
  });

  return NextResponse.json(user);
}

export async function DELETE(request: Request) {
  return runSecureApiRoute(request, {
    mutation: true,
    auth: { recent: true },
    noStore: true,
    errorMessage: "Failed to delete account",
  }, async ({ auth }) => {
    await parseJsonBody(request, DeleteProfileSchema, 1024);
    const userId = auth!.userId;
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      take: 500,
      select: { workspaceId: true, role: true, workspace: { select: { name: true } } },
    });
    const [createdBudgets, ownedBudgetSources, ownedMonthlySources, ownedPlanSources] = await Promise.all([
      prisma.budgetEnvelope.findMany({ where: { createdById: userId }, take: 5000, select: { workspaceId: true } }),
      prisma.budgetSource.findMany({ where: { ownerId: userId }, take: 5000, select: { workspaceId: true } }),
      prisma.monthlyBudgetSource.findMany({ where: { ownerId: userId }, take: 5000, select: { workspaceId: true } }),
      prisma.monthlyBudgetPlanSource.findMany({ where: { ownerId: userId }, take: 5000, select: { plan: { select: { workspaceId: true } } } }),
    ]);
    const recordOwnershipWorkspaceIds = new Set([
      ...createdBudgets.map((record) => record.workspaceId),
      ...ownedBudgetSources.map((record) => record.workspaceId),
      ...ownedMonthlySources.map((record) => record.workspaceId),
      ...ownedPlanSources.map((record) => record.plan.workspaceId),
    ]);
    const affectedWorkspaceIds = [...new Set([
      ...memberships.map((membership) => membership.workspaceId),
      ...recordOwnershipWorkspaceIds,
    ])];
    const otherMembers = affectedWorkspaceIds.length
      ? await prisma.workspaceMember.findMany({
          where: { workspaceId: { in: affectedWorkspaceIds }, userId: { not: userId } },
          orderBy: { createdAt: "asc" },
          take: 5000,
          select: { workspaceId: true, userId: true, role: true },
        })
      : [];
    const replacementOwnerByWorkspace = new Map<string, string>();
    const replacementMemberByWorkspace = new Map<string, string>();
    for (const member of otherMembers) {
      if (!replacementMemberByWorkspace.has(member.workspaceId)) {
        replacementMemberByWorkspace.set(member.workspaceId, member.userId);
      }
      if (normalizeWorkspaceRole(member.role) === "OWNER") {
        replacementOwnerByWorkspace.set(member.workspaceId, member.userId);
        replacementMemberByWorkspace.set(member.workspaceId, member.userId);
      }
    }
    const soleOwnedWorkspaces = memberships.filter(
      (membership) => normalizeWorkspaceRole(membership.role) === "OWNER" && !replacementOwnerByWorkspace.has(membership.workspaceId),
    );
    if (soleOwnedWorkspaces.length) {
      return Response.json({
        error: "Transfer ownership or delete each workspace where you are the only owner before deleting your account.",
        code: "SOLE_WORKSPACE_OWNER",
        workspaces: soleOwnedWorkspaces.map((membership) => ({ id: membership.workspaceId, name: membership.workspace.name })),
      }, { status: 409 });
    }
    const unassignedRecordWorkspaces = [...recordOwnershipWorkspaceIds].filter(
      (workspaceId) => !replacementMemberByWorkspace.has(workspaceId),
    );
    if (unassignedRecordWorkspaces.length) {
      const workspaces = await prisma.workspace.findMany({
        where: { id: { in: unassignedRecordWorkspaces } },
        take: 500,
        select: { id: true, name: true },
      });
      return Response.json({
        error: "Shared records need another workspace member before your account can be deleted.",
        code: "RECORD_OWNERSHIP_TRANSFER_REQUIRED",
        workspaces,
      }, { status: 409 });
    }

    await prisma.$transaction(async (db) => {
      for (const [workspaceId, replacementUserId] of replacementMemberByWorkspace) {
        await db.budgetEnvelope.updateMany({
          where: { workspaceId, createdById: userId },
          data: { createdById: replacementUserId },
        });
        await db.budgetSource.updateMany({
          where: { workspaceId, ownerId: userId },
          data: { ownerId: replacementUserId },
        });
        await db.monthlyBudgetSource.updateMany({
          where: { workspaceId, ownerId: userId },
          data: { ownerId: replacementUserId },
        });
        await db.monthlyBudgetPlanSource.updateMany({
          where: { ownerId: userId, plan: { workspaceId } },
          data: { ownerId: replacementUserId },
        });
      }
      if (memberships.length) {
        await db.workspaceAuditLog.createMany({
          data: memberships.map((membership) => ({
            workspaceId: membership.workspaceId,
            actorUserId: userId,
            action: "ACCOUNT_DELETED",
            details: "Member account deleted; retained financial records were anonymized.",
          })),
        });
      }
      await db.workspaceInvite.deleteMany({ where: { invitedById: userId } });
      await db.workspaceInvite.updateMany({ where: { invitedUserId: userId }, data: { invitedUserId: null } });
      await db.workspaceAuditLog.updateMany({ where: { actorUserId: userId }, data: { actorUserId: null } });
      await db.note.updateMany({ where: { createdById: userId }, data: { createdById: null } });
      await db.receivable.updateMany({ where: { fromUserId: userId }, data: { fromUserId: null } });
      await db.receivable.updateMany({ where: { toUserId: userId }, data: { toUserId: null } });
      await db.transaction.updateMany({ where: { voidedByUserId: userId }, data: { voidedByUserId: null } });
      await db.postingGroup.updateMany({ where: { actorUserId: userId }, data: { actorUserId: null } });
      await db.backgroundJob.updateMany({ where: { userId }, data: { userId: null } });
      await db.integrationOAuthState.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    });

    return Response.json({ ok: true });
  });
}
