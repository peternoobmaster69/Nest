import { prisma } from "@/lib/prisma";
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
  const { id } = await params;
  const parsed = UpdateAccountSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.financialAccount.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(updated);
}
