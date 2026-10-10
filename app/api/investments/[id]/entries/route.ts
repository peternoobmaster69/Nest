import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateInvestmentEntrySchema = z.object({
  date: z.iso.datetime(),
  investedCents: z.number().int(),
  currentValueCents: z.number().int(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to create investment entry" }, async () => {
    const { id } = await params;
    const parsed = CreateInvestmentEntrySchema.safeParse(await parseJsonBody(request, z.unknown()));
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
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
  });
}
