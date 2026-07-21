import { getWorkspaceNetWorthPayload } from "@/lib/net-worth";
import { ensureDatabaseReady } from "@/lib/database-readiness";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

const PUBLIC_NET_WORTH_HEADERS = {
  "Cache-Control": "private, no-store",
};

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!token || token.length < 24) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await enforceDistributedRateLimit(request, {
      scope: "public-net-worth",
      identifier: token,
      limit: 60,
      windowMs: 60_000,
      blockMs: 5 * 60_000,
    });

    await ensureDatabaseReady();
    const workspace = await prisma.workspace.findFirst({
      where: {
        publicNetWorthEnabled: true,
        publicNetWorthToken: token,
      },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const payload = await getWorkspaceNetWorthPayload(prisma, workspace.id);
    return NextResponse.json(payload, { headers: PUBLIC_NET_WORTH_HEADERS });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: "Failed to load net worth" }, { status: 500 });
  }
}
