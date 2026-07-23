import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateInvestmentAccountSchema = z.object({
  workspaceId: z.string().min(1),
  displayName: z.string().max(160).optional(),
  institutionName: z.string().min(1).max(160),
  productName: z.string().min(1).max(160),
  inceptionDate: z.string().datetime(),
  divestedDate: z.string().datetime().nullable().optional(),
  isLiquid: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const accounts = await prisma.investmentAccount.findMany({
      where: { workspaceId },
      include: {
        entries: {
          orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ inceptionDate: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(accounts);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch investments", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = CreateInvestmentAccountSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to create investment account", message }, { status: 500 });
  }
}
