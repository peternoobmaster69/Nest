import { getWorkspaceCardsDuePayload } from "@/lib/public-card-dues";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const PUBLIC_CARDS_DUE_HEADERS = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!token || token.length < 24) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

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

    const payload = await getWorkspaceCardsDuePayload(prisma, workspace.id);
    return NextResponse.json(payload, { headers: PUBLIC_CARDS_DUE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Failed to load cards due" }, { status: 500 });
  }
}
