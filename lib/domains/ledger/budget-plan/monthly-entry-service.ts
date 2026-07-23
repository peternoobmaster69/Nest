import type { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CreateMonthlyItemSchema,
  CreateMonthlySourceSchema,
  UpdateMonthlyItemSchema,
  UpdateMonthlySourceSchema,
} from "@/lib/domains/ledger/budget-plan/contracts";
import {
  BudgetPlanRequestError,
  destinationSelect,
  nextMonthlyItemSortOrder,
  nextMonthlySourceSortOrder,
  ownerSelect,
  requireDraftPlan,
  requireWorkspaceDestination,
  requireWorkspaceMember,
} from "@/lib/domains/ledger/budget-plan/support";

export async function createMonthlyItem(
  workspaceId: string,
  input: z.infer<typeof CreateMonthlyItemSchema>,
) {
  return prisma.$transaction(async (db) => {
    await requireDraftPlan(db, workspaceId, input.planId);
    await requireWorkspaceDestination(db, workspaceId, input.destinationSubAccountId);
    const sortOrder = await nextMonthlyItemSortOrder(db, input.planId);
    return db.monthlyBudgetPlanItem.create({
      data: {
        planId: input.planId,
        title: input.title,
        amountCents: input.amountCents,
        destinationSubAccountId: input.destinationSubAccountId ?? null,
        sortOrder,
      },
      include: { destinationSubAccount: { select: destinationSelect } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createMonthlySource(
  workspaceId: string,
  input: z.infer<typeof CreateMonthlySourceSchema>,
) {
  return prisma.$transaction(async (db) => {
    await requireDraftPlan(db, workspaceId, input.planId);
    await requireWorkspaceMember(db, workspaceId, input.ownerId);
    const sortOrder = await nextMonthlySourceSortOrder(db, input.planId);
    return db.monthlyBudgetPlanSource.create({
      data: {
        planId: input.planId,
        title: input.title,
        ownerId: input.ownerId,
        amountCents: input.amountCents,
        sortOrder,
      },
      include: { owner: { select: ownerSelect } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateMonthlyItem(
  workspaceId: string,
  input: z.infer<typeof UpdateMonthlyItemSchema>,
) {
  return prisma.$transaction(async (db) => {
    await requireDraftPlan(db, workspaceId, input.planId);
    await requireWorkspaceDestination(db, workspaceId, input.destinationSubAccountId);
    const existing = await db.monthlyBudgetPlanItem.findFirst({
      where: { id: input.id, planId: input.planId },
      select: { id: true },
    });
    if (!existing) throw new BudgetPlanRequestError(404, "Monthly budget item not found.");
    return db.monthlyBudgetPlanItem.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        amountCents: input.amountCents,
        destinationSubAccountId: input.destinationSubAccountId ?? null,
      },
      include: { destinationSubAccount: { select: destinationSelect } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateMonthlySource(
  workspaceId: string,
  input: z.infer<typeof UpdateMonthlySourceSchema>,
) {
  return prisma.$transaction(async (db) => {
    await requireDraftPlan(db, workspaceId, input.planId);
    await requireWorkspaceMember(db, workspaceId, input.ownerId);
    const existing = await db.monthlyBudgetPlanSource.findFirst({
      where: { id: input.id, planId: input.planId },
      select: { id: true },
    });
    if (!existing) throw new BudgetPlanRequestError(404, "Monthly budget source not found.");
    return db.monthlyBudgetPlanSource.update({
      where: { id: existing.id },
      data: { title: input.title, ownerId: input.ownerId, amountCents: input.amountCents },
      include: { owner: { select: ownerSelect } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteMonthlyItem(workspaceId: string, id: string) {
  await prisma.$transaction(async (db) => {
    const item = await db.monthlyBudgetPlanItem.findFirst({
      where: { id, plan: { workspaceId } },
      select: { id: true, planId: true },
    });
    if (!item) throw new BudgetPlanRequestError(404, "Monthly budget item not found.");
    await requireDraftPlan(db, workspaceId, item.planId);
    await db.monthlyBudgetPlanItem.delete({ where: { id: item.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteMonthlySource(workspaceId: string, id: string) {
  await prisma.$transaction(async (db) => {
    const source = await db.monthlyBudgetPlanSource.findFirst({
      where: { id, plan: { workspaceId } },
      select: { id: true, planId: true },
    });
    if (!source) throw new BudgetPlanRequestError(404, "Monthly budget source not found.");
    await requireDraftPlan(db, workspaceId, source.planId);
    await db.monthlyBudgetPlanSource.delete({ where: { id: source.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

