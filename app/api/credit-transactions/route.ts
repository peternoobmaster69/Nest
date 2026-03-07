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
  isInstallment: z.boolean().default(false),
  installmentNo: z.number().int().min(1).optional(),
  totalInstallments: z.number().int().min(1).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const cardId = searchParams.get("cardId");
    const year = searchParams.get("year");
    const month = searchParams.get("month");

    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace ID required" }, { status: 400 });
    }

    const where: any = { workspaceId };

    if (cardId && cardId !== "all") {
      where.creditCardId = cardId;
    }

    if (year && month) {
      where.statementYear = parseInt(year);
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
    console.error("Credit transactions fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch transactions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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
      isInstallment,
      installmentNo,
      totalInstallments,
    } = parsed.data;

    // Verify credit card exists
    const card = await prisma.creditCardAccount.findUnique({
      where: { id: creditCardId },
    });

    if (!card) {
      return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
    }

    const transaction = await prisma.creditCardTransaction.create({
      data: {
        workspaceId: card.workspaceId,
        creditCardId,
        transactionDate: new Date(transactionDate),
        paymentDueDate: paymentDueDate ? new Date(paymentDueDate) : null,
        statementMonth,
        statementYear,
        amountCents,
        subject,
        isInstallment,
        installmentNo,
        totalInstallments,
      },
      include: { creditCard: true },
    });

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    console.error("Credit transaction create error:", error);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}
