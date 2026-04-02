import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateTransactionSchema = z.object({
  creditCardId: z.string().optional(),
  transactionDate: z.string().datetime().optional(),
  paymentDueDate: z.string().datetime().optional().nullable(),
  statementMonth: z.number().int().min(1).max(12).optional(),
  statementYear: z.number().int().min(2020).max(2100).optional(),
  amountCents: z.number().int().min(0).optional(),
  subject: z.string().min(1).optional(),
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

    const existing = await prisma.creditCardTransaction.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    await requireWorkspaceAccess(existing.workspaceId);

    const updatePayload = parsed.data;
    const data: Prisma.CreditCardTransactionUpdateInput = {};
    if (updatePayload.creditCardId !== undefined) {
      const card = await prisma.creditCardAccount.findFirst({
        where: { id: updatePayload.creditCardId, workspaceId: existing.workspaceId },
        select: { id: true },
      });
      if (!card) {
        return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
      }
      data.creditCard = { connect: { id: card.id } };
    }
    if (updatePayload.transactionDate) {
      data.transactionDate = new Date(updatePayload.transactionDate);
    }
    if (updatePayload.paymentDueDate !== undefined) {
      data.paymentDueDate = updatePayload.paymentDueDate ? new Date(updatePayload.paymentDueDate) : null;
    }
    if (updatePayload.statementMonth !== undefined) {
      data.statementMonth = updatePayload.statementMonth;
    }
    if (updatePayload.statementYear !== undefined) {
      data.statementYear = updatePayload.statementYear;
    }
    if (updatePayload.amountCents !== undefined) {
      data.amountCents = updatePayload.amountCents;
    }
    if (updatePayload.subject !== undefined) {
      data.subject = updatePayload.subject;
    }
    if (updatePayload.isAllocated !== undefined) {
      data.isAllocated = updatePayload.isAllocated;
    }
    data.isInstallment = false;
    data.installmentNo = null;
    data.totalInstallments = null;

    const transaction = await prisma.creditCardTransaction.update({
      where: { id },
      data,
      include: { creditCard: true },
    });

    return NextResponse.json(transaction);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Credit transaction update error:", error);
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await prisma.creditCardTransaction.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    await requireWorkspaceAccess(existing.workspaceId);
    await prisma.creditCardTransaction.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Credit transaction delete error:", error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
