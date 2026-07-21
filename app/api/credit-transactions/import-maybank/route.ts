import { deriveStatementCycle } from "@/lib/credit-card-statement-cycle";
import { parseMaybankCsv, normalizeTransactionSubject, shouldSkipMaybankRow } from "@/lib/maybank-csv";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { enforceDistributedRateLimit } from "@/lib/security-rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

const ImportMaybankSchema = z.object({
  creditCardId: z.string().min(1),
  csvContent: z.string().min(1),
});

export async function POST(request: Request) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to import Maybank CSV" }, async () => {
   try {
    const { workspaceId, userId } = await requireWorkspaceAccess(null, "EDITOR");
    await enforceDistributedRateLimit(request, {
      scope: "maybank-csv-import",
      identifier: `${workspaceId}:${userId}`,
      limit: 6,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
    const parsed = { data: await parseJsonBody(request, ImportMaybankSchema, 3 * 1024 * 1024) };

    const { creditCardId, csvContent } = parsed.data;

    const card = await prisma.creditCardAccount.findFirst({
      where: { id: creditCardId, workspaceId, isActive: true },
      select: { id: true, statementDay: true, paymentDueDay: true },
    });
    if (!card) {
      return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
    }

    const parsedRows = parseMaybankCsv(csvContent);
    const candidateRows = parsedRows.filter((row) => !shouldSkipMaybankRow(row.description) && row.amountCents > 0);

    if (!candidateRows.length) {
      return NextResponse.json({
        ok: true,
        imported: 0,
        skippedDuplicates: 0,
        skippedPayments: parsedRows.length,
        totalRows: parsedRows.length,
      });
    }

    const transactionDates = candidateRows.map((row) => row.transactionDate.getTime());
    const minDate = new Date(Math.min(...transactionDates));
    const maxDate = new Date(Math.max(...transactionDates));

    const existingTransactions = await prisma.creditCardTransaction.findMany({
      where: {
        workspaceId,
        creditCardId,
        transactionDate: {
          gte: minDate,
          lte: maxDate,
        },
      },
      select: {
        id: true,
        transactionDate: true,
        amountCents: true,
        subject: true,
      },
    });

    const existingKeys = new Set(
      existingTransactions.map((tx) =>
        [
          tx.transactionDate.toISOString().slice(0, 10),
          tx.amountCents,
          normalizeTransactionSubject(tx.subject),
        ].join("|"),
      ),
    );

    const seenImportKeys = new Set<string>();
    let imported = 0;
    let skippedDuplicates = 0;
    const skippedPayments = parsedRows.length - candidateRows.length;

    for (const row of candidateRows) {
      const subject = row.description;
      const key = [
        row.transactionDate.toISOString().slice(0, 10),
        row.amountCents,
        normalizeTransactionSubject(subject),
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

      await prisma.creditCardTransaction.create({
        data: {
          workspaceId,
          creditCardId,
          transactionDate: row.transactionDate,
          paymentDueDate: cycle.paymentDueDate,
          statementMonth: cycle.statementMonth,
          statementYear: cycle.statementYear,
          amountCents: row.amountCents,
          subject,
          isInstallment: false,
        },
      });

      existingKeys.add(key);
      seenImportKeys.add(key);
      imported += 1;
    }

    return NextResponse.json({
      ok: true,
      imported,
      skippedDuplicates,
      skippedPayments,
      totalRows: parsedRows.length,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
   }
  });
}
