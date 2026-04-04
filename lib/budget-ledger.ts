import { Prisma } from "@prisma/client";

export async function recalculateBudgetAvailableCents(
  db: Prisma.TransactionClient,
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
    if (row.direction === "DEBIT") {
      debitCents += row._sum.amountCents ?? 0;
    } else if (row.direction === "CREDIT") {
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
