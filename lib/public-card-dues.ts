import { Prisma, PrismaClient } from "@prisma/client";
import { addUtcDays, startOfUtcDay } from "@/lib/credit-card-payment-reminder-schedule";

const DUE_WINDOW_DAYS = 14;

function statementKey(cardId: string, statementMonth: number, statementYear: number) {
  return `${cardId}:${statementYear}:${statementMonth}`;
}

function centsToAmount(cents: number) {
  return (cents / 100).toFixed(2);
}

export async function getWorkspaceCardsDuePayload(
  db: Prisma.TransactionClient | PrismaClient,
  workspaceId: string,
  now = new Date(),
) {
  const [balances, scheduledDueDates] = await Promise.all([
    db.creditCardTransaction.groupBy({
      by: ["creditCardId", "statementMonth", "statementYear"],
      where: { workspaceId },
      _sum: { amountCents: true },
    }),
    db.creditCardTransaction.groupBy({
      by: ["creditCardId", "statementMonth", "statementYear"],
      where: {
        workspaceId,
        amountCents: { gt: 0 },
        paymentDueDate: { not: null },
      },
      _min: { paymentDueDate: true },
    }),
  ]);

  const dueDateByStatement = new Map(
    scheduledDueDates.flatMap((row) => {
      if (!row._min.paymentDueDate) return [];
      return [[
        statementKey(row.creditCardId, row.statementMonth, row.statementYear),
        row._min.paymentDueDate,
      ] as const];
    }),
  );
  const today = startOfUtcDay(now);
  const dueWindowEndExclusive = addUtcDays(today, DUE_WINDOW_DAYS + 1);
  const dueByCard = new Map<string, { amountCents: number; dueDate: Date }>();

  for (const balance of balances) {
    const amountCents = balance._sum.amountCents ?? 0;
    const dueDate = dueDateByStatement.get(
      statementKey(balance.creditCardId, balance.statementMonth, balance.statementYear),
    );
    if (
      amountCents <= 0 ||
      !dueDate ||
      dueDate.getTime() < today.getTime() ||
      dueDate.getTime() >= dueWindowEndExclusive.getTime()
    ) {
      continue;
    }

    const current = dueByCard.get(balance.creditCardId);
    dueByCard.set(balance.creditCardId, {
      amountCents: (current?.amountCents ?? 0) + amountCents,
      dueDate: current && current.dueDate < dueDate ? current.dueDate : dueDate,
    });
  }

  const cardIds = [...dueByCard.keys()];
  const cards = cardIds.length
    ? await db.creditCardAccount.findMany({
        where: {
          workspaceId,
          id: { in: cardIds },
          isActive: true,
        },
        take: 500,
        select: {
          id: true,
          bankName: true,
          last4Digit: true,
        },
      })
    : [];
  const cardById = new Map(cards.map((card) => [card.id, card]));

  return {
    cards: [...dueByCard.entries()]
      .flatMap(([cardId, due]) => {
        const card = cardById.get(cardId);
        if (!card) return [];
        return [{
          bank: card.bankName,
          last4: card.last4Digit,
          amount: centsToAmount(due.amountCents),
          dueDate: due.dueDate,
        }];
      })
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .map(({ bank, last4, amount, dueDate }) => ({ bank, last4, amount, dueDate })),
  };
}
