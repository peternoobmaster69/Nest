import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateInvestmentAccountSchema = z.object({
  displayName: z.string().max(160).optional(),
  institutionName: z.string().min(1).max(160).optional(),
  productName: z.string().min(1).max(160).optional(),
  inceptionDate: z.string().datetime().optional(),
  divestedDate: z.string().datetime().nullable().optional(),
  isLiquid: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = UpdateInvestmentAccountSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.investmentAccount.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Investment account not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId);

    const updated = await prisma.investmentAccount.update({
      where: { id },
      data: {
        displayName: parsed.data.displayName === undefined ? undefined : parsed.data.displayName.trim() || null,
        institutionName: parsed.data.institutionName?.trim(),
        productName: parsed.data.productName?.trim(),
        inceptionDate: parsed.data.inceptionDate ? new Date(parsed.data.inceptionDate) : undefined,
        divestedDate: parsed.data.divestedDate === undefined ? undefined : parsed.data.divestedDate ? new Date(parsed.data.divestedDate) : null,
        isLiquid: parsed.data.isLiquid,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      message.includes("Unknown argument `displayName`") ||
      message.includes("Invalid column name 'displayName'") ||
      message.includes("Unknown argument `isLiquid`") ||
      message.includes("Invalid column name 'isLiquid'")
    ) {
      return NextResponse.json(
        {
          error: "Database schema is out of sync for investment account fields.",
          message: "Run `node scripts/run-prisma.mjs db push`, then restart the app server.",
        },
        { status: 500 },
      );
    }
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to update investment account", message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await prisma.investmentAccount.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Investment account not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId);

    await prisma.investmentAccount.delete({
      where: { id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to delete investment account", message }, { status: 500 });
  }
}
