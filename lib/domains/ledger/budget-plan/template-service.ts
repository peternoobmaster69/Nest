import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import type {
  CreateTemplateItemSchema,
  CreateTemplateSourceSchema,
  UpdateTemplateItemSchema,
  UpdateTemplateSourceSchema,
} from "@/lib/domains/ledger/budget-plan/contracts";
import {
  BudgetPlanRequestError,
  destinationSelect,
  ownerSelect,
  requireWorkspaceDestination,
  requireWorkspaceMember,
} from "@/lib/domains/ledger/budget-plan/support";

export async function createTemplateItem(
  workspaceId: string,
  input: z.infer<typeof CreateTemplateItemSchema>,
) {
  await requireWorkspaceDestination(prisma, workspaceId, input.destinationSubAccountId);
  return prisma.budgetItem.create({
    data: {
      workspaceId,
      title: input.title,
      amountCents: input.amountCents,
      isMonthly: input.isMonthly,
      destinationSubAccountId: input.destinationSubAccountId ?? null,
    },
    include: { destinationSubAccount: { select: destinationSelect } },
  });
}

export async function createTemplateSource(
  workspaceId: string,
  input: z.infer<typeof CreateTemplateSourceSchema>,
) {
  await requireWorkspaceMember(prisma, workspaceId, input.ownerId);
  return prisma.budgetSource.create({
    data: {
      workspaceId,
      title: input.title,
      ownerId: input.ownerId,
      amountCents: input.amountCents,
    },
    include: { owner: { select: ownerSelect } },
  });
}

export async function updateTemplateItem(
  workspaceId: string,
  input: z.infer<typeof UpdateTemplateItemSchema>,
) {
  const existing = await prisma.budgetItem.findFirst({
    where: { id: input.id, workspaceId, isActive: true },
    select: { id: true },
  });
  if (!existing) throw new BudgetPlanRequestError(404, "Template budget item not found.");
  await requireWorkspaceDestination(prisma, workspaceId, input.destinationSubAccountId);
  return prisma.budgetItem.update({
    where: { id: existing.id },
    data: {
      title: input.title,
      amountCents: input.amountCents,
      isMonthly: input.isMonthly,
      destinationSubAccountId: input.destinationSubAccountId ?? null,
    },
    include: { destinationSubAccount: { select: destinationSelect } },
  });
}

export async function updateTemplateSource(
  workspaceId: string,
  input: z.infer<typeof UpdateTemplateSourceSchema>,
) {
  const existing = await prisma.budgetSource.findFirst({
    where: { id: input.id, workspaceId, isActive: true },
    select: { id: true },
  });
  if (!existing) throw new BudgetPlanRequestError(404, "Template budget source not found.");
  await requireWorkspaceMember(prisma, workspaceId, input.ownerId);
  return prisma.budgetSource.update({
    where: { id: existing.id },
    data: { title: input.title, ownerId: input.ownerId, amountCents: input.amountCents },
    include: { owner: { select: ownerSelect } },
  });
}

export async function archiveTemplateItem(workspaceId: string, id: string) {
  const existing = await prisma.budgetItem.findFirst({
    where: { id, workspaceId, isActive: true },
    select: { id: true },
  });
  if (!existing) throw new BudgetPlanRequestError(404, "Template budget item not found.");
  await prisma.budgetItem.update({ where: { id: existing.id }, data: { isActive: false } });
}

export async function archiveTemplateSource(workspaceId: string, id: string) {
  const existing = await prisma.budgetSource.findFirst({
    where: { id, workspaceId, isActive: true },
    select: { id: true },
  });
  if (!existing) throw new BudgetPlanRequestError(404, "Template budget source not found.");
  await prisma.budgetSource.update({ where: { id: existing.id }, data: { isActive: false } });
}

