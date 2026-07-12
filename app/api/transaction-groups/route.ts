import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateTransactionGroupSchema = z.object({
  workspaceId: z.string().min(1),
  budgetId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  icon: z.string().max(8).optional(),
  transactionIds: z.array(z.string().min(1)).min(1).max(100),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const budgetId = searchParams.get("budgetId");

    if (!workspaceId || !budgetId) {
      return NextResponse.json({ error: "workspaceId and budgetId are required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const budget = await prisma.budgetEnvelope.findFirst({
      where: { id: budgetId, workspaceId, isActive: true },
      select: { id: true },
    });
    if (!budget) {
      return NextResponse.json({ error: "Sub-account not found" }, { status: 404 });
    }

    const groups = await prisma.transactionGroup.findMany({
      where: { workspaceId, budgetId },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      include: {
        transactions: {
          select: { amountCents: true, direction: true, date: true },
        },
      },
    });

    return NextResponse.json(
      groups.map(({ transactions, ...group }) => {
        let incomeCents = 0;
        let expenseCents = 0;
        let firstTransactionDate: Date | null = null;
        let lastTransactionDate: Date | null = null;

        for (const transaction of transactions) {
          if (transaction.direction === "CREDIT") incomeCents += transaction.amountCents;
          else expenseCents += transaction.amountCents;
          if (!firstTransactionDate || transaction.date < firstTransactionDate) firstTransactionDate = transaction.date;
          if (!lastTransactionDate || transaction.date > lastTransactionDate) lastTransactionDate = transaction.date;
        }

        return {
          ...group,
          createdAt: group.createdAt.toISOString(),
          updatedAt: group.updatedAt.toISOString(),
          transactionCount: transactions.length,
          incomeCents,
          expenseCents,
          netCents: incomeCents - expenseCents,
          firstTransactionDate: firstTransactionDate?.toISOString() ?? null,
          lastTransactionDate: lastTransactionDate?.toISOString() ?? null,
        };
      }),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch transaction groups", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = CreateTransactionGroupSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { workspaceId, budgetId, name, icon, transactionIds } = parsed.data;
    await requireWorkspaceAccess(workspaceId);

    const uniqueTransactionIds = [...new Set(transactionIds)];
    const transactions = await prisma.transaction.findMany({
      where: { id: { in: uniqueTransactionIds }, workspaceId, budgetId },
      select: { id: true },
    });
    if (transactions.length !== uniqueTransactionIds.length) {
      return NextResponse.json(
        { error: "Every selected transaction must belong to this sub-account." },
        { status: 400 },
      );
    }

    const group = await prisma.$transaction(async (db) => {
      const created = await db.transactionGroup.create({
        data: { workspaceId, budgetId, name, icon },
      });
      await db.transaction.updateMany({
        where: { id: { in: uniqueTransactionIds }, workspaceId, budgetId },
        data: { groupId: created.id },
      });
      return created;
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create transaction group", message }, { status: 500 });
  }
}
