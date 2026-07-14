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

const PaymentDueMonthsQuerySchema = z.object({
  cardId: z.string().min(1).optional(),
  year: z.coerce.number().int().min(2020).max(2100),
});

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    const { searchParams } = new URL(request.url);
    const parsed = PaymentDueMonthsQuerySchema.safeParse({
      cardId: searchParams.get("cardId") || undefined,
      year: searchParams.get("year"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { cardId, year } = parsed.data;
    const where = {
      workspaceId,
      statementYear: year,
      ...(cardId && cardId !== "all" ? { creditCardId: cardId } : {}),
    };

    const [balances, dueDates] = await Promise.all([
      prisma.creditCardTransaction.groupBy({
        by: ["creditCardId", "statementMonth"],
        where,
        _sum: { amountCents: true },
      }),
      prisma.creditCardTransaction.groupBy({
        by: ["creditCardId", "statementMonth"],
        where: {
          ...where,
          amountCents: { gt: 0 },
        },
        _min: { paymentDueDate: true },
      }),
    ]);

    const balanceByStatement = new Map(
      balances.map((entry) => [
        `${entry.creditCardId}:${entry.statementMonth}`,
        entry._sum.amountCents ?? 0,
      ]),
    );
    const earliestDueDateByMonth = new Map<number, Date>();

    for (const entry of dueDates) {
      const balance = balanceByStatement.get(`${entry.creditCardId}:${entry.statementMonth}`) ?? 0;
      const dueDate = entry._min.paymentDueDate;
      if (balance <= 0 || !dueDate) continue;

      const current = earliestDueDateByMonth.get(entry.statementMonth);
      if (!current || dueDate.getTime() < current.getTime()) {
        earliestDueDateByMonth.set(entry.statementMonth, dueDate);
      }
    }

    return NextResponse.json({
      months: Array.from(earliestDueDateByMonth.entries())
        .sort(([monthA], [monthB]) => monthA - monthB)
        .map(([statementMonth, paymentDueDate]) => ({
          statementMonth,
          paymentDueDate: paymentDueDate.toISOString(),
        })),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load payment due months", message }, { status: 500 });
  }
}

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
