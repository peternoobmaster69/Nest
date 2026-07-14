import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { applyTransactionBudgetDelta } from "@/lib/budget-ledger";
import { prisma } from "@/lib/prisma";

export class PostingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingConflictError";
  }
}

type PostingOperation = {
  workspaceId: string;
  operation: string;
  idempotencyKey: string;
  actorUserId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  request: unknown;
  reversalOfId?: string | null;
  reason?: string | null;
};

type StoredIdempotency = {
  requestHash: string;
  status: string;
  resultJson: string | null;
  postingGroupId: string | null;
};

type PostingResult<T> = {
  result: T;
  postingGroupId: string;
  replayed: boolean;
};

type LedgerTransactionInput = Prisma.TransactionUncheckedCreateInput & {
  postingGroupId: string;
  creditCardTransactionId?: string | null;
  receivableId?: string | null;
  reversalOfId?: string | null;
};

export async function createPostingGroupRecord(
  db: Prisma.TransactionClient,
  params: {
    workspaceId: string;
    operation: string;
    idempotencyKey: string;
    actorUserId?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
  },
) {
  const id = randomUUID();
  await db.$executeRaw(Prisma.sql`
    INSERT INTO [PostingGroup]
      ([id], [workspaceId], [operation], [sourceType], [sourceId], [actorUserId],
       [idempotencyKey], [status], [createdAt])
    VALUES
      (${id}, ${params.workspaceId}, ${params.operation}, ${params.sourceType ?? null},
       ${params.sourceId ?? null}, ${params.actorUserId ?? null}, ${params.idempotencyKey},
       'POSTED', CURRENT_TIMESTAMP)
  `);
  return id;
}

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isUniqueConstraintError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2002") return true;
  return error.code === "P2010" && /duplicate|unique/i.test(JSON.stringify(error.meta ?? {}));
}

async function findIdempotencyRecord(
  db: Prisma.TransactionClient | PrismaClient,
  workspaceId: string,
  operation: string,
  idempotencyKey: string,
) {
  const rows = await db.$queryRaw<StoredIdempotency[]>(Prisma.sql`
    SELECT TOP 1 [requestHash], [status], [resultJson], [postingGroupId]
    FROM [IdempotencyRecord]
    WHERE [workspaceId] = ${workspaceId}
      AND [operation] = ${operation}
      AND [idempotencyKey] = ${idempotencyKey}
  `);
  return rows[0] ?? null;
}

function replayStoredResult<T>(stored: StoredIdempotency, hash: string): PostingResult<T> {
  if (stored.requestHash !== hash) {
    throw new PostingConflictError("Idempotency key was already used with a different request.");
  }
  if (stored.status !== "COMPLETED" || !stored.resultJson || !stored.postingGroupId) {
    throw new PostingConflictError("An operation with this idempotency key is still in progress.");
  }
  return {
    result: JSON.parse(stored.resultJson) as T,
    postingGroupId: stored.postingGroupId,
    replayed: true,
  };
}

export function getIdempotencyKey(request: Request, serverFallback?: string) {
  const supplied = request.headers.get("idempotency-key")?.trim();
  const key = supplied || serverFallback || randomUUID();
  if (key.length > 191) {
    throw new PostingConflictError("Idempotency key must not exceed 191 characters.");
  }
  return key;
}

