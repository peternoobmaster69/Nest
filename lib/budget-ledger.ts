import { Prisma, PrismaClient } from "@prisma/client";

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
