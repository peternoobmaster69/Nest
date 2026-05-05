import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

// Schema for a single imported transaction
const ImportedTransactionSchema = z.object({
  AccountName: z.string().min(1),
  Direction: z.enum(["DEBIT", "CREDIT"]),
  Subject: z.string().min(1),
  Date: z.string(), // Accepts various date formats (YYYY-MM-DD or ISO)
  AmountCents: z.number().int().positive(),
  Details: z.string().optional(),
  Notes: z.string().optional(),
});

// Schema for the overall JSON input
const BulkImportSchema = z.object({
  workspaceId: z.string().min(1),
  accountId: z.string().min(1),
  budgetId: z.string().min(1),
  kind: z.string().default("Migration"),
  transactions: z.array(ImportedTransactionSchema).min(1).max(1000), // Max 1000 at a time
  chunkIndex: z.number().int().min(0).optional(), // For chunked processing
  chunkSize: z.number().int().min(1).max(100).optional(), // Max 100 per chunk
});

type ImportedTransaction = z.infer<typeof ImportedTransactionSchema>;

interface ImportResult {
  imported: number;
  duplicates: number;
  failed: number;
  errors: string[];
}

function normalizeDate(dateInput: string): Date {
  // Handle both "YYYY-MM-DD" and ISO format
  const trimmed = dateInput.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00.000Z`);
  }
  return new Date(trimmed);
}

function normalizeDirection(direction: string): "DEBIT" | "CREDIT" {
  // DEBIT = money going out, CREDIT = money coming in
  // Store as DEBIT/CREDIT to match existing transaction pattern
  return direction === "DEBIT" ? "DEBIT" : "CREDIT";
}

async function checkDuplicate(
  workspaceId: string,
  accountId: string,
  budgetId: string,
  tx: ImportedTransaction,
): Promise<boolean> {
  const normalizedDate = normalizeDate(tx.Date);
  // Check for duplicate: same date (day), subject, and amount
  const startOfDay = new Date(normalizedDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(normalizedDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const existing = await prisma.transaction.findFirst({
    where: {
      workspaceId,
      accountId,
      budgetId,
      date: {
        gte: startOfDay,
        lte: endOfDay,
      },
      subject: tx.Subject.trim(),
      amountCents: tx.AmountCents,
    },
    select: { id: true },
  });

  return existing !== null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = BulkImportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { workspaceId, accountId, budgetId, kind, transactions, chunkIndex, chunkSize } = parsed.data;

    await requireWorkspaceAccess(workspaceId);

    // Handle chunked processing
    const totalTransactions = transactions.length;
    const actualChunkSize = chunkSize || totalTransactions;
    const actualChunkIndex = chunkIndex ?? 0;
    const startIndex = actualChunkIndex * actualChunkSize;
    const endIndex = Math.min(startIndex + actualChunkSize, totalTransactions);
    const isChunked = chunkSize !== undefined && chunkSize < totalTransactions;

    // Get the slice to process
    const transactionsToProcess = isChunked ? transactions.slice(startIndex, endIndex) : transactions;

    // Validate account belongs to workspace
    const account = await prisma.financialAccount.findFirst({
      where: {
        id: accountId,
        workspaceId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!account) {
      return NextResponse.json({ error: "Invalid account for workspace." }, { status: 400 });
    }

    // Validate budget belongs to account/workspace
    const budget = await prisma.budgetEnvelope.findFirst({
      where: { id: budgetId, workspaceId, isActive: true },
      select: { id: true, accountId: true },
    });
    if (!budget) {
      return NextResponse.json({ error: "Invalid budget for workspace." }, { status: 400 });
    }
    if (budget.accountId !== accountId) {
      return NextResponse.json({ error: "Selected budget is linked to a different bank account." }, { status: 400 });
    }

    const result: ImportResult = {
      imported: 0,
      duplicates: 0,
      failed: 0,
      errors: [],
    };

    // Process each transaction - checking duplicates first
    const toImport: Array<{
      tx: ImportedTransaction;
      direction: "DEBIT" | "CREDIT";
      date: Date;
      isDuplicate: boolean;
    }> = [];

    for (const tx of transactionsToProcess) {
      try {
        const date = normalizeDate(tx.Date);
        if (isNaN(date.getTime())) {
          throw new Error(`Invalid date: ${tx.Date}`);
        }

        const direction = normalizeDirection(tx.Direction);
        const isDuplicate = await checkDuplicate(workspaceId, accountId, budgetId, tx);

        toImport.push({ tx, direction, date, isDuplicate });
        if (isDuplicate) {
          result.duplicates++;
        }
      } catch (error) {
        result.failed++;
        result.errors.push(`${tx.Subject}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // Now import non-duplicate transactions one by one to track success
    const nonDuplicates = toImport.filter((item) => !item.isDuplicate);

    if (nonDuplicates.length > 0) {
      // Generate IDs and create transactions individually to track success/failure
      const createPromises = nonDuplicates.map((item) => {
        const id = crypto.randomUUID?.() || `tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        return prisma.transaction
          .create({
            data: {
              id,
              workspaceId,
              accountId,
              budgetId,
              kind,
              direction: item.direction,
              date: item.date,
              amountCents: item.tx.AmountCents,
              subject: item.tx.Subject.trim(),
              details: item.tx.Details?.trim() || null,
              notes: item.tx.Notes?.trim() || null,
              isSynced: false,
              isFromFamily: false,
            },
          })
          .then(() => ({ success: true, subject: item.tx.Subject }))
          .catch((error) => ({ success: false, subject: item.tx.Subject, error: error instanceof Error ? error.message : "Unknown error" }));
      });

      // Type guard for failed result
      const isFailedResult = (r: { success: boolean; subject: string; error?: string }): r is { success: false; subject: string; error: string } =>
        !r.success;

      const results = await Promise.allSettled(createPromises);

      // Count successful imports
      let importedCount = 0;
      for (const resultItem of results) {
        if (resultItem.status === "fulfilled") {
          if (resultItem.value.success) {
            importedCount++;
          } else if (isFailedResult(resultItem.value)) {
            result.failed++;
            result.errors.push(`${resultItem.value.subject}: ${resultItem.value.error}`);
          }
        } else {
          result.failed++;
          result.errors.push("Transaction creation failed: " + String(resultItem.reason));
        }
      }

      result.imported = importedCount;
    }

    // Only recalculate budget on the last chunk or when there are imports
    const isLastChunk = !isChunked || endIndex >= totalTransactions;

    if (result.imported > 0 && isLastChunk) {
      await recalculateBudgetAvailableCents(prisma, workspaceId, budgetId);
    }

    return NextResponse.json({
      success: true,
      ...result,
      total: transactions.length,
      chunked: isChunked,
      chunkIndex: actualChunkIndex,
      chunkSize: actualChunkSize,
      processedCount: endIndex,
      remainingCount: Math.max(0, totalTransactions - endIndex),
      isComplete: isLastChunk,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to import transactions", message }, { status: 500 });
  }
}
