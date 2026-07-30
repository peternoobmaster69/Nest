import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateReceivableSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1).max(120).optional(),
  amountCents: z.number().int().positive(),
  date: z.string().datetime().optional(),
  receivableDate: z.string().datetime().optional(),
  transactionDate: z.string().datetime().optional(),
  remarks: z.string().max(500).optional(),
  notes: z.string().optional(),
  accountId: z.string().optional(),
  budgetId: z.string().optional(),
  fromUserId: z.string().optional(),
  status: z.enum(["OPEN", "PARTIAL", "PAID", "VOID"]).default("OPEN"),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const access = await requireWorkspaceAccess(workspaceId);

    const receivables = await prisma.receivable.findMany({
      where: { workspaceId },
      include: {
        account: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            workspace: {
              select: { id: true, name: true },
            },
          },
        },
        budget: {
          select: {
            id: true,
            name: true,
            availableCents: true,
          },
        },
      },
      orderBy: { date: "desc" },
      take: 100,
    });
    const referencedSourceWorkspaceIds = [...new Set(receivables.map((item) => item.sourceWorkspaceId).filter((value): value is string => Boolean(value)))];
    const sourceMemberships = referencedSourceWorkspaceIds.length
      ? await prisma.workspaceMember.findMany({
          where: { userId: access.userId, workspaceId: { in: referencedSourceWorkspaceIds } },
          take: 500,
          select: { workspaceId: true },
        })
      : [];
    const allowedSourceWorkspaceIds = new Set([workspaceId, ...sourceMemberships.map((membership) => membership.workspaceId)]);
    const sourceAccountIds = [...new Set(receivables
      .filter((item) => item.sourceWorkspaceId && allowedSourceWorkspaceIds.has(item.sourceWorkspaceId))
      .map((item) => item.sourceAccountId)
      .filter((value): value is string => Boolean(value)))];
    const sourceBudgetIds = [...new Set(receivables
      .filter((item) => item.sourceWorkspaceId && allowedSourceWorkspaceIds.has(item.sourceWorkspaceId))
      .map((item) => item.sourceBudgetId)
      .filter((value): value is string => Boolean(value)))];
    const [sourceAccounts, sourceBudgets] = await Promise.all([
      sourceAccountIds.length
        ? prisma.financialAccount.findMany({
            where: { id: { in: sourceAccountIds }, workspaceId: { in: [...allowedSourceWorkspaceIds] } },
            take: 100,
            select: {
              id: true,
              name: true,
              workspaceId: true,
              workspace: {
                select: { id: true, name: true },
              },
            },
          })
        : Promise.resolve([]),
      sourceBudgetIds.length
        ? prisma.budgetEnvelope.findMany({
            where: { id: { in: sourceBudgetIds }, workspaceId: { in: [...allowedSourceWorkspaceIds] } },
            take: 100,
            select: {
              id: true,
              name: true,
              availableCents: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const sourceAccountById = new Map(sourceAccounts.map((account) => [account.id, account]));
    const sourceBudgetById = new Map(sourceBudgets.map((budget) => [budget.id, budget]));

    return NextResponse.json(
      receivables.map((receivable) => ({
        ...receivable,
        accountId: receivable.sourceAccountId ?? receivable.accountId,
        budgetId: receivable.sourceBudgetId ?? receivable.budgetId,
        account:
          (receivable.sourceAccountId ? sourceAccountById.get(receivable.sourceAccountId) : null) ??
          receivable.account,
        budget:
          (receivable.sourceBudgetId ? sourceBudgetById.get(receivable.sourceBudgetId) : null) ??
          receivable.budget,
      })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch receivables", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = CreateReceivableSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");

    let sourceWorkspaceId: string | null = null;
    if (parsed.data.accountId) {
      const account = await prisma.financialAccount.findUnique({
        where: { id: parsed.data.accountId },
        select: { id: true, workspaceId: true, kind: true, isActive: true },
      });
      if (!account || account.kind !== "BANK" || !account.isActive) {
        return NextResponse.json({ error: "Selected deduction account is invalid." }, { status: 400 });
      }
      await requireWorkspaceAccess(account.workspaceId, "EDITOR");
      sourceWorkspaceId = account.workspaceId;
    }

    if (parsed.data.budgetId) {
      if (!parsed.data.accountId || !sourceWorkspaceId) {
        return NextResponse.json({ error: "Selected deduction subaccount is invalid." }, { status: 400 });
      }
      const budget = await prisma.budgetEnvelope.findFirst({
        where: {
          id: parsed.data.budgetId,
          workspaceId: sourceWorkspaceId,
          accountId: parsed.data.accountId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!budget) {
        return NextResponse.json({ error: "Selected deduction subaccount is invalid." }, { status: 400 });
      }
    }

    const receivableDate = parsed.data.receivableDate ?? parsed.data.date;
    if (!receivableDate) {
      return NextResponse.json({ error: "receivableDate is required" }, { status: 400 });
    }

    const created = await prisma.receivable.create({
      data: {
        workspaceId: parsed.data.workspaceId,
        title: parsed.data.title ?? "Receivable",
        amountCents: parsed.data.amountCents,
        date: new Date(receivableDate),
        transactionDate: parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : null,
        remarkTogether: parsed.data.remarks,
        notes: parsed.data.notes,
        accountId: sourceWorkspaceId === parsed.data.workspaceId ? parsed.data.accountId : null,
        budgetId: sourceWorkspaceId === parsed.data.workspaceId ? parsed.data.budgetId : null,
        sourceWorkspaceId,
        sourceAccountId: parsed.data.accountId,
        sourceBudgetId: parsed.data.budgetId,
        fromUserId: parsed.data.fromUserId,
        status: parsed.data.status,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create receivable", message }, { status: 500 });
  }
}
