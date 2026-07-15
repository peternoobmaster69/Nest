import { prisma } from "@/lib/prisma";
import { getAskNestHistoryRetentionDays } from "@/lib/ai/ask-nest-retention";

type StoredAnswer = {
  scope?: { toolsUsed?: unknown };
  evidence?: unknown;
  memoryUpdates?: unknown;
};

type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type AiCostRates = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

type DatabaseStorageRow = {
  dataAllocatedMb: unknown;
  dataUsedMb: unknown;
  logAllocatedMb: unknown;
  totalAllocatedMb: unknown;
};

function parseAnswerMetadata(answerJson: string) {
  try {
    const parsed = JSON.parse(answerJson) as StoredAnswer;
    const toolsUsed = Array.isArray(parsed.scope?.toolsUsed)
      ? parsed.scope.toolsUsed.filter((tool): tool is string => typeof tool === "string")
      : [];

    return {
      toolsUsed,
      evidenceCount: Array.isArray(parsed.evidence) ? parsed.evidence.length : 0,
      memoryUpdateCount: Array.isArray(parsed.memoryUpdates) ? parsed.memoryUpdates.length : 0,
    };
  } catch {
    return { toolsUsed: [], evidenceCount: 0, memoryUpdateCount: 0 };
  }
}

function tokenTotals(
  aggregate: { _sum: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } },
): TokenTotals {
  return {
    inputTokens: aggregate._sum.inputTokens ?? 0,
    outputTokens: aggregate._sum.outputTokens ?? 0,
    totalTokens: aggregate._sum.totalTokens ?? 0,
  };
}

function addTokenTotals(left: TokenTotals, right: TokenTotals): TokenTotals {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function parseUsdRate(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : null;
}

function getAiCostRates(): AiCostRates | null {
  const inputPerMillionUsd = parseUsdRate(process.env.AI_WORKLOAD_INPUT_COST_PER_1M_USD);
  const outputPerMillionUsd = parseUsdRate(process.env.AI_WORKLOAD_OUTPUT_COST_PER_1M_USD);
  if (inputPerMillionUsd === null || outputPerMillionUsd === null) return null;

  return { inputPerMillionUsd, outputPerMillionUsd };
}

function estimateTokenCost(usage: TokenTotals, rates: AiCostRates) {
  const inputCostUsd = (usage.inputTokens * rates.inputPerMillionUsd) / 1_000_000;
  const outputCostUsd = (usage.outputTokens * rates.outputPerMillionUsd) / 1_000_000;

  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
  };
}

