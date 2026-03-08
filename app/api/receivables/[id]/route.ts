import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateReceivableSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  amountCents: z.number().int().positive().optional(),
  date: z.string().datetime().optional(),
  transactionDate: z.string().datetime().nullable().optional(),
  remarks: z.string().max(500).optional(),
  status: z.enum(["OPEN", "PARTIAL", "PAID", "VOID"]).optional(),
  isFamily: z.boolean().optional(),
  isMom: z.boolean().optional(),
  accountId: z.string().nullable().optional(),
  budgetId: z.string().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = UpdateReceivableSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.receivable.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Receivable not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId);

    if (parsed.data.accountId !== undefined && parsed.data.accountId !== null) {
      const account = await prisma.financialAccount.findUnique({
        where: { id: parsed.data.accountId },
        select: { id: true, workspaceId: true, kind: true, isActive: true },
      });
      if (!account || account.kind !== "BANK" || !account.isActive) {
        return NextResponse.json({ error: "Selected deduction account is invalid." }, { status: 400 });
      }
      await requireWorkspaceAccess(account.workspaceId);
    }

    const updated = await prisma.receivable.update({
      where: { id },
      data: {
        title: parsed.data.title,
        amountCents: parsed.data.amountCents,
        date: parsed.data.date ? new Date(parsed.data.date) : undefined,
        transactionDate:
          parsed.data.transactionDate === undefined
            ? undefined
            : parsed.data.transactionDate === null
              ? null
              : new Date(parsed.data.transactionDate),
        remarkTogether: parsed.data.remarks,
        status: parsed.data.status,
        isFamily: parsed.data.isFamily,
        isMom: parsed.data.isMom,
        accountId: parsed.data.accountId,
        budgetId: parsed.data.budgetId,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update receivable", message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const existing = await prisma.receivable.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Receivable not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId);

    await prisma.receivable.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to delete receivable", message }, { status: 500 });
  }
}
