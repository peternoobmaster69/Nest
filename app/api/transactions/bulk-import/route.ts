import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

// Schema for a single imported transaction
const ImportedTransactionSchema = z.object({
  AccountName: z.string().min(1).optional(),
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
  chunkIndex: z.number().int().min(0).optional(),
  chunkSize: z.number().int().min(1).max(1000).optional(),
  recalculate: z.boolean().default(true),
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

function getUtcDayRange(date: Date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}

function getDuplicateKey(date: Date, subject: string, amountCents: number) {
  return `${getUtcDayRange(date).start.toISOString().slice(0, 10)}|${subject.trim()}|${amountCents}`;
}

function normalizeDirection(direction: string): "DEBIT" | "CREDIT" {
  // DEBIT = money going out, CREDIT = money coming in
  // Store as DEBIT/CREDIT to match existing transaction pattern
  return direction === "DEBIT" ? "DEBIT" : "CREDIT";
}

async function getExistingDuplicateKeys(
  workspaceId: string,
  accountId: string,
  budgetId: string,
  transactions: Array<{ date: Date; subject: string; amountCents: number }>,
) {
  if (transactions.length === 0) return new Set<string>();

  const existing = await prisma.transaction.findMany({
    where: {
      workspaceId,
      accountId,
      budgetId,
      OR: transactions.map((tx) => {
        const { start, end } = getUtcDayRange(tx.date);
        return {
          date: {
            gte: start,
            lt: end,
          },
          subject: tx.subject,
          amountCents: tx.amountCents,
        };
      }),
    },
    select: { date: true, subject: true, amountCents: true },
  });

  return new Set(existing.map((tx) => getDuplicateKey(tx.date, tx.subject, tx.amountCents)));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = BulkImportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { workspaceId, accountId, budgetId, kind, transactions, chunkIndex, chunkSize, recalculate } = parsed.data;

    await requireWorkspaceAccess(workspaceId);

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

    // Process exactly the transactions in this request. The client owns chunking.
    const toImport: Array<{
      tx: ImportedTransaction;
      direction: "DEBIT" | "CREDIT";
      date: Date;
      subject: string;
    }> = [];

    for (const tx of transactions) {
      try {
        const date = normalizeDate(tx.Date);
        if (isNaN(date.getTime())) {
          throw new Error(`Invalid date: ${tx.Date}`);
        }

        const direction = normalizeDirection(tx.Direction);
        const subject = tx.Subject.trim();

        toImport.push({ tx, direction, date, subject });
      } catch (error) {
        result.failed++;
        result.errors.push(`${tx.Subject}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    const existingDuplicateKeys = await getExistingDuplicateKeys(
      workspaceId,
      accountId,
      budgetId,
      toImport.map((item) => ({
        date: item.date,
        subject: item.subject,
        amountCents: item.tx.AmountCents,
      })),
    );
    const seenImportKeys = new Set<string>();
    const nonDuplicates = toImport.filter((item) => {
      const duplicateKey = getDuplicateKey(item.date, item.subject, item.tx.AmountCents);
      if (existingDuplicateKeys.has(duplicateKey) || seenImportKeys.has(duplicateKey)) {
        result.duplicates++;
        return false;
      }
      seenImportKeys.add(duplicateKey);
      return true;
    });

    if (nonDuplicates.length > 0) {
      const data: Prisma.TransactionCreateManyInput[] = nonDuplicates.map((item) => ({
        workspaceId,
        accountId,
        budgetId,
        kind,
        direction: item.direction,
        date: item.date,
        amountCents: item.tx.AmountCents,
        subject: item.subject,
        details: item.tx.Details?.trim() || null,
        notes: item.tx.Notes?.trim() || null,
        isSynced: false,
        isFromFamily: false,
      }));

      try {
        const createResult = await prisma.$transaction(async (db) => {
          const created = await db.transaction.createMany({ data });
          if (recalculate && created.count > 0) {
            await recalculateBudgetAvailableCents(db, workspaceId, budgetId);
          }
          return created;
        });
        result.imported = createResult.count;
      } catch (error) {
        result.failed += nonDuplicates.length;
        result.errors.push(`Transaction creation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    return NextResponse.json({
      success: true,
      ...result,
      total: transactions.length,
      chunked: chunkIndex !== undefined || chunkSize !== undefined,
      chunkIndex: chunkIndex ?? 0,
      chunkSize: chunkSize ?? transactions.length,
      processedCount: transactions.length,
      remainingCount: 0,
      isComplete: true,
      recalculated: recalculate && result.imported > 0,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to import transactions", message }, { status: 500 });
  }
}
