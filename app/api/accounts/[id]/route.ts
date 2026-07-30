import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { staleWriteResponse } from "@/lib/concurrency";

const UpdateAccountSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
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
      select: { workspaceId: true, updatedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Bank account not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    const { expectedUpdatedAt, ...data } = parsed.data;
    const result = await prisma.financialAccount.updateMany({
      where: { id, updatedAt: new Date(expectedUpdatedAt) },
      data,
    });
    if (result.count !== 1) {
      const current = await prisma.financialAccount.findUnique({ where: { id }, select: { updatedAt: true } });
      return staleWriteResponse(current?.updatedAt);
    }
    const updated = await prisma.financialAccount.findUniqueOrThrow({ where: { id } });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update bank account", message }, { status: 500 });
  }
}
