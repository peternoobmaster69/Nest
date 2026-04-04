import { PrismaClient } from "@prisma/client";

export type BankConsistencyRow = {
  id: string;
  name: string;
  currentBalanceCents: number;
  linkedBudgetTotalCents: number;
  discrepancyCents: number;
};

export async function getBankConsistency(prisma: PrismaClient, workspaceId: string): Promise<BankConsistencyRow[]> {
  const bankAccounts = await prisma.financialAccount.findMany({
    where: { workspaceId, kind: "BANK" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      startingCents: true,
    },
  });

  if (!bankAccounts.length) {
    return [];
  }

  const bankIds = bankAccounts.map((a) => a.id);

  const budgets = await prisma.budgetEnvelope.findMany({
    where: {
      workspaceId,
      accountId: { in: bankIds },
      isActive: true,
    },
    select: {
      accountId: true,
      availableCents: true,
    },
  });

  const budgetTotals = new Map<string, number>();
  for (const b of budgets) {
    budgetTotals.set(b.accountId, (budgetTotals.get(b.accountId) ?? 0) + b.availableCents);
  }

  return bankAccounts.map((bank) => {
    // Treat configured bank balance as source of truth.
    // Transactions should affect budgets/allocations, not mutate the bank's configured amount.
    const currentBalanceCents = bank.startingCents;
    const linkedBudgetTotalCents = budgetTotals.get(bank.id) ?? 0;
    return {
      id: bank.id,
      name: bank.name,
      currentBalanceCents,
      linkedBudgetTotalCents,
      discrepancyCents: currentBalanceCents - linkedBudgetTotalCents,
    };
  });
}
