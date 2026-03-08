import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { ApiAuthError, requireSessionUserId, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateContextSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  activeWorkspaceId: z.string().min(1).optional(),
  baseCurrency: z.enum(["SGD", "USD", "EUR", "GBP", "AUD", "JPY"]).optional(),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    const email = session?.user?.email?.toLowerCase();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (email) {
      const pending = await prisma.workspaceInvite.findMany({
        where: { invitedEmail: email, status: "PENDING" },
        select: { id: true, workspaceId: true, invitedById: true },
      });

      for (const invite of pending) {
        await prisma.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: invite.workspaceId,
              userId,
            },
          },
          update: {},
          create: {
            workspaceId: invite.workspaceId,
            userId,
            role: "MEMBER",
            invitedBy: invite.invitedById,
          },
        });

        await prisma.workspaceInvite.update({
          where: { id: invite.id },
          data: {
            status: "ACCEPTED",
            invitedUserId: userId,
            respondedAt: new Date(),
          },
        });

        await prisma.workspaceAuditLog.create({
          data: {
            workspaceId: invite.workspaceId,
            actorUserId: userId,
            action: "INVITE_ACCEPTED",
            details: `${email} joined workspace via email invite.`,
          },
        });
      }
    }

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          select: { id: true, name: true, baseCurrency: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const activeWorkspaceId = (await prisma.user.findUnique({
      where: { id: userId },
      select: { activeWorkspaceId: true },
    }))?.activeWorkspaceId;
    let selectedWorkspaceId =
      (activeWorkspaceId && memberships.some((m) => m.workspaceId === activeWorkspaceId) ? activeWorkspaceId : null) ||
      memberships[0]?.workspaceId ||
      null;

    // If active workspace is empty but user has another workspace with data, recover automatically.
    if (selectedWorkspaceId && memberships.length > 1) {
      const scoreWorkspace = async (workspaceId: string) => {
        const [budgetCount, txCount, receivableCount, cardCount, investmentCount] = await Promise.all([
          prisma.budgetEnvelope.count({ where: { workspaceId } }),
          prisma.transaction.count({ where: { workspaceId } }),
          prisma.receivable.count({ where: { workspaceId } }),
          prisma.creditCardAccount.count({ where: { workspaceId } }),
          prisma.investmentAccount.count({ where: { workspaceId } }),
        ]);
        return budgetCount + txCount + receivableCount + cardCount + investmentCount;
      };

      const selectedScore = await scoreWorkspace(selectedWorkspaceId);
      if (selectedScore === 0) {
        let bestWorkspaceId = selectedWorkspaceId;
        let bestScore = selectedScore;
        for (const membership of memberships) {
          if (membership.workspaceId === selectedWorkspaceId) continue;
          const score = await scoreWorkspace(membership.workspaceId);
          if (score > bestScore) {
            bestScore = score;
            bestWorkspaceId = membership.workspaceId;
          }
        }
        if (bestWorkspaceId !== selectedWorkspaceId) {
          selectedWorkspaceId = bestWorkspaceId;
          await prisma.user.update({
            where: { id: userId },
            data: { activeWorkspaceId: bestWorkspaceId },
          });
        }
      }
    }

    if (!selectedWorkspaceId) {
      return NextResponse.json({
        workspaceId: null,
        defaultAccountId: null,
        defaultUserId: null,
        baseCurrency: "SGD",
        isCollaborative: false,
        workspaceName: null,
        workspaces: [],
        accounts: [],
      });
    }

    const { workspaceId } = await requireWorkspaceAccess(selectedWorkspaceId);
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        financials: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
        },
        members: {
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json({
        workspaceId: null,
        defaultAccountId: null,
        defaultUserId: null,
        baseCurrency: "SGD",
        isCollaborative: false,
        workspaceName: null,
        workspaces: memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name })),
        accounts: [],
      });
    }

    return NextResponse.json({
      workspaceId: workspace.id,
      defaultAccountId: null,
      defaultUserId: workspace.members[0]?.userId ?? null,
      baseCurrency: workspace.baseCurrency || "SGD",
      isCollaborative: workspace.members.length > 1,
      workspaceName: workspace.name,
      workspaces: memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name })),
      accounts: workspace.financials.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
      })),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      if (error.status === 404) {
        return NextResponse.json({
          workspaceId: null,
          defaultAccountId: null,
          defaultUserId: null,
          baseCurrency: "SGD",
          isCollaborative: false,
          workspaceName: null,
          workspaces: [],
          accounts: [],
        });
      }
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load context", message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const parsed = UpdateContextSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const userId = await requireSessionUserId();

    if (parsed.data.activeWorkspaceId) {
      await requireWorkspaceAccess(parsed.data.activeWorkspaceId);
      await prisma.user.update({
        where: { id: userId },
        data: { activeWorkspaceId: parsed.data.activeWorkspaceId },
      });
    }

    let updated: { id: string; baseCurrency: string } | null = null;
    if (parsed.data.workspaceId && parsed.data.baseCurrency) {
      await requireWorkspaceAccess(parsed.data.workspaceId);
      updated = await prisma.workspace.update({
        where: { id: parsed.data.workspaceId },
        data: { baseCurrency: parsed.data.baseCurrency },
        select: { id: true, baseCurrency: true },
      });
    }

    return NextResponse.json({
      workspaceId: updated?.id ?? parsed.data.workspaceId ?? parsed.data.activeWorkspaceId ?? null,
      baseCurrency: updated?.baseCurrency ?? null,
      activeWorkspaceId: parsed.data.activeWorkspaceId ?? null,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update context", message }, { status: 500 });
  }
}
