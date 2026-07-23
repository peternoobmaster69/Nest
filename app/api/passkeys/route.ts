import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { ApiAuthError, requireRecentAuthentication } from "@/lib/workspace-auth";

export async function GET() {
  const session = await getDatabaseReadyServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const passkeys = await prisma.passkeyCredential.findMany({
    take: 100,
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true },
  });
  return NextResponse.json({ passkeys });
}

export async function PATCH(request: Request) {
  const session = await getDatabaseReadyServerSession();
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
  try {
    const userId = await requireRecentAuthentication();
    const { id } = await request.json().catch(() => ({}));
    if (typeof id !== "string" || !id) return NextResponse.json({ error: "Passkey id is required" }, { status: 400 });
    await prisma.passkeyCredential.deleteMany({ where: { id, userId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to delete passkey" }, { status: 500 });
  }
}
