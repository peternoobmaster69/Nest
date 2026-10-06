import { Prisma, type PrismaClient } from "@prisma/client";

export type OutstandingCreditCardStatement = {
  workspaceId: string;
  workspaceName: string;
  cardId: string;
  cardName: string;
  bankName: string | null;
  last4Digit: string;
  statementMonth: number;
  statementYear: number;
  paymentDueDate: Date;
  outstandingCents: number | bigint;
};

type StatementOptions = {
  workspaceId?: string;
  activeOnly?: boolean;
  dueBefore?: Date;
  limit?: number;
};

/** Net the complete statement before applying any payment-due window. */
export function getOutstandingCreditCardStatements(
  db: Pick<PrismaClient, "$queryRaw">,
  options: StatementOptions = {},
) {
  // Payments and refunds reduce the balance, but their dates are not bill due dates.
  const dueDate = Prisma.sql`MIN(CASE WHEN cct.[amountCents] > 0 THEN cct.[paymentDueDate] END)`;
  const limit = options.limit === undefined ? Prisma.empty : Prisma.sql`TOP (${options.limit})`;
  const workspaceFilter = options.workspaceId === undefined
    ? Prisma.empty
    : Prisma.sql`AND cct.[workspaceId] = ${options.workspaceId}`;
  const activeFilter = options.activeOnly ? Prisma.sql`AND cc.[isActive] = 1` : Prisma.empty;
  const dueFilter = options.dueBefore === undefined
    ? Prisma.empty
    : Prisma.sql`AND ${dueDate} < ${options.dueBefore}`;

  return db.$queryRaw<OutstandingCreditCardStatement[]>(Prisma.sql`
    SELECT ${limit}
      cct.[workspaceId] AS [workspaceId],
      w.[name] AS [workspaceName],
      cct.[creditCardId] AS [cardId],
      cc.[cardName] AS [cardName],
      cc.[bankName] AS [bankName],
      cc.[last4Digit] AS [last4Digit],
      cct.[statementMonth] AS [statementMonth],
      cct.[statementYear] AS [statementYear],
      ${dueDate} AS [paymentDueDate],
      SUM(CAST(cct.[amountCents] AS BIGINT)) AS [outstandingCents]
    FROM [dbo].[CreditCardTransaction] cct
    INNER JOIN [dbo].[CreditCardAccount] cc
      ON cc.[id] = cct.[creditCardId] AND cc.[workspaceId] = cct.[workspaceId]
    INNER JOIN [dbo].[Workspace] w ON w.[id] = cct.[workspaceId]
    WHERE 1 = 1
      ${workspaceFilter}
      ${activeFilter}
    GROUP BY
      cct.[workspaceId], w.[name], cct.[creditCardId], cc.[cardName],
      cc.[bankName], cc.[last4Digit], cct.[statementMonth], cct.[statementYear]
    HAVING SUM(CAST(cct.[amountCents] AS BIGINT)) > 0
      AND ${dueDate} IS NOT NULL
      ${dueFilter}
    ORDER BY ${dueDate} ASC, cct.[workspaceId], cct.[creditCardId],
      cct.[statementYear], cct.[statementMonth]
  `);
}