export async function executePosting<T>(
  operation: PostingOperation,
  callback: (db: Prisma.TransactionClient, postingGroupId: string) => Promise<T>,
): Promise<PostingResult<T>> {
  const hash = requestHash(operation.request);
  const existing = await findIdempotencyRecord(
    prisma,
    operation.workspaceId,
    operation.operation,
    operation.idempotencyKey,
  );
  if (existing) return replayStoredResult<T>(existing, hash);

  const postingGroupId = randomUUID();
  const idempotencyRecordId = randomUUID();

  try {
    return await prisma.$transaction(async (db) => {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO [IdempotencyRecord]
          ([id], [workspaceId], [operation], [idempotencyKey], [requestHash], [status], [createdAt])
        VALUES
          (${idempotencyRecordId}, ${operation.workspaceId}, ${operation.operation},
           ${operation.idempotencyKey}, ${hash}, 'IN_PROGRESS', CURRENT_TIMESTAMP)
      `);

      await db.$executeRaw(Prisma.sql`
        INSERT INTO [PostingGroup]
          ([id], [workspaceId], [operation], [sourceType], [sourceId], [actorUserId],
           [idempotencyKey], [status], [reversalOfId], [reason], [createdAt])
        VALUES
          (${postingGroupId}, ${operation.workspaceId}, ${operation.operation},
           ${operation.sourceType ?? null}, ${operation.sourceId ?? null},
           ${operation.actorUserId ?? null}, ${operation.idempotencyKey}, 'POSTED',
           ${operation.reversalOfId ?? null}, ${operation.reason ?? null}, CURRENT_TIMESTAMP)
      `);

      const result = await callback(db, postingGroupId);
      const resultJson = JSON.stringify(result);

      await db.$executeRaw(Prisma.sql`
        UPDATE [IdempotencyRecord]
        SET [status] = 'COMPLETED', [postingGroupId] = ${postingGroupId},
            [resultJson] = ${resultJson}, [completedAt] = CURRENT_TIMESTAMP
        WHERE [id] = ${idempotencyRecordId}
      `);

      return { result, postingGroupId, replayed: false };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrent = await findIdempotencyRecord(
      prisma,
      operation.workspaceId,
      operation.operation,
      operation.idempotencyKey,
    );
    if (!concurrent) throw error;
    return replayStoredResult<T>(concurrent, hash);
  }
}

export async function createLedgerTransaction(
  db: Prisma.TransactionClient,
  postingGroupId: string,
  data: Omit<LedgerTransactionInput, "postingGroupId">,
) {
  return db.transaction.create({
    data: { ...data, postingGroupId } as Prisma.TransactionUncheckedCreateInput,
  });
}

export async function claimCreditCardTransaction(db: Prisma.TransactionClient, id: string) {
  const claimed = await db.creditCardTransaction.updateMany({
    where: { id, isAllocated: false },
    data: { isAllocated: true },
  });
  if (claimed.count !== 1) {
    throw new PostingConflictError("Credit transaction is already accounted.");
  }
}

export async function claimReceivable(db: Prisma.TransactionClient, id: string) {
  const claimed = await db.receivable.updateMany({
    where: { id, status: { notIn: ["PAID", "PROCESSING"] } },
    data: { status: "PROCESSING" },
  });
  if (claimed.count !== 1) {
    throw new PostingConflictError("Receivable is already closed.");
  }
}

export async function reverseLedgerTransaction(params: {
  transactionId: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
}) {
  const original = await prisma.transaction.findUnique({
    where: { id: params.transactionId },
    select: {
      id: true,
      workspaceId: true,
      accountId: true,
      budgetId: true,
      kind: true,
      direction: true,
      date: true,
      amountCents: true,
      subject: true,
      details: true,
      notes: true,
      externalRef: true,
    },
  });
  if (!original) throw new PostingConflictError("Transaction not found.");

  return executePosting({
    workspaceId: original.workspaceId,
    operation: "TRANSACTION_REVERSAL",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.actorUserId,
    sourceType: "TRANSACTION",
    sourceId: original.id,
    request: params,
    reason: params.reason,
  }, async (db, postingGroupId) => {
    const rows = await db.$queryRaw<Array<{ voidedAt: Date | null }>>(Prisma.sql`
      SELECT [voidedAt] FROM [Transaction] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${original.id}
    `);
    if (!rows[0] || rows[0].voidedAt) {
      throw new PostingConflictError("Transaction is already reversed.");
    }

    const direction = original.direction === "CREDIT" ? "DEBIT" : "CREDIT";
    const reversal = await createLedgerTransaction(db, postingGroupId, {
      workspaceId: original.workspaceId,
      accountId: original.accountId,
      budgetId: original.budgetId,
      kind: "REVERSAL",
      direction,
      date: new Date(),
      amountCents: original.amountCents,
      subject: `Reversal: ${original.subject}`,
      details: params.reason,
      notes: original.notes,
      externalRef: original.externalRef ? `reversal:${original.externalRef}` : `reversal:${original.id}`,
      reversalOfId: original.id,
      isSynced: false,
      isFromFamily: false,
    });

    await db.$executeRaw(Prisma.sql`
      UPDATE [Transaction]
      SET [voidedAt] = CURRENT_TIMESTAMP, [voidedByUserId] = ${params.actorUserId},
          [voidReason] = ${params.reason}
      WHERE [id] = ${original.id} AND [voidedAt] IS NULL
    `);

    await applyTransactionBudgetDelta(db, {
      nextBudgetId: original.budgetId,
      nextDirection: direction,
      nextAmountCents: original.amountCents,
    });

    const links = await db.$queryRaw<Array<{ creditCardTransactionId: string | null }>>(Prisma.sql`
      SELECT [creditCardTransactionId]
      FROM [CreditCardTxnLink]
      WHERE [transactionId] = ${original.id}
    `);
    const sourceCreditTransactionId = links[0]?.creditCardTransactionId;
    if (sourceCreditTransactionId) {
      await db.creditCardTransaction.updateMany({
        where: { id: sourceCreditTransactionId },
        data: { isAllocated: false },
      });
    }

    return { ok: true, reversedTransactionId: original.id, reversalTransactionId: reversal.id };
  });
}

export async function reconcileWorkspaceBudgets(db: PrismaClient, workspaceId: string) {
  const budgets = await db.budgetEnvelope.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true, availableCents: true },
  });
  const totals = await db.transaction.groupBy({
    by: ["budgetId", "direction"],
    where: { workspaceId, budgetId: { not: null } },
    _sum: { amountCents: true },
  });

  return budgets.map((budget) => {
    const ledgerCents = totals
      .filter((row) => row.budgetId === budget.id)
      .reduce((sum, row) => {
        const amount = row._sum.amountCents ?? 0;
        return sum + (row.direction === "CREDIT" || row.direction === "Incoming" ? amount : -amount);
      }, 0);
    return {
      budgetId: budget.id,
      budgetName: budget.name,
      materializedCents: budget.availableCents,
      ledgerCents,
      driftCents: budget.availableCents - ledgerCents,
    };
  });
}
