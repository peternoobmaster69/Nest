import type { PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { ensureDatabaseReady } from "@/lib/database-readiness";
import { prisma } from "@/lib/prisma";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

type PublicWorkspaceOptions<T> = {
  scope: string;
  errorMessage: string;
  load: (db: PrismaClient, workspaceId: string) => Promise<T>;
};

export async function publicWorkspaceResponse<T>(
  request: Request,
  params: Promise<{ token: string }>,
  options: PublicWorkspaceOptions<T>,
) {
  try {
    const { token } = await params;
    if (!token || token.length < 24) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await enforceDistributedRateLimit(request, {
      scope: options.scope,
      identifier: token,
      limit: 60,
      windowMs: 60_000,
      blockMs: 5 * 60_000,
    });
    await ensureDatabaseReady();
    const workspace = await prisma.workspace.findFirst({
      where: { publicNetWorthEnabled: true, publicNetWorthToken: token },
      select: { id: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const payload = await options.load(prisma, workspace.id);
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: options.errorMessage }, { status: 500 });
  }
}
