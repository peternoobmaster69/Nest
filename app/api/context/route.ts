import { prisma } from "@/lib/prisma";
import { ensureUserWithDefaultWorkspace } from "@/lib/workspace-bootstrap";
import { authOptions } from "@/lib/auth";
import { ApiAuthError, requireSessionUserId, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateContextSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  activeWorkspaceId: z.string().min(1).optional(),
  baseCurrency: z.enum(["SGD", "USD", "EUR", "GBP", "AUD", "JPY"]).optional(),
  receivableDefaultAccountId: z.string().min(1).nullable().optional(),
  receivableDefaultBudgetId: z.string().min(1).nullable().optional(),
});

const DEFAULT_SIDEBAR_MONEY_PAGES = {
  creditCards: true,
  creditTransactions: true,
  receivables: true,
  transactions: true,
  rewards: true,
  investments: true,
};

type WorkspaceSummary = {
  id: string;
  name: string;
};

function emptyContextResponse(workspaces: WorkspaceSummary[] = []) {
  return {
    workspaceId: null,
    defaultAccountId: null,
    defaultBudgetId: null,
    defaultUserId: null,
    baseCurrency: "SGD",
    isShared: false,
    isCollaborative: false,
    workspaceName: null,
    memberCount: 0,
    pendingInviteCount: 0,
    workspaces,
    accounts: [],
    sidebarMoneyPages: DEFAULT_SIDEBAR_MONEY_PAGES,
  };
}

