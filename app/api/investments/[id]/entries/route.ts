import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateInvestmentEntrySchema = z.object({
  date: z.string().datetime(),
  investedCents: z.number().int(),
  currentValueCents: z.number().int(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = CreateInvestmentEntrySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const account = await prisma.investmentAccount.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!account) {
      return NextResponse.json({ error: "Investment account not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(account.workspaceId, "EDITOR");

    const created = await prisma.investmentEntry.create({
      data: {
        accountId: id,
        date: new Date(parsed.data.date),
        investedCents: parsed.data.investedCents,
        currentValueCents: parsed.data.currentValueCents,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create investment entry", message }, { status: 500 });
  }
}
