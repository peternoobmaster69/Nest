import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { deriveStatementCycle } from "@/lib/credit-card-statement-cycle";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateTransactionSchema = z.object({
  creditCardId: z.string().trim().min(1).max(191),
  transactionDate: z.iso.datetime(),
  paymentDueDate: z.iso.datetime().optional(),
  statementMonth: z.number().int().min(1).max(12),
  statementYear: z.number().int().min(2020).max(2100),
  amountCents: z.number().int(),
  subject: z.string().trim().min(1).max(500),
});

const DEFAULT_PAGE_LIMIT = 250;
const MAX_PAGE_LIMIT = 500;

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    const { searchParams } = new URL(request.url);
    const cardId = searchParams.get("cardId");
    const year = searchParams.get("year");
    const month = searchParams.get("month");
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    const cursor = searchParams.get("cursor");
    if ((cardId?.length ?? 0) > 191 || (cursor?.length ?? 0) > 191) {
      return NextResponse.json(
        { error: "Card id or cursor is too long", code: "INVALID_REQUEST" },
        { status: 400 },
      );
    }
    if (
      (year && (!/^\d{4}$/.test(year) || Number(year) < 2020 || Number(year) > 2100)) ||
      (month && (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12))
    ) {
      return NextResponse.json(
        { error: "Invalid statement period", code: "INVALID_REQUEST" },
        { status: 400 },
      );
    }

    const where: Prisma.CreditCardTransactionWhereInput = { workspaceId };

    if (cardId && cardId !== "all") {
      where.creditCardId = cardId;
    }

    if (year) {
      where.statementYear = Number.parseInt(year, 10);
    }

    if (month) {
      where.statementMonth = Number.parseInt(month, 10);
    }

    const page = Math.max(Number.parseInt(pageParam || "1", 10) || 1, 1);
    const limit = Math.min(
      Math.max(Number.parseInt(limitParam || String(DEFAULT_PAGE_LIMIT), 10) || DEFAULT_PAGE_LIMIT, 1),
      MAX_PAGE_LIMIT,
    );

    const cardCountWhere: Prisma.CreditCardTransactionWhereInput = {
      workspaceId,
      isAllocated: false,
    };

    if (year) {
      cardCountWhere.statementYear = Number.parseInt(year, 10);
    }

    if (month) {
      cardCountWhere.statementMonth = Number.parseInt(month, 10);
    }

    const unaccountedWhere: Prisma.CreditCardTransactionWhereInput = {
      ...where,
      isAllocated: false,
    };

    // Get the visible page plus aggregate totals for every matching transaction.
    const [transactions, total, summary, unaccountedSummary, cardCounts] = await Promise.all([
      prisma.creditCardTransaction.findMany({
        where,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip: 1,
            }
          : { skip: (page - 1) * limit }),
        take: limit + 1,
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          workspaceId: true,
          creditCardId: true,
          transactionDate: true,
          paymentDueDate: true,
          statementMonth: true,
          statementYear: true,
          amountCents: true,
          subject: true,
          isInstallment: true,
          installmentNo: true,
          totalInstallments: true,
          isAllocated: true,
          budgetId: true,
          createdAt: true,
          updatedAt: true,
          creditCard: {
            select: {
              id: true,
              cardName: true,
              bankName: true,
              last4Digit: true,
            },
          },
        },
      }),
      prisma.creditCardTransaction.count({ where }),
      prisma.creditCardTransaction.aggregate({
        where,
        _sum: { amountCents: true },
        _min: { paymentDueDate: true },
      }),
      prisma.creditCardTransaction.aggregate({
        where: unaccountedWhere,
        _sum: { amountCents: true },
      }),
      prisma.creditCardTransaction.groupBy({
        by: ["creditCardId"],
        where: cardCountWhere,
        _count: { id: true },
      }),
    ]);

    const hasMore = transactions.length > limit;
    const pageItems = hasMore ? transactions.slice(0, limit) : transactions;

    return NextResponse.json({
      transactions: pageItems,
      cardCounts,
      total,
      page,
      limit,
      hasMore,
      nextCursor: hasMore ? pageItems.at(-1)?.id ?? null : null,
      summary: {
        totalAmountCents: summary._sum.amountCents ?? 0,
        unaccountedAmountCents: unaccountedSummary._sum.amountCents ?? 0,
        earliestPaymentDueDate: summary._min.paymentDueDate?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Credit transactions fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch transactions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");
    const body = await request.json();
    const parsed = CreateTransactionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const {
      creditCardId,
      transactionDate,
      paymentDueDate,
      statementMonth,
      statementYear,
      amountCents,
      subject,
    } = parsed.data;

    // Verify credit card exists
    const card = await prisma.creditCardAccount.findUnique({
      where: { id: creditCardId },
      select: { id: true, workspaceId: true, statementDay: true, paymentDueDay: true },
    });

    if (card?.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
    }

    const parsedTransactionDate = new Date(transactionDate);
    const cycle = deriveStatementCycle({
      transactionDate: parsedTransactionDate,
      statementDay: card.statementDay,
      paymentDueDay: card.paymentDueDay,
    });

    const transaction = await prisma.creditCardTransaction.create({
      data: {
        workspaceId,
        creditCardId,
        transactionDate: parsedTransactionDate,
        paymentDueDate: paymentDueDate ? new Date(paymentDueDate) : cycle.paymentDueDate,
        statementMonth,
        statementYear,
        amountCents,
        subject,
        isInstallment: false,
        installmentNo: null,
        totalInstallments: null,
      },
      include: { creditCard: true },
    });

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Credit transaction create error:", error);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}
