import { Prisma, PrismaClient } from "@prisma/client";

function centsToAmount(cents: number) {
  return (cents / 100).toFixed(2);
}

export async function getWorkspaceNetWorthPayload(
  db: Prisma.TransactionClient | PrismaClient,
  workspaceId: string,
) {
  const [workspace, budgets, investmentAccounts] = await Promise.all([
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { baseCurrency: true },
    }),
    db.budgetEnvelope.findMany({
      take: 500,
      where: { workspaceId, isActive: true, isSavings: true },
      select: { availableCents: true },
    }),
    db.investmentAccount.findMany({
      take: 500,
      where: { workspaceId },
      select: {
        isLiquid: true,
        entries: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { currentValueCents: true },
        },
      },
    }),
  ]);

  const savingsCents = budgets.reduce((sum, budget) => sum + budget.availableCents, 0);
  const investmentCents = investmentAccounts.reduce(
    (sum, account) => sum + (account.entries[0]?.currentValueCents ?? 0),
    0,
  );
  const liquidInvestmentCents = investmentAccounts.reduce(
    (sum, account) => sum + (account.isLiquid ? (account.entries[0]?.currentValueCents ?? 0) : 0),
    0,
  );

  return {
    amount: centsToAmount(savingsCents + investmentCents),
    liquidAmt: centsToAmount(savingsCents + liquidInvestmentCents),
    base: "Savings",
    currency: workspace?.baseCurrency || "SGD",
  };
}
