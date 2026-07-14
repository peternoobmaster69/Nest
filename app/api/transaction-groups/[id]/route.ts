import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateTransactionGroupSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  icon: z.string().max(8).nullable().optional(),
  addTransactionIds: z.array(z.string().min(1)).max(500).optional(),
  removeTransactionIds: z.array(z.string().min(1)).max(500).optional(),
});

const transactionOptionSelect = {
  id: true,
  subject: true,
  date: true,
  amountCents: true,
  direction: true,
  groupId: true,
  group: { select: { id: true, name: true, icon: true } },
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const search = new URL(request.url).searchParams.get("search")?.trim().slice(0, 120) ?? "";
    const group = await prisma.transactionGroup.findUnique({
      where: { id },
      select: { id: true, name: true, icon: true, workspaceId: true, budgetId: true },
    });
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    await requireWorkspaceAccess(group.workspaceId);

    const members = await prisma.transaction.findMany({
      where: {
        workspaceId: group.workspaceId,
        budgetId: group.budgetId,
        groupId: id,
        voidedAt: null,
        kind: { not: "REVERSAL" },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: transactionOptionSelect,
    });

    const candidates = await prisma.transaction.findMany({
      where: {
        workspaceId: group.workspaceId,
        budgetId: group.budgetId,
        voidedAt: null,
        kind: { not: "REVERSAL" },
        ...(search
          ? {
              OR: [
                { subject: { contains: search } },
                { details: { contains: search } },
                { notes: { contains: search } },
              ],
            }
          : { OR: [{ groupId: null }, { groupId: { not: id } }] }),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: search ? 150 : 100,
      select: transactionOptionSelect,
    });

    const options = new Map(search ? [] : members.map((transaction) => [transaction.id, transaction]));
    for (const transaction of candidates) options.set(transaction.id, transaction);

    return NextResponse.json({
      group: { id: group.id, name: group.name, icon: group.icon, budgetId: group.budgetId },
      memberIds: members.map((transaction) => transaction.id),
      transactions: [...options.values()].map((transaction) => ({
        ...transaction,
        date: transaction.date.toISOString(),
      })),
      candidateLimit: search ? 150 : 100,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch group transactions", message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = UpdateTransactionGroupSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const group = await prisma.transactionGroup.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, budgetId: true },
    });
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    await requireWorkspaceAccess(group.workspaceId);

    const addIds = [...new Set(parsed.data.addTransactionIds ?? [])];
    const removeIds = [...new Set(parsed.data.removeTransactionIds ?? [])];
    if (addIds.length) {
      const validTransactions = await prisma.transaction.count({
        where: {
          id: { in: addIds },
          workspaceId: group.workspaceId,
          budgetId: group.budgetId,
          voidedAt: null,
          kind: { not: "REVERSAL" },
        },
      });
      if (validTransactions !== addIds.length) {
        return NextResponse.json(
          { error: "Every selected transaction must belong to this group's sub-account." },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.$transaction(async (db) => {
      if (removeIds.length) {
        await db.transaction.updateMany({
          where: { id: { in: removeIds }, groupId: id },
          data: { groupId: null },
        });
      }
      if (addIds.length) {
        await db.transaction.updateMany({
          where: {
            id: { in: addIds },
            workspaceId: group.workspaceId,
            budgetId: group.budgetId,
            voidedAt: null,
            kind: { not: "REVERSAL" },
          },
          data: { groupId: id },
        });
      }
      return db.transactionGroup.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.icon !== undefined ? { icon: parsed.data.icon } : {}),
          ...((addIds.length || removeIds.length) ? { updatedAt: new Date() } : {}),
        },
      });
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update transaction group", message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const group = await prisma.transactionGroup.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    await requireWorkspaceAccess(group.workspaceId);

    await prisma.$transaction(async (db) => {
      await db.transaction.updateMany({ where: { groupId: id }, data: { groupId: null } });
      await db.transactionGroup.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to delete transaction group", message }, { status: 500 });
  }
}
