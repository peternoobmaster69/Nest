import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const { workspaceId, userId } = await requireWorkspaceAccess();
    await prisma.gmailIntegration.updateMany({
      where: { workspaceId, userId, isActive: true },
      data: { isActive: false },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to disconnect Gmail", message }, { status: 500 });
  }
}

