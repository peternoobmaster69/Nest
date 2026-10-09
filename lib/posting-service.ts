import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { applyTransactionBudgetDelta } from "@/lib/budget-ledger";
import { prisma } from "@/lib/prisma";
import { PostingConflictError, PostingValidationError } from "@/lib/posting-errors";

export { PostingConflictError, PostingValidationError } from "@/lib/posting-errors";

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

type LedgerTransactionCorrection = {
  subject?: string;
  amountCents?: number;
  direction?: "DEBIT" | "CREDIT";
  kind?: "EXPENSE" | "INCOME" | "ADJUSTMENT";
  details?: string | null;
  notes?: string | null;
  date?: Date;
  budgetId?: string | null;
  groupId?: string | null;
};

const CORRECTABLE_TRANSACTION_KINDS = new Set(["EXPENSE", "INCOME", "ADJUSTMENT"]);
const CORRECTABLE_POSTING_OPERATIONS = new Set([
  "TRANSACTION_CREATE",
  "TRANSACTION_UPDATE",
  "TRANSACTION_BULK_IMPORT",
  "TRANSACTION_CORRECTION",
]);

const correctionTransactionSelect = {
  id: true,
  workspaceId: true,
  accountId: true,
  budgetId: true,
  groupId: true,
  kind: true,
  direction: true,
  date: true,
  amountCents: true,
  subject: true,
  details: true,
  notes: true,
  isSynced: true,
  isFromFamily: true,
  externalRef: true,
  creditCardTransactionId: true,
  receivableId: true,
  voidedAt: true,
  postingGroup: { select: { operation: true } },
  creditCardLinks: { take: 1, select: { id: true } },
} as const satisfies Prisma.TransactionSelect;

type CorrectionSourceTransaction = Prisma.TransactionGetPayload<{
  select: typeof correctionTransactionSelect;
}>;

type ReversalSourceTransaction = Pick<
  CorrectionSourceTransaction,
  | "id"
  | "workspaceId"
  | "accountId"
  | "budgetId"
  | "direction"
  | "amountCents"
  | "subject"
  | "notes"
  | "externalRef"
>;

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

function normalizeTransactionDirection(direction: string): "DEBIT" | "CREDIT" {
  if (direction === "CREDIT" || direction === "Incoming") return "CREDIT";
  if (direction === "DEBIT" || direction === "Outgoing") return "DEBIT";
  throw new PostingConflictError("Transaction has an unsupported ledger direction.");
}

function assertTransactionCanBeCorrected(transaction: CorrectionSourceTransaction) {
  const postingOperation = transaction.postingGroup?.operation;
  const hasUnsupportedPostingOperation = Boolean(
    postingOperation && !CORRECTABLE_POSTING_OPERATIONS.has(postingOperation),
  );
  const isLinkedWorkflow =
    Boolean(transaction.creditCardTransactionId) ||
    Boolean(transaction.receivableId) ||
    transaction.creditCardLinks.length > 0 ||
    hasUnsupportedPostingOperation;

  if (!CORRECTABLE_TRANSACTION_KINDS.has(transaction.kind) || isLinkedWorkflow) {
    throw new PostingConflictError(
      "This transaction belongs to a linked financial workflow and must be corrected from that workflow.",
    );
  }
}

async function createTransactionReversal(
  db: Prisma.TransactionClient,
  postingGroupId: string,
  original: ReversalSourceTransaction,
  reason: string,
) {
  const originalDirection = normalizeTransactionDirection(original.direction);
  const direction = originalDirection === "CREDIT" ? "DEBIT" : "CREDIT";

  return createLedgerTransaction(db, postingGroupId, {
    workspaceId: original.workspaceId,
    accountId: original.accountId,
    budgetId: original.budgetId,
    kind: "REVERSAL",
    direction,
    date: new Date(),
    amountCents: original.amountCents,
    subject: `Reversal: ${original.subject}`,
    details: reason,
    notes: original.notes,
    externalRef: original.externalRef ? `reversal:${original.externalRef}` : `reversal:${original.id}`,
    reversalOfId: original.id,
    isSynced: false,
    isFromFamily: false,
  });
}

export async function correctLedgerTransaction(params: {
  transactionId: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
  replacement: LedgerTransactionCorrection;
}) {
  const original = await prisma.transaction.findUnique({
    where: { id: params.transactionId },
    select: correctionTransactionSelect,
  });
  if (!original) throw new PostingConflictError("Transaction not found.");
  assertTransactionCanBeCorrected(original);

  return executePosting({
    workspaceId: original.workspaceId,
    operation: "TRANSACTION_CORRECTION",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.actorUserId,
    sourceType: "TRANSACTION",
    sourceId: original.id,
    request: {
      transactionId: original.id,
      reason: params.reason,
      replacement: params.replacement,
    },
    reason: params.reason,
  }, async (db, postingGroupId) => {
    return correctLedgerTransactionInPosting(db, postingGroupId, params);
  });
}

