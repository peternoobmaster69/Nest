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
import { withQueryTelemetry } from "@/lib/observability/query-telemetry";
import { ApiRequestError, runSecureApiRoute } from "@/lib/api-security";

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
  return runSecureApiRoute(request, { errorMessage: "Failed to load context" }, ({ requestId }) =>
    getContext(request, requestId),
  );
}

async function getContext(request: Request, requestId: string) {
  try {
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
    const selectedMembership = memberships.find((membership) => membership.workspaceId === activeWorkspaceId)
      ?? memberships[0];
    if (!selectedMembership) {
      return NextResponse.json(emptyContextResponse([], isAdmin));
    }
    const selectedWorkspaceId = selectedMembership.workspaceId;

    const [workspace, pendingInviteCount] = await withQueryTelemetry(
      { domain: "workspaces", operation: "context_workspace", requestId, workspaceId: selectedWorkspaceId },
      () => Promise.all([
      loadContextWorkspace(selectedWorkspaceId),
      prisma.workspaceInvite.count({
        where: { workspaceId: selectedWorkspaceId, status: "PENDING" },
      }),
      ]),
    );

    if (!workspace) {
      return NextResponse.json(emptyContextResponse(workspaceSummaries, isAdmin));
    }

    const response = NextResponse.json({
      ...workspaceContextResponse(workspace, selectedMembership.role, pendingInviteCount),
      workspaces: workspaceSummaries,
      setupProgress: {
        bankAccountCount: workspace.financials.filter((account) => account.kind === "BANK").length,
        subAccountCount: selectedMembership.workspace._count.budgetEnvelopes,
        creditCardCount: selectedMembership.workspace._count.creditCards,
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

    throw error;
  }
}

function loadContextWorkspace(workspaceId: string) {
  return prisma.workspace.findUnique({
    where: { id: workspaceId },
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
        select: { id: true, name: true, kind: true },
      },
      members: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      },
      _count: { select: { members: true } },
    },
  });
}

function workspaceContextResponse(
  workspace: NonNullable<Awaited<ReturnType<typeof loadContextWorkspace>>>,
  membershipRole: string,
  pendingInviteCount: number,
) {
  const role = normalizeWorkspaceRole(membershipRole);
  const isOwner = role === "OWNER";
  return {
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
    accounts: workspace.financials.map((account) => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
    })),
  };
}

export async function PATCH(request: Request) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to update context" }, () =>
    updateContext(request),
  );
}

async function updateContext(request: Request) {
  try {
    const parsed = UpdateContextSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    if (parsed.data.activeWorkspaceId) {
      await requireWorkspaceAccess(parsed.data.activeWorkspaceId);
    }

    const updated = await updateWorkspaceDefaults(parsed.data);

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
    if (error instanceof ApiAuthError || error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}

type ContextUpdate = z.infer<typeof UpdateContextSchema>;

async function validateDefaultAccount(workspaceId: string, accountId: string | null | undefined) {
  if (!accountId) return;
  const account = await prisma.financialAccount.findFirst({
    where: { id: accountId, workspaceId, kind: "BANK", isActive: true },
    select: { id: true },
  });
  if (!account) throw new ApiRequestError(400, "Invalid default receivable account.");
}

async function validateDefaultBudget(workspaceId: string, budgetId: string | null | undefined, accountId: string | null) {
  if (!budgetId) return;
  const budget = await prisma.budgetEnvelope.findFirst({
    where: { id: budgetId, workspaceId, isActive: true },
    select: { id: true, accountId: true },
  });
  if (!budget) throw new ApiRequestError(400, "Invalid default receivable subaccount.");
  if (!accountId || budget.accountId !== accountId) {
    throw new ApiRequestError(400, "Default receivable subaccount must belong to the selected default account.");
  }
}

async function updateWorkspaceDefaults(data: ContextUpdate) {
  const { workspaceId, baseCurrency, receivableDefaultAccountId, receivableDefaultBudgetId } = data;
  if (!workspaceId) return null;
  const hasDefaults = baseCurrency !== undefined || receivableDefaultAccountId !== undefined || receivableDefaultBudgetId !== undefined;
  if (!hasDefaults) return null;

  await requireWorkspaceRole(workspaceId, "OWNER");
  const existingWorkspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { receivableDefaultAccountId: true, receivableDefaultBudgetId: true },
  });
  if (!existingWorkspace) throw new ApiRequestError(404, "Workspace not found.");

  await validateDefaultAccount(workspaceId, receivableDefaultAccountId);
  const nextAccountId = receivableDefaultAccountId === undefined
    ? existingWorkspace.receivableDefaultAccountId
    : receivableDefaultAccountId;
  await validateDefaultBudget(workspaceId, receivableDefaultBudgetId, nextAccountId);

  let nextBudgetId = receivableDefaultBudgetId === undefined
    ? existingWorkspace.receivableDefaultBudgetId
    : receivableDefaultBudgetId;
  if (receivableDefaultAccountId !== undefined && receivableDefaultBudgetId === undefined) {
    nextBudgetId = null;
  }

  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { baseCurrency, receivableDefaultAccountId, receivableDefaultBudgetId: nextBudgetId },
    select: { id: true, baseCurrency: true, receivableDefaultAccountId: true, receivableDefaultBudgetId: true },
  });
}
