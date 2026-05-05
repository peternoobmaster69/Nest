import { recalculateBudgetAvailableCents } from "@/lib/budget-ledger";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateTransactionSchema = z.object({
  workspaceId: z.string().min(1),
  accountId: z.string().min(1),
  subject: z.string().min(1).max(120),
  amountCents: z.number().int().positive(),
  direction: z.enum(["DEBIT", "CREDIT"]),
  kind: z.enum([
    "EXPENSE",
    "INCOME",
    "TRANSFER",
    "CREDIT_CARD_PAYMENT",
    "RECEIVABLE_PAYMENT",
    "ADJUSTMENT",
  ]),
  date: z.string().datetime(),
  details: z.string().max(500).optional(),
  notes: z.string().optional(),
  budgetId: z.string().min(1),
  budgetOperation: z.enum(["DEDUCT", "ADD"]),
});

const MAX_TRANSACTION_PAGE_LIMIT = 100;
const DEFAULT_TRANSACTION_PAGE_LIMIT = 50;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    const cursor = searchParams.get("cursor");
    const accountId = searchParams.get("accountId");
    const budgetId = searchParams.get("budgetId");
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");
    const wantsPaginatedResponse =
      searchParams.get("paginated") === "1" ||
      pageParam !== null ||
      limitParam !== null ||
      cursor !== null ||
      accountId !== null ||
      budgetId !== null;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const limit = Math.min(
      Math.max(Number.parseInt(limitParam || String(DEFAULT_TRANSACTION_PAGE_LIMIT), 10) || DEFAULT_TRANSACTION_PAGE_LIMIT, 1),
      MAX_TRANSACTION_PAGE_LIMIT,
    );
    const page = Math.max(Number.parseInt(pageParam || "1", 10) || 1, 1);
    const where: Record<string, unknown> = {
      workspaceId,
      ...(accountId ? { accountId } : {}),
      ...(budgetId && budgetId !== "ALL" ? { budgetId } : {}),
    };

    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) {
        (where.date as Record<string, Date>).gte = new Date(fromDate);
      }
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        (where.date as Record<string, Date>).lte = to;
      }
    }
    const select = {
      id: true,
      workspaceId: true,
      accountId: true,
      budgetId: true,
      kind: true,
      direction: true,
      date: true,
      amountCents: true,
      subject: true,
      details: true,
      notes: true,
      isSynced: true,
      isFromFamily: true,
      externalRef: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    if (wantsPaginatedResponse) {
      const txs = await prisma.transaction.findMany({
        where,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip: 1,
            }
          : { skip: (page - 1) * limit }),
        take: limit + 1,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select,
      });
      const hasMore = txs.length > limit;
      const pageItems = hasMore ? txs.slice(0, limit) : txs;
      const [total, summary] = await Promise.all([
        prisma.transaction.count({ where }),
        prisma.transaction.groupBy({
          by: ["direction"],
          where,
          _sum: { amountCents: true },
        }),
      ]);

      const incomeCents = summary.find((s) => s.direction === "CREDIT")?._sum.amountCents ?? 0;
      const expenseCents = summary.find((s) => s.direction === "DEBIT")?._sum.amountCents ?? 0;

      return NextResponse.json({
        transactions: pageItems.map((t) => ({
          ...t,
          date: t.date.toISOString(),
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        })),
        total,
        page,
        limit,
        hasMore,
        nextCursor: hasMore ? pageItems[pageItems.length - 1]?.id ?? null : null,
        summary: {
          incomeCents,
          expenseCents,
        },
      });
    }

    const txs = await prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select,
    });

    return NextResponse.json(
      txs.map((t) => ({
        ...t,
        date: t.date.toISOString(),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch transactions", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = CreateTransactionSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { budgetId, budgetOperation, ...txPayload } = parsed.data;
    await requireWorkspaceAccess(txPayload.workspaceId);

    const account = await prisma.financialAccount.findFirst({
      where: {
        id: txPayload.accountId,
        workspaceId: txPayload.workspaceId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!account) {
      return NextResponse.json({ error: "Invalid account for workspace." }, { status: 400 });
    }

    const normalizedDirection =
      budgetOperation === "ADD" ? "CREDIT" : budgetOperation === "DEDUCT" ? "DEBIT" : txPayload.direction;
    const normalizedKind =
      budgetOperation === "ADD" ? "ADJUSTMENT" : budgetOperation === "DEDUCT" ? "EXPENSE" : txPayload.kind;

    const created = await prisma.$transaction(async (db) => {
      const tx = await db.transaction.create({
        data: {
          ...txPayload,
          direction: normalizedDirection,
          kind: normalizedKind,
          budgetId,
          date: new Date(txPayload.date),
          isSynced: false,
        },
      });

      const budget = await db.budgetEnvelope.findFirst({
        where: { id: budgetId, workspaceId: txPayload.workspaceId, isActive: true },
        select: { id: true, accountId: true },
      });
      if (!budget) {
        throw new Error("Selected budget does not belong to workspace.");
      }
      if (budget.accountId !== txPayload.accountId) {
        throw new Error("Selected budget is linked to a different bank account.");
      }

      const updatedBudget = await recalculateBudgetAvailableCents(db, txPayload.workspaceId, budget.id);

      return { tx, updatedBudget };
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create transaction", message }, { status: 500 });
  }
}