function asMegabytes(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function getDatabaseStorage() {
  try {
    const rows = await prisma.$queryRaw<DatabaseStorageRow[]>`
      SELECT
        CAST(COALESCE(SUM(CASE WHEN [type] = 0 THEN [size] ELSE 0 END), 0) * 8.0 / 1024.0 AS DECIMAL(18, 2)) AS [dataAllocatedMb],
        CAST(COALESCE(SUM(CASE WHEN [type] = 0 THEN ISNULL(FILEPROPERTY([name], 'SpaceUsed'), 0) ELSE 0 END), 0) * 8.0 / 1024.0 AS DECIMAL(18, 2)) AS [dataUsedMb],
        CAST(COALESCE(SUM(CASE WHEN [type] = 1 THEN [size] ELSE 0 END), 0) * 8.0 / 1024.0 AS DECIMAL(18, 2)) AS [logAllocatedMb],
        CAST(COALESCE(SUM([size]), 0) * 8.0 / 1024.0 AS DECIMAL(18, 2)) AS [totalAllocatedMb]
      FROM sys.database_files
    `;
    const row = rows[0];
    if (!row) return null;

    return {
      dataAllocatedMb: asMegabytes(row.dataAllocatedMb),
      dataUsedMb: asMegabytes(row.dataUsedMb),
      logAllocatedMb: asMegabytes(row.logAllocatedMb),
      totalAllocatedMb: asMegabytes(row.totalAllocatedMb),
    };
  } catch {
    return null;
  }
}

export async function getAdminOverview() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    totalWorkspaces,
    rawTotalTurns,
    recentTurnCount,
    activeMemoryCount,
    inactiveMemoryCount,
    memoryKinds,
    recentTurns,
    users,
    workspaces,
    allTimeTokens,
    archivedUsage,
    recentTokens,
    trackedTokenTurnCount,
    archivedUsageByUser,
    archivedUsageByWorkspace,
    databaseStorage,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count(),
    prisma.askNestTurn.count(),
    prisma.askNestTurn.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.askNestMemory.count({ where: { status: "ACTIVE" } }),
    prisma.askNestMemory.count({ where: { status: { not: "ACTIVE" } } }),
    prisma.askNestMemory.groupBy({
      by: ["kind"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
      orderBy: { _count: { kind: "desc" } },
    }),
    prisma.askNestTurn.findMany({
      take: 25,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        question: true,
        answerJson: true,
        pagePath: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        createdAt: true,
        workspace: { select: { name: true } },
        user: { select: { email: true, name: true } },
      },
    }),
    prisma.user.findMany({
      orderBy: [{ createdAt: "desc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        activeWorkspaceId: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            createdAt: true,
            workspace: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: {
            askNestTurns: true,
            askNestMemories: true,
            sessions: true,
          },
        },
      },
    }),
    prisma.workspace.findMany({
      orderBy: [{ createdAt: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        baseCurrency: true,
        isShared: true,
        createdAt: true,
        updatedAt: true,
        members: {
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          select: {
            role: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        _count: {
          select: {
            members: true,
            financials: true,
            transactions: true,
            budgetEnvelopes: true,
            creditCards: true,
            receivables: true,
            investmentAccounts: true,
            askNestTurns: true,
            askNestMemories: true,
          },
        },
      },
    }),
    prisma.askNestTurn.aggregate({
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    }),
    prisma.askNestUsageDaily.aggregate({
      _sum: {
        turnCount: true,
        trackedTurnCount: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
      },
    }),
    prisma.askNestTurn.aggregate({
      where: { createdAt: { gte: sevenDaysAgo } },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    }),
    prisma.askNestTurn.count({ where: { totalTokens: { not: null } } }),
    prisma.askNestUsageDaily.groupBy({
      by: ["userId"],
      _sum: { turnCount: true },
    }),
    prisma.askNestUsageDaily.groupBy({
      by: ["workspaceId"],
      _sum: { turnCount: true },
    }),
    getDatabaseStorage(),
  ]);
  const archivedTokenUsage = tokenTotals(archivedUsage);
  const allTimeTokenUsage = addTokenTotals(tokenTotals(allTimeTokens), archivedTokenUsage);
  const recentTokenUsage = tokenTotals(recentTokens);
  const costRates = getAiCostRates();
  const archivedTurnCount = archivedUsage._sum.turnCount ?? 0;
  const archivedTrackedTurnCount = archivedUsage._sum.trackedTurnCount ?? 0;
  const archivedTurnsByUser = new Map(
    archivedUsageByUser.map((entry) => [entry.userId, entry._sum.turnCount ?? 0]),
  );
  const archivedTurnsByWorkspace = new Map(
    archivedUsageByWorkspace.map((entry) => [entry.workspaceId, entry._sum.turnCount ?? 0]),
  );

  return {
    generatedAt: now,
    stats: {
      totalUsers,
      totalWorkspaces,
      totalTurns: rawTotalTurns + archivedTurnCount,
      recentTurnCount,
      activeMemoryCount,
      inactiveMemoryCount,
    },
    databaseStorage,
    tokenUsage: {
      allTime: allTimeTokenUsage,
      last7Days: recentTokenUsage,
      trackedTurnCount: trackedTokenTurnCount + archivedTrackedTurnCount,
      estimatedCost: costRates ? {
        rates: costRates,
        allTime: estimateTokenCost(allTimeTokenUsage, costRates),
        last7Days: estimateTokenCost(recentTokenUsage, costRates),
      } : null,
    },
    memoryKinds: memoryKinds.map((entry) => ({
      kind: entry.kind,
      count: entry._count._all,
    })),
    recentTurns: recentTurns.map((turn) => {
      const usage = {
        inputTokens: turn.inputTokens ?? 0,
        outputTokens: turn.outputTokens ?? 0,
        totalTokens: turn.totalTokens ?? 0,
      };
      return {
        id: turn.id,
        question: turn.question,
        pagePath: turn.pagePath,
        createdAt: turn.createdAt,
        workspaceName: turn.workspace.name,
        userLabel: turn.user.name || turn.user.email || "Unknown user",
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        totalTokens: turn.totalTokens,
        estimatedCostUsd: turn.totalTokens === null || !costRates
          ? null
          : estimateTokenCost(usage, costRates).totalCostUsd,
        ...parseAnswerMetadata(turn.answerJson),
      };
    }),
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      activeWorkspaceId: user.activeWorkspaceId,
      memberships: user.memberships.map((membership) => ({
        workspaceId: membership.workspace.id,
        workspaceName: membership.workspace.name,
        role: membership.role,
        joinedAt: membership.createdAt,
      })),
      counts: {
        ...user._count,
        askNestTurns: user._count.askNestTurns + (archivedTurnsByUser.get(user.id) ?? 0),
      },
    })),
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      baseCurrency: workspace.baseCurrency,
      isShared: workspace.isShared,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      members: workspace.members.map((membership) => ({
        userId: membership.user.id,
        userName: membership.user.name,
        userEmail: membership.user.email,
        role: membership.role,
        joinedAt: membership.createdAt,
      })),
      counts: {
        ...workspace._count,
        askNestTurns: workspace._count.askNestTurns + (archivedTurnsByWorkspace.get(workspace.id) ?? 0),
      },
    })),
    configuration: {
      adminConfigured: Boolean(process.env.ADMIN?.trim()),
      aiEndpointConfigured: Boolean(process.env.AI_WORKLOAD_ENDPOINT?.trim()),
      aiKeyConfigured: Boolean(process.env.AI_WORKLOAD_API_KEY?.trim()),
      aiModel: process.env.AI_WORKLOAD_MODEL?.trim() || null,
      aiCostRatesConfigured: Boolean(costRates),
      askNestHistoryRetentionDays: getAskNestHistoryRetentionDays(),
    },
  };
}
