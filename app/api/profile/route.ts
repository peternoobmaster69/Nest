import { prisma } from "@/lib/prisma";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(120),
});

export async function PATCH(request: Request) {
  const session = await getDatabaseReadyServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = UpdateProfileSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name.trim() },
    select: { id: true, name: true, email: true },
  });

  return NextResponse.json(user);
}