function parseSidebarMoneyPages(value: string | null | undefined) {
  if (!value) return DEFAULT_SIDEBAR_MONEY_PAGES;
  try {
    return JSON.parse(value) as Record<string, boolean>;
  } catch {
    return DEFAULT_SIDEBAR_MONEY_PAGES;
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.toLowerCase();
    const userLookup =
      session?.user?.id
        ? await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { id: true, activeWorkspaceId: true },
          })
        : email
          ? await prisma.user.findUnique({
              where: { email },
              select: { id: true, activeWorkspaceId: true },
            })
          : null;

    if (!userLookup?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = userLookup.id;
    await ensureUserWithDefaultWorkspace({
      id: userId,
      email,
      activeWorkspaceId: userLookup.activeWorkspaceId,
      name: session?.user?.name,
    });

    if (email) {
      const pending = await prisma.workspaceInvite.findMany({
        where: { invitedEmail: email, status: "PENDING" },
        select: { id: true, workspaceId: true, invitedById: true },
      });

      if (pending.length) {
        const respondedAt = new Date();
        await prisma.$transaction([
          ...pending.map((invite) =>
            prisma.workspaceMember.upsert({
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
            }),
          ),
          prisma.workspaceInvite.updateMany({
            where: { id: { in: pending.map((invite) => invite.id) } },
            data: {
              status: "ACCEPTED",
              invitedUserId: userId,
              respondedAt,
            },
          }),
          prisma.workspaceAuditLog.createMany({
            data: pending.map((invite) => ({
              workspaceId: invite.workspaceId,
              actorUserId: userId,
              action: "INVITE_ACCEPTED",
              details: `${email} joined workspace via email invite.`,
            })),
          }),
        ]);
      }
    }

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            baseCurrency: true,
            receivableDefaultAccountId: true,
            receivableDefaultBudgetId: true,
            sidebarMoneyPages: true,
            _count: {
              select: {
                budgetEnvelopes: true,
                transactions: true,
                receivables: true,
                creditCards: true,
                investmentAccounts: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const activeWorkspaceId = userLookup.activeWorkspaceId;
    const workspaceSummaries = memberships.map((membership) => ({
      id: membership.workspace.id,
      name: membership.workspace.name,
    }));
    const membershipWorkspaceIds = new Set(memberships.map((membership) => membership.workspaceId));
    let selectedWorkspaceId =
      (activeWorkspaceId && membershipWorkspaceIds.has(activeWorkspaceId) ? activeWorkspaceId : null) ||
      memberships[0]?.workspaceId ||
      null;

    if (!activeWorkspaceId && selectedWorkspaceId && memberships.length > 1) {
      const scores = memberships.map((membership) => ({
        workspaceId: membership.workspaceId,
        score:
          membership.workspace._count.budgetEnvelopes +
          membership.workspace._count.transactions +
          membership.workspace._count.receivables +
          membership.workspace._count.creditCards +
          membership.workspace._count.investmentAccounts,
      }));
      const best = scores.reduce((currentBest, candidate) => (
        candidate.score > currentBest.score ? candidate : currentBest
      ));

      if (best.score > 0 && best.workspaceId !== selectedWorkspaceId) {
        selectedWorkspaceId = best.workspaceId;
        await prisma.user.update({
          where: { id: userId },
          data: { activeWorkspaceId: best.workspaceId },
        });
      }
    }

    if (!selectedWorkspaceId) {
      return NextResponse.json(emptyContextResponse());
    }

    if (!membershipWorkspaceIds.has(selectedWorkspaceId)) {
      return NextResponse.json(emptyContextResponse(workspaceSummaries));
    }

    const [workspace, pendingInviteCount] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: selectedWorkspaceId },
        select: {
          id: true,
          name: true,
          baseCurrency: true,
          receivableDefaultAccountId: true,
          receivableDefaultBudgetId: true,
          isShared: true,
          sidebarMoneyPages: true,
          financials: {
            where: { isActive: true },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              name: true,
              kind: true,
            },
          },
          members: {
            take: 1,
            orderBy: { createdAt: "asc" },
            select: { userId: true },
          },
          _count: {
            select: { members: true },
          },
        },
      }),
      prisma.workspaceInvite.count({
        where: { workspaceId: selectedWorkspaceId, status: "PENDING" },
      }),
    ]);

    if (!workspace) {
      return NextResponse.json(emptyContextResponse(workspaceSummaries));
    }

    return NextResponse.json({
      workspaceId: workspace.id,
      defaultAccountId: workspace.receivableDefaultAccountId,
      defaultBudgetId: workspace.receivableDefaultBudgetId,
      defaultUserId: workspace.members[0]?.userId ?? null,
      baseCurrency: workspace.baseCurrency || "SGD",
      isShared: workspace.isShared,
      isCollaborative: workspace.isShared && (workspace._count.members > 1 || pendingInviteCount > 0),
      workspaceName: workspace.name,
      memberCount: workspace._count.members,
      pendingInviteCount,
      sidebarMoneyPages: parseSidebarMoneyPages(workspace.sidebarMoneyPages),
      workspaces: workspaceSummaries,
      accounts: workspace.financials.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
      })),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      if (error.status === 404) {
        return NextResponse.json(emptyContextResponse());
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

    let updated: {
      id: string;
      baseCurrency: string;
      receivableDefaultAccountId: string | null;
      receivableDefaultBudgetId: string | null;
    } | null = null;
    if (
      parsed.data.workspaceId &&
      (
        parsed.data.baseCurrency !== undefined ||
        parsed.data.receivableDefaultAccountId !== undefined ||
        parsed.data.receivableDefaultBudgetId !== undefined
      )
    ) {
      await requireWorkspaceAccess(parsed.data.workspaceId);
      const existingWorkspace = await prisma.workspace.findUnique({
        where: { id: parsed.data.workspaceId },
        select: { receivableDefaultAccountId: true, receivableDefaultBudgetId: true },
      });
      if (!existingWorkspace) {
        return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
      }

      if (parsed.data.receivableDefaultAccountId) {
        const account = await prisma.financialAccount.findFirst({
          where: {
            id: parsed.data.receivableDefaultAccountId,
            workspaceId: parsed.data.workspaceId,
            kind: "BANK",
            isActive: true,
          },
          select: { id: true },
        });
        if (!account) {
          return NextResponse.json({ error: "Invalid default receivable account." }, { status: 400 });
        }
      }

      const nextAccountId =
        parsed.data.receivableDefaultAccountId === undefined
          ? existingWorkspace.receivableDefaultAccountId
          : parsed.data.receivableDefaultAccountId;

      if (parsed.data.receivableDefaultBudgetId) {
        const budget = await prisma.budgetEnvelope.findFirst({
          where: {
            id: parsed.data.receivableDefaultBudgetId,
            workspaceId: parsed.data.workspaceId,
            isActive: true,
          },
          select: { id: true, accountId: true },
        });
        if (!budget) {
          return NextResponse.json({ error: "Invalid default receivable subaccount." }, { status: 400 });
        }
        if (!nextAccountId || budget.accountId !== nextAccountId) {
          return NextResponse.json(
            { error: "Default receivable subaccount must belong to the selected default account." },
            { status: 400 },
          );
        }
      }

      let nextBudgetId =
        parsed.data.receivableDefaultBudgetId === undefined
          ? existingWorkspace.receivableDefaultBudgetId
          : parsed.data.receivableDefaultBudgetId;
      if (parsed.data.receivableDefaultAccountId !== undefined && parsed.data.receivableDefaultBudgetId === undefined) {
        nextBudgetId = null;
      }

      updated = await prisma.workspace.update({
        where: { id: parsed.data.workspaceId },
        data: {
          baseCurrency: parsed.data.baseCurrency,
          receivableDefaultAccountId:
            parsed.data.receivableDefaultAccountId === undefined
              ? undefined
              : parsed.data.receivableDefaultAccountId,
          receivableDefaultBudgetId: nextBudgetId,
        },
        select: { id: true, baseCurrency: true, receivableDefaultAccountId: true, receivableDefaultBudgetId: true },
      });
    }

    return NextResponse.json({
      workspaceId: updated?.id ?? parsed.data.workspaceId ?? parsed.data.activeWorkspaceId ?? null,
      baseCurrency: updated?.baseCurrency ?? null,
      defaultAccountId: updated?.receivableDefaultAccountId ?? null,
      defaultBudgetId: updated?.receivableDefaultBudgetId ?? null,
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
