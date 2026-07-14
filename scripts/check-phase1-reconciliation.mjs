import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT b.[workspaceId], COUNT(*) AS [drifted]
    FROM [BudgetEnvelope] b
    LEFT JOIN (
      SELECT [budgetId],
        SUM(CASE WHEN [direction] IN ('CREDIT', 'Incoming') THEN [amountCents] ELSE -[amountCents] END) AS ledger
      FROM [Transaction]
      WHERE [budgetId] IS NOT NULL
      GROUP BY [budgetId]
    ) t ON t.[budgetId] = b.[id]
    WHERE b.[isActive] = 1
      AND b.[availableCents] != COALESCE(t.ledger, 0)
    GROUP BY b.[workspaceId]
  `);
  console.log(JSON.stringify(rows, (_, value) => typeof value === "bigint" ? value.toString() : value));
} finally {
  await prisma.$disconnect();
}
