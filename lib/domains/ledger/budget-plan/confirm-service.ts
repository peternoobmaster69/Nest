import type { z } from "zod";
import type { Prisma } from "@prisma/client";
import { applyBudgetAvailableDelta } from "@/lib/budget-ledger";
import { executePosting } from "@/lib/domains/ledger";
import {
  getUnappliedMonthlyBudgetItemCents,
  summarizeMonthlyBudgetPlan,
} from "@/lib/monthly-budget-plan.mjs";
import type { ConfirmMonthlySchema } from "@/lib/domains/ledger/budget-plan/contracts";
import {
  BudgetPlanRequestError,
  monthDate,
  monthlyPlanInclude,
} from "@/lib/domains/ledger/budget-plan/support";

export async function confirmMonthlyBudget(params: {
  workspaceId: string;
  userId: string;
  input: z.infer<typeof ConfirmMonthlySchema>;
  idempotencyKey: string;
}) {
  const posting = await executePosting({
    workspaceId: params.workspaceId,
    operation: "MONTHLY_BUDGET_CONFIRM",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.userId,
    sourceType: "MONTHLY_BUDGET_PLAN",
    sourceId: params.input.planId,
    request: params.input,
  }, async (db, postingGroupId) => {
    const claimed = await db.monthlyBudgetPlan.updateMany({
      where: { id: params.input.planId, workspaceId: params.workspaceId, status: "DRAFT" },
      data: { status: "CONFIRMING" },
    });
    if (claimed.count === 0) {
      const current = await db.monthlyBudgetPlan.findFirst({
        where: { id: params.input.planId, workspaceId: params.workspaceId },
        include: monthlyPlanInclude(),
      });
      if (!current) throw new BudgetPlanRequestError(404, "Monthly budget plan not found.");
      if (current.status === "CONFIRMED") {
        return {
          monthlyPlan: current,
          appliedCents: 0,
          appliedToSubAccounts: current.items.some((item) => item.appliedCents > 0),
        };
      }
      throw new BudgetPlanRequestError(409, "This monthly budget plan is read-only.");
    }

    const plan = await db.monthlyBudgetPlan.findFirstOrThrow({
      where: { id: params.input.planId, workspaceId: params.workspaceId, status: "CONFIRMING" },
      include: monthlyPlanInclude(),
    });
    if (!plan.sources.length || !plan.items.length) {
      throw new BudgetPlanRequestError(
        400,
        "A monthly budget needs at least one source and one budget item before confirmation.",
      );
    }
    const summary = summarizeMonthlyBudgetPlan(plan.sources, plan.items);
    if (!summary.isBalanced) {
      throw new BudgetPlanRequestError(
        400,
        `Budget source total (${summary.sourceTotalCents}) must equal budget item total (${summary.itemTotalCents}).`,
      );
    }

    const ownerIds = [...new Set(plan.sources.map((source) => source.ownerId))];
    const destinationIds = [...new Set(
      plan.items
        .map((item) => item.destinationSubAccountId)
        .filter((id): id is string => Boolean(id)),
    )];
    const [validOwners, destinations] = await Promise.all([
      db.workspaceMember.findMany({
        take: 500,
        where: { workspaceId: params.workspaceId, userId: { in: ownerIds } },
        select: { userId: true },
      }),
      destinationIds.length
        ? db.budgetEnvelope.findMany({
            take: 500,
            where: {
              workspaceId: params.workspaceId,
              id: { in: destinationIds },
              ...(params.input.applyToSubAccounts ? { isActive: true } : {}),
            },
            select: { id: true, accountId: true },
          })
        : Promise.resolve([]),
    ]);
    if (validOwners.length !== ownerIds.length) {
      throw new BudgetPlanRequestError(400, "A monthly budget source has an owner outside this workspace.");
    }
    if (destinations.length !== destinationIds.length) {
      throw new BudgetPlanRequestError(
        400,
        params.input.applyToSubAccounts
          ? "A monthly budget item has an inactive or invalid destination sub-account."
          : "A monthly budget item has a destination outside this workspace.",
      );
    }
    const destinationById = new Map(destinations.map((destination) => [destination.id, destination]));

    let appliedCents = 0;
    if (params.input.applyToSubAccounts) {
      const deltaByDestination = new Map<string, number>();
      const transactionRows: Prisma.TransactionCreateManyInput[] = [];
      for (const item of plan.items) {
        const deltaCents = getUnappliedMonthlyBudgetItemCents(item.amountCents, item.appliedCents);
        if (!item.destinationSubAccountId || deltaCents <= 0) continue;
        const destination = destinationById.get(item.destinationSubAccountId);
        if (!destination) {
          throw new BudgetPlanRequestError(400, `Destination sub-account is missing for "${item.title}".`);
        }
        transactionRows.push({
          workspaceId: params.workspaceId,
          accountId: destination.accountId,
          budgetId: destination.id,
          kind: "ADJUSTMENT",
          direction: "CREDIT",
          date: monthDate(plan.year, plan.month),
          amountCents: deltaCents,
          subject: `Monthly budget item: ${item.title}`,
          details: `Confirmed budget for ${plan.month}/${plan.year}`,
          externalRef: `monthly-budget-plan:${plan.id}:${item.id}`,
        });
        deltaByDestination.set(
          destination.id,
          (deltaByDestination.get(destination.id) ?? 0) + deltaCents,
        );
        appliedCents += deltaCents;
        await db.monthlyBudgetPlanItem.update({
          where: { id: item.id },
          data: { appliedCents: item.amountCents },
        });
      }
      if (transactionRows.length) {
        const ledgerRows = transactionRows.map((row) => ({ ...row, postingGroupId })) as Prisma.TransactionCreateManyInput[];
        await db.transaction.createMany({ data: ledgerRows });
        for (const [destinationId, deltaCents] of deltaByDestination) {
          await applyBudgetAvailableDelta(db, destinationId, deltaCents);
        }
      }
    }

    await db.monthlyBudgetPlan.update({
      where: { id: plan.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    return {
      monthlyPlan: await db.monthlyBudgetPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: monthlyPlanInclude(),
      }),
      appliedCents,
      appliedToSubAccounts: params.input.applyToSubAccounts,
    };
  });
  return {
    ...posting.result,
    postingGroupId: posting.postingGroupId,
    replayed: posting.replayed,
  };
}

