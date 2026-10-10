import { runSecureApiRoute } from "@/lib/api-security";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { staleWriteResponse } from "@/lib/concurrency";
import { resolveReceivableSourceWorkspace } from "@/lib/receivable-source";

const UpdateReceivableSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  title: z.string().min(1).max(120).optional(),
  amountCents: z.number().int().positive().optional(),
  date: z.iso.datetime().optional(),
  transactionDate: z.iso.datetime().nullable().optional(),
  remarks: z.string().max(500).optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["OPEN", "PARTIAL", "PAID", "VOID"]).optional(),
  isFamily: z.boolean().optional(),
  isMom: z.boolean().optional(),
  accountId: z.string().nullable().optional(),
  budgetId: z.string().nullable().optional(),
});


function localReference(value: string | null | undefined, sourceWorkspaceId: string | null | undefined, workspaceId: string) {
  if (value === undefined) return undefined;
  return sourceWorkspaceId === workspaceId ? value : null;
}

function transactionDate(value: string | null | undefined) {
  return value == null ? value : new Date(value);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to update receivable" }, async () => {
    const { id } = await params;
    const parsed = UpdateReceivableSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    const existing = await prisma.receivable.findUnique({
      where: { id },
      select: { workspaceId: true, updatedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Receivable not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    const sourceWorkspaceId = await resolveReceivableSourceWorkspace(parsed.data);

    const result = await prisma.receivable.updateMany({
      where: { id, updatedAt: new Date(parsed.data.expectedUpdatedAt) },
      data: {
        title: parsed.data.title,
        amountCents: parsed.data.amountCents,
        date: parsed.data.date ? new Date(parsed.data.date) : undefined,
        transactionDate: transactionDate(parsed.data.transactionDate),
        remarkTogether: parsed.data.remarks,
        notes: parsed.data.notes,
        status: parsed.data.status,
        isFamily: parsed.data.isFamily,
        isMom: parsed.data.isMom,
        accountId: localReference(parsed.data.accountId, sourceWorkspaceId, existing.workspaceId),
        budgetId: localReference(parsed.data.budgetId, sourceWorkspaceId, existing.workspaceId),
        sourceWorkspaceId,
        sourceAccountId: parsed.data.accountId,
        sourceBudgetId: parsed.data.budgetId,
      },
    });
    if (result.count !== 1) {
      const current = await prisma.receivable.findUnique({ where: { id }, select: { updatedAt: true } });
      return staleWriteResponse(current?.updatedAt);
    }
    const updated = await prisma.receivable.findUniqueOrThrow({ where: { id } });
    return NextResponse.json(updated);
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to delete receivable" }, async () => {
    const { id } = await params;

    const existing = await prisma.receivable.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Receivable not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    await prisma.receivable.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
