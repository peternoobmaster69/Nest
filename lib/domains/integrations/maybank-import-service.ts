import type { Prisma } from "@prisma/client";
import { ApiRequestError } from "@/lib/api-security";
import { chunkValues } from "@/lib/api/batching";
import { deriveStatementCycle } from "@/lib/credit-card-statement-cycle";
import {
  normalizeTransactionSubject,
  parseMaybankCsv,
  shouldSkipMaybankRow,
} from "@/lib/maybank-csv";
import { executePosting } from "@/lib/domains/ledger";
import {
  MAX_MAYBANK_ROWS_PER_CHUNK,
  type MaybankImportInput,
} from "@/lib/domains/integrations/import-contracts";

export async function importMaybankChunk(params: {
  workspaceId: string;
  userId: string;
  input: MaybankImportInput;
  idempotencyKey: string;
}) {
  let parsedRows: ReturnType<typeof parseMaybankCsv>;
  try {
    parsedRows = parseMaybankCsv(params.input.csvContent);
  } catch (error) {
    throw new ApiRequestError(
      422,
      error instanceof Error ? error.message : "Invalid Maybank CSV",
    );
  }
  if (parsedRows.length > MAX_MAYBANK_ROWS_PER_CHUNK) {
    throw new ApiRequestError(
      413,
      `Maybank imports are limited to ${MAX_MAYBANK_ROWS_PER_CHUNK} rows per chunk`,
    );
  }

  const candidateRows = parsedRows.filter(
    (row) => !shouldSkipMaybankRow(row.description) && row.amountCents > 0,
  );
  const posting = await executePosting({
    workspaceId: params.workspaceId,
    operation: "MAYBANK_CSV_IMPORT",
    idempotencyKey: params.idempotencyKey,
    actorUserId: params.userId,
    sourceType: "IMPORT",
    sourceId: `${params.input.creditCardId}:${params.input.chunkIndex}`,
    request: params.input,
  }, async (db) => {
    const card = await db.creditCardAccount.findFirst({
      where: {
        id: params.input.creditCardId,
        workspaceId: params.workspaceId,
        isActive: true,
      },
      select: { id: true, statementDay: true, paymentDueDay: true },
    });
    if (!card) throw new ApiRequestError(404, "Credit card not found");

    const existingKeys = new Set<string>();
    for (const batch of chunkValues(candidateRows)) {
      const existing = await db.creditCardTransaction.findMany({
        take: 500,
        where: {
          workspaceId: params.workspaceId,
          creditCardId: card.id,
          OR: batch.map((row) => ({
            transactionDate: row.transactionDate,
            amountCents: row.amountCents,
          })),
        },
        select: { transactionDate: true, amountCents: true, subject: true },
      });
      for (const transaction of existing) {
        existingKeys.add([
          transaction.transactionDate.toISOString().slice(0, 10),
          transaction.amountCents,
          normalizeTransactionSubject(transaction.subject),
        ].join("|"));
      }
    }

    const seenImportKeys = new Set<string>();
    const data: Prisma.CreditCardTransactionCreateManyInput[] = [];
    let skippedDuplicates = 0;
    for (const row of candidateRows) {
      const key = [
        row.transactionDate.toISOString().slice(0, 10),
        row.amountCents,
        normalizeTransactionSubject(row.description),
      ].join("|");
      if (existingKeys.has(key) || seenImportKeys.has(key)) {
        skippedDuplicates += 1;
        continue;
      }
      const cycle = deriveStatementCycle({
        transactionDate: row.transactionDate,
        statementDay: card.statementDay,
        paymentDueDay: card.paymentDueDay,
      });
      data.push({
        workspaceId: params.workspaceId,
        creditCardId: card.id,
        transactionDate: row.transactionDate,
        paymentDueDate: cycle.paymentDueDate,
        statementMonth: cycle.statementMonth,
        statementYear: cycle.statementYear,
        amountCents: row.amountCents,
        subject: row.description,
        isInstallment: false,
      });
      seenImportKeys.add(key);
    }
    const created = data.length ? await db.creditCardTransaction.createMany({ data }) : { count: 0 };
    return {
      ok: true as const,
      imported: created.count,
      skippedDuplicates,
      skippedPayments: parsedRows.length - candidateRows.length,
      totalRows: parsedRows.length,
      chunkIndex: params.input.chunkIndex,
      totalChunks: params.input.totalChunks,
      isComplete: params.input.chunkIndex + 1 >= params.input.totalChunks,
    };
  });

  return {
    ...posting.result,
    replayed: posting.replayed,
    postingGroupId: posting.postingGroupId,
  };
}
