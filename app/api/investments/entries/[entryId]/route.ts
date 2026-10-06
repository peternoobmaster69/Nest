import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateInvestmentEntrySchema = z.object({
  date: z.iso.datetime().optional(),
  investedCents: z.number().int().optional(),
  currentValueCents: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  try {
    const { entryId } = await params;
    const parsed = UpdateInvestmentEntrySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    const existing = await prisma.investmentEntry.findUnique({
      where: { id: entryId },
      select: {
        account: {
          select: { workspaceId: true },
        },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Investment entry not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.account.workspaceId, "EDITOR");

    const updated = await prisma.investmentEntry.update({
      where: { id: entryId },
      data: {
        date: parsed.data.date ? new Date(parsed.data.date) : undefined,
        investedCents: parsed.data.investedCents,
        currentValueCents: parsed.data.currentValueCents,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update investment entry", message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ entryId: string }> }) {
  try {
    const { entryId } = await params;
    const existing = await prisma.investmentEntry.findUnique({
      where: { id: entryId },
      select: {
        account: {
          select: { workspaceId: true },
        },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Investment entry not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.account.workspaceId, "EDITOR");

    await prisma.investmentEntry.delete({
      where: { id: entryId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to delete investment entry", message }, { status: 500 });
  }
}
