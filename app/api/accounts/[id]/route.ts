import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateAccountSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  bankName: z.string().min(1).max(120).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  startingCents: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = UpdateAccountSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.financialAccount.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Bank account not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId);

    const updated = await prisma.financialAccount.update({
      where: { id },
      data: parsed.data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update bank account", message }, { status: 500 });
  }
}
