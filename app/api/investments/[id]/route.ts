import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateInvestmentAccountSchema = z.object({
  displayName: z.string().max(160).optional(),
  institutionName: z.string().min(1).max(160).optional(),
  productName: z.string().min(1).max(160).optional(),
  inceptionDate: z.iso.datetime().optional(),
  divestedDate: z.iso.datetime().nullable().optional(),
  isLiquid: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to update investment account" }, async () => {
    const { id } = await params;
    const parsed = UpdateInvestmentAccountSchema.safeParse(await parseJsonBody(request, z.unknown()));
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    const existing = await prisma.investmentAccount.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Investment account not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    const { divestedDate } = parsed.data;
    const updated = await prisma.investmentAccount.update({
      where: { id },
      data: {
        displayName: parsed.data.displayName === undefined ? undefined : parsed.data.displayName.trim() || null,
        institutionName: parsed.data.institutionName?.trim(),
        productName: parsed.data.productName?.trim(),
        inceptionDate: parsed.data.inceptionDate ? new Date(parsed.data.inceptionDate) : undefined,
        divestedDate: divestedDate ? new Date(divestedDate) : divestedDate,
        isLiquid: parsed.data.isLiquid,
      },
    });

    return NextResponse.json(updated);
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to delete investment account" }, async () => {
    const { id } = await params;
    const existing = await prisma.investmentAccount.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Investment account not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    await prisma.investmentAccount.delete({
      where: { id },
    });
    return NextResponse.json({ ok: true });
  });
}
