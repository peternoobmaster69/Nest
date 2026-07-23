import type { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  StartBlankSchema,
  StartFromSetupSchema,
} from "@/lib/domains/ledger/budget-plan/contracts";
import {
  BudgetPlanRequestError,
  monthlyPlanInclude,
  requireDraftPlan,
} from "@/lib/domains/ledger/budget-plan/support";

export async function startBlankMonthlyPlan(
  workspaceId: string,
  input: z.infer<typeof StartBlankSchema>,
) {
  return prisma.$transaction(async (db) => {
    const existing = await db.monthlyBudgetPlan.findFirst({
      where: { workspaceId, year: input.year, month: input.month },
      include: monthlyPlanInclude(),
    });
    if (existing) {
      if (existing.status !== "DRAFT") {
        throw new BudgetPlanRequestError(409, "This monthly budget plan is read-only.");
      }
      return existing;
    }
    return db.monthlyBudgetPlan.create({
      data: { workspaceId, year: input.year, month: input.month },
      include: monthlyPlanInclude(),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function startMonthlyPlanFromSetup(
  workspaceId: string,
  input: z.infer<typeof StartFromSetupSchema>,
) {
  return prisma.$transaction(async (db) => {
    const existing = await db.monthlyBudgetPlan.findFirst({
      where: { workspaceId, year: input.year, month: input.month },
      include: monthlyPlanInclude(),
    });
    if (existing && existing.status !== "DRAFT") {
      throw new BudgetPlanRequestError(409, "This monthly budget plan is read-only.");
    }
    if (existing && (existing.items.length > 0 || existing.sources.length > 0)) {
      throw new BudgetPlanRequestError(409, "Budget Setup can only be applied to an empty monthly draft.");
    }

    const [templateItems, templateSources, members] = await Promise.all([
      db.budgetItem.findMany({
        take: 500,
        where: { workspaceId, isActive: true, isMonthly: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      db.budgetSource.findMany({
        take: 500,
        where: { workspaceId, isActive: true },
        orderBy: { createdAt: "asc" },
      }),
      db.workspaceMember.findMany({
        take: 100,
        where: { workspaceId },
        select: { userId: true },
      }),
    ]);
    const memberIds = new Set(members.map((member) => member.userId));
    const invalidSource = templateSources.find((source) => !memberIds.has(source.ownerId));
    if (invalidSource) {
      throw new BudgetPlanRequestError(
        400,
        `Template source "${invalidSource.title}" has an owner outside this workspace.`,
      );
    }

    const destinationIds = [...new Set(
      templateItems
        .map((item) => item.destinationSubAccountId)
        .filter((id): id is string => Boolean(id)),
    )];
    if (destinationIds.length) {
      const validDestinations = await db.budgetEnvelope.findMany({
        take: 500,
        where: { workspaceId, id: { in: destinationIds } },
        select: { id: true },
      });
      if (validDestinations.length !== destinationIds.length) {
        throw new BudgetPlanRequestError(
          400,
          "Budget Setup contains a destination sub-account outside this workspace.",
        );
      }
    }

    const draft = existing ?? await db.monthlyBudgetPlan.create({
      data: { workspaceId, year: input.year, month: input.month },
    });
    if (templateSources.length) {
      await db.monthlyBudgetPlanSource.createMany({
        data: templateSources.map((source, index) => ({
          planId: draft.id,
          templateSourceId: source.id,
          title: source.title,
          ownerId: source.ownerId,
          amountCents: source.amountCents,
          sortOrder: index,
        })),
      });
    }
    if (templateItems.length) {
      await db.monthlyBudgetPlanItem.createMany({
        data: templateItems.map((item, index) => ({
          planId: draft.id,
          templateItemId: item.id,
          title: item.title,
          amountCents: item.amountCents,
          destinationSubAccountId: item.destinationSubAccountId,
          sortOrder: index,
        })),
      });
    }
    return db.monthlyBudgetPlan.findUniqueOrThrow({
      where: { id: draft.id },
      include: monthlyPlanInclude(),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function discardMonthlyDraft(workspaceId: string, planId: string) {
  await prisma.$transaction(async (db) => {
    await requireDraftPlan(db, workspaceId, planId);
    await db.monthlyBudgetPlanItem.deleteMany({ where: { planId } });
    await db.monthlyBudgetPlanSource.deleteMany({ where: { planId } });
    await db.monthlyBudgetPlan.delete({ where: { id: planId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

