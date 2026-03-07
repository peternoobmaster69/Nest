import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateBudgetSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  icon: z.string().max(8).optional(),
  targetCents: z.number().int().min(0).optional(),
  availableCents: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = UpdateBudgetSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.budgetEnvelope.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.budgetEnvelope.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
