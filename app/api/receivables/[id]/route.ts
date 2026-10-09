import { ApiRequestError, runSecureApiRoute } from "@/lib/api-security";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { staleWriteResponse } from "@/lib/concurrency";

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

async function resolveSourceWorkspace(data: z.infer<typeof UpdateReceivableSchema>) {
  let sourceWorkspaceId: string | null | undefined;
  if (data.accountId != null) {
    const account = await prisma.financialAccount.findUnique({
      where: { id: data.accountId },
      select: { id: true, workspaceId: true, kind: true, isActive: true },
    });
    if (account?.kind !== "BANK" || !account.isActive) {
      throw new ApiRequestError(400, "Selected deduction account is invalid.");
    }
    await requireWorkspaceAccess(account.workspaceId, "EDITOR");
    sourceWorkspaceId = account.workspaceId;
  } else if (data.accountId === null) {
    sourceWorkspaceId = null;
  }

  if (data.budgetId != null) {
    if (data.accountId == null || !sourceWorkspaceId) {
      throw new ApiRequestError(400, "Selected deduction subaccount is invalid.");
    }
    const budget = await prisma.budgetEnvelope.findFirst({
      where: { id: data.budgetId, workspaceId: sourceWorkspaceId, accountId: data.accountId, isActive: true },
      select: { id: true },
    });
    if (!budget) throw new ApiRequestError(400, "Selected deduction subaccount is invalid.");
  }
  return sourceWorkspaceId;
}

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

    const sourceWorkspaceId = await resolveSourceWorkspace(parsed.data);

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
