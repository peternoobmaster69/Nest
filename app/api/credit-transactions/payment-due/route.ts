import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdatePaymentDueSchema = z.object({
  cardId: z.string().optional(),
  statementMonth: z.number().int().min(1).max(12),
  statementYear: z.number().int().min(2020).max(2100),
  paymentDueDate: z.string().datetime().nullable(),
});

export async function PATCH(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    const parsed = UpdatePaymentDueSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { cardId, statementMonth, statementYear, paymentDueDate } = parsed.data;

    if (cardId) {
      const card = await prisma.creditCardAccount.findFirst({
        where: { id: cardId, workspaceId },
        select: { id: true },
      });
      if (!card) {
        return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
      }
    }

    const result = await prisma.creditCardTransaction.updateMany({
      where: {
        workspaceId,
        statementMonth,
        statementYear,
        ...(cardId ? { creditCardId: cardId } : {}),
      },
      data: {
        paymentDueDate: paymentDueDate ? new Date(paymentDueDate) : null,
      },
    });

    return NextResponse.json({ ok: true, updatedCount: result.count });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update payment due date", message }, { status: 500 });
  }
}
