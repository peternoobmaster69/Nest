import { getActiveWorkspaceCookie, setActiveWorkspaceCookie } from "@/lib/active-workspace";
import { prisma } from "@/lib/prisma";
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
  isDatabaseUnavailableError,
} from "@/lib/database-errors";
import {
  ApiAuthError,
  normalizeWorkspaceRole,
  requireSessionUserId,
  requireWorkspaceAccess,
  requireWorkspaceRole,
} from "@/lib/workspace-auth";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminEmail } from "@/lib/admin-auth";
import { WORKSPACE_ID_HEADER } from "@/lib/workspace-request";
import { randomUUID } from "node:crypto";
import { withQueryTelemetry } from "@/lib/observability/query-telemetry";

const UpdateContextSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  activeWorkspaceId: z.string().min(1).optional(),
  baseCurrency: z.enum(["SGD", "USD", "EUR", "GBP", "AUD", "JPY"]).optional(),
  receivableDefaultAccountId: z.string().min(1).nullable().optional(),
  receivableDefaultBudgetId: z.string().min(1).nullable().optional(),
});

const DEFAULT_SIDEBAR_PAGES = {
  cio: true,
  budget: true,
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
  role: string;
};

function emptyContextResponse(workspaces: WorkspaceSummary[] = [], isAdmin = false) {
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
    setupProgress: {
      bankAccountCount: 0,
      subAccountCount: 0,
      creditCardCount: 0,
    },
    sidebarMoneyPages: DEFAULT_SIDEBAR_PAGES,
    publicNetWorthEnabled: false,
    publicNetWorthToken: null,
    isAdmin,
  };
}

function parseSidebarMoneyPages(value: string | null | undefined) {
  if (!value) return DEFAULT_SIDEBAR_PAGES;
  try {
    return JSON.parse(value) as Record<string, boolean>;
  } catch {
    return DEFAULT_SIDEBAR_PAGES;
  }
}

