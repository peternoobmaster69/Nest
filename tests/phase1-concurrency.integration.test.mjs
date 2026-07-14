import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const enabled = process.env.RUN_PHASE1_DB_TESTS === "1";

test("SQL Server admits one journal claim for concurrent finance mutations", { skip: !enabled }, async () => {
  const prisma = new PrismaClient();
  const workspaceId = `phase1-test-${randomUUID()}`;
  const operations = [
    "CREDIT_CARD_PAYMENT",
    "CREDIT_ALLOCATION",
    "TRANSACTION_TRANSFER",
    "RECEIVABLE_CLOSE",
    "TRANSACTION_BULK_IMPORT",
    "CREDIT_AUTO_ACCOUNTING",
  ];

  try {
    for (const operation of operations) {
      const key = randomUUID();
      const insert = () => prisma.$executeRawUnsafe(`
        INSERT INTO [IdempotencyRecord]
          ([id], [workspaceId], [operation], [idempotencyKey], [requestHash], [status], [createdAt])
        VALUES
          ('${randomUUID()}', '${workspaceId}', '${operation}', '${key}',
           '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
           'IN_PROGRESS', CURRENT_TIMESTAMP)
      `);
      const raced = await Promise.allSettled([insert(), insert()]);
      assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1, operation);
      assert.equal(raced.filter((result) => result.status === "rejected").length, 1, operation);
    }

    const creditTransactionId = randomUUID();
    await prisma.$executeRawUnsafe(`
      INSERT INTO [CreditCardTransaction]
        ([id], [workspaceId], [creditCardId], [transactionDate], [statementMonth],
         [statementYear], [amountCents], [subject], [isInstallment], [isAllocated],
         [createdAt], [updatedAt])
      VALUES
        ('${creditTransactionId}', '${workspaceId}', 'phase1-card', CURRENT_TIMESTAMP,
         7, 2026, 100, 'Phase 1 concurrent claim', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const claimCredit = () => prisma.$executeRawUnsafe(`
      UPDATE [CreditCardTransaction]
      SET [isAllocated] = 1, [updatedAt] = CURRENT_TIMESTAMP
      WHERE [id] = '${creditTransactionId}' AND [isAllocated] = 0
    `);
    const creditClaims = await Promise.all([claimCredit(), claimCredit()]);
    assert.deepEqual([...creditClaims].sort(), [0, 1]);

    const receivableId = randomUUID();
    await prisma.$executeRawUnsafe(`
      INSERT INTO [Receivable]
        ([id], [workspaceId], [title], [amountCents], [date], [status], [createdAt], [updatedAt])
      VALUES
        ('${receivableId}', '${workspaceId}', 'Phase 1 concurrent close', 100,
         CURRENT_TIMESTAMP, 'OPEN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const claimReceivable = () => prisma.$executeRawUnsafe(`
      UPDATE [Receivable]
      SET [status] = 'PROCESSING', [updatedAt] = CURRENT_TIMESTAMP
      WHERE [id] = '${receivableId}' AND [status] <> 'PAID' AND [status] <> 'PROCESSING'
    `);
    const receivableClaims = await Promise.all([claimReceivable(), claimReceivable()]);
    assert.deepEqual([...receivableClaims].sort(), [0, 1]);
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM [IdempotencyRecord] WHERE [workspaceId] = '${workspaceId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM [CreditCardTransaction] WHERE [workspaceId] = '${workspaceId}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM [Receivable] WHERE [workspaceId] = '${workspaceId}'`);
    await prisma.$disconnect();
  }
});
