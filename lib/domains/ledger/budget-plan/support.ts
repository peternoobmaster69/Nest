import type { Prisma } from "@prisma/client";

export const ownerSelect = { id: true, name: true, email: true } as const;
export const destinationSelect = { id: true, name: true, availableCents: true } as const;

export class BudgetPlanRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BudgetPlanRequestError";
  }
}

export function monthlyPlanInclude() {
  return {
    sources: {
      include: { owner: { select: ownerSelect } },
      orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    },
    items: {
      include: { destinationSubAccount: { select: destinationSelect } },
      orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    },
  };
}

export function monthDate(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
}

export async function requireWorkspaceMember(
  db: Pick<Prisma.TransactionClient, "workspaceMember">,
  workspaceId: string,
  userId: string,
) {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { userId: true },
  });
  if (!member) {
    throw new BudgetPlanRequestError(400, "The selected owner is not a member of this workspace.");
  }
}

export async function requireWorkspaceDestination(
  db: Pick<Prisma.TransactionClient, "budgetEnvelope">,
  workspaceId: string,
  destinationSubAccountId?: string | null,
) {
  if (!destinationSubAccountId) return null;
  const destination = await db.budgetEnvelope.findFirst({
    where: { id: destinationSubAccountId, workspaceId },
    select: { id: true, accountId: true, name: true },
  });
  if (!destination) {
    throw new BudgetPlanRequestError(400, "The selected destination sub-account is not in this workspace.");
  }
  return destination;
}

export async function requireDraftPlan(
  db: Pick<Prisma.TransactionClient, "monthlyBudgetPlan">,
  workspaceId: string,
  planId: string,
) {
  const plan = await db.monthlyBudgetPlan.findFirst({
    where: { id: planId, workspaceId },
    select: { id: true, status: true, year: true, month: true },
  });
  if (!plan) throw new BudgetPlanRequestError(404, "Monthly budget plan not found.");
  if (plan.status !== "DRAFT") {
    throw new BudgetPlanRequestError(409, "Only draft monthly budget plans can be changed.");
  }
  return plan;
}

export async function nextMonthlyItemSortOrder(db: Prisma.TransactionClient, planId: string) {
  const result = await db.monthlyBudgetPlanItem.aggregate({
    where: { planId },
    _max: { sortOrder: true },
  });
  return (result._max.sortOrder ?? -1) + 1;
}

export async function nextMonthlySourceSortOrder(db: Prisma.TransactionClient, planId: string) {
  const result = await db.monthlyBudgetPlanSource.aggregate({
    where: { planId },
    _max: { sortOrder: true },
  });
  return (result._max.sortOrder ?? -1) + 1;
}
