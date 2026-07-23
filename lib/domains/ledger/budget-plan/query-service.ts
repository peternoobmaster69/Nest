import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { PeriodSchema } from "@/lib/domains/ledger/budget-plan/contracts";
import {
  destinationSelect,
  monthlyPlanInclude,
  ownerSelect,
} from "@/lib/domains/ledger/budget-plan/support";

export async function getBudgetPlan(
  workspaceId: string,
  period: z.infer<typeof PeriodSchema> | null,
) {
  const [items, sources, monthlyPlan, members, subAccounts] = await Promise.all([
    prisma.budgetItem.findMany({
      take: 500,
      where: { workspaceId, isActive: true },
      include: { destinationSubAccount: { select: destinationSelect } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.budgetSource.findMany({
      take: 500,
      where: { workspaceId, isActive: true },
      include: { owner: { select: ownerSelect } },
      orderBy: { createdAt: "asc" },
    }),
    period
      ? prisma.monthlyBudgetPlan.findFirst({
          where: { workspaceId, year: period.year, month: period.month },
          include: monthlyPlanInclude(),
        })
      : Promise.resolve(null),
    prisma.workspaceMember.findMany({
      take: 100,
      where: { workspaceId },
      include: { user: { select: ownerSelect } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.budgetEnvelope.findMany({
      take: 500,
      where: { workspaceId, isActive: true },
      select: destinationSelect,
      orderBy: { name: "asc" },
    }),
  ]);
  return { setup: { items, sources }, monthlyPlan, members, subAccounts };
}

