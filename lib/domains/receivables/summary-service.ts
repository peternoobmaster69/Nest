import { prisma } from "@/lib/prisma";

const OPEN_STATUSES = ["OPEN", "PARTIAL"];

export async function getReceivableSummary(workspaceId: string) {
  const summary = await prisma.receivable.aggregate({
    where: { workspaceId, status: { in: OPEN_STATUSES } },
    _sum: { amountCents: true },
    _count: { id: true },
  });
  return {
    workspaceId,
    totalCents: summary._sum.amountCents ?? 0,
    count: summary._count.id ?? 0,
  };
}

export async function getReceivableSourceSummary(workspaceId: string, budgetId: string) {
  const summary = await prisma.receivable.aggregate({
    where: {
      sourceWorkspaceId: workspaceId,
      sourceBudgetId: budgetId,
      status: { in: OPEN_STATUSES },
    },
    _sum: { amountCents: true },
    _count: { id: true },
  });
  return {
    workspaceId,
    budgetId,
    receivableReservedCents: summary._sum.amountCents ?? 0,
    count: summary._count.id ?? 0,
  };
}

