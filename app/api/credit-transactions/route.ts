import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { deriveStatementCycle } from "@/lib/credit-card-statement-cycle";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateTransactionSchema = z.object({
  creditCardId: z.string(),
  transactionDate: z.string().datetime(),
  paymentDueDate: z.string().datetime().optional(),
  statementMonth: z.number().int().min(1).max(12),
  statementYear: z.number().int().min(2020).max(2100),
  amountCents: z.number().int().min(0),
  subject: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    const { searchParams } = new URL(request.url);
    const cardId = searchParams.get("cardId");
    const year = searchParams.get("year");
    const month = searchParams.get("month");

    const where: Record<string, unknown> = { workspaceId };

    if (cardId && cardId !== "all") {
      where.creditCardId = cardId;
    }

    if (year) {
      where.statementYear = parseInt(year);
    }

    if (month) {
      where.statementMonth = parseInt(month);
    }

    const transactions = await prisma.creditCardTransaction.findMany({
      where,
      include: { creditCard: true },
      orderBy: { transactionDate: "desc" },
    });

    // Get counts per card
    const cardCounts = await prisma.creditCardTransaction.groupBy({
      by: ["creditCardId"],
      where: { workspaceId },
      _count: { id: true },
    });

    return NextResponse.json({ transactions, cardCounts });
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
    const { workspaceId } = await requireWorkspaceAccess();
    const body = await request.json();
    const parsed = CreateTransactionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
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

    if (!card || card.workspaceId !== workspaceId) {
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
