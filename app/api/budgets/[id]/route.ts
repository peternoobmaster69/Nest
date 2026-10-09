import { runSecureApiRoute } from "@/lib/api-security";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateBudgetSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  icon: z.string().max(8).optional(),
  targetCents: z.number().int().min(0).optional(),
  availableCents: z.number().int().min(0).optional(),
  isSavings: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to update budget" }, async () => {
    const { id } = await params;
    const parsed = UpdateBudgetSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    const existing = await prisma.budgetEnvelope.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    const updated = await prisma.budgetEnvelope.update({
      where: { id },
      data: parsed.data,
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to delete budget" }, async () => {
    const { id } = await params;

    const existing = await prisma.budgetEnvelope.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    await prisma.budgetEnvelope.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
