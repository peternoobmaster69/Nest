import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateTransactionSchema = z.object({
  transactionDate: z.string().datetime().optional(),
  paymentDueDate: z.string().datetime().optional().nullable(),
  statementMonth: z.number().int().min(1).max(12).optional(),
  statementYear: z.number().int().min(2020).max(2100).optional(),
  amountCents: z.number().int().min(0).optional(),
  subject: z.string().min(1).optional(),
  isInstallment: z.boolean().optional(),
  installmentNo: z.number().int().min(1).optional().nullable(),
  totalInstallments: z.number().int().min(1).optional().nullable(),
  isAllocated: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateTransactionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data: any = { ...parsed.data };
    if (data.transactionDate) {
      data.transactionDate = new Date(data.transactionDate);
    }
    if (data.paymentDueDate !== undefined) {
      data.paymentDueDate = data.paymentDueDate ? new Date(data.paymentDueDate) : null;
    }

    const transaction = await prisma.creditCardTransaction.update({
      where: { id },
      data,
      include: { creditCard: true },
    });

    return NextResponse.json(transaction);
  } catch (error) {
    console.error("Credit transaction update error:", error);
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.creditCardTransaction.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Credit transaction delete error:", error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
