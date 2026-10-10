import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { staleWriteResponse } from "@/lib/concurrency";

const UpdateTransactionSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  creditCardId: z.string().optional(),
  transactionDate: z.iso.datetime().optional(),
  paymentDueDate: z.iso.datetime().optional().nullable(),
  statementMonth: z.number().int().min(1).max(12).optional(),
  statementYear: z.number().int().min(2020).max(2100).optional(),
  amountCents: z.number().int().optional(),
  subject: z.string().min(1).optional(),
  isAllocated: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to update transaction" }, async () => {
    const { id } = await params;
    const body = await parseJsonBody(request, z.unknown());
    const parsed = UpdateTransactionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const existing = await prisma.creditCardTransaction.findUnique({
      where: { id },
      select: { workspaceId: true, updatedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    const { expectedUpdatedAt, transactionDate, paymentDueDate, ...fields } = parsed.data;
    const data: Prisma.CreditCardTransactionUncheckedUpdateManyInput = {
      ...fields,
      isInstallment: false,
      installmentNo: null,
      totalInstallments: null,
    };
    if (fields.creditCardId !== undefined) {
      const card = await prisma.creditCardAccount.findFirst({
        where: { id: fields.creditCardId, workspaceId: existing.workspaceId },
        select: { id: true },
      });
      if (!card) {
        return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
      }
      data.creditCardId = card.id;
    }
    if (transactionDate !== undefined) {
      data.transactionDate = new Date(transactionDate);
    }
    if (paymentDueDate !== undefined) {
      data.paymentDueDate = paymentDueDate === null ? null : new Date(paymentDueDate);
    }

    const result = await prisma.creditCardTransaction.updateMany({
      where: { id, updatedAt: new Date(expectedUpdatedAt) },
      data,
    });
    if (result.count !== 1) {
      const current = await prisma.creditCardTransaction.findUnique({ where: { id }, select: { updatedAt: true } });
      return staleWriteResponse(current?.updatedAt);
    }
    const transaction = await prisma.creditCardTransaction.findUniqueOrThrow({ where: { id }, include: { creditCard: true } });

    return NextResponse.json(transaction);
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to delete transaction" }, async () => {
    const { id } = await params;
    const existing = await prisma.creditCardTransaction.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");
    await prisma.creditCardTransaction.delete({ where: { id } });
    return NextResponse.json({ success: true });
  });
}
