import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateInvestmentAccountSchema = z.object({
  workspaceId: z.string().min(1),
  displayName: z.string().max(160).optional(),
  institutionName: z.string().min(1).max(160),
  productName: z.string().min(1).max(160),
  inceptionDate: z.iso.datetime(),
  divestedDate: z.iso.datetime().nullable().optional(),
  isLiquid: z.boolean().optional(),
});

export async function GET(request: Request) {
  return runSecureApiRoute(request, { errorMessage: "Failed to fetch investments" }, async () => {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const accounts = await prisma.investmentAccount.findMany({
      where: { workspaceId },
      take: 500,
      include: {
        entries: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 5_000,
        },
      },
      orderBy: [{ inceptionDate: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(
      accounts.map((account) => ({ ...account, entries: account.entries.toReversed() })),
    );
  });
}

export async function POST(request: Request) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to create investment account" }, async () => {
    const parsed = CreateInvestmentAccountSchema.safeParse(await parseJsonBody(request, z.unknown()));
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");

    const created = await prisma.investmentAccount.create({
      data: {
        workspaceId: parsed.data.workspaceId,
        displayName: parsed.data.displayName?.trim() || null,
        institutionName: parsed.data.institutionName.trim(),
        productName: parsed.data.productName.trim(),
        inceptionDate: new Date(parsed.data.inceptionDate),
        divestedDate: parsed.data.divestedDate ? new Date(parsed.data.divestedDate) : null,
        isLiquid: parsed.data.isLiquid ?? false,
      },
    });

    return NextResponse.json(created, { status: 201 });
  });
}
