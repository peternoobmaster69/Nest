import { getBankConsistency } from "@/lib/bank-consistency";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateAccountSchema = z.object({
  workspaceId: z.string().optional(),
  name: z.string().max(120).default(""),
  bankName: z.string().min(1).max(120).optional(),
  startingCents: z.number().int().min(0).default(0),
  description: z.string().max(500).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json([]);
    }

    await requireWorkspaceAccess(workspaceId);

    const accounts = await prisma.financialAccount.findMany({
      where: { workspaceId, kind: "BANK" },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    const consistency = await getBankConsistency(prisma, workspaceId);
    const map = new Map(consistency.map((c) => [c.id, c]));

    return NextResponse.json(
      accounts.map((a) => ({
        ...a,
        currentBalanceCents: map.get(a.id)?.currentBalanceCents ?? a.startingCents,
        linkedBudgetTotalCents: map.get(a.id)?.linkedBudgetTotalCents ?? 0,
        discrepancyCents: map.get(a.id)?.discrepancyCents ?? a.startingCents,
      })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch bank accounts", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = CreateAccountSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    const { workspaceId } = await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");

    let bankType = await prisma.accountType.findFirst({
      where: { workspaceId, label: "Bank" },
    });

    if (!bankType) {
      bankType = await prisma.accountType.create({
        data: {
          workspaceId,
          label: "Bank",
          color: "#147349",
          sortOrder: 1,
          isActive: true,
        },
      });
    }

    const accountName = parsed.data.name.trim() || `${parsed.data.bankName || "Bank"} Account`;

    const account = await prisma.financialAccount.create({
      data: {
        workspaceId,
        accountTypeId: bankType.id,
        name: accountName,
        bankName: parsed.data.bankName,
        kind: "BANK",
        description: parsed.data.description,
        startingCents: parsed.data.startingCents,
        isActive: true,
        isSynced: false,
      },
    });

    return NextResponse.json({ workspaceId, account }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create bank account", message }, { status: 500 });
  }
}
