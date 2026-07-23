import { applyTransactionBudgetDelta } from "@/lib/budget-ledger";
import { createLedgerTransaction, executePosting, getIdempotencyKey, PostingConflictError } from "@/lib/domains/ledger";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import type { Prisma } from "@prisma/client";
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
  groupId: z.string().min(1).optional(),
  budgetOperation: z.enum(["DEDUCT", "ADD"]),
});

const MAX_TRANSACTION_PAGE_LIMIT = 100;
const DEFAULT_TRANSACTION_PAGE_LIMIT = 50;
const MONTH_FILTER_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function getMonthDateRange(monthKey: string) {
  if (!MONTH_FILTER_PATTERN.test(monthKey)) return null;

  const [year, month] = monthKey.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  return { start, end };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    const cursor = searchParams.get("cursor");
    const accountId = searchParams.get("accountId");
    const budgetId = searchParams.get("budgetId");
    const groupId = searchParams.get("groupId");
    const transactionId = searchParams.get("transactionId")?.trim() || "";
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");
    const monthKey = searchParams.get("month");
    const monthsParam = searchParams.get("months");
    const search = searchParams.get("search")?.trim() || "";
    if (search.length > 100 || transactionId.length > 191 || (cursor?.length ?? 0) > 191) {
      return NextResponse.json(
        { error: "Search, cursor, or transaction id is too long", code: "INVALID_REQUEST" },
        { status: 400 },
      );
    }
    const wantsPaginatedResponse =
      searchParams.get("paginated") === "1" ||
      pageParam !== null ||
      limitParam !== null ||
      cursor !== null ||
      accountId !== null ||
      budgetId !== null ||
      groupId !== null ||
      transactionId !== "" ||
      monthKey !== null ||
      monthsParam !== null ||
      fromDate !== null ||
      toDate !== null ||
      search !== "";

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const monthRange = monthKey && monthKey !== "ALL" ? getMonthDateRange(monthKey) : null;
    if (monthKey && monthKey !== "ALL" && !monthRange) {
      return NextResponse.json({ error: "month must be in YYYY-MM format" }, { status: 400 });
    }
    const selectedMonthKeys = monthsParam
      ? [...new Set(monthsParam.split(",").map((value) => value.trim()).filter(Boolean))]
      : [];
    if (selectedMonthKeys.length > 24 || selectedMonthKeys.some((value) => !MONTH_FILTER_PATTERN.test(value))) {
      return NextResponse.json({ error: "months must contain at most 24 YYYY-MM values" }, { status: 400 });
    }
    const selectedMonthRanges = selectedMonthKeys.map((value) => getMonthDateRange(value)!);

    const limit = Math.min(
      Math.max(Number.parseInt(limitParam || String(DEFAULT_TRANSACTION_PAGE_LIMIT), 10) || DEFAULT_TRANSACTION_PAGE_LIMIT, 1),
      MAX_TRANSACTION_PAGE_LIMIT,
    );
    const page = Math.max(Number.parseInt(pageParam || "1", 10) || 1, 1);
    const andFilters: Prisma.TransactionWhereInput[] = [];
    if (selectedMonthRanges.length) {
      andFilters.push({
        OR: selectedMonthRanges.map((range) => ({ date: { gte: range.start, lt: range.end } })),
      });
    }
    if (search) {
      andFilters.push({
        OR: [
          { subject: { contains: search } },
          { details: { contains: search } },
          { notes: { contains: search } },
        ],
      });
    }
    const where: Prisma.TransactionWhereInput = {
      workspaceId,
      voidedAt: null,
      kind: { not: "REVERSAL" },
      ...(transactionId ? { id: transactionId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(budgetId && budgetId !== "ALL" ? { budgetId } : {}),
      ...(groupId ? { groupId } : {}),
      ...(monthRange ? { date: { gte: monthRange.start, lt: monthRange.end } } : {}),
      ...(andFilters.length ? { AND: andFilters } : {}),
    };

    if ((fromDate || toDate) && !selectedMonthRanges.length) {
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
      groupId: true,
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
      group: { select: { id: true, name: true, icon: true } },
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
      take: MAX_TRANSACTION_PAGE_LIMIT,
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

    const { budgetId, groupId, budgetOperation, ...txPayload } = parsed.data;
    const { userId } = await requireWorkspaceAccess(txPayload.workspaceId, "EDITOR");

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

    const posting = await executePosting({
      workspaceId: txPayload.workspaceId,
      operation: "TRANSACTION_CREATE",
      idempotencyKey: getIdempotencyKey(request),
      actorUserId: userId,
      sourceType: "TRANSACTION_REQUEST",
      request: parsed.data,
    }, async (db, postingGroupId) => {
      const tx = await createLedgerTransaction(db, postingGroupId, {
          ...txPayload,
          direction: normalizedDirection,
          kind: normalizedKind,
          budgetId,
          date: new Date(txPayload.date),
          isSynced: false,
          isFromFamily: false,
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

      if (groupId) {
        const group = await db.transactionGroup.findFirst({
          where: { id: groupId, workspaceId: txPayload.workspaceId, budgetId },
          select: { id: true },
        });
        if (!group) throw new Error("Selected group does not belong to this sub-account.");
      }

      const linkedTx = groupId ? await db.transaction.update({ where: { id: tx.id }, data: { groupId } }) : tx;

      const [updatedBudget] = await applyTransactionBudgetDelta(db, {
        nextBudgetId: budget.id,
        nextDirection: linkedTx.direction,
        nextAmountCents: linkedTx.amountCents,
      });

      return { tx: linkedTx, updatedBudget };
    });

    return NextResponse.json(
      { ...posting.result, postingGroupId: posting.postingGroupId, replayed: posting.replayed },
      { status: posting.replayed ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PostingConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      message === "Selected budget does not belong to workspace." ||
      message === "Selected budget is linked to a different bank account." ||
      message === "Selected group does not belong to this sub-account."
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create transaction", message }, { status: 500 });
  }
}