export async function GET(request: Request) {
  try {
    const requestId = randomUUID();
    const session = await getDatabaseReadyServerSession();
    const email = session?.user?.email?.toLowerCase();
    const isAdmin = isAdminEmail(email);
    const userId = await requireSessionUserId();
    const userLookup = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, activeWorkspaceId: true },
    });

    if (!userLookup?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const memberships = await withQueryTelemetry(
      { domain: "workspaces", operation: "context_memberships", requestId, workspaceId: null },
      () => prisma.workspaceMember.findMany({
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
                budgetEnvelopes: { where: { isActive: true } },
                transactions: true,
                receivables: true,
                creditCards: { where: { isActive: true } },
                investmentAccounts: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      }),
    );

    const requestedWorkspaceId = request.headers.get(WORKSPACE_ID_HEADER)?.trim() || null;
    if (requestedWorkspaceId) {
      await requireWorkspaceAccess(requestedWorkspaceId);
    }
    const cookieWorkspaceId = await getActiveWorkspaceCookie();
    const activeWorkspaceId = requestedWorkspaceId || cookieWorkspaceId || userLookup.activeWorkspaceId;
    const workspaceSummaries = memberships.map((membership) => ({
      id: membership.workspace.id,
      name: membership.workspace.name,
      role: normalizeWorkspaceRole(membership.role),
    }));
    const membershipWorkspaceIds = new Set(memberships.map((membership) => membership.workspaceId));
    const selectedWorkspaceId =
      (activeWorkspaceId && membershipWorkspaceIds.has(activeWorkspaceId) ? activeWorkspaceId : null) ||
      memberships[0]?.workspaceId ||
      null;

    if (!selectedWorkspaceId) {
      return NextResponse.json(emptyContextResponse([], isAdmin));
    }

    if (!membershipWorkspaceIds.has(selectedWorkspaceId)) {
      return NextResponse.json(emptyContextResponse(workspaceSummaries, isAdmin));
    }

    const [workspace, pendingInviteCount] = await withQueryTelemetry(
      { domain: "workspaces", operation: "context_workspace", requestId, workspaceId: selectedWorkspaceId },
      () => Promise.all([
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
          publicNetWorthEnabled: true,
          publicNetWorthToken: true,
          financials: {
            where: { isActive: true },
            orderBy: { createdAt: "asc" },
            take: 500,
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
      ]),
    );

    if (!workspace) {
      return NextResponse.json(emptyContextResponse(workspaceSummaries, isAdmin));
    }

    const selectedMembership = memberships.find(
      (membership) => membership.workspaceId === workspace.id,
    );
    const role = normalizeWorkspaceRole(selectedMembership?.role ?? "VIEWER");
    const isOwner = role === "OWNER";

    const response = NextResponse.json({
      workspaceId: workspace.id,
      defaultAccountId: workspace.receivableDefaultAccountId,
      defaultBudgetId: workspace.receivableDefaultBudgetId,
      defaultUserId: workspace.members[0]?.userId ?? null,
      baseCurrency: workspace.baseCurrency || "SGD",
      isShared: workspace.isShared,
      isCollaborative: workspace.isShared && (workspace._count.members > 1 || pendingInviteCount > 0),
      workspaceName: workspace.name,
      memberCount: workspace._count.members,
      pendingInviteCount: isOwner ? pendingInviteCount : 0,
      role,
      sidebarMoneyPages: parseSidebarMoneyPages(workspace.sidebarMoneyPages),
      publicNetWorthEnabled: isOwner ? workspace.publicNetWorthEnabled : false,
      publicNetWorthToken: isOwner ? workspace.publicNetWorthToken : null,
      workspaces: workspaceSummaries,
      accounts: workspace.financials.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
      })),
      setupProgress: {
        bankAccountCount: workspace.financials.filter((account) => account.kind === "BANK").length,
        subAccountCount: selectedMembership?.workspace._count.budgetEnvelopes ?? 0,
        creditCardCount: selectedMembership?.workspace._count.creditCards ?? 0,
      },
      isAdmin,
    });
    if (!requestedWorkspaceId && cookieWorkspaceId !== workspace.id) {
      return setActiveWorkspaceCookie(response, workspace.id);
    }
    return response;
  } catch (error) {
    if (error instanceof ApiAuthError) {
      if (error.status === 404) {
        return NextResponse.json(emptyContextResponse());
      }
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (isDatabaseUnavailableError(error)) {
      return NextResponse.json(
        {
          error: "Database unavailable",
          code: DATABASE_UNAVAILABLE_CODE,
          message: DATABASE_UNAVAILABLE_MESSAGE,
        },
        { status: 503 },
      );
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

    if (parsed.data.activeWorkspaceId) {
      await requireWorkspaceAccess(parsed.data.activeWorkspaceId);
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
      await requireWorkspaceRole(parsed.data.workspaceId, "OWNER");
      const existingWorkspace = await prisma.workspace.findUnique({
        where: { id: parsed.data.workspaceId },
        select: {
          receivableDefaultAccountId: true,
          receivableDefaultBudgetId: true,
        },
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
        select: {
          id: true,
          baseCurrency: true,
          receivableDefaultAccountId: true,
          receivableDefaultBudgetId: true,
        },
      });
    }

    const response = NextResponse.json({
      workspaceId: updated?.id ?? parsed.data.workspaceId ?? parsed.data.activeWorkspaceId ?? null,
      baseCurrency: updated?.baseCurrency ?? null,
      defaultAccountId: updated?.receivableDefaultAccountId ?? null,
      defaultBudgetId: updated?.receivableDefaultBudgetId ?? null,
      activeWorkspaceId: parsed.data.activeWorkspaceId ?? null,
    });
    if (parsed.data.activeWorkspaceId) {
      return setActiveWorkspaceCookie(response, parsed.data.activeWorkspaceId);
    }
    return response;
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update context", message }, { status: 500 });
  }
}
