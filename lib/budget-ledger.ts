import { Prisma, PrismaClient } from "@prisma/client";

export function getBudgetAvailableDeltaCents(direction: string, amountCents: number) {
  if (direction === "CREDIT" || direction === "Incoming") return amountCents;
  if (direction === "DEBIT" || direction === "Outgoing") return -amountCents;
  return 0;
}

export async function applyBudgetAvailableDelta(
  db: Prisma.TransactionClient | PrismaClient,
  budgetId: string,
  deltaCents: number,
) {
  return db.budgetEnvelope.update({
    where: { id: budgetId },
    data: { availableCents: { increment: deltaCents } },
    select: {
      id: true,
      name: true,
      availableCents: true,
      targetCents: true,
    },
  });
}

export function getTransactionBudgetDelta(params: {
  previousBudgetId?: string | null;
  previousDirection?: string | null;
  previousAmountCents?: number | null;
  nextBudgetId?: string | null;
  nextDirection?: string | null;
  nextAmountCents?: number | null;
}) {
  const deltas = new Map<string, number>();

  if (params.previousBudgetId && params.previousDirection && params.previousAmountCents) {
    deltas.set(
      params.previousBudgetId,
      (deltas.get(params.previousBudgetId) ?? 0) -
        getBudgetAvailableDeltaCents(params.previousDirection, params.previousAmountCents),
    );
  }

  if (params.nextBudgetId && params.nextDirection && params.nextAmountCents) {
    deltas.set(
      params.nextBudgetId,
      (deltas.get(params.nextBudgetId) ?? 0) +
        getBudgetAvailableDeltaCents(params.nextDirection, params.nextAmountCents),
    );
  }

  return deltas;
}

export async function applyTransactionBudgetDelta(
  db: Prisma.TransactionClient | PrismaClient,
  params: Parameters<typeof getTransactionBudgetDelta>[0],
) {
  const deltas = getTransactionBudgetDelta(params);
  const updated = [];
  for (const [budgetId, deltaCents] of deltas) {
    if (deltaCents === 0) continue;
    updated.push(await applyBudgetAvailableDelta(db, budgetId, deltaCents));
  }
  return updated;
}

export async function recalculateBudgetAvailableCents(
  db: Prisma.TransactionClient | PrismaClient,
  workspaceId: string,
  budgetId: string,
) {
  const grouped = await db.transaction.groupBy({
    by: ["direction"],
    where: {
      workspaceId,
      budgetId,
    },
    _sum: {
      amountCents: true,
    },
  });

  let debitCents = 0;
  let creditCents = 0;
  for (const row of grouped) {
    // Handle both naming conventions:
    // "DEBIT" / "Outgoing" = money leaving (subtract)
    // "CREDIT" / "Incoming" = money arriving (add)
    if (row.direction === "DEBIT" || row.direction === "Outgoing") {
      debitCents += row._sum.amountCents ?? 0;
    } else if (row.direction === "CREDIT" || row.direction === "Incoming") {
      creditCents += row._sum.amountCents ?? 0;
    }
  }

  const availableCents = creditCents - debitCents;

  return db.budgetEnvelope.update({
    where: { id: budgetId },
    data: { availableCents },
    select: {
      id: true,
      name: true,
      availableCents: true,
      targetCents: true,
    },
  });
}
