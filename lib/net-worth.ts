import { Prisma, PrismaClient } from "@prisma/client";

const SAVINGS_ICON = "\uD83D\uDEE1\uFE0F";

function getBudgetIcon(name: string, icon?: string | null) {
  if (icon) return icon;
  const lowerName = name.toLowerCase();
  if (lowerName.includes("savings") || lowerName.includes("emergency")) return SAVINGS_ICON;
  return "";
}

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
      where: { workspaceId, isActive: true },
      select: { name: true, icon: true, availableCents: true },
    }),
    db.investmentAccount.findMany({
      where: { workspaceId },
      select: {
        entries: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: 1,
          select: { currentValueCents: true },
        },
      },
    }),
  ]);

  const savingsCents = budgets
    .filter((budget) => getBudgetIcon(budget.name, budget.icon) === SAVINGS_ICON)
    .reduce((sum, budget) => sum + budget.availableCents, 0);
  const investmentCents = investmentAccounts.reduce(
    (sum, account) => sum + (account.entries[0]?.currentValueCents ?? 0),
    0,
  );

  return {
    amount: centsToAmount(savingsCents + investmentCents),
    base: "Savings",
    currency: workspace?.baseCurrency || "SGD",
  };
}
