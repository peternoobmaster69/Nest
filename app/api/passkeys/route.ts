import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const passkeys = await prisma.passkeyCredential.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true },
  });
  return NextResponse.json({ passkeys });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { id?: string; name?: string };
  const name = body.name?.trim().replace(/\s+/g, " ");
  if (!body.id) return NextResponse.json({ error: "Passkey id is required" }, { status: 400 });
  if (!name || name.length > 80) {
    return NextResponse.json({ error: "Passkey name must be between 1 and 80 characters" }, { status: 400 });
  }
  const result = await prisma.passkeyCredential.updateMany({
    where: { id: body.id, userId: session.user.id },
    data: { name },
  });
  if (!result.count) return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
  return NextResponse.json({ ok: true, name });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await request.json().catch(() => ({}));
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "Passkey id is required" }, { status: 400 });
  await prisma.passkeyCredential.deleteMany({ where: { id, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