async function resolveCorrectionAllocation(
  db: Prisma.TransactionClient,
  current: CorrectionSourceTransaction,
  replacement: LedgerTransactionCorrection,
) {
  const nextBudgetId = replacement.budgetId === undefined
    ? current.budgetId
    : replacement.budgetId;
  const budgetChanged = nextBudgetId !== current.budgetId;
  let nextGroupId = replacement.groupId;
  if (nextGroupId === undefined) nextGroupId = budgetChanged ? null : current.groupId;

  if (nextGroupId && !nextBudgetId) {
    throw new PostingValidationError("A transaction group requires a selected sub-account.");
  }

  if (nextBudgetId) {
    const budget = await db.budgetEnvelope.findFirst({
      where: {
        id: nextBudgetId,
        workspaceId: current.workspaceId,
        accountId: current.accountId,
        ...(budgetChanged ? { isActive: true } : {}),
      },
      select: { id: true },
    });
    if (!budget) {
      throw new PostingValidationError("Selected sub-account does not belong to this transaction account.");
    }
  }

  if (nextGroupId) {
    const group = await db.transactionGroup.findFirst({
      where: {
        id: nextGroupId,
        workspaceId: current.workspaceId,
        budgetId: nextBudgetId!,
      },
      select: { id: true },
    });
    if (!group) throw new PostingValidationError("Selected group does not belong to this sub-account.");
  }

  return { nextBudgetId, nextGroupId };
}

/** Apply a correction within an existing atomic posting, retaining reversal history. */
export async function correctLedgerTransactionInPosting(
  db: Prisma.TransactionClient,
  postingGroupId: string,
  params: {
    transactionId: string;
    actorUserId: string;
    reason: string;
    replacement: LedgerTransactionCorrection;
  },
) {
  const locked = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT [id]
    FROM [Transaction] WITH (UPDLOCK, HOLDLOCK)
    WHERE [id] = ${params.transactionId}
  `);
  if (!locked[0]) throw new PostingConflictError("Transaction not found.");

  const current = await db.transaction.findUnique({
    where: { id: params.transactionId },
    select: correctionTransactionSelect,
  });
  if (!current || current.voidedAt) {
    throw new PostingConflictError("Transaction is already reversed or corrected.");
  }
  assertTransactionCanBeCorrected(current);

  const { nextBudgetId, nextGroupId } = await resolveCorrectionAllocation(db, current, params.replacement);

  const nextDirection = params.replacement.direction ?? normalizeTransactionDirection(current.direction);
  const nextAmountCents = params.replacement.amountCents ?? current.amountCents;
  const nextKind = (params.replacement.kind ?? current.kind) as "EXPENSE" | "INCOME" | "ADJUSTMENT";
  const reversal = await createTransactionReversal(db, postingGroupId, current, params.reason);

  const voided = await db.transaction.updateMany({
    where: { id: current.id, voidedAt: null },
    data: {
      voidedAt: new Date(),
      voidedByUserId: params.actorUserId,
      voidReason: params.reason,
    },
  });
  if (voided.count !== 1) {
    throw new PostingConflictError("Transaction is already reversed or corrected.");
  }

  const replacement = await createLedgerTransaction(db, postingGroupId, {
    workspaceId: current.workspaceId,
    accountId: current.accountId,
    budgetId: nextBudgetId,
    groupId: nextGroupId,
    kind: nextKind,
    direction: nextDirection,
    date: params.replacement.date ?? current.date,
    amountCents: nextAmountCents,
    subject: params.replacement.subject ?? current.subject,
    details: params.replacement.details === undefined ? current.details : params.replacement.details,
    notes: params.replacement.notes === undefined ? current.notes : params.replacement.notes,
    externalRef: `correction:${current.id}:${postingGroupId}`,
    isSynced: false,
    isFromFamily: current.isFromFamily,
  });

  const updatedBudgets = await applyTransactionBudgetDelta(db, {
    previousBudgetId: current.budgetId,
    previousDirection: current.direction,
    previousAmountCents: current.amountCents,
    nextBudgetId,
    nextDirection,
    nextAmountCents,
  });

  return {
    ok: true,
    correctedTransactionId: current.id,
    reversalTransactionId: reversal.id,
    replacementTransactionId: replacement.id,
    tx: replacement,
    updatedBudgets,
  };
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

    const direction = normalizeTransactionDirection(original.direction) === "CREDIT" ? "DEBIT" : "CREDIT";
    const reversal = await createTransactionReversal(db, postingGroupId, original, params.reason);

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
