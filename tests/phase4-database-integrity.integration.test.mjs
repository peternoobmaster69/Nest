import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const enabled = process.env.RUN_PHASE4_DB_TESTS === "true";

test("SQL Server rejects invalid states, duplicate tokens, and cross-workspace references", { skip: !enabled }, async () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const userId = `phase4-user-${suffix}`;
  const workspaceA = `phase4-a-${suffix}`;
  const workspaceB = `phase4-b-${suffix}`;
  const accountId = `phase4-account-${suffix}`;
  const publicToken = `phase4-token-${suffix}`;

  try {
    await prisma.user.create({ data: { id: userId, email: `${suffix}@phase4.invalid` } });
    await prisma.workspace.create({ data: { id: workspaceA, name: "Phase 4 A", publicNetWorthToken: publicToken } });
    await prisma.workspace.create({ data: { id: workspaceB, name: "Phase 4 B" } });
    await prisma.financialAccount.create({
      data: { id: accountId, workspaceId: workspaceA, name: "Integrity account", kind: "BANK" },
    });

    await assert.rejects(
      prisma.backgroundJob.create({ data: { type: "PHASE4_TEST", status: "NOT_A_STATUS" } }),
    );
    await assert.rejects(
      prisma.workspace.create({ data: { id: `phase4-c-${suffix}`, name: "Duplicate token", publicNetWorthToken: publicToken } }),
    );
    await assert.rejects(
      prisma.budgetEnvelope.create({
        data: {
          id: `phase4-budget-${suffix}`,
          workspaceId: workspaceB,
          accountId,
          name: "Cross workspace",
          createdById: userId,
        },
      }),
    );

    await prisma.idempotencyRecord.create({
      data: {
        id: `phase4-idem-a-${suffix}`,
        workspaceId: workspaceA,
        operation: "PHASE4_TEST",
        idempotencyKey: suffix,
        requestHash: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      },
    });
    await assert.rejects(
      prisma.idempotencyRecord.create({
        data: {
          id: `phase4-idem-b-${suffix}`,
          workspaceId: workspaceA,
          operation: "PHASE4_TEST",
          idempotencyKey: suffix,
          requestHash: "0".repeat(64),
        },
      }),
    );
  } finally {
    await prisma.idempotencyRecord.deleteMany({ where: { workspaceId: { in: [workspaceA, workspaceB] } } }).catch(() => undefined);
    await prisma.financialAccount.deleteMany({ where: { id: accountId } }).catch(() => undefined);
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceA, workspaceB, `phase4-c-${suffix}`] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
